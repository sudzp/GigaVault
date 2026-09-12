const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

// Story 1.2 AC3: exponential backoff, up to 5 attempts, on network failure
// or a 5xx from the backend.
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  maxRetries = 5
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxRetries) {
    try {
      const res = await fetch(input, init);
      if (!res.ok && res.status >= 500) {
        throw new Error(`Server error ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      attempt++;
      if (attempt >= maxRetries) break;
      const backoffMs = Math.min(30000, 500 * 2 ** attempt) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

export interface InitUploadResponse {
  sessionId: string;
  s3UploadId: string;
  bucket: string;
  objectKey: string;
  chunkSize: number;
}

export async function initUpload(
  filename: string,
  totalSize: number,
  chunkSize: number
): Promise<InitUploadResponse> {
  const res = await fetchWithRetry(`${API_BASE}/api/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, totalSize, chunkSize }),
  });
  if (!res.ok) throw new Error('Failed to initialize upload session');
  return res.json();
}

export interface ResumeResponse {
  sessionId: string;
  chunkSize: number;
  totalSize: number;
  objectKey: string;
  status: string;
  uploadedParts: { partNumber: number; etag: string; size: number }[];
}

// Story 1.2 AC4: fetch already-uploaded parts from S3 (via backend ListParts)
// so the client can skip re-uploading them.
export async function resumeUpload(sessionId: string): Promise<ResumeResponse> {
  const res = await fetchWithRetry(`${API_BASE}/api/uploads/${sessionId}/resume`, {
    method: 'GET',
  });
  if (!res.ok) throw new Error('Failed to resume upload session');
  return res.json();
}

export async function completeUpload(sessionId: string) {
  const res = await fetchWithRetry(`${API_BASE}/api/uploads/${sessionId}/complete`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to complete upload');
  return res.json();
}

export { API_BASE };
