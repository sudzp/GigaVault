import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { calculateChunkSize } from '../lib/chunk';
import {
  fileFingerprint,
  getUploadRecord,
  saveUploadRecord,
  markPartComplete,
  deleteUploadRecord,
  updateUploadStatus,
  type UploadRecord,
} from '../lib/db';
import { abortUpload, initUpload, resumeUpload, completeUpload, API_BASE } from '../lib/api';

type Status = 'idle' | 'preparing' | 'uploading' | 'paused' | 'waiting_for_connection' | 'completed' | 'error';

interface ActiveUpload {
  fingerprint: string;
  sessionId: string;
}

export default function UploadForm() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeFileRef = useRef<File | null>(null);
  const activeUploadRef = useRef<ActiveUpload | null>(null);
  const pauseRequestedRef = useRef(false);
  const statusRef = useRef<Status>('idle');

  const setUploadStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    activeFileRef.current = file;
    pauseRequestedRef.current = false;
    setError(null);
    setUploadStatus('preparing');
    setProgress(0);
    setFileName(file.name);

    if (!navigator.onLine) {
      setUploadStatus('waiting_for_connection');
      return;
    }

    const fingerprint = fileFingerprint(file);
    let record: UploadRecord | undefined = await getUploadRecord(fingerprint);
    let sessionId: string;
    let chunkSize: number;
    let alreadyUploadedParts: number[] = [];

    async function startFresh() {
      const size = calculateChunkSize(file.size);
      const initData = await initUpload(file.name, file.size, size);
      const newRecord: UploadRecord = {
        fingerprint,
        sessionId: initData.sessionId,
        filename: file.name,
        totalSize: file.size,
        chunkSize: size,
        objectKey: initData.objectKey,
        completedParts: {},
        status: 'in_progress',
        updatedAt: Date.now(),
      };
      await saveUploadRecord(newRecord);
      activeUploadRef.current = { fingerprint, sessionId: newRecord.sessionId };
      return { record: newRecord, sessionId: initData.sessionId, chunkSize: size, alreadyUploadedParts: [] as number[] };
    }

    try {
      if (record && record.status !== 'completed') {
        // Story 1.2 AC4: resume - ask the backend/S3 what's already there.
        try {
          const resumeData = await resumeUpload(record.sessionId);
          sessionId = resumeData.sessionId;
          chunkSize = resumeData.chunkSize;
          alreadyUploadedParts = resumeData.uploadedParts.map((p) => p.partNumber);
          activeUploadRef.current = { fingerprint, sessionId };
        } catch (resumeErr) {
          // The session backing this record is gone server-side (e.g. S3
          // storage got restarted without persistence, or it was aborted
          // server-side). Drop the stale local record and start fresh
          // instead of surfacing a hard error for something recoverable.
          await deleteUploadRecord(fingerprint);
          const fresh = await startFresh();
          record = fresh.record;
          sessionId = fresh.sessionId;
          chunkSize = fresh.chunkSize;
          alreadyUploadedParts = fresh.alreadyUploadedParts;
        }
      } else {
        const fresh = await startFresh();
        record = fresh.record;
        sessionId = fresh.sessionId;
        chunkSize = fresh.chunkSize;
        alreadyUploadedParts = fresh.alreadyUploadedParts;
      }
    } catch (err) {
      if (pauseRequestedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to start upload');
      setUploadStatus('error');
      return;
    }

    if (pauseRequestedRef.current || !navigator.onLine) {
      await updateUploadStatus(fingerprint, 'paused');
      setUploadStatus(navigator.onLine ? 'paused' : 'waiting_for_connection');
      return;
    }

    setUploadStatus('uploading');

    const worker = new Worker(new URL('../workers/uploadWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;

      if (workerRef.current !== worker || pauseRequestedRef.current) return;

      if (msg.type === 'progress') {
        if (!msg.skipped && msg.etag) {
          await markPartComplete(fingerprint, msg.partNumber, msg.etag);
        }
        setProgress(Math.round((msg.partNumber / msg.totalParts) * 100));
        return;
      }

      if (msg.type === 'error') {
        setError(`Part ${msg.partNumber} failed after retries: ${msg.message}`);
        setUploadStatus('error');
        worker.terminate();
        workerRef.current = null;
        return;
      }

      if (msg.type === 'done') {
        try {
          await completeUpload(sessionId);
          await deleteUploadRecord(fingerprint);
          activeUploadRef.current = null;
          setUploadStatus('completed');
          setProgress(100);
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('GigaVault', { body: `${file.name} uploaded successfully.` });
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to finalize upload');
          setUploadStatus('error');
        }
        worker.terminate();
        workerRef.current = null;
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
  }, [setUploadStatus]);

  const pauseUpload = useCallback(async (waitingForConnection = false) => {
    if (statusRef.current !== 'preparing' && statusRef.current !== 'uploading') return;
    pauseRequestedRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;

    const activeUpload = activeUploadRef.current;
    if (activeUpload) {
      await updateUploadStatus(activeUpload.fingerprint, 'paused');
    }
    setUploadStatus(waitingForConnection ? 'waiting_for_connection' : 'paused');
  }, [setUploadStatus]);

  const resumeCurrentUpload = useCallback(() => {
    const file = activeFileRef.current;
    if (file) void handleFile(file);
  }, [handleFile]);

  const abortCurrentUpload = useCallback(async () => {
    const activeUpload = activeUploadRef.current;
    pauseRequestedRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;

    try {
      if (activeUpload) {
        await abortUpload(activeUpload.sessionId);
        await deleteUploadRecord(activeUpload.fingerprint);
      }
      activeUploadRef.current = null;
      activeFileRef.current = null;
      setProgress(0);
      setFileName(null);
      setError(null);
      setUploadStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abort upload');
      setUploadStatus('error');
    }
  }, [setUploadStatus]);

  useEffect(() => {
    const handleOffline = () => void pauseUpload(true);
    const handleOnline = () => {
      if (statusRef.current === 'waiting_for_connection' && activeFileRef.current) {
        void handleFile(activeFileRef.current);
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [handleFile, pauseUpload]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    void handleFile(file);
  };

  const busy = status === 'uploading' || status === 'preparing' || status === 'paused' || status === 'waiting_for_connection';

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
          {(status === 'uploading' || status === 'preparing') && (
            <button type="button" onClick={() => void pauseUpload()}>Pause</button>
          )}
          {status === 'paused' && (
            <button type="button" onClick={resumeCurrentUpload}>Resume</button>
          )}
          {status === 'waiting_for_connection' && (
            <p style={{ color: '#92400e' }}>Waiting for your internet connection. Upload will resume automatically.</p>
          )}
          {(status === 'uploading' || status === 'preparing' || status === 'paused' || status === 'waiting_for_connection') && (
            <button type="button" onClick={() => void abortCurrentUpload()} style={{ marginLeft: 8 }}>Abort</button>
          )}
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
