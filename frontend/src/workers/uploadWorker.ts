/// <reference lib="webworker" />
import SparkMD5 from 'spark-md5';

interface StartMessage {
  type: 'start';
  file: File;
  sessionId: string;
  chunkSize: number;
  totalSize: number;
  apiBase: string;
  alreadyUploadedParts: number[];
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function computeMD5(buffer: ArrayBuffer): string {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  return spark.end();
}

async function fetchWithRetry(input: string, init: RequestInit, maxRetries = 5): Promise<Response> {
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
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

ctx.addEventListener('message', async (event: MessageEvent<StartMessage>) => {
  const { file, sessionId, chunkSize, totalSize, apiBase, alreadyUploadedParts } = event.data;
  const skip = new Set(alreadyUploadedParts);
  const totalParts = Math.max(1, Math.ceil(totalSize / chunkSize));

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    if (skip.has(partNumber)) {
      ctx.postMessage({ type: 'progress', partNumber, skipped: true, totalParts });
      continue;
    }

    const start = (partNumber - 1) * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    // file.slice() is lazy - only the bytes read below actually land in
    // memory, so this stays flat regardless of whether `file` is 1GB or
    // 100GB (Story 1.1 AC2).
    const blob = file.slice(start, end);

    try {
      const buffer = await blob.arrayBuffer();
      const md5Hex = computeMD5(buffer);

      const res = await fetchWithRetry(`${apiBase}/api/uploads/${sessionId}/parts/${partNumber}`, {
        method: 'PUT',
        headers: {
          'X-Checksum-MD5': md5Hex,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Upload failed for part ${partNumber}: ${res.status} ${text}`);
      }

      const data = (await res.json()) as { etag: string };
      ctx.postMessage({ type: 'progress', partNumber, skipped: false, etag: data.etag, totalParts });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upload error';
      ctx.postMessage({ type: 'error', partNumber, message });
      return;
    }
  }

  ctx.postMessage({ type: 'done' });
});

export {};
