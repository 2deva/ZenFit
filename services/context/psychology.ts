import { getOnboardingState, getRecentMemories } from '../supabaseService';
import type { LifeContextPsychology, LifeContextMovementBaseline, LifeContextHabits } from '../../types';

export async function getPsychologySummary(userId: string | null): Promise<LifeContextPsychology> {
    const defaultSummary: LifeContextPsychology = {
        primaryWhy: 'Support the user in building sustainable physical and mental wellbeing habits.',
        secondaryWhys: [],
        riskPatterns: [],
        toneGuardrails: 'Be warm, optimistic, non-judgmental and collaborative. Emphasize small wins and autonomy.'
    };

    if (!userId) {
        return defaultSummary;
    }

    try {
        const [onboarding, recentMems] = await Promise.all([
            getOnboardingState(userId),
            getRecentMemories(userId, 5)
        ]);

        const primaryWhy = onboarding?.primaryMotivation || defaultSummary.primaryWhy;
        const secondaryWhys: string[] = [];
        const riskPatterns: string[] = [];

        if (onboarding?.motivationDetails) {
            secondaryWhys.push(onboarding.motivationDetails);
        }
        if (onboarding?.stressBaseline) {
            secondaryWhys.push(`Baseline stress: ${onboarding.stressBaseline}`);
        }

        // Mine recent memories for indications of risk patterns
        for (const mem of recentMems) {
            const text = (mem.content || '').toLowerCase();
            if (/burnout|burned out|overwhelmed/.test(text) && !riskPatterns.includes('burnout_risk')) {
                riskPatterns.push('burnout_risk');
            }
            if (/(all or nothing|all-or-nothing|if i miss one day)/.test(text) && !riskPatterns.includes('all_or_nothing')) {
                riskPatterns.push('all_or_nothing');
            }
            if (/(perfectionist|perfectionism|never good enough)/.test(text) && !riskPatterns.includes('perfectionism')) {
                riskPatterns.push('perfectionism');
            }
            if (/(anxious|anxiety|worried)/.test(text) && !riskPatterns.includes('anxiety')) {
                riskPatterns.push('anxiety');
            }
        }

        let toneGuardrails = defaultSummary.toneGuardrails;
        const style = onboarding?.motivationStyle ? String(onboarding.motivationStyle).toLowerCase() : '';
        if (style === 'tough_love') {
            toneGuardrails = 'Be supportive but direct. Combine empathy with clear, realistic challenges. Avoid harsh judgment.';
        } else if (style === 'gentle_encouragement') {
            toneGuardrails = 'Be especially gentle and affirming. Focus on encouragement, validation, and small, manageable steps.';
        }

        return {
            primaryWhy,
            secondaryWhys,
            riskPatterns,
            toneGuardrails
        };
    } catch (e) {
        console.error('Error building psychology summary:', e);
        return defaultSummary;
    }
}

/**
 * Derive simple habit-related signals (sleep & stress) from onboarding and
 * recent memories. This is deliberately high-level and non-clinical.
 */
export function inferHabitsFromData(options: {
    onboarding?: any;
    movementBaseline?: LifeContextMovementBaseline;
    psychology?: LifeContextPsychology;
}): LifeContextHabits {
    const habits: LifeContextHabits = {};

    const { onboarding, movementBaseline, psychology } = options;

    // Sleep: infer from onboarding if available
    if (onboarding?.typicalSleepHours || onboarding?.preferredWorkoutTime) {
        const avgHours = typeof onboarding.typicalSleepHours === 'number'
            ? onboarding.typicalSleepHours
            : undefined;

        const summaryParts: string[] = [];
        if (avgHours) {
            summaryParts.push(`User reports ~${avgHours} hours of sleep per night.`);
        }
        if (onboarding.preferredWorkoutTime) {
            summaryParts.push(`Prefers to move in the ${onboarding.preferredWorkoutTime}.`);
        }

        habits.sleepConsistency = {
            avgHours,
            bedtimeVariabilityMinutes: undefined,
            summary: summaryParts.length > 0
                ? summaryParts.join(' ')
                : 'No specific sleep pattern reported.'
        };
    }

    // Stress: use onboarding + psychology
    if (psychology || onboarding?.stressBaseline) {
        const level = onboarding?.stressBaseline as 'low' | 'medium' | 'high' | undefined;
        const secondary = psychology?.secondaryWhys?.find(w => w.toLowerCase().includes('stress'));

        const parts: string[] = [];
        if (level) {
            parts.push(`Self-reported baseline stress: ${level}.`);
        }
        if (secondary) {
            parts.push(secondary);
        }
        if (!parts.length && psychology?.primaryWhy.toLowerCase().includes('stress')) {
            parts.push('Reducing stress is one of the user’s primary motivations.');
        }

        habits.stressSignals = {
            userReportedLevel: level,
            patternSummary: parts.length > 0
                ? parts.join(' ')
                : 'No clear stress baseline reported. Check in gently about current stress before suggesting intense changes.'
        };
    }

    // If nothing was inferred, provide safe defaults
    if (!habits.sleepConsistency) {
        habits.sleepConsistency = {
            avgHours: undefined,
            bedtimeVariabilityMinutes: undefined,
            summary: 'Sleep pattern is unknown. Consider asking brief, non-intrusive questions before suggesting large changes.'
        };
    }
    if (!habits.stressSignals) {
        habits.stressSignals = {
            userReportedLevel: undefined,
            patternSummary: 'Stress level is unclear. When relevant, invite the user to share how they’re feeling and offer low-pressure options.'
        };
    }

    return habits;
}

