/**
 * Comprehensive Persistence Service
 * 
 * Handles both localStorage (local device) and Supabase (cross-device) persistence
 * for workout progress, guidance state, and timer state.
 */

import { getStorageItem, setStorageItem, removeStorageItem } from './storageService';
import { saveWorkoutProgress, getWorkoutProgress as getWorkoutProgressFromDB, deleteWorkoutProgress } from './supabaseService';

// ============================================================================
// TYPES
// ============================================================================

export interface GuidanceState {
  status: 'active' | 'paused' | 'completed';
  activityType: string;
  currentExerciseIndex: number;
  totalExercises: number;
  completedExercises: string[];
  elapsedTime: number;
  isResting?: boolean;
  restDuration?: number;
  restExerciseIndex?: number;
  // Enhanced: Cue-level state
  currentCueIndex?: number;
  scheduledCues?: Array<{ cueIndex: number; scheduledFor: number }>;
  repTimings?: number[];
  averageRepDuration?: number;
  timestamp: number;
}

export interface WorkoutProgressState {
  workoutId: string;
  completedIndices: number[];
  activeIdx: number;
  activeTimerState?: {
    timeLeft: number;
    timestamp: number;
    isRunning: boolean;
  };
  isResting?: boolean;
  restDuration?: number;
  timerDuration?: number;
}

export interface TimerState {
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  startedAt: number;
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE_KEYS = {
  GUIDANCE_STATE: 'zen_guidance_state',
  GUIDANCE_EXECUTOR_STATE: 'zen_guidance_executor_state',
  WORKOUT_REFS: 'zen_workout_refs',
  LIVE_SESSION: 'zen_live_session',
  AUTO_RECONNECT: 'zen_auto_reconnect'
};

// ============================================================================
// GUIDANCE STATE PERSISTENCE
// ============================================================================

import { syncService } from './syncService';

/**
 * Save guidance state (localStorage + Supabase if userId provided)
 */
export const saveGuidanceState = async (
  state: GuidanceState,
  userId?: string,
  workoutId?: string
): Promise<boolean> => {
  try {
    // Always save to localStorage (Optimistic)
    setStorageItem(STORAGE_KEYS.GUIDANCE_STATE, state);

    // If userId provided, sync to queue for eventual consistency
    if (userId && workoutId) {
      syncService.scheduleOperation('SAVE_GUIDANCE_STATE', {
        userId,
        workoutId,
        completedIndices: state.completedExercises.map((_, idx) => idx).filter(idx =>
          state.completedExercises[idx] !== undefined
        ),
        activeIdx: state.currentExerciseIndex
      });
    }

    return true;
  } catch (e) {
    console.warn('Failed to save guidance state:', e);
    return false;
  }
};

/**
 * Load guidance state (checks Supabase first if userId provided, then localStorage)
 */
export const loadGuidanceState = async (
  userId?: string,
  workoutId?: string
): Promise<GuidanceState | null> => {
  try {
    // Try Supabase first for cross-device sync
    if (userId && workoutId) {
      const dbProgress = await getWorkoutProgressFromDB(userId, workoutId);
      if (dbProgress) {
        // Convert DB format to GuidanceState format
        const localState = getStorageItem<GuidanceState>(STORAGE_KEYS.GUIDANCE_STATE);
        if (localState && Date.now() - localState.timestamp < 10 * 60 * 1000) {
          // Merge: Use DB for progress, local for detailed state
          return {
            ...localState,
            currentExerciseIndex: dbProgress.activeIdx,
            completedExercises: dbProgress.completed.map(idx => `exercise_${idx}`)
          };
        }
      }
    }

    // Fall back to localStorage
    const localState = getStorageItem<GuidanceState>(STORAGE_KEYS.GUIDANCE_STATE);
    if (localState && Date.now() - localState.timestamp < 10 * 60 * 1000) {
      return localState;
    }

    return null;
  } catch (e) {
    console.warn('Failed to load guidance state:', e);
    return null;
  }
};

/**
 * Clear guidance state (both localStorage and Supabase)
 */
export const clearGuidanceState = async (
  userId?: string,
  workoutId?: string
): Promise<void> => {
  try {
    removeStorageItem(STORAGE_KEYS.GUIDANCE_STATE);
    removeStorageItem(STORAGE_KEYS.GUIDANCE_EXECUTOR_STATE);

    if (userId && workoutId) {
      await deleteWorkoutProgress(userId, workoutId);
    }
  } catch (e) {
    console.warn('Failed to clear guidance state:', e);
  }
};

// ============================================================================
// GUIDANCE EXECUTOR STATE PERSISTENCE (Enhanced)
// ============================================================================

export interface GuidanceExecutorState {
  currentCueIndex: number;
  scheduledCues: Array<{ cueIndex: number; scheduledFor: number }>;
  repTimings: number[];
  averageRepDuration: number;
  currentRep: number;
  targetReps: number;
  startTime: number;
  totalPausedDuration: number;
  status: 'idle' | 'active' | 'paused' | 'completed';
  timestamp: number;
}

/**
 * Save detailed GuidanceExecutor state for seamless resume
 */
export const saveGuidanceExecutorState = (state: GuidanceExecutorState): boolean => {
  try {
    setStorageItem(STORAGE_KEYS.GUIDANCE_EXECUTOR_STATE, state);
    return true;
  } catch (e) {
    console.warn('Failed to save executor state:', e);
    return false;
  }
};

/**
 * Load GuidanceExecutor state
 */
export const loadGuidanceExecutorState = (): GuidanceExecutorState | null => {
  try {
    const state = getStorageItem<GuidanceExecutorState>(STORAGE_KEYS.GUIDANCE_EXECUTOR_STATE);
    if (state && Date.now() - state.timestamp < 10 * 60 * 1000) {
      return state;
    }
    return null;
  } catch (e) {
    console.warn('Failed to load executor state:', e);
    return null;
  }
};

// ============================================================================
// WORKOUT REFS PERSISTENCE
// ============================================================================

export interface WorkoutRefsState {
  lastWorkoutList: {
    exercises: any[];
    title: string;
    timestamp: number;
    messageId?: string;
  } | null;
  lastTimer?: {
    label: string;
    duration: number;
    activityType: string;
    config: any;
    timestamp: number;
  } | null;
  workoutListsMap: Array<[string, { exercises: any[]; title: string; timestamp: number }]>;
}

/**
 * Save workout list refs for auto-start detection
 */
export const saveWorkoutRefs = (refs: WorkoutRefsState): boolean => {
  try {
    setStorageItem(STORAGE_KEYS.WORKOUT_REFS, refs);
    return true;
  } catch (e) {
    console.warn('Failed to save workout refs:', e);
    return false;
  }
};

/**
 * Load workout list refs
 */
export const loadWorkoutRefs = (): WorkoutRefsState | null => {
  try {
    return getStorageItem<WorkoutRefsState>(STORAGE_KEYS.WORKOUT_REFS) || null;
  } catch (e) {
    console.warn('Failed to load workout refs:', e);
    return null;
  }
};

// ============================================================================
// AUTO-RECONNECT STATE
// ============================================================================

export interface AutoReconnectState {
  shouldAutoReconnect: boolean;
  reason: 'guidance_active' | 'workout_in_progress' | 'timer_active';
  timestamp: number;
}

/**
 * Save auto-reconnect preference
 */
export const saveAutoReconnectState = (state: AutoReconnectState): boolean => {
  try {
    setStorageItem(STORAGE_KEYS.AUTO_RECONNECT, state);
    return true;
  } catch (e) {
    console.warn('Failed to save auto-reconnect state:', e);
    return false;
  }
};

/**
 * Load auto-reconnect preference
 */
export const loadAutoReconnectState = (): AutoReconnectState | null => {
  try {
    const state = getStorageItem<AutoReconnectState>(STORAGE_KEYS.AUTO_RECONNECT);
    if (state && Date.now() - state.timestamp < 30 * 60 * 1000) { // 30 min window
      return state;
    }
    return null;
  } catch (e) {
    console.warn('Failed to load auto-reconnect state:', e);
    return null;
  }
};

/**
 * Clear auto-reconnect state
 */
export const clearAutoReconnectState = (): void => {
  removeStorageItem(STORAGE_KEYS.AUTO_RECONNECT);
};

// ============================================================================
// CROSS-DEVICE SYNC HELPERS
// ============================================================================

/**
 * Sync workout progress to Supabase (for cross-device)
 */
/**
 * Sync workout progress to Supabase (for cross-device)
 * Now uses offline-first sync queue.
 */
export const syncWorkoutProgressToCloud = async (
  userId: string,
  workoutId: string,
  completedIndices: number[],
  activeIdx: number
): Promise<boolean> => {
  try {
    syncService.scheduleOperation('SAVE_WORKOUT_PROGRESS', {
      userId,
      workoutId,
      completedIndices,
      activeIdx
    });
    return true; // Optimistic success
  } catch (e) {
    console.warn('Failed to schedule workout sync:', e);
    return false;
  }
};

/**
 * Sync workout progress from Supabase (for cross-device)
 */
export const syncWorkoutProgressFromCloud = async (
  userId: string,
  workoutId: string
): Promise<{ completed: number[]; activeIdx: number } | null> => {
  try {
    return await getWorkoutProgressFromDB(userId, workoutId);
  } catch (e) {
    console.warn('Failed to sync workout progress from cloud:', e);
    return null;
  }
};
