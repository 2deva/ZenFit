/** Supabase adapter for the transport-independent offline queue. */
import { SyncQueue, type SyncQueueOptions, type SyncOperation } from './sync/SyncQueue';
import { saveMessage, saveWorkoutProgress, saveUserGoals, deleteWorkoutProgress, deleteAllMessages } from './supabaseService';
import { supabase } from '../supabaseConfig';
export type * from './sync/SyncQueue';

async function executeSupabaseOperation(op: SyncOperation): Promise<boolean> {
    try {
      switch (op.type) {
        case 'SAVE_MESSAGE': return await saveMessage(op.payload.userId, op.payload.message);
        case 'SAVE_WORKOUT_PROGRESS':
        case 'SAVE_GUIDANCE_STATE': return await saveWorkoutProgress(op.payload.userId, op.payload.workoutId, op.payload.completedIndices, op.payload.activeIdx);
        case 'SAVE_GOALS': return await saveUserGoals(op.payload.userId, op.payload.goals);
        case 'DELETE_WORKOUT_PROGRESS': return await deleteWorkoutProgress(op.payload.userId, op.payload.workoutId);
        case 'DELETE_MESSAGES': return await deleteAllMessages(op.payload.userId);
        case 'DELETE_ALL_DATA': {
          if (!await deleteAllMessages(op.payload.userId)) return false;
          for (const table of ['user_memories', 'workout_progress', 'workout_sessions', 'user_goals', 'habit_streaks']) {
            const { error } = await supabase.from(table).delete().eq('user_id', op.payload.userId);
            if (error) return false;
          }
          return true;
        }
        default: return false;
      }
    } catch (error) {
      console.warn(`Sync failed for ${op.type}:`, error);
      return false;
    }
  }

export class SyncService extends SyncQueue {
  constructor(options: Partial<SyncQueueOptions> = {}) { super({ execute: executeSupabaseOperation, ...options }); }
}
export const syncService = new SyncService();
