import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface UploadRecord {
  fingerprint: string;
  sessionId: string;
  filename: string;
  totalSize: number;
  chunkSize: number;
  objectKey: string;
  completedParts: Record<number, string>; // partNumber -> etag
  status: 'in_progress' | 'completed';
  updatedAt: number;
}

interface GigaVaultDB extends DBSchema {
  uploads: {
    key: string;
    value: UploadRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<GigaVaultDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<GigaVaultDB>('gigavault-uploads', 1, {
      upgrade(db) {
        db.createObjectStore('uploads', { keyPath: 'fingerprint' });
      },
    });
  }
  return dbPromise;
}

// name + size + lastModified is a decent cheap fingerprint for "is this the
// same file as last time" without hashing the whole 100GB file up front.
export function fileFingerprint(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export async function getUploadRecord(fingerprint: string) {
  const db = await getDB();
  return db.get('uploads', fingerprint);
}

export async function saveUploadRecord(record: UploadRecord) {
  const db = await getDB();
  await db.put('uploads', record);
}

export async function markPartComplete(fingerprint: string, partNumber: number, etag: string) {
  const db = await getDB();
  const record = await db.get('uploads', fingerprint);
  if (!record) return;
  record.completedParts[partNumber] = etag;
  record.updatedAt = Date.now();
  await db.put('uploads', record);
}

export async function deleteUploadRecord(fingerprint: string) {
  const db = await getDB();
  await db.delete('uploads', fingerprint);
}
