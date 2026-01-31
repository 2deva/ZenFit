
/**
 * User Context Service
 *
 * Aggregates user data from multiple sources (Structured DB, Semantic Memory, Calendar, Fitness)
 * to provide a unified context for the AI.
 *
 * Moved here from supabaseService.ts to avoid circular dependencies with embeddingService.
 */

import {
    getUserGoals,
    getAllStreaks,
    getRecentWorkouts,
    getRecentMemories,
    getUpcomingEvents,
    getOnboardingState
} from './supabaseService';
import { findRelevantMemories } from './embeddingService';
import { getFitnessData } from './fitnessService';
import {
    LifeContextGoal,
    LifeContextGoalProgress,
    LifeContextGoalType,
  LifeContextMovementBaseline,
  LifeContextSchedule,
  LifeContextHabits,
  LifeContextPsychology,
  LifeContextProfile,
  LifeContext
} from '../types';

// Re-export for convenience
export type { LifeContextGoalType };

export interface UserMemoryContext {
    goals: { type: string; label: string; motivation: string | null }[];
    streaks: { habitType: string; currentStreak: number; longestStreak: number }[];
    recentWorkouts: { type: string | null; completed: boolean; daysAgo: number }[];
    relevantMemories: string[];
    upcomingEvents: { title: string; scheduledAt: string }[];
}

// ============================================================================
// LifeContext Helpers: Goal Types, Per-Goal Progress, Movement Baseline
// ============================================================================

export function normalizeGoalType(rawType: string | null | undefined): LifeContextGoalType {
    if (!rawType) return 'other';
    const t = rawType.toLowerCase();

    if (t.includes('strength') || t.includes('muscle') || t.includes('resistance')) return 'strength';
    if (t.includes('cardio') || t.includes('run') || t.includes('walk') || t.includes('hiit')) return 'cardio';
    if (t.includes('mobility') || t.includes('flex') || t.includes('yoga') || t.includes('stretch')) return 'mobility';
    if (t.includes('mind') || t.includes('meditat') || t.includes('focus')) return 'mindfulness';
    if (t.includes('sleep')) return 'sleep';
    if (t.includes('stress') || t.includes('anxiety') || t.includes('calm')) return 'stress';
    if (t.includes('recover') || t.includes('rest')) return 'recovery';

    return 'other';
}

export function inferTargetFrequency(goal: Pick<LifeContextGoal, 'type'>): number | undefined {
    // Lightweight heuristic based on goal type; can be refined later.
    switch (goal.type) {
        case 'strength':
        case 'cardio':
        case 'mobility':
            return 3; // 3 sessions/week is a common sustainable target
        case 'mindfulness':
        case 'sleep':
        case 'stress':
        case 'recovery':
            return 5; // most days
        default:
            return undefined;
    }
}

export function inferPriority(_goal: Pick<LifeContextGoal, 'type'>): 'high' | 'medium' | 'low' | undefined {
    // For now, keep all explicit goals as high priority; can later be user-tuned.
    return 'high';
}

/**
 * Compute lightweight per-goal streak and weekly completion summary.
 *
 * NOTE: v1 approximation: uses global workout streak and simple mapping from
 * workout_type -> goal_type. This can later be extended when sessions are
 * explicitly tagged with goal IDs.
 */
export async function getGoalStreakSummary(
    userId: string
): Promise<Record<string, LifeContextGoalProgress>> {
    try {
        const [goals, streaks, workouts] = await Promise.all([
            getUserGoals(userId),
            getAllStreaks(userId),
            getRecentWorkouts(userId, 60) // ~2 months of history for per-goal streaks
        ]);

        const now = new Date();
        const globalWorkoutStreak = streaks.find(s => s.habit_type === 'workout');

        const byGoal: Record<string, LifeContextGoalProgress> = {};

        // Build a map of goalId -> set of dates where that goal had a completed session
        const goalDateMap: Record<string, Set<string>> = {};
        goals.forEach(g => {
            goalDateMap[g.id] = new Set<string>();
        });

        workouts.forEach(w => {
            if (!w.completed) return;
            const dateStr = new Date(w.created_at).toISOString().split('T')[0];

            // Prefer explicit goal_ids tagging when available
            if (Array.isArray((w as any).goal_ids) && (w as any).goal_ids.length > 0) {
                (w as any).goal_ids.forEach((gid: string) => {
                    if (!goalDateMap[gid]) return;
                    goalDateMap[gid].add(dateStr);
                });
                return;
            }

            // Fallback: if no explicit tagging yet, attribute generic workouts
            // using the same type-based heuristic as before.
            const wt = (w.workout_type || '').toLowerCase();
            goals.forEach(goal => {
                const type = normalizeGoalType(goal.goal_type);
                let matches = false;
                switch (type) {
                    case 'strength':
                        matches = wt.includes('strength') || wt.includes('lift') || wt.includes('resistance');
                        break;
                    case 'cardio':
                        matches = wt.includes('cardio') || wt.includes('run') || wt.includes('walk') || wt.includes('bike') || wt.includes('hiit');
                        break;
                    case 'mobility':
                        matches = wt.includes('mobility') || wt.includes('stretch') || wt.includes('yoga');
                        break;
                    default:
                        // For mental/recovery goals we currently rely more on timers / separate flows.
                        matches = false;
                        break;
                }
                if (matches) {
                    goalDateMap[goal.id].add(dateStr);
                }
            });
        });

        goals.forEach(goal => {
            const dates = goalDateMap[goal.id] || new Set<string>();

            // Completions in the last 7 days for this goal
            let completionsThisWeek = 0;
            for (let d = 0; d < 7; d++) {
                const day = new Date(now);
                day.setDate(now.getDate() - d);
                const key = day.toISOString().split('T')[0];
                if (dates.has(key)) {
                    completionsThisWeek++;
                }
            }

            // Compute current streak and best streak for this goal from the date set
            let currentStreak = 0;
            for (let d = 0; d < 60; d++) {
                const day = new Date(now);
                day.setDate(now.getDate() - d);
                const key = day.toISOString().split('T')[0];
                if (dates.has(key)) {
                    currentStreak++;
                } else {
                    break;
                }
            }

            let bestStreak = 0;
            let run = 0;
            for (let d = 0; d < 60; d++) {
                const day = new Date(now);
                day.setDate(now.getDate() - d);
                const key = day.toISOString().split('T')[0];
                if (dates.has(key)) {
                    run++;
                    if (run > bestStreak) bestStreak = run;
                } else {
                    run = 0;
                }
            }

            // If there are no tagged dates yet, fall back to global workout streak so
            // we still show something meaningful.
            if (dates.size === 0 && globalWorkoutStreak) {
                currentStreak = globalWorkoutStreak.current_streak;
                bestStreak = globalWorkoutStreak.longest_streak;
            }

            byGoal[goal.id] = {
                currentStreak,
                bestStreak,
                completionsThisWeek
            };
        });

        return byGoal;
    } catch (e) {
        console.error('Error computing goal streak summary:', e);
        return {};
    }
}

/**
 * Build a simple movement baseline using existing fitnessStats helpers.
 * Currently uses today's Google Fit data as a proxy and generates a
 * conservative pattern summary.
 */
export async function getMovementBaseline(userId: string | null): Promise<LifeContextMovementBaseline> {
    try {
        // For now we don't yet persist historical Fit data per user, so we use
        // the current-day fitness snapshot and replicate it across 7 days as
        // a stable baseline. This is still useful for the model to reason about
        // \"low\" vs \"high\" movement.
        const fitnessStats = await getFitnessData();

        const today = new Date();
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - (6 - i));
            return {
                date: d.toISOString().split('T')[0],
                steps: fitnessStats.steps,
                activeMinutes: fitnessStats.activeMinutes
            };
        });

        const avgDailySteps = fitnessStats.steps;
        const avgDailyActiveMinutes = fitnessStats.activeMinutes;

        let patternSummary = '';
        if (avgDailySteps === 0 && avgDailyActiveMinutes === 0) {
            patternSummary = 'Movement data unavailable or very low today. Ask the user briefly about their typical activity level before assuming sedentary behavior.';
        } else if (avgDailySteps < 4000) {
            patternSummary = 'Currently shows low daily movement (<4k steps). Favor gentle, achievable suggestions and celebrate any movement.';
        } else if (avgDailySteps < 8000) {
            patternSummary = 'Moderate daily movement (~4k–8k steps). You can nudge slightly more activity or focus on specific goals.';
        } else {
            patternSummary = 'High daily movement (>=8k steps). Consider emphasizing strength, mobility, or recovery rather than just more steps.';
        }

        return {
            source: 'google_fit',
            avgDailySteps,
            avgDailyActiveMinutes,
            last7Days,
            patternSummary
        };
    } catch (e) {
        console.warn('Movement baseline: falling back due to error or missing fitness data:', e);

        const today = new Date();
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - (6 - i));
            return {
                date: d.toISOString().split('T')[0],
                steps: 0,
                activeMinutes: 0
            };
        });

        return {
            source: 'none',
            avgDailySteps: undefined,
            avgDailyActiveMinutes: undefined,
            last7Days,
            patternSummary: 'Movement data is currently unavailable. Ask the user a quick question about how much they move in a typical day before making strong assumptions.'
        };
    }
}

/**
 * Derive a coarse schedule profile from onboarding preferences and upcoming
 * scheduled events. This focuses on \"when\" to suggest activities rather than
 * exposing raw calendar details.
 */
export async function getScheduleProfile(userId: string | null): Promise<LifeContextSchedule> {
    const now = new Date();

    if (!userId) {
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: [],
            hardBusyBlocksSummary: 'No account-linked schedule data available. Assume a standard day and ask the user when they prefer to move.'
        };
    }

    try {
        const onboarding = await getOnboardingState(userId);
        const upcoming = await getUpcomingEvents(userId, 10);

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Map preferredWorkoutTime (e.g. 'morning', 'afternoon', 'evening') into windows
        const trainingWindows: LifeContextSchedule['preferredTrainingWindows'] = [];
        const preferred = onboarding?.preferredWorkoutTime?.toLowerCase();

        const addWindow = (label: string, startHour: number, endHour: number, source: LifeContextSchedule['preferredTrainingWindows'][number]['source']) => {
            trainingWindows.push({
                label,
                days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                start: `${String(startHour).padStart(2, '0')}:00`,
                end: `${String(endHour).padStart(2, '0')}:00`,
                source
            });
        };

        if (preferred === 'morning') {
            addWindow('morning_block', 6, 9, 'user_reported');
        } else if (preferred === 'evening') {
            addWindow('evening_block', 17, 20, 'user_reported');
        } else if (preferred === 'afternoon') {
            addWindow('afternoon_block', 12, 14, 'user_reported');
        }

        // Derive busy periods from upcoming scheduled events (e.g., workouts / meetings)
        const busyCounts: Record<string, number> = {};
        for (const ev of upcoming) {
            if (!ev.scheduled_at) continue;
            const start = new Date(ev.scheduled_at);
            const hour = start.getHours();
            const bucket =
                hour < 9 ? 'early_morning' :
                    hour < 12 ? 'late_morning' :
                        hour < 17 ? 'afternoon' :
                            hour < 21 ? 'evening' : 'late_night';
            busyCounts[bucket] = (busyCounts[bucket] || 0) + 1;
        }

        const busiest = Object.entries(busyCounts).sort((a, b) => b[1] - a[1])[0];
        let hardBusyBlocksSummary = '';
        if (busiest) {
            const [slot] = busiest;
            switch (slot) {
                case 'early_morning':
                    hardBusyBlocksSummary = 'Mornings are often busy based on scheduled events. Avoid stacking long sessions before 9 AM unless the user asks.';
                    break;
                case 'late_morning':
                    hardBusyBlocksSummary = 'Late mornings are frequently booked. Consider suggesting early morning, afternoon, or evening sessions.';
                    break;
                case 'afternoon':
                    hardBusyBlocksSummary = 'Afternoons are often busy. Prefer morning or evening for new commitments.';
                    break;
                case 'evening':
                    hardBusyBlocksSummary = 'Evenings are usually busy. Be cautious suggesting long sessions after work hours.';
                    break;
                default:
                    hardBusyBlocksSummary = 'No strong busy time patterns detected in scheduled events.';
            }
        } else {
            hardBusyBlocksSummary = 'No upcoming events found. Use simple, flexible suggestions and ask the user about their preferred times.';
        }

        return {
            timezone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: trainingWindows,
            hardBusyBlocksSummary
        };
    } catch (e) {
        console.error('Error building schedule profile:', e);
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: [],
            hardBusyBlocksSummary: 'Schedule information could not be loaded. Default to asking the user when they prefer to move.'
        };
    }
}

/**
 * Build a high-level psychological profile from onboarding data and
 * recent memories. This is intentionally coarse and focused on motivation
 * and coaching style, not any clinical assessment.
 */
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

        let primaryWhy = onboarding?.primaryMotivation || defaultSummary.primaryWhy;
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

export const getFullUserContext = async (
    userId: string,
    semanticQuery?: string
): Promise<UserMemoryContext | null> => {
    try {
        let relevantMemories: string[] = [];

        if (semanticQuery) {
            // Use semantic vector search when a query is provided
            try {
                // Now we can import statically because embeddingService doesn't import this file
                // const { findRelevantMemories } = await import('./embeddingService'); // Using static import
                relevantMemories = await findRelevantMemories(userId, semanticQuery, 3);
                // console.log(`SemanticSearch: Found ${relevantMemories.length} relevant memories for query`);
            } catch (e) {
                console.warn('Semantic search failed, falling back to recent memories:', e);
            }
        }

        const [goals, streaks, workouts, recentMems, events] = await Promise.all([
            getUserGoals(userId),
            getAllStreaks(userId),
            getRecentWorkouts(userId, 3),
            // Fallback to recent memories if semantic search returned nothing
            relevantMemories.length === 0 ? getRecentMemories(userId, 3) : Promise.resolve([]),
            getUpcomingEvents(userId, 3)
        ]);

        const now = new Date();

        // Use semantic results if available, otherwise use recent memories
        const finalMemories = relevantMemories.length > 0
            ? relevantMemories
            : recentMems.map(m => m.content);

        return {
            goals: goals.map(g => ({
                type: g.goal_type,
                label: g.goal_label,
                motivation: g.motivation
            })),
            streaks: streaks.map(s => ({
                habitType: s.habit_type,
                currentStreak: s.current_streak,
                longestStreak: s.longest_streak
            })),
            recentWorkouts: workouts.map(w => ({
                type: w.workout_type,
                completed: w.completed,
                daysAgo: Math.floor((now.getTime() - new Date(w.created_at).getTime()) / (1000 * 60 * 60 * 24))
            })),
            relevantMemories: finalMemories,
            upcomingEvents: events.map(e => ({
                title: e.title,
                scheduledAt: e.scheduled_at
            }))
        };
    } catch (e) {
        console.error('Error getting full context:', e);
        return null;
    }
};

// ============================================================================
// LifeContext Aggregation
// ============================================================================

/**
 * Build a holistic LifeContext for the given user by combining structured
 * data (goals, workouts, onboarding), movement data, and semantic memories.
 * This is intentionally high-level and focused on factors that influence
 * sustainable behavior change.
 */
export const buildLifeContext = async (
    userId: string | null,
    semanticQuery?: string
): Promise<LifeContext | null> => {
    // If no user, return a minimal anonymous profile
    if (!userId) {
        const movementBaseline = await getMovementBaseline(null);
        const psychology = await getPsychologySummary(null);
        const schedule = await getScheduleProfile(null);
        const habits = inferHabitsFromData({ movementBaseline, psychology });

        const profile: LifeContextProfile = {};

        return {
            profile,
            schedule,
            goals: [],
            movementBaseline,
            habits,
            psychology,
            suggestedNextAction: 'Optional: suggest one small action (workout, breathing, or stretch).'
        };
    }

    try {
        // Reuse existing context-building pieces where possible
        const [goals, goalProgress, movementBaseline, schedule, psychology, memContext, onboarding] = await Promise.all([
            getUserGoals(userId),
            getGoalStreakSummary(userId),
            getMovementBaseline(userId),
            getScheduleProfile(userId),
            getPsychologySummary(userId),
            getFullUserContext(userId, semanticQuery),
            getOnboardingState(userId)
        ]);

        const profile: LifeContextProfile = {
            // We can enhance this over time with explicit profile fields.
            // For now, infer very coarse environment from preferredActivityTypes if available.
            environment: onboarding?.preferredActivityTypes?.some((t: string) => t.toLowerCase().includes('gym'))
                ? 'gym_access'
                : undefined
        };

        const lifeContextGoals: LifeContextGoal[] = goals.map(g => {
            const type = normalizeGoalType(g.goal_type);
            const progress = goalProgress[g.id] || {};

            return {
                id: g.id,
                type,
                label: g.goal_label,
                motivation: g.motivation,
                createdAt: g.created_at,
                targetPerWeek: inferTargetFrequency({ type } as LifeContextGoal),
                priority: inferPriority({ type } as LifeContextGoal),
                currentStreak: progress.currentStreak,
                bestStreak: progress.bestStreak,
                completionsThisWeek: progress.completionsThisWeek
            };
        });

        const habits = inferHabitsFromData({
            onboarding,
            movementBaseline,
            psychology
        });

        // If we have a memory context with upcoming events, optionally enrich schedule summary.
        if (memContext && memContext.upcomingEvents && memContext.upcomingEvents.length > 0) {
            const firstEvent = memContext.upcomingEvents[0];
            schedule.hardBusyBlocksSummary += ` The user has an upcoming commitment: ${firstEvent.title} at ${firstEvent.scheduledAt}. Use this as an anchor when suggesting follow-up actions.`;
        }

        // Suggested next action for proactive nudge (resolution adherence)
        const hasMovementToday = memContext?.recentWorkouts?.some(w => w.daysAgo === 0 && w.completed) ?? false;
        const noMovementToday = !hasMovementToday;
        const streak = Math.max(0, ...lifeContextGoals.map(g => g.currentStreak ?? 0));
        const now = new Date();
        const currentHour = now.getHours();
        const inPreferredWindow = schedule.preferredTrainingWindows?.some(w => {
            const [startH] = (w.start || '0:00').split(':').map(Number);
            const [endH] = (w.end || '23:59').split(':').map(Number);
            return currentHour >= startH && currentHour <= endH;
        }) ?? false;

        let suggestedNextAction: string;
        if (noMovementToday) {
            suggestedNextAction = 'No movement today — suggest 10-min session (or 5-min stretch/breathing).';
        } else if (streak > 0) {
            suggestedNextAction = `${streak}-day streak — nudge to maintain (one more session today).`;
        } else if (inPreferredWindow) {
            suggestedNextAction = 'Preferred window (e.g. evening) — suggest session.';
        } else {
            suggestedNextAction = 'Optional: suggest one small action (workout, breathing, or stretch).';
        }

        return {
            profile,
            schedule,
            goals: lifeContextGoals,
            movementBaseline,
            habits,
            psychology,
            suggestedNextAction
        };
    } catch (e) {
        console.error('Error building LifeContext:', e);
        // Fall back to a minimal yet safe context
        const movementBaseline = await getMovementBaseline(userId);
        const psychology = await getPsychologySummary(userId);
        const schedule = await getScheduleProfile(userId);
        const habits = inferHabitsFromData({ movementBaseline, psychology });

        return {
            profile: {},
            schedule,
            goals: [],
            movementBaseline,
            habits,
            psychology,
            suggestedNextAction: 'Optional: suggest one small action (workout, breathing, or stretch).'
        };
    }
};
