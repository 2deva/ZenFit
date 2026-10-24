import { v4 as uuidv4 } from 'uuid';
import { getSyncQueue, setSyncQueue } from '../storageService';
import type { saveMessage, saveUserGoals } from '../supabaseService';

interface WorkoutPayload { userId: string; workoutId: string; completedIndices: number[]; activeIdx: number }
interface SyncPayloads {
  SAVE_MESSAGE: { userId: string; message: Parameters<typeof saveMessage>[1] };
  SAVE_WORKOUT_PROGRESS: WorkoutPayload;
  SAVE_GUIDANCE_STATE: WorkoutPayload;
  SAVE_GOALS: { userId: string; goals: Parameters<typeof saveUserGoals>[1] };
  DELETE_WORKOUT_PROGRESS: { userId: string; workoutId: string };
  DELETE_MESSAGES: { userId: string };
  DELETE_ALL_DATA: { userId: string };
}
export type SyncOperationType = keyof SyncPayloads;
interface OperationState { id: string; timestamp: number; retryCount: number; status: 'pending' | 'processing' | 'failed' }
export type SyncOperation = { [K in SyncOperationType]: OperationState & { type: K; payload: SyncPayloads[K] } }[SyncOperationType];

export interface SyncQueueOptions { execute: (operation: SyncOperation) => Promise<boolean>; isOnline?: () => boolean }

export class SyncQueue {
  private processing: Promise<void> | null = null;
  private queue: SyncOperation[] = [];
  private onlineListener = () => { void this.processQueue(); };

  constructor(private options: SyncQueueOptions) {
    const saved = getSyncQueue<SyncOperation>();
    // A browser can close while a request is in flight. Retry that operation on reload.
    this.queue = Array.isArray(saved) ? saved.filter(op => op && typeof op === 'object' && op.payload)
      .map(op => ({ ...op, status: op.status === 'processing' ? 'pending' : op.status })) : [];
    window.addEventListener('online', this.onlineListener);
  }

  /** Unregister listeners when an isolated instance is no longer needed. */
  dispose(): void { window.removeEventListener('online', this.onlineListener); }

  private saveQueue(): void {
    if (!setSyncQueue(this.queue)) throw new Error('Could not persist the sync queue');
  }

  scheduleOperation<T extends SyncOperationType>(type: T, payload: SyncPayloads[T]): void {
    if (type === 'SAVE_WORKOUT_PROGRESS' || type === 'SAVE_GUIDANCE_STATE') {
      const progress = payload as WorkoutPayload;
      this.queue = this.queue.filter(op => !(op.type === type && op.status === 'pending'
        && op.payload.userId === progress.userId
        && 'workoutId' in op.payload && op.payload.workoutId === progress.workoutId));
    }
    this.queue.push({ id: uuidv4(), type, payload, timestamp: Date.now(), retryCount: 0, status: 'pending' } as SyncOperation);
    this.saveQueue();
    if ((this.options.isOnline?.() ?? navigator.onLine)) void this.processQueue();
  }

  /** Failed operations remain visible in storage and can be retried deliberately. */
  retryFailedOperations(): void {
    this.queue = this.queue.map(op => op.status === 'failed' ? { ...op, status: 'pending', retryCount: 0 } : op);
    this.saveQueue();
    if ((this.options.isOnline?.() ?? navigator.onLine)) void this.processQueue();
  }

  async processQueue(): Promise<void> {
    if (this.processing) return this.processing;
    this.processing = this.drainQueue();
    try { await this.processing; } finally { this.processing = null; }
  }

  private async drainQueue(): Promise<void> {
    if (!this.queue.length || !(this.options.isOnline?.() ?? navigator.onLine)) return;
    const attempted = new Set<string>();
    try {
      while ((this.options.isOnline?.() ?? navigator.onLine)) {
        const op = this.queue.find(item => item.status === 'pending' && !attempted.has(item.id));
        if (!op) break;
        attempted.add(op.id);
        op.status = 'processing';
        this.saveQueue();
        let success = false;
        try { success = await this.options.execute(op); }
        catch (error) { console.warn(`Sync transport failed for ${op.type}:`, error); }
        if (success) this.queue = this.queue.filter(item => item.id !== op.id);
        else {
          op.retryCount++;
          op.status = op.retryCount >= 6 ? 'failed' : 'pending';
        }
        this.saveQueue();
      }
    } catch (error) {
      // Keep in-memory work retryable if local persistence itself fails.
      this.queue = this.queue.map(op => op.status === 'processing' ? { ...op, status: 'pending' } : op);
      console.error('Sync queue processing error:', error);
    }
  }

}
