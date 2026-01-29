/**
 * Storage Service
 * Centralized localStorage operations with error handling and type safety
 */

import { STORAGE_KEYS } from '../constants/app';
import { Message } from '../types';
import { UserProfile } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface AppState {
    activeTimer: {
        label: string;
        totalSeconds: number;
        remainingSeconds: number;
        isRunning: boolean;
        startedAt: number;
    } | null;
    currentWorkoutProgress: {
        title: string;
        exercises: { name: string; completed: boolean }[];
        startedAt: number;
    } | null;
    lastGeneratedWorkout: {
        title: string;
        exerciseCount: number;
        generatedAt: number;
    } | null;
    recentUIInteractions: {
        type: string;
        timestamp: number;
    }[];
    timestamp: number;
}

// ============================================================================
// GENERIC STORAGE OPERATIONS
// ============================================================================

/**
 * Safely get item from localStorage with error handling
 */
export const getStorageItem = <T>(key: string, defaultValue: T | null = null): T | null => {
    try {
        const item = localStorage.getItem(key);
        if (!item) return defaultValue;
        return JSON.parse(item) as T;
    } catch (error) {
        console.warn(`Failed to get storage item '${key}':`, error);
        return defaultValue;
    }
};

/**
 * Safely set item to localStorage with error handling
 */
export const setStorageItem = <T>(key: string, value: T): boolean => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn(`Failed to set storage item '${key}':`, error);
        return false;
    }
};

/**
 * Remove item from localStorage
 */
export const removeStorageItem = (key: string): void => {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn(`Failed to remove storage item '${key}':`, error);
    }
};

/**
 * Clear all items matching a prefix
 */
export const clearStorageByPrefix = (prefix: string): void => {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(prefix)) {
                localStorage.removeItem(key);
            }
        });
    } catch (error) {
        console.warn(`Failed to clear storage by prefix '${prefix}':`, error);
    }
};

// ============================================================================
// MESSAGE STORAGE
// ============================================================================

export const getMessages = (): Message[] => {
    return getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES, []) || [];
};

export const setMessages = (messages: Message[]): boolean => {
    return setStorageItem(STORAGE_KEYS.MESSAGES, messages);
};

export const clearMessages = (): void => {
    removeStorageItem(STORAGE_KEYS.MESSAGES);
};

// ============================================================================
// PROFILE STORAGE
// ============================================================================

export const getProfile = (): UserProfile | null => {
    return getStorageItem<UserProfile>(STORAGE_KEYS.PROFILE);
};

export const setProfile = (profile: UserProfile): boolean => {
    return setStorageItem(STORAGE_KEYS.PROFILE, profile);
};

export const clearProfile = (): void => {
    removeStorageItem(STORAGE_KEYS.PROFILE);
};

// ============================================================================
// APP STATE STORAGE
// ============================================================================

export const getAppState = (): AppState | null => {
    return getStorageItem<AppState>(STORAGE_KEYS.APP_STATE);
};

export const setAppState = (state: AppState): boolean => {
    return setStorageItem(STORAGE_KEYS.APP_STATE, state);
};

export const clearAppState = (): void => {
    removeStorageItem(STORAGE_KEYS.APP_STATE);
};

// ============================================================================
// WORKOUT PROGRESS STORAGE
// ============================================================================

export const getWorkoutProgress = (workoutId: string): any | null => {
    return getStorageItem(`${STORAGE_KEYS.WORKOUT_PREFIX}${workoutId}`);
};

export const setWorkoutProgress = (workoutId: string, progress: any): boolean => {
    return setStorageItem(`${STORAGE_KEYS.WORKOUT_PREFIX}${workoutId}`, progress);
};

export const clearAllWorkoutProgress = (): void => {
    clearStorageByPrefix(STORAGE_KEYS.WORKOUT_PREFIX);
};

// ============================================================================
// LEGACY CLEANUP
// ============================================================================

export const clearLegacyStorage = (): void => {
    removeStorageItem(STORAGE_KEYS.LEGACY_CHAT_HISTORY);
};

// ============================================================================
// SYNC QUEUE STORAGE
// ============================================================================

export const getSyncQueue = <T>(): T[] => {
    return getStorageItem<T[]>(STORAGE_KEYS.SYNC_QUEUE, []) || [];
};

export const setSyncQueue = <T>(queue: T[]): boolean => {
    return setStorageItem(STORAGE_KEYS.SYNC_QUEUE, queue);
};

// ============================================================================
// BULK CLEAR OPERATIONS
// ============================================================================

/**
 * Clear all Zenfit-related storage (for data reset)
 */
export const clearAllStorage = (): void => {
    clearMessages();
    clearProfile();
    clearAppState();
    clearAllWorkoutProgress();
    clearLegacyStorage();
    // Do NOT clear sync queue automatically if we want to ensure remote deletes happen!
    // But if it's a "hard reset" maybe we do?
    // For now, let's keep it safe. If user nukes storage, they nuke queue. Correct.
    removeStorageItem(STORAGE_KEYS.SYNC_QUEUE);
};
