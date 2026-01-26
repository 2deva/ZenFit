/**
 * Sync Service
 * 
 * Manages offline-first data synchronization queue.
 * Operations are persisted to local storage and executed when online.
 */

import { v4 as uuidv4 } from 'uuid';
import { getSyncQueue, setSyncQueue } from './storageService';
import {
    saveMessage as supabaseSaveMessage,
    saveWorkoutProgress as supabaseSaveWorkout,
    saveUserGoals as supabaseSaveGoals,
    deleteWorkoutProgress as supabaseDeleteWorkout,
    deleteAllMessages as supabaseDeleteMessages
} from './supabaseService';
import { supabase } from '../supabaseConfig';

// ============================================================================
// TYPES
// ============================================================================

export type SyncOperationType =
    | 'SAVE_MESSAGE'
    | 'SAVE_WORKOUT_PROGRESS'
    | 'SAVE_GOALS'
    | 'SAVE_GUIDANCE_STATE'
    | 'DELETE_WORKOUT_PROGRESS'
    | 'DELETE_ALL_DATA';

export interface SyncOperation {
    id: string;
    type: SyncOperationType;
    payload: any;
    timestamp: number;
    retryCount: number;
    status: 'pending' | 'processing' | 'failed';
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class SyncService {
    private isProcessing = false;
    private queue: SyncOperation[] = [];

    constructor() {
        this.loadQueue();
        this.registerNetworkListeners();
    }

    private loadQueue() {
        this.queue = getSyncQueue<SyncOperation>();
    }

    private saveQueue() {
        setSyncQueue(this.queue);
    }

    /**
     * Add an operation to the sync queue
     */
    public scheduleOperation(type: SyncOperationType, payload: any) {
        // Optimization: Deduplication
        // If we are saving the same entity (e.g. same workout progress), replace the old pending op with new one
        // This avoids sending 50 "progress update" calls when user comes online, only the latest matters.
        if (type === 'SAVE_WORKOUT_PROGRESS' || type === 'SAVE_GUIDANCE_STATE') {
            this.queue = this.queue.filter(op => {
                if (op.type === type &&
                    op.payload.workoutId === payload.workoutId &&
                    op.status === 'pending') {
                    return false; // Remove old pending op
                }
                return true;
            });
        }

        const operation: SyncOperation = {
            id: uuidv4(),
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending'
        };

        this.queue.push(operation);
        this.saveQueue();

        // Attempt to process immediately if online
        if (navigator.onLine) {
            this.processQueue();
        }
    }

    /**
     * Listen for network status changes
     */
    private registerNetworkListeners() {
        window.addEventListener('online', () => {
            // console.log('Network online - syncing Pending Operations:', this.queue.length);
            this.processQueue();
        });
    }

    /**
     * Process the queue
     */
    public async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        if (!navigator.onLine) return;

        this.isProcessing = true;

        // Get generic Supabase client status check if needed, but onLine check is usually good first step.
        // We'll proceed optimistically.

        try {
            // Filter pending items
            const pendingOps = this.queue.filter(op => op.status === 'pending');

            for (const op of pendingOps) {
                op.status = 'processing';
                this.saveQueue(); // Persist processing state

                const success = await this.executeOperation(op);

                if (success) {
                    // Remove from queue
                    this.queue = this.queue.filter(item => item.id !== op.id);
                } else {
                    // Revert to pending, increment retry
                    op.status = 'pending';
                    op.retryCount++;
                    if (op.retryCount > 5) {
                        console.error('Operation failed max retries, dropping:', op);
                        this.queue = this.queue.filter(item => item.id !== op.id);
                    }
                }
                this.saveQueue();
            }
        } catch (e) {
            console.error('Sync queue processing error:', e);
        } finally {
            this.isProcessing = false;
            // If more items were added while processing, trigger again? 
            // The loop handles current snapshot.
        }
    }

    /**
     * Execute a single operation against Supabase
     */
    private async executeOperation(op: SyncOperation): Promise<boolean> {
        try {
            switch (op.type) {
                case 'SAVE_MESSAGE':
                    return await supabaseSaveMessage(op.payload.userId, op.payload.message);

                case 'SAVE_WORKOUT_PROGRESS':
                    return await supabaseSaveWorkout(
                        op.payload.userId,
                        op.payload.workoutId,
                        op.payload.completedIndices,
                        op.payload.activeIdx
                    );

                case 'SAVE_GOALS':
                    return await supabaseSaveGoals(op.payload.userId, op.payload.goals);

                case 'SAVE_GUIDANCE_STATE':
                    // This one wraps the complex logic from persistenceService that was doing both local+remote
                    // Now we just do the remote part here.
                    // Note: persistenceService needs to pass the right derived data.
                    await supabaseSaveWorkout(
                        op.payload.userId,
                        op.payload.workoutId,
                        op.payload.completedIndices,
                        op.payload.activeIdx
                    );
                    return true;

                case 'DELETE_ALL_DATA':
                    await supabaseDeleteMessages(op.payload.userId);
                    // Also delete all memory/workout tables manually if not handled by a generic function?
                    // The AppContext logic had multiple deletes.
                    // We should probably consolidate delete logic in supabaseService or execute multiple here.
                    const { userId } = op.payload;

                    // We can move the consolidated delete logic here for robustness
                    await supabase.from('user_memories').delete().eq('user_id', userId);
                    await supabase.from('workout_progress').delete().eq('user_id', userId);
                    await supabase.from('workout_sessions').delete().eq('user_id', userId);
                    await supabase.from('user_goals').delete().eq('user_id', userId);
                    await supabase.from('habit_streaks').delete().eq('user_id', userId);
                    return true;

                default:
                    console.warn('Unknown sync operation type:', op.type);
                    return true; // Drop unknown ops
            }
        } catch (e) {
            console.warn(`Sync failed for ${op.type}:`, e);
            return false;
        }
    }
}

// Singleton instance
export const syncService = new SyncService();
