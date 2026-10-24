import { supabase } from '../../supabaseConfig';
import type { User, UserGoal } from './types';

export const syncUserProfile = async (
    firebaseUid: string,
    name: string | null,
    email: string | null,
    photoUrl: string | null
): Promise<User | null> => {
    try {
        // Upsert user record
        const { data, error } = await supabase
            .from('users')
            .upsert({
                firebase_uid: firebaseUid,
                name,
                email,
                photo_url: photoUrl,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'firebase_uid'
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (e) {
        console.error('Error syncing user profile:', e);
        return null;
    }
};

export const getUserByFirebaseUid = async (firebaseUid: string): Promise<User | null> => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('firebase_uid', firebaseUid)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    } catch (e) {
        console.error('Error getting user:', e);
        return null;
    }
};

// ============================================
// GOALS MANAGEMENT
// ============================================

export const saveUserGoals = async (
    userId: string,
    goals: { type: string; label: string; motivation?: string }[]
): Promise<boolean> => {
    try {
        // Deactivate all current goals
        await supabase
            .from('user_goals')
            .update({ is_active: false })
            .eq('user_id', userId);

        // Insert new goals
        const goalsToInsert = goals.map(g => ({
            user_id: userId,
            goal_type: g.type,
            goal_label: g.label,
            motivation: g.motivation || null,
            is_active: true
        }));

        const { error } = await supabase
            .from('user_goals')
            .insert(goalsToInsert);

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error saving goals:', e);
        return false;
    }
};

export const getUserGoals = async (userId: string): Promise<UserGoal[]> => {
    try {
        const { data, error } = await supabase
            .from('user_goals')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting goals:', e);
        return [];
    }
};

const STEP_GOAL_MIN = 1000;
const STEP_GOAL_MAX = 50000;
const STEP_GOAL_DEFAULT = 8000;

/**
 * Resolve daily step goal from user goals (steps/walking-related goal with target_value).
 * Returns default 8000 if no matching goal.
 */
export const getStepGoalForUser = async (userId: string): Promise<number> => {
    try {
        const goals = await getUserGoals(userId);
        const labelLower = (s: string) => (s || '').toLowerCase();
        const stepGoal = goals.find(g => {
            const type = labelLower(g.goal_type);
            const label = labelLower(g.goal_label);
            const isStepRelated = type === 'cardio' || label.includes('step') || label.includes('walk');
            const value = g.target_value ?? 0;
            return isStepRelated && value >= STEP_GOAL_MIN && value <= STEP_GOAL_MAX;
        });
        return stepGoal?.target_value ?? STEP_GOAL_DEFAULT;
    } catch (e) {
        console.warn('getStepGoalForUser failed, using default:', e);
        return STEP_GOAL_DEFAULT;
    }
};

// ============================================
// WORKOUT PROGRESS SYNC (Cross-Device)
// ============================================

