import { useState } from 'react';
import UploadActivity from './components/UploadActivity';
import UploadForm from './components/UploadForm';

export default function App() {
  const [page, setPage] = useState<'upload' | 'activity'>('upload');

  return (
    <>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <button type="button" onClick={() => setPage('upload')} disabled={page === 'upload'}>Upload</button>
        <button type="button" onClick={() => setPage('activity')} disabled={page === 'activity'} style={{ marginLeft: 8 }}>Activity</button>
      </nav>
      {page === 'upload' ? <UploadForm /> : <UploadActivity />}
    </>
  );
}
