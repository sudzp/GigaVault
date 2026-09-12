import { useUploadManager } from '../lib/uploadManager';

export default function UploadActivity() {
  const [state] = useUploadManager();

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Upload activity</h1>
      {state.status === 'idle' && <p>No upload is currently active.</p>}
      {state.status !== 'idle' && (
        <>
          <p>{state.fileName} — {state.status} — {state.progress}%</p>
          <div style={{ background: '#eee', borderRadius: 4, overflow: 'hidden', height: 20 }}>
            <div style={{ width: `${state.progress}%`, background: '#4f46e5', height: '100%', transition: 'width 0.2s' }} />
          </div>
          {state.error && <p style={{ color: '#dc2626' }}>{state.error}</p>}
        </>
      )}
      {state.resumableUploads.length > 0 && (
        <p style={{ color: '#92400e' }}>
          {state.resumableUploads.length} resumable upload{state.resumableUploads.length === 1 ? '' : 's'} saved locally.
        </p>
      )}
    </div>
  );
}
