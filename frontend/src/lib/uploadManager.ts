import { useSyncExternalStore } from 'react';
import { calculateChunkSize } from './chunk';
import {
  deleteUploadRecord,
  fileFingerprint,
  getUploadRecord,
  listUnfinishedUploadRecords,
  markPartComplete,
  saveUploadRecord,
  updateUploadStatus,
  type UploadRecord,
} from './db';
import { abortUpload, API_BASE, completeUpload, initUpload, resumeUpload } from './api';

export type UploadStatus =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'paused'
  | 'waiting_for_connection'
  | 'completed'
  | 'error';

export interface UploadState {
  status: UploadStatus;
  progress: number;
  error: string | null;
  fileName: string | null;
  resumableUploads: UploadRecord[];
}

interface ActiveUpload {
  fingerprint: string;
  sessionId: string;
}

const initialState: UploadState = {
  status: 'idle',
  progress: 0,
  error: null,
  fileName: null,
  resumableUploads: [],
};

class UploadManager {
  private state = initialState;
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private activeFile: File | null = null;
  private activeUpload: ActiveUpload | null = null;
  private pauseRequested = false;

  constructor() {
    window.addEventListener('offline', () => void this.pause(true));
    window.addEventListener('online', () => {
      if (this.state.status === 'waiting_for_connection' && this.activeFile) {
        void this.start(this.activeFile);
      }
    });
    void this.restoreSessions();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private setState(next: Partial<UploadState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private notifyIfBackground(body: string) {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('GigaVault', { body });
    }
  }

  async restoreSessions() {
    this.setState({ resumableUploads: await listUnfinishedUploadRecords() });
  }

  async requestNotifications() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') return Notification.requestPermission();
    return Notification.permission;
  }

  async start(file: File) {
    this.activeFile = file;
    this.pauseRequested = false;
    this.setState({
      status: 'preparing',
      progress: 0,
      error: null,
      fileName: file.name,
    });

    if (!navigator.onLine) {
      this.setState({ status: 'waiting_for_connection' });
      return;
    }

    const fingerprint = fileFingerprint(file);
    let record = await getUploadRecord(fingerprint);
    let sessionId: string;
    let chunkSize: number;
    let alreadyUploadedParts: number[] = [];

    const startFresh = async () => {
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
      this.activeUpload = { fingerprint, sessionId: newRecord.sessionId };
      return { record: newRecord, sessionId: newRecord.sessionId, chunkSize: size, alreadyUploadedParts: [] as number[] };
    };

    try {
      if (record && record.status !== 'completed') {
        try {
          const resumeData = await resumeUpload(record.sessionId);
          sessionId = resumeData.sessionId;
          chunkSize = resumeData.chunkSize;
          alreadyUploadedParts = resumeData.uploadedParts.map((part) => part.partNumber);
          this.activeUpload = { fingerprint, sessionId };
        } catch {
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
    } catch (error) {
      if (!this.pauseRequested) {
        const message = error instanceof Error ? error.message : 'Failed to start upload';
        this.setState({
          status: 'error',
          error: message,
        });
        this.notifyIfBackground(`${file.name} failed to start uploading.`);
      }
      return;
    }

    if (this.pauseRequested || !navigator.onLine) {
      await updateUploadStatus(fingerprint, 'paused');
      this.setState({ status: navigator.onLine ? 'paused' : 'waiting_for_connection' });
      await this.restoreSessions();
      return;
    }

    this.setState({ status: 'uploading' });
    const worker = new Worker(new URL('../workers/uploadWorker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;

    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (this.worker !== worker || this.pauseRequested) return;

      if (message.type === 'progress') {
        if (!message.skipped && message.etag) {
          await markPartComplete(fingerprint, message.partNumber, message.etag);
        }
        this.setState({ progress: Math.round((message.partNumber / message.totalParts) * 100) });
        return;
      }

      if (message.type === 'error') {
        const error = `Part ${message.partNumber} failed after retries: ${message.message}`;
        this.setState({
          status: 'error',
          error,
        });
        this.notifyIfBackground(`${file.name} upload failed.`);
        worker.terminate();
        this.worker = null;
        await this.restoreSessions();
        return;
      }

      if (message.type === 'done') {
        try {
          await completeUpload(sessionId);
          await deleteUploadRecord(fingerprint);
          this.activeUpload = null;
          this.setState({ status: 'completed', progress: 100 });
          this.notifyIfBackground(`${file.name} uploaded successfully.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to finalize upload';
          this.setState({
            status: 'error',
            error: message,
          });
          this.notifyIfBackground(`${file.name} could not be finalized.`);
        }
        worker.terminate();
        this.worker = null;
        await this.restoreSessions();
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
    await this.restoreSessions();
  }

  async pause(waitingForConnection = false) {
    if (this.state.status !== 'preparing' && this.state.status !== 'uploading') return;
    this.pauseRequested = true;
    this.worker?.terminate();
    this.worker = null;
    if (this.activeUpload) await updateUploadStatus(this.activeUpload.fingerprint, 'paused');
    this.setState({ status: waitingForConnection ? 'waiting_for_connection' : 'paused' });
    await this.restoreSessions();
  }

  resume() {
    if (this.activeFile) void this.start(this.activeFile);
  }

  async abort() {
    this.pauseRequested = true;
    this.worker?.terminate();
    this.worker = null;
    try {
      if (this.activeUpload) {
        await abortUpload(this.activeUpload.sessionId);
        await deleteUploadRecord(this.activeUpload.fingerprint);
      }
      this.activeUpload = null;
      this.activeFile = null;
      this.setState({ ...initialState });
      await this.restoreSessions();
    } catch (error) {
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to abort upload',
      });
    }
  }
}

export const uploadManager = new UploadManager();

export function useUploadManager() {
  return [useSyncExternalStore(uploadManager.subscribe, uploadManager.getSnapshot), uploadManager] as const;
}
