const MIN_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_PARTS = 9500; // stay comfortably under S3's 10,000-part ceiling

/**
 * Picks a chunk size between 10MB and 50MB based on total file size, so a
 * 100GB file doesn't blow past S3's part-count limit and a 200MB file
 * doesn't get sliced into needlessly tiny pieces.
 */
export function calculateChunkSize(totalBytes: number): number {
  const raw = Math.ceil(totalBytes / MAX_PARTS);
  return Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, raw));
}

export function totalChunks(totalBytes: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(totalBytes / chunkSize));
}
