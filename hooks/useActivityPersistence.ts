import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getAppState, setAppState, type AppState } from '../services/storageService';
import type { ActivitySession, ActivityTimer, TimerState, WorkoutProgress, GeneratedWorkout, UIInteraction } from '../services/activityModel';
import { TIMING, NUMBERS } from '../constants/app';
interface PersistenceProps {
  activeTimer: TimerState | null;
  currentWorkoutProgress: WorkoutProgress | null;
  lastGeneratedWorkout: GeneratedWorkout | null;
  recentUIInteractions: UIInteraction[];
  setActiveTimer: Dispatch<SetStateAction<TimerState | null>>;
  setCurrentWorkoutProgress: Dispatch<SetStateAction<WorkoutProgress | null>>;
  setLastGeneratedWorkout: Dispatch<SetStateAction<GeneratedWorkout | null>>;
  setRecentUIInteractions: Dispatch<SetStateAction<UIInteraction[]>>;
  setActivitySessions: Dispatch<SetStateAction<Record<string, ActivitySession>>>;
  setActivityTimers: Dispatch<SetStateAction<Record<string, ActivityTimer>>>;
}

export function useActivityPersistence({ activeTimer, currentWorkoutProgress, lastGeneratedWorkout, recentUIInteractions, setActiveTimer, setCurrentWorkoutProgress, setLastGeneratedWorkout, setRecentUIInteractions, setActivitySessions, setActivityTimers }: PersistenceProps) {
  const stateSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

            // Seed unified ActivityEngine for backward‑compatible timers
            const activityId = `legacy_timer_${restoredTimer.label || 'timer'}`;
            const createdAt = savedState.timestamp || Date.now();

            const session: ActivitySession = {
                id: activityId,
                type: 'timer',
                label: restoredTimer.label,
                state: restoredTimer.isRunning ? 'running' : 'paused',
                createdAt
            };

            const timer: ActivityTimer = {
                activityId,
                totalSeconds: restoredTimer.totalSeconds,
                remainingSeconds: restoredTimer.remainingSeconds,
                state: restoredTimer.isRunning ? 'running' : restoredTimer.remainingSeconds <= 0 ? 'completed' : 'paused',
                startedAt: restoredTimer.startedAt
            };

            setActivitySessions(prev => ({ ...prev, [activityId]: session }));
            setActivityTimers(prev => ({ ...prev, [activityId]: timer }));
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

}
