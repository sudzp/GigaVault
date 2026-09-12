import type { ChangeEvent } from 'react';
import { useUploadManager } from '../lib/uploadManager';

export default function UploadForm() {
  const [state, manager] = useUploadManager();
  const { error, fileName, progress, resumableUploads, status } = state;

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void manager.requestNotifications();
    void manager.start(file);
  };

  const busy = status === 'uploading' || status === 'preparing' || status === 'paused' || status === 'waiting_for_connection';

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 0 }}>GigaVault</h1>
      <p style={{ color: '#666', marginTop: 4 }}>
        Zero-Knowledge Document Management Engine — MVP1 upload pipeline
      </p>

      <input type="file" onChange={onFileChange} disabled={busy} />

      {status === 'idle' && resumableUploads.length > 0 && (
        <p style={{ color: '#92400e' }}>
          {resumableUploads.length} interrupted upload{resumableUploads.length === 1 ? '' : 's'} found. Select the same file to resume.
        </p>
      )}

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
            <button type="button" onClick={() => void manager.pause()}>Pause</button>
          )}
          {status === 'paused' && (
            <button type="button" onClick={() => manager.resume()}>Resume</button>
          )}
          {status === 'waiting_for_connection' && (
            <p style={{ color: '#92400e' }}>Waiting for your internet connection. Upload will resume automatically.</p>
          )}
          {(status === 'uploading' || status === 'preparing' || status === 'paused' || status === 'waiting_for_connection') && (
            <button type="button" onClick={() => void manager.abort()} style={{ marginLeft: 8 }}>Abort</button>
          )}
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
