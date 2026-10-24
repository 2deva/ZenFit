/** Shared activity types and deterministic phase resolution. */
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

export interface TimerState {
    label: string;
    totalSeconds: number;
    remainingSeconds: number;
    isRunning: boolean;
    startedAt: number;
}

export interface WorkoutProgress {
    title: string;
    exercises: { name: string; completed: boolean }[];
    startedAt: number;
}

export interface GeneratedWorkout {
    title: string;
    exerciseCount: number;
    generatedAt: number;
}

export interface UIInteraction {
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

export const getPhaseForElapsed = (phases: ActivityPhase[], elapsedSeconds: number): ActivityPhaseSnapshot | undefined => {
        if (!phases.length) return undefined;

        const remaining = Math.max(0, Math.floor(elapsedSeconds));
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

