import { useCallback, useState, type ChangeEvent } from 'react';
import { calculateChunkSize } from '../lib/chunk';
import {
  fileFingerprint,
  getUploadRecord,
  saveUploadRecord,
  markPartComplete,
  deleteUploadRecord,
  type UploadRecord,
} from '../lib/db';
import { initUpload, resumeUpload, completeUpload, API_BASE } from '../lib/api';

type Status = 'idle' | 'preparing' | 'uploading' | 'completed' | 'error';

export default function UploadForm() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setStatus('preparing');
    setProgress(0);
    setFileName(file.name);

    const fingerprint = fileFingerprint(file);
    let record: UploadRecord | undefined = await getUploadRecord(fingerprint);
    let sessionId: string;
    let chunkSize: number;
    let alreadyUploadedParts: number[] = [];

    try {
      if (record && record.status !== 'completed') {
        // Story 1.2 AC4: resume - ask the backend/S3 what's already there.
        const resumeData = await resumeUpload(record.sessionId);
        sessionId = resumeData.sessionId;
        chunkSize = resumeData.chunkSize;
        alreadyUploadedParts = resumeData.uploadedParts.map((p) => p.partNumber);
      } else {
        chunkSize = calculateChunkSize(file.size);
        const initData = await initUpload(file.name, file.size, chunkSize);
        sessionId = initData.sessionId;
        record = {
          fingerprint,
          sessionId,
          filename: file.name,
          totalSize: file.size,
          chunkSize,
          objectKey: initData.objectKey,
          completedParts: {},
          status: 'in_progress',
          updatedAt: Date.now(),
        };
        await saveUploadRecord(record);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start upload');
      setStatus('error');
      return;
    }

    setStatus('uploading');

    const worker = new Worker(new URL('../workers/uploadWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'progress') {
        if (!msg.skipped && msg.etag) {
          await markPartComplete(fingerprint, msg.partNumber, msg.etag);
        }
        setProgress(Math.round((msg.partNumber / msg.totalParts) * 100));
        return;
      }

      if (msg.type === 'error') {
        setError(`Part ${msg.partNumber} failed after retries: ${msg.message}`);
        setStatus('error');
        worker.terminate();
        return;
      }

      if (msg.type === 'done') {
        try {
          await completeUpload(sessionId);
          await deleteUploadRecord(fingerprint);
          setStatus('completed');
          setProgress(100);
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('GigaVault', { body: `${file.name} uploaded successfully.` });
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to finalize upload');
          setStatus('error');
        }
        worker.terminate();
      }
    };

    worker.postMessage({
      type: 'start',
      file,
      sessionId,
      chunkSize,
      totalSize: file.size,
      apiBase: API_BASE,
      alreadyUploadedParts,
    });
  }, []);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    void handleFile(file);
  };

  const busy = status === 'uploading' || status === 'preparing';

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 0 }}>GigaVault</h1>
      <p style={{ color: '#666', marginTop: 4 }}>
        Zero-Knowledge Document Management Engine — MVP1 upload pipeline
      </p>

      <input type="file" onChange={onFileChange} disabled={busy} />

      {status !== 'idle' && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ background: '#eee', borderRadius: 4, overflow: 'hidden', height: 20 }}>
            <div
              style={{
                width: `${progress}%`,
                background: status === 'error' ? '#dc2626' : '#4f46e5',
                height: '100%',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <p style={{ marginBottom: 4 }}>
            {fileName} — {status} — {progress}%
          </p>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
