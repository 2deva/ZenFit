/**
 * useActivityState Hook
 * Manages activity-related state (timers, workouts, UI interactions)
 */

import { useState, useEffect, useRef } from 'react';
import { getAppState, setAppState, AppState } from '../services/storageService';
import { TIMING, NUMBERS } from '../constants/app';

// ---------------------------------------------------------------------------
// Unified Activity Domain Model
// ---------------------------------------------------------------------------

export type ActivityIntent =
    | 'generic_timer'
    | 'workout'
    | 'breathing_reset'
    | 'deep_meditation'
    | 'sleep_prep'
    | 'focus_block';

export type ActivityType =
    | 'timer'
    | 'workout'
    | 'breathing'
    | 'meditation'
    | 'stretching'
    | 'custom';

export type ActivitySessionState =
    | 'idle'
    | 'configuring'
    | 'ready'
    | 'running'
    | 'paused'
    | 'completed'
    | 'stopped';

export type ActivityTimerState = 'idle' | 'running' | 'paused' | 'completed';

export interface ActivityPhase {
    id: string;
    kind: 'settle' | 'breath_cycle' | 'body_scan' | 'meditation' | 'closing';
    durationSeconds: number;
    order: number;
}

export interface ActivityPhaseSnapshot {
    id: string;
    kind: ActivityPhase['kind'];
    index: number;
    elapsedInPhase: number;
    remainingInPhase: number;
    totalPhases: number;
}

export interface ActivitySession {
    id: string;
    type: ActivityType;
    label: string;
    goalType?: string;
    goalIds?: string[];
    intent?: ActivityIntent;
    phases?: ActivityPhase[];
    state: ActivitySessionState;
    createdAt: number;
    completedAt?: number;
    // Optional metadata for multi‑segment activities (workouts, intervals)
    totalSegments?: number;
    activeSegmentIndex?: number;
}

export interface ActivityTimer {
    activityId: string;
    segmentId?: string;
    totalSeconds: number;
    remainingSeconds: number;
    state: ActivityTimerState;
    startedAt?: number; // epoch ms
    pausedAt?: number; // epoch ms
    remainingAtPause?: number;
}

export type ActivityEventType = 'started' | 'paused' | 'resumed' | 'completed' | 'tick';

export interface ActivityEvent {
    type: ActivityEventType;
    activityId: string;
    segmentId?: string;
    session: ActivitySession;
    timer?: ActivityTimer;
    phase?: ActivityPhaseSnapshot;
}

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

export interface StartActivityConfig {
    type: ActivityType;
    label: string;
    totalSeconds: number;
    goalType?: string;
    goalIds?: string[];
    activityId?: string;
    intent?: ActivityIntent;
    phases?: ActivityPhase[];
    workoutMeta?: {
        totalSegments?: number;
        initialSegmentIndex?: number;
    };
}

interface UseActivityStateReturn {
    // Legacy activity surface (used across the app today)
    activeTimer: TimerState | null;
    setActiveTimer: React.Dispatch<React.SetStateAction<TimerState | null>>;
    currentWorkoutProgress: WorkoutProgress | null;
    setCurrentWorkoutProgress: React.Dispatch<React.SetStateAction<WorkoutProgress | null>>;
    lastGeneratedWorkout: GeneratedWorkout | null;
    setLastGeneratedWorkout: React.Dispatch<React.SetStateAction<GeneratedWorkout | null>>;
    recentUIInteractions: UIInteraction[];
    setRecentUIInteractions: React.Dispatch<React.SetStateAction<UIInteraction[]>>;
    addUIInteraction: (type: string) => void;

    // Unified ActivityEngine state
    activitySessions: Record<string, ActivitySession>;
    activityTimers: Record<string, ActivityTimer>;

    // ActivityEngine API
    startActivity: (config: StartActivityConfig) => string;
    pauseActivity: (activityId: string) => void;
    resumeActivity: (activityId: string) => void;
    completeActivity: (activityId: string) => void;
    stopActivity: (activityId: string) => void;

    // Subscription to activity events (GuidanceEngine / LiveEngine / UI)
    registerActivityListener: (listener: (event: ActivityEvent) => void) => () => void;
}

/**
 * Custom hook for managing activity state with persistence
 */
export const useActivityState = (): UseActivityStateReturn => {
    const [activeTimer, setActiveTimer] = useState<TimerState | null>(null);
    const [currentWorkoutProgress, setCurrentWorkoutProgress] = useState<WorkoutProgress | null>(null);
    const [lastGeneratedWorkout, setLastGeneratedWorkout] = useState<GeneratedWorkout | null>(null);
    const [recentUIInteractions, setRecentUIInteractions] = useState<UIInteraction[]>([]);

    // Unified ActivityEngine state
    const [activitySessions, setActivitySessions] = useState<Record<string, ActivitySession>>({});
    const [activityTimers, setActivityTimers] = useState<Record<string, ActivityTimer>>({});

    const stateSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activityListenersRef = useRef<Array<(event: ActivityEvent) => void>>([]);

    // Helper to emit activity events to all subscribers
    const emitActivityEvent = (event: ActivityEvent) => {
        if (activityListenersRef.current.length === 0) return;
        // Shallow clone to avoid mutations by listeners
        const clonedEvent: ActivityEvent = {
            ...event,
            session: { ...event.session },
            timer: event.timer ? { ...event.timer } : undefined
        };
        activityListenersRef.current.forEach(listener => {
            try {
                listener(clonedEvent);
            } catch (e) {
                // Never let a subscriber break the engine
                // eslint-disable-next-line no-console
                console.warn('ActivityEngine listener error', e);
            }
        });
    };

    const registerActivityListener = (listener: (event: ActivityEvent) => void) => {
        activityListenersRef.current.push(listener);
        return () => {
            activityListenersRef.current = activityListenersRef.current.filter(l => l !== listener);
        };
    };

    // Small helper for ID creation when one is not provided
    const createActivityId = () => {
        return `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    };

    // Compute the current mindful phase from elapsed seconds.
    const getPhaseForElapsed = (phases: ActivityPhase[], elapsedSeconds: number): ActivityPhaseSnapshot | undefined => {
        if (!phases.length) return undefined;

        let remaining = Math.max(0, Math.floor(elapsedSeconds));
        const sorted = [...phases].sort((a, b) => a.order - b.order);
        let accumulated = 0;

        for (let index = 0; index < sorted.length; index++) {
            const phase = sorted[index];
            const phaseStart = accumulated;
            const phaseEnd = accumulated + phase.durationSeconds;

            if (remaining < phaseEnd || index === sorted.length - 1) {
                const elapsedInPhase = Math.min(phase.durationSeconds, Math.max(0, remaining - phaseStart));
                const remainingInPhase = Math.max(0, phase.durationSeconds - elapsedInPhase);
                return {
                    id: phase.id,
                    kind: phase.kind,
                    index,
                    elapsedInPhase,
                    remainingInPhase,
                    totalPhases: sorted.length
                };
            }

            accumulated = phaseEnd;
        }

        const last = sorted[sorted.length - 1];
        return {
            id: last.id,
            kind: last.kind,
            index: sorted.length - 1,
            elapsedInPhase: last.durationSeconds,
            remainingInPhase: 0,
            totalPhases: sorted.length
        };
    };

    // -----------------------------------------------------------------------
    // ActivityEngine API implementations
    // -----------------------------------------------------------------------

    const startActivity = (config: StartActivityConfig): string => {
        const activityId = config.activityId || createActivityId();
        const createdAt = Date.now();

        const session: ActivitySession = {
            id: activityId,
            type: config.type,
            label: config.label,
            goalType: config.goalType,
            goalIds: config.goalIds,
            intent: config.intent,
            phases: config.phases,
            state: 'running',
            createdAt,
            totalSegments: config.workoutMeta?.totalSegments,
            activeSegmentIndex: config.workoutMeta?.initialSegmentIndex ?? 0
        };

        const timer: ActivityTimer = {
            activityId,
            totalSeconds: config.totalSeconds,
            remainingSeconds: config.totalSeconds,
            state: 'running',
            startedAt: createdAt
        };

        setActivitySessions(prev => ({
            ...prev,
            [activityId]: session
        }));

        setActivityTimers(prev => ({
            ...prev,
            [activityId]: timer
        }));

        emitActivityEvent({
            type: 'started',
            activityId,
            session,
            timer
        });

        // For now, keep legacy activeTimer roughly aligned for callers still using it.
        if (config.type === 'timer' || config.type === 'breathing' || config.type === 'meditation') {
            setActiveTimer({
                label: config.label,
                totalSeconds: config.totalSeconds,
                remainingSeconds: config.totalSeconds,
                isRunning: true,
                startedAt: createdAt
            });
        }

        return activityId;
    };

    const pauseActivity = (activityId: string) => {
        setActivityTimers(prev => {
            const existing = prev[activityId];
            if (!existing || existing.state !== 'running' || !existing.startedAt) return prev;

            const now = Date.now();
            const elapsed = (now - existing.startedAt) / NUMBERS.MS_TO_SECONDS_DIVISOR;
            const remainingSeconds = Math.max(0, Math.round(existing.totalSeconds - elapsed));

            const updatedTimer: ActivityTimer = {
                ...existing,
                remainingSeconds,
                state: 'paused',
                pausedAt: now,
                remainingAtPause: remainingSeconds
            };

            const next = { ...prev, [activityId]: updatedTimer };

            setActivitySessions(prevSessions => {
                const session = prevSessions[activityId];
                if (!session) return prevSessions;
                const updatedSession: ActivitySession = { ...session, state: 'paused' };
                emitActivityEvent({
                    type: 'paused',
                    activityId,
                    session: updatedSession,
                    timer: updatedTimer
                });
                return { ...prevSessions, [activityId]: updatedSession };
            });

            return next;
        });
    };

    const resumeActivity = (activityId: string) => {
        const now = Date.now();

        setActivityTimers(prev => {
            const existing = prev[activityId];
            if (!existing || existing.state !== 'paused') return prev;

            const remaining = existing.remainingAtPause ?? existing.remainingSeconds;
            const updatedTimer: ActivityTimer = {
                ...existing,
                state: 'running',
                startedAt: now - (existing.totalSeconds - remaining) * NUMBERS.MS_TO_SECONDS_DIVISOR,
                pausedAt: undefined,
                remainingAtPause: undefined
            };

            const next = { ...prev, [activityId]: updatedTimer };

            setActivitySessions(prevSessions => {
                const session = prevSessions[activityId];
                if (!session) return prevSessions;
                const updatedSession: ActivitySession = { ...session, state: 'running' };
                emitActivityEvent({
                    type: 'resumed',
                    activityId,
                    session: updatedSession,
                    timer: updatedTimer
                });
                return { ...prevSessions, [activityId]: updatedSession };
            });

            return next;
        });
    };

    const completeActivity = (activityId: string) => {
        const completedAt = Date.now();

        setActivityTimers(prev => {
            const existing = prev[activityId];
            if (!existing) return prev;
            const updatedTimer: ActivityTimer = {
                ...existing,
                remainingSeconds: 0,
                state: 'completed'
            };
            const next = { ...prev, [activityId]: updatedTimer };

            setActivitySessions(prevSessions => {
                const session = prevSessions[activityId];
                if (!session) return prevSessions;
                if (session.state === 'completed' || session.state === 'stopped') return prevSessions;

                const updatedSession: ActivitySession = {
                    ...session,
                    state: 'completed',
                    completedAt
                };

                emitActivityEvent({
                    type: 'completed',
                    activityId,
                    session: updatedSession,
                    timer: updatedTimer
                });

                return { ...prevSessions, [activityId]: updatedSession };
            });

            return next;
        });
    };

    const stopActivity = (activityId: string) => {
        const stoppedAt = Date.now();
        setActivityTimers(prev => {
            if (!prev[activityId]) return prev;
            const next = { ...prev };
            delete next[activityId];
            return next;
        });

        setActivitySessions(prevSessions => {
            const session = prevSessions[activityId];
            if (!session) return prevSessions;
            const updatedSession: ActivitySession = {
                ...session,
                state: 'stopped',
                completedAt: session.completedAt ?? stoppedAt
            };
            emitActivityEvent({
                type: 'completed',
                activityId,
                session: updatedSession
            });
            const next = { ...prevSessions };
            next[activityId] = updatedSession;
            return next;
        });
    };

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

    // Helper to add UI interaction
    const addUIInteraction = (type: string) => {
        setRecentUIInteractions(prev => [
            ...prev.slice(-3), // Keep last 3
            { type, timestamp: Date.now() }
        ]);
    };

    // -----------------------------------------------------------------------
    // Central ticking loop – single clock for all running ActivityTimers
    // -----------------------------------------------------------------------

    useEffect(() => {
        // Quick check to avoid starting an interval when nothing is running
        const hasRunningTimers = Object.values(activityTimers).some(t => t.state === 'running' && t.startedAt);
        if (!hasRunningTimers) {
            return;
        }

        const intervalId = setInterval(() => {
            setActivityTimers(prevTimers => {
                const now = Date.now();
                let changed = false;
                const nextTimers: Record<string, ActivityTimer> = {};

                Object.entries(prevTimers).forEach(([key, timer]) => {
                    if (timer.state !== 'running' || !timer.startedAt) {
                        nextTimers[key] = timer;
                        return;
                    }

                    const elapsed = (now - timer.startedAt) / NUMBERS.MS_TO_SECONDS_DIVISOR;
                    const remainingSeconds = Math.max(0, Math.round(timer.totalSeconds - elapsed));

                    if (remainingSeconds !== timer.remainingSeconds) {
                        changed = true;
                    }

                    let nextState: ActivityTimerState = timer.state;
                    if (remainingSeconds <= 0) {
                        nextState = 'completed';
                    }

                    const updatedTimer: ActivityTimer = {
                        ...timer,
                        remainingSeconds,
                        state: nextState
                    };
                    nextTimers[key] = updatedTimer;

                    // Emit tick event on every update
                    setActivitySessions(prevSessions => {
                        const session = prevSessions[timer.activityId];
                        if (!session) return prevSessions;

                        const updatedSession: ActivitySession =
                            nextState === 'completed' &&
                            session.state !== 'completed' &&
                            session.state !== 'stopped'
                                ? { ...session, state: 'completed', completedAt: now }
                                : session;

                        let phaseSnapshot: ActivityPhaseSnapshot | undefined;
                        if (session.phases && session.phases.length > 0) {
                            const elapsedSeconds = Math.max(0, timer.totalSeconds - remainingSeconds);
                            phaseSnapshot = getPhaseForElapsed(session.phases, elapsedSeconds);
                        }

                        emitActivityEvent({
                            type: nextState === 'completed' ? 'completed' : 'tick',
                            activityId: timer.activityId,
                            session: updatedSession,
                            timer: updatedTimer,
                            ...(phaseSnapshot ? { phase: phaseSnapshot } : {})
                        });

                        if (updatedSession === session) return prevSessions;
                        return { ...prevSessions, [timer.activityId]: updatedSession };
                    });
                });

                return changed ? nextTimers : prevTimers;
            });
        }, 1000);

        return () => clearInterval(intervalId);
    }, [activityTimers]);

    // -----------------------------------------------------------------------
    // Mirror simple ActivityTimers into legacy activeTimer for UI/contexts
    // -----------------------------------------------------------------------

    useEffect(() => {
        // Only mirror simple, single-timer activities (timer / breathing / meditation)
        const simpleTypes: ActivityType[] = ['timer', 'breathing', 'meditation'];
        const timersArray = Object.values(activityTimers);

        const pickByState = (state: ActivityTimerState) =>
            timersArray.find(t => {
                if (t.state !== state) return false;
                const session = activitySessions[t.activityId];
                return !!session && simpleTypes.includes(session.type);
            });

        const runningTimer = pickByState('running');
        const pausedTimer = pickByState('paused');
        const completedTimer = pickByState('completed');

        const chosenTimer = runningTimer || pausedTimer || completedTimer || null;

        if (!chosenTimer) {
            if (activeTimer !== null) {
                setActiveTimer(null);
            }
            return;
        }

        const session = activitySessions[chosenTimer.activityId];
        if (!session) return;

        const isRunning = chosenTimer.state === 'running';
        const totalSeconds = chosenTimer.totalSeconds;
        const remainingSeconds = chosenTimer.remainingSeconds;

        let startedAt = chosenTimer.startedAt;
        if (!startedAt) {
            startedAt = Date.now() - (totalSeconds - remainingSeconds) * NUMBERS.MS_TO_SECONDS_DIVISOR;
        }

        setActiveTimer(prev => {
            if (
                prev &&
                prev.label === session.label &&
                prev.totalSeconds === totalSeconds &&
                prev.remainingSeconds === remainingSeconds &&
                prev.isRunning === isRunning
            ) {
                return prev;
            }
            return {
                label: session.label,
                totalSeconds,
                remainingSeconds,
                isRunning,
                startedAt: startedAt!
            };
        });
    }, [activityTimers, activitySessions]);

    return {
        activeTimer,
        setActiveTimer,
        currentWorkoutProgress,
        setCurrentWorkoutProgress,
        lastGeneratedWorkout,
        setLastGeneratedWorkout,
        recentUIInteractions,
        setRecentUIInteractions,
        addUIInteraction,
        activitySessions,
        activityTimers,
        startActivity,
        pauseActivity,
        resumeActivity,
        completeActivity,
        stopActivity,
        registerActivityListener
    };
};
