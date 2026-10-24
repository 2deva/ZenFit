import type { Exercise, GuidanceCue, BreathingPattern } from './types';
import { getRandomMotivation } from './coaching';

export function generateBreathingCues(
    pattern: BreathingPattern,
    pace: number = 1.0,
    targetDurationSeconds?: number
): GuidanceCue[] {
    const estimateDurationMs = (cycles: number) => {
        const active = pattern.inhale + (pattern.hold || 0) + pattern.exhale + (pattern.holdEmpty || 0);
        const promptGaps =
            0.5 + // inhale prompt gap
            (pattern.hold ? 0.5 : 0) +
            0.5 + // exhale prompt gap
            (pattern.holdEmpty ? 0.5 : 0);
        const perCycle = (active + promptGaps) * 1000 * pace;
        const opening = 14000 * pace;
        const closing = 4000 * pace;
        const transitionGaps = Math.max(0, cycles - 1) * (1000 * pace);
        return opening + (cycles * perCycle) + transitionGaps + closing;
    };

    const targetMs = targetDurationSeconds && targetDurationSeconds > 0
        ? targetDurationSeconds * 1000
        : undefined;

    let effectiveCycles = pattern.cycles;
    if (targetMs) {
        const maxCycles = Math.max(1, Math.ceil((targetDurationSeconds || 1) / Math.max(1, pattern.inhale + pattern.exhale)) + 4);
        let bestCycles = 1;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (let cycles = 1; cycles <= maxCycles; cycles++) {
            const delta = Math.abs(estimateDurationMs(cycles) - targetMs);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestCycles = cycles;
            }
        }
        effectiveCycles = bestCycles;
    }

    const effectivePattern = { ...pattern, cycles: effectiveCycles };
    const cues: GuidanceCue[] = [];
    let currentTime = 0;

    // Gentle, grounding opening
    cues.push({
        timing: 0,
        type: 'instruction',
        text: `Welcome to ${pattern.name}. Find a comfortable position, let your shoulders drop, and gently close your eyes.`,
        priority: 'immediate'
    });

    currentTime += 5000 * pace;

    cues.push({
        timing: currentTime,
        type: 'instruction',
        text: "Take a moment to notice your breath as it is right now... no need to change anything yet.",
        priority: 'immediate'
    });

    currentTime += 5000 * pace;

    cues.push({
        timing: currentTime,
        type: 'instruction',
        text: `We'll move through ${effectivePattern.cycles} cycles together. Let me guide you.`,
        priority: 'immediate'
    });

    currentTime += 4000 * pace;

    for (let cycle = 1; cycle <= effectivePattern.cycles; cycle++) {
        const isFirst = cycle === 1;
        const isLast = cycle === effectivePattern.cycles;
        const isMidpoint = cycle === Math.ceil(effectivePattern.cycles / 2);

        // Cycle announcement for later cycles (not first)
        if (!isFirst && (isMidpoint || isLast)) {
            const cycleText = isLast 
                ? "Final cycle. Make this one count."
                : `Cycle ${cycle}. ${getRandomMotivation('breathing')}`;
            cues.push({
                timing: currentTime,
                type: 'motivation',
                text: cycleText,
                priority: 'queued'
            });
            currentTime += 2000 * pace;
        }

        // Inhale - varied language
        const inhalePrompts = isFirst 
            ? ["Breathe in slowly through your nose...", "Inhale gently, let your belly expand..."]
            : ["Inhale...", "Breathe in...", "Fill your lungs..."];
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: inhalePrompts[Math.floor(Math.random() * inhalePrompts.length)],
            priority: 'immediate'
        });

        // (Previously: per-second numeric inhale counts. Removed to avoid
        // timing drift and repeated/ skipped numbers with remote TTS.)
        currentTime += (effectivePattern.inhale * 1000 * pace) + (500 * pace); // Small gap after inhale

        // Hold (if specified)
        if (effectivePattern.hold) {
            const holdPrompts = isFirst
                ? ["Gently hold, keeping your body relaxed..."]
                : ["Hold...", "Hold gently...", "Pause here..."];
            
            cues.push({
                timing: currentTime,
                type: 'instruction',
                text: holdPrompts[Math.floor(Math.random() * holdPrompts.length)],
                priority: 'immediate'
            });

            // (Previously: per-second numeric hold counts. Removed for robustness.)
            currentTime += (effectivePattern.hold * 1000 * pace) + (500 * pace);
        }

        // Exhale - varied language
        const exhalePrompts = isFirst
            ? ["Exhale slowly, letting everything go...", "Release the breath gently..."]
            : ["Exhale...", "Breathe out...", "Let it go..."];
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: exhalePrompts[Math.floor(Math.random() * exhalePrompts.length)],
            priority: 'immediate'
        });

        // (Previously: per-second numeric exhale counts. Removed for robustness.)
        currentTime += (effectivePattern.exhale * 1000 * pace) + (500 * pace);

        // Hold empty (if specified)
        if (effectivePattern.holdEmpty) {
            const holdEmptyPrompts = isFirst
                ? ["Rest in the stillness, lungs empty..."]
                : ["Hold empty...", "Pause...", "Rest here..."];
            
            cues.push({
                timing: currentTime,
                type: 'instruction',
                text: holdEmptyPrompts[Math.floor(Math.random() * holdEmptyPrompts.length)],
                priority: 'immediate'
            });

            // (Previously: per-second numeric empty-hold counts. Removed for robustness.)
            currentTime += (effectivePattern.holdEmpty * 1000 * pace) + (500 * pace);
        }

        // Brief transition between cycles
        if (!isLast) {
            currentTime += 1000 * pace;
        }
    }

    // Gentle closing sequence
    cues.push({
        timing: currentTime + 1000,
        type: 'instruction',
        text: "Allow your breath to return to its natural rhythm.",
        priority: 'immediate'
    });

    currentTime += 4000 * pace;

    cues.push({
        timing: currentTime,
        type: 'completion',
        text: `Beautiful work. ${effectivePattern.cycles} cycles complete. Notice how calm and centered you feel. Carry this peace with you.`,
        priority: 'immediate'
    });

    if (targetMs && cues.length > 0) {
        const maxTiming = Math.max(...cues.map(c => c.timing));
        if (maxTiming > 0 && maxTiming !== targetMs) {
            const scale = targetMs / maxTiming;
            return cues.map(c => ({
                ...c,
                timing: Math.max(0, Math.round(c.timing * scale))
            }));
        }
    }

    return cues;
}
