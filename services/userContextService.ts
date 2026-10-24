import { getMovementBaseline } from './context/movement';
import { getScheduleProfile } from './context/schedule';
import { getPsychologySummary, inferHabitsFromData } from './context/psychology';
export { getMovementBaseline } from './context/movement';
export { getScheduleProfile } from './context/schedule';
export { getPsychologySummary, inferHabitsFromData } from './context/psychology';
import { normalizeGoalType } from '../utils/goalType';
export { normalizeGoalType } from '../utils/goalType';

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
import { getFitnessData, getFitnessDataLast7Days } from './fitnessService';
import { STORAGE_KEYS } from '../constants/app';
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
 * Build a simple movement baseline using today's Fit data and, when connected,
 * real last-7-days from the Fit API.
 */
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
        // Movement today = Zenfit workout completed OR Fit steps/active minutes above thresholds
        const MOVEMENT_STEPS_THRESHOLD = 4000;
        const MOVEMENT_ACTIVE_MINUTES_THRESHOLD = 10;
        const hasWorkoutToday = memContext?.recentWorkouts?.some(w => w.daysAgo === 0 && w.completed) ?? false;
        const stepsOk = (movementBaseline.avgDailySteps ?? 0) >= MOVEMENT_STEPS_THRESHOLD;
        const activeMinsOk = (movementBaseline.avgDailyActiveMinutes ?? 0) >= MOVEMENT_ACTIVE_MINUTES_THRESHOLD;
        const hasMovementToday = hasWorkoutToday || stepsOk || activeMinsOk;
        const noMovementToday = !hasMovementToday;
        const lowMovementBaseline = movementBaseline.patternSummary.toLowerCase().includes('low') ||
            (movementBaseline.avgDailySteps ?? 0) < MOVEMENT_STEPS_THRESHOLD;

        const streak = Math.max(0, ...lifeContextGoals.map(g => g.currentStreak ?? 0));
        const now = new Date();
        const currentHour = now.getHours();
        const inPreferredWindow = schedule.preferredTrainingWindows?.some(w => {
            const [startH] = (w.start || '0:00').split(':').map(Number);
            const [endH] = (w.end || '23:59').split(':').map(Number);
            return currentHour >= startH && currentHour <= endH;
        }) ?? false;

        let suggestedNextAction: string;
        if (movementBaseline.source === 'none' && !hasWorkoutToday) {
            suggestedNextAction = 'Movement data unavailable — ask about current activity or offer an optional short session without claiming low steps.';
        } else if (noMovementToday && lowMovementBaseline) {
            suggestedNextAction = 'Strong nudge: low steps and no workout today — suggest a 10-min session or 5-min stretch/breathing.';
        } else if (noMovementToday) {
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
