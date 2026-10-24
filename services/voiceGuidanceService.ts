/** Public voice-guidance API; activity planners live in ./guidance. */
export * from './guidance/types';
import { BREATHING_PATTERNS } from './guidance/types';
import type { ActivityType, GuidanceCue, VoiceGuidanceConfig } from './guidance/types';
import { generateWorkoutCues } from './guidance/workoutCues';
import { generateBreathingCues } from './guidance/breathingCues';
import { generateMeditationCues } from './guidance/meditationCues';
import { generateTimerCues } from './guidance/timerCues';

const PACE_MULTIPLIERS = { slow: 1.5, normal: 1, fast: 0.75 };

export function adjustCuesForPace(
    cues: GuidanceCue[],
    paceMultiplier: number
): GuidanceCue[] {
    return cues.map(cue => ({
        ...cue,
        timing: cue.timing * paceMultiplier
    }));
}

// ============================================================================
// STYLE ADJUSTMENT HELPERS
// ============================================================================

/**
 * Apply guidanceStyle post-processing to a cue sequence.
 *
 * This keeps cue planning simple while allowing the same base
 * templates to serve "full", "light", and "silent" experiences.
 */
function applyGuidanceStyle(
    cues: GuidanceCue[],
    activity: ActivityType,
    guidanceStyle: VoiceGuidanceConfig['guidanceStyle']
): GuidanceCue[] {
    if (!guidanceStyle || guidanceStyle === 'full') return cues;

    // For non-mindful activities we keep current behaviour.
    if (activity === 'workout' || activity === 'stretching') {
        return cues;
    }

    // Silent: keep only opening (t=0) + explicit completion cues.
    if (guidanceStyle === 'silent') {
        const hasCompletion = cues.some(c => c.type === 'completion');
        const maxTiming = cues.reduce((m, c) => Math.max(m, c.timing), 0);
        return cues.filter(c =>
            c.timing === 0 ||
            c.type === 'completion' ||
            (!hasCompletion && c.timing === maxTiming) // fallback last cue
        );
    }

    // Light: keep opening, closing, and a sparse set of mid-session prompts.
    if (guidanceStyle === 'light') {
        if (cues.length <= 6) return cues; // already sparse

        const maxTiming = cues.reduce((m, c) => Math.max(m, c.timing), 0);
        const targetSlots = 4; // start, two mid, end
        const slotSize = maxTiming / targetSlots || 1;

        return cues.filter(cue => {
            if (cue.timing === 0 || cue.type === 'completion') return true;
            // Always keep explicit phase-transition style cues
            if (cue.type === 'transition') return true;
            // Prefer immediate (higher-salience) cues over queued ones
            if (cue.priority === 'queued' && (cue.type === 'motivation' || cue.type === 'instruction')) {
                // Sample only some queued cues based on slot buckets
                const bucket = Math.floor(cue.timing / slotSize);
                // Keep first queued cue we encounter in each middle bucket
                return bucket === 1 || bucket === 2;
            }
            return true;
        });
    }

    return cues;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Generate guidance cues for any activity type.
 */
export function generateGuidanceCues(config: VoiceGuidanceConfig): GuidanceCue[] {
    const paceMultiplier = PACE_MULTIPLIERS[config.pace || 'normal'];
    let cues: GuidanceCue[] = [];

    switch (config.activity) {
        case 'workout':
            if (config.exercises && config.exercises.length > 0) {
                cues = generateWorkoutCues(config.exercises, paceMultiplier);
            }
            break;

        case 'breathing': {
            const targetDurationSeconds = config.intervals?.[0]?.work;
            if (config.pattern) {
                cues = generateBreathingCues(config.pattern, paceMultiplier, targetDurationSeconds);
            } else {
                // Default to box breathing
                cues = generateBreathingCues(BREATHING_PATTERNS.box, paceMultiplier, targetDurationSeconds);
            }
            cues = applyGuidanceStyle(cues, 'breathing', config.guidanceStyle);
            break;
        }

        case 'meditation': {
            const duration = config.intervals?.[0]?.work
                ? Math.floor(config.intervals[0].work / 60)
                : 5;
            cues = generateMeditationCues(duration, paceMultiplier);
            cues = applyGuidanceStyle(cues, 'meditation', config.guidanceStyle);
            break;
        }

        case 'stretching':
            // Similar to workout but with longer holds
            if (config.exercises) {
                const stretchExercises = config.exercises.map(e => ({
                    ...e,
                    duration: e.duration || '30s',
                    restAfter: e.restAfter || 10
                }));
                cues = generateWorkoutCues(stretchExercises, paceMultiplier);
            }
            break;

        case 'timer': {
            // Simple timer with end warnings
            const timerDuration = config.intervals?.[0]?.work || 60;
            const timerLabel = (config as any).label || 'Timer';
            cues = generateTimerCues(timerDuration, timerLabel, paceMultiplier);
            cues = applyGuidanceStyle(cues, 'timer', config.guidanceStyle);
            break;
        }
    }

    return cues;
}

/**
 * Get estimated duration for a set of cues.
 */
export function getGuidanceDuration(cues: GuidanceCue[]): number {
    if (cues.length === 0) return 0;
    return Math.max(...cues.map(c => c.timing));
}

/**
 * Get cues that should play at a specific time (with tolerance).
 */
export function getCuesAtTime(
    cues: GuidanceCue[],
    currentTime: number,
    toleranceMs: number = 100
): GuidanceCue[] {
    return cues.filter(cue =>
        Math.abs(cue.timing - currentTime) <= toleranceMs
    );
}
