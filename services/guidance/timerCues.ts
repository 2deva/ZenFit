import type { Exercise, GuidanceCue, BreathingPattern } from './types';

export function generateTimerCues(
    durationSeconds: number,
    label: string = 'Timer',
    pace: number = 1.0
): GuidanceCue[] {
    const cues: GuidanceCue[] = [];
    const durationMs = durationSeconds * 1000;

    // Only add an opening cue for timers > 30 seconds
    if (durationSeconds > 30) {
        cues.push({
            timing: 0,
            type: 'instruction',
            text: `${label} started. ${Math.floor(durationSeconds / 60)} ${durationSeconds >= 120 ? 'minutes' : 'minute'}${durationSeconds % 60 > 0 ? ` ${durationSeconds % 60} seconds` : ''} begins now.`,
            priority: 'immediate'
        });
    }

    // Halfway check-in for longer timers (> 2 minutes)
    if (durationSeconds >= 120) {
        cues.push({
            timing: durationMs / 2,
            type: 'instruction',
            text: "Halfway there.",
            priority: 'queued'
        });
    }

    // 1 minute warning for timers > 2 minutes
    if (durationSeconds > 120) {
        cues.push({
            timing: durationMs - 60000,
            type: 'instruction',
            text: "One minute remaining.",
            priority: 'queued'
        });
    }

    // 30 second warning for timers > 1 minute
    if (durationSeconds > 60) {
        cues.push({
            timing: durationMs - 30000,
            type: 'instruction',
            text: "Thirty seconds left.",
            priority: 'queued'
        });
    }

    // 10 second warning
    if (durationSeconds > 15) {
        cues.push({
            timing: durationMs - 10000,
            type: 'instruction',
            text: "Ten seconds.",
            priority: 'queued'
        });
    }

    // 5 second countdown - split into separate cues for clear TTS
    if (durationSeconds > 5) {
        const countdownStartTime = durationMs - 5000;
        const countdownNumbers = ['Five', 'Four', 'Three', 'Two', 'One'];
        countdownNumbers.forEach((num, idx) => {
            cues.push({
                timing: countdownStartTime + (idx * 1000),
                type: 'count',
                text: num,
                priority: 'immediate'
            });
        });
    }

    // Completion
    cues.push({
        timing: durationMs,
        type: 'completion',
        text: `${label} complete!`,
        priority: 'immediate'
    });

    return cues;
}
