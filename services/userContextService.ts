/**
 * User Context Service
 * 
 * Aggregates user data from multiple sources (Structured DB, Semantic Memory, Calendar)
 * to provide a unified context for the AI.
 * 
 * Moved here from supabaseService.ts to avoid circular dependencies with embeddingService.
 */

import {
    getUserGoals,
    getAllStreaks,
    getRecentWorkouts,
    getRecentMemories,
    getUpcomingEvents
} from './supabaseService';
import { findRelevantMemories } from './embeddingService';

export interface UserMemoryContext {
    goals: { type: string; label: string; motivation: string | null }[];
    streaks: { habitType: string; currentStreak: number; longestStreak: number }[];
    recentWorkouts: { type: string | null; completed: boolean; daysAgo: number }[];
    relevantMemories: string[];
    upcomingEvents: { title: string; scheduledAt: string }[];
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
