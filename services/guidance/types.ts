export type ActivityType = 'workout' | 'breathing' | 'meditation' | 'stretching' | 'timer';
export type CueType = 'count' | 'instruction' | 'motivation' | 'transition' | 'completion' | 'rest';
export type CuePriority = 'immediate' | 'queued';

export interface Exercise {
    name: string;
    reps?: string;
    duration?: string;
    restAfter?: number; // seconds
}

export interface BreathingPattern {
    name: string;
    inhale: number;      // seconds
    hold?: number;       // seconds (optional)
    exhale: number;      // seconds
    holdEmpty?: number;  // seconds (optional)
    cycles: number;
}

export interface VoiceGuidanceConfig {
    activity: ActivityType;
    exercises?: Exercise[];
    pattern?: BreathingPattern;
    intervals?: { work: number; rest: number }[];
    pace?: 'slow' | 'normal' | 'fast';
    /**
     * High-level guidance density for mindful sessions.
     * - 'full': rich prompts throughout (default)
     * - 'light': primarily phase boundaries + a few check-ins
     * - 'silent': only opening/closing cues (or minimal speech)
     */
    guidanceStyle?: 'full' | 'light' | 'silent';
    /**
     * Optional semantic intent for mindful timers. This mirrors
     * MindfulSessionConfig.intent but is kept lightweight here to
     * avoid a hard dependency on the session generator module.
     */
    intent?: 'breathing_reset' | 'deep_meditation' | 'sleep_prep' | 'focus_block';
}

export interface GuidanceCue {
    timing: number;       // ms from activity start
    type: CueType;
    text: string;         // What Zen should say
    priority: CuePriority;
    exerciseIndex?: number; // For workout tracking
}

// ============================================================================
// PRESET BREATHING PATTERNS
// ============================================================================

export const BREATHING_PATTERNS: Record<string, BreathingPattern> = {
    box: {
        name: 'Box Breathing',
        inhale: 4,
        hold: 4,
        exhale: 4,
        holdEmpty: 4,
        cycles: 4
    },
    relaxing: {
        name: '4-7-8 Relaxing Breath',
        inhale: 4,
        hold: 7,
        exhale: 8,
        cycles: 4
    },
    energizing: {
        name: 'Energizing Breath',
        inhale: 4,
        exhale: 4,
        cycles: 10
    },
    calming: {
        name: 'Calming Breath',
        inhale: 4,
        exhale: 6,
        cycles: 6
    },
    focus: {
        name: 'Focus Breath',
        inhale: 4,
        hold: 4,
        exhale: 4,
        cycles: 5
    }
};

