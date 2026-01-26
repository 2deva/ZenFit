/**
 * useActivityState Hook
 * Manages activity-related state (timers, workouts, UI interactions)
 */

import { useState, useEffect, useRef } from 'react';
import { getAppState, setAppState, AppState } from '../services/storageService';
import { TIMING, NUMBERS } from '../constants/app';

interface TimerState {
    label: string;
    totalSeconds: number;
    remainingSeconds: number;
    isRunning: boolean;
    startedAt: number;
}

interface WorkoutProgress {
    title: string;
    exercises: { name: string; completed: boolean }[];
    startedAt: number;
}

interface GeneratedWorkout {
    title: string;
    exerciseCount: number;
    generatedAt: number;
}

interface UIInteraction {
    type: string;
    timestamp: number;
}

interface UseActivityStateReturn {
    activeTimer: TimerState | null;
    setActiveTimer: React.Dispatch<React.SetStateAction<TimerState | null>>;
    currentWorkoutProgress: WorkoutProgress | null;
    setCurrentWorkoutProgress: React.Dispatch<React.SetStateAction<WorkoutProgress | null>>;
    lastGeneratedWorkout: GeneratedWorkout | null;
    setLastGeneratedWorkout: React.Dispatch<React.SetStateAction<GeneratedWorkout | null>>;
    recentUIInteractions: UIInteraction[];
    setRecentUIInteractions: React.Dispatch<React.SetStateAction<UIInteraction[]>>;
    addUIInteraction: (type: string) => void;
}

/**
 * Custom hook for managing activity state with persistence
 */
export const useActivityState = (): UseActivityStateReturn => {
    const [activeTimer, setActiveTimer] = useState<TimerState | null>(null);
    const [currentWorkoutProgress, setCurrentWorkoutProgress] = useState<WorkoutProgress | null>(null);
    const [lastGeneratedWorkout, setLastGeneratedWorkout] = useState<GeneratedWorkout | null>(null);
    const [recentUIInteractions, setRecentUIInteractions] = useState<UIInteraction[]>([]);
    const stateSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load persisted state on mount
    useEffect(() => {
        const savedState = getAppState();
        if (!savedState) return;

        // Restore timer with smart resumption
        if (savedState.activeTimer) {
            let restoredTimer = savedState.activeTimer;

            if (restoredTimer.isRunning) {
                const elapsedSinceSave = (Date.now() - savedState.timestamp) / NUMBERS.MS_TO_SECONDS_DIVISOR;
                const newRemaining = Math.max(0, restoredTimer.remainingSeconds - elapsedSinceSave);

                restoredTimer = {
                    ...restoredTimer,
                    remainingSeconds: newRemaining,
                    isRunning: newRemaining > 0
                };
            }

            setActiveTimer(restoredTimer);
        }

        if (savedState.currentWorkoutProgress) {
            setCurrentWorkoutProgress(savedState.currentWorkoutProgress);
        }
        if (savedState.lastGeneratedWorkout) {
            setLastGeneratedWorkout(savedState.lastGeneratedWorkout);
        }
        if (savedState.recentUIInteractions) {
            setRecentUIInteractions(savedState.recentUIInteractions);
        }
    }, []);

    // Persist state with debouncing
    useEffect(() => {
        if (stateSaveTimeoutRef.current) {
            clearTimeout(stateSaveTimeoutRef.current);
        }

        stateSaveTimeoutRef.current = setTimeout(() => {
            const appState: AppState = {
                activeTimer,
                currentWorkoutProgress,
                lastGeneratedWorkout,
                recentUIInteractions,
                timestamp: Date.now()
            };
            setAppState(appState);
        }, TIMING.STATE_SAVE_DEBOUNCE);

        return () => {
            if (stateSaveTimeoutRef.current) {
                clearTimeout(stateSaveTimeoutRef.current);
            }
        };
    }, [activeTimer, currentWorkoutProgress, lastGeneratedWorkout, recentUIInteractions]);

    // Save state synchronously on beforeunload
    useEffect(() => {
        const handleBeforeUnload = () => {
            const appState: AppState = {
                activeTimer,
                currentWorkoutProgress,
                lastGeneratedWorkout,
                recentUIInteractions,
                timestamp: Date.now()
            };
            setAppState(appState);
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [activeTimer, currentWorkoutProgress, lastGeneratedWorkout, recentUIInteractions]);

    // Helper to add UI interaction
    const addUIInteraction = (type: string) => {
        setRecentUIInteractions(prev => [
            ...prev.slice(-3), // Keep last 3
            { type, timestamp: Date.now() }
        ]);
    };

    return {
        activeTimer,
        setActiveTimer,
        currentWorkoutProgress,
        setCurrentWorkoutProgress,
        lastGeneratedWorkout,
        setLastGeneratedWorkout,
        recentUIInteractions,
        setRecentUIInteractions,
        addUIInteraction
    };
};
