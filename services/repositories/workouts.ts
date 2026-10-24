import { supabase } from '../../supabaseConfig';
import type { WorkoutSession, HabitStreak } from './types';

export const saveWorkoutProgress = async (
    userId: string,
    workoutId: string,
    completedIndices: number[],
    activeIdx: number
): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('workout_progress')
            .upsert({
                user_id: userId,
                workout_id: workoutId,
                completed_indices: completedIndices,
                active_idx: activeIdx,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,workout_id'
            });

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error saving workout progress:', e);
        return false;
    }
};

export const getWorkoutProgress = async (
    userId: string,
    workoutId: string
): Promise<{ completed: number[]; activeIdx: number } | null> => {
    try {
        const { data, error } = await supabase
            .from('workout_progress')
            .select('completed_indices, active_idx')
            .eq('user_id', userId)
            .eq('workout_id', workoutId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
        if (!data) return null;

        return {
            completed: data.completed_indices || [],
            activeIdx: data.active_idx ?? 0
        };
    } catch (e) {
        console.error('Error getting workout progress:', e);
        return null;
    }
};

export const deleteWorkoutProgress = async (
    userId: string,
    workoutId: string
): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('workout_progress')
            .delete()
            .eq('user_id', userId)
            .eq('workout_id', workoutId);

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error deleting workout progress:', e);
        return false;
    }
};

// ============================================
// WORKOUT SESSION LOGGING
// ============================================

export const logWorkoutSession = async (
    userId: string,
    session: {
        workoutType?: string;
        durationSeconds?: number;
        completed?: boolean;
        exercises?: any[];
        moodBefore?: string;
        moodAfter?: string;
        goalIds?: string[];
    }
): Promise<WorkoutSession | null> => {
    try {
        const { data, error } = await supabase
            .from('workout_sessions')
            .insert({
                user_id: userId,
                workout_type: session.workoutType,
                duration_seconds: session.durationSeconds,
                completed: session.completed ?? false,
                exercises: session.exercises,
                mood_before: session.moodBefore,
                mood_after: session.moodAfter,
                goal_ids: session.goalIds && session.goalIds.length > 0 ? session.goalIds : null
            })
            .select()
            .single();

        if (error) throw error;

        // Update streak after logging workout
        await updateStreak(userId, 'workout');

        return data;
    } catch (e) {
        console.error('Error logging workout:', e);
        return null;
    }
};

export const getRecentWorkouts = async (userId: string, limit = 5): Promise<WorkoutSession[]> => {
    try {
        const { data, error } = await supabase
            .from('workout_sessions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting workouts:', e);
        return [];
    }
};

// ============================================
// HABIT STREAK TRACKING
// ============================================

export const getStreak = async (userId: string, habitType: string): Promise<HabitStreak | null> => {
    try {
        const { data, error } = await supabase
            .from('habit_streaks')
            .select('*')
            .eq('user_id', userId)
            .eq('habit_type', habitType)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    } catch (e) {
        console.error('Error getting streak:', e);
        return null;
    }
};

export const updateStreak = async (userId: string, habitType: string): Promise<HabitStreak | null> => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const existingStreak = await getStreak(userId, habitType);

        if (!existingStreak) {
            // Create new streak
            const { data, error } = await supabase
                .from('habit_streaks')
                .insert({
                    user_id: userId,
                    habit_type: habitType,
                    current_streak: 1,
                    longest_streak: 1,
                    last_activity_date: today
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        }

        // Check if already logged today
        if (existingStreak.last_activity_date === today) {
            return existingStreak;
        }

        // Calculate if streak continues
        const lastDate = new Date(existingStreak.last_activity_date || '2000-01-01');
        const todayDate = new Date(today);
        const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

        let newStreak = existingStreak.current_streak;
        let breakCount = existingStreak.break_count;

        if (diffDays === 1) {
            // Consecutive day
            newStreak += 1;
        } else if (diffDays > 1) {
            // Streak broken
            breakCount += 1;
            newStreak = 1;
        }

        const longestStreak = Math.max(existingStreak.longest_streak, newStreak);

        const { data, error } = await supabase
            .from('habit_streaks')
            .update({
                current_streak: newStreak,
                longest_streak: longestStreak,
                last_activity_date: today,
                break_count: breakCount,
                updated_at: new Date().toISOString()
            })
            .eq('id', existingStreak.id)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (e) {
        console.error('Error updating streak:', e);
        return null;
    }
};

export const getAllStreaks = async (userId: string): Promise<HabitStreak[]> => {
    try {
        const { data, error } = await supabase
            .from('habit_streaks')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting all streaks:', e);
        return [];
    }
};

// ============================================
// SEMANTIC MEMORY (TIER 3 - pgvector)
// ============================================

