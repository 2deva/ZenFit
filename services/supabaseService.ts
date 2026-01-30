// Supabase Service for Zenfit Memory System
// Implements the 3-tier memory architecture:
// - Tier 2: Structured Facts (SQL)
// - Tier 3: Semantic Embeddings (pgvector)

import { supabase } from '../supabaseConfig';

// Type definitions (will match database schema after migration)
interface User {
    id: string;
    firebase_uid: string;
    name: string | null;
    email: string | null;
    photo_url: string | null;
    created_at: string;
    updated_at: string;
}

interface UserGoal {
    id: string;
    user_id: string;
    goal_type: string;
    goal_label: string;
    motivation: string | null;
    target_value: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

interface WorkoutSession {
    id: string;
    user_id: string;
    workout_type: string | null;
    duration_seconds: number | null;
    completed: boolean;
    exercises: any;
    mood_before: string | null;
    mood_after: string | null;
    goal_ids?: string[] | null;
    created_at: string;
}

interface HabitStreak {
    id: string;
    user_id: string;
    habit_type: string;
    current_streak: number;
    longest_streak: number;
    last_activity_date: string | null;
    break_count: number;
    created_at: string;
    updated_at: string;
}

interface UserMemory {
    id: string;
    user_id: string;
    memory_type: string;
    content: string;
    embedding: number[] | null;
    importance_score: number;
    created_at: string;
}

interface ScheduledEvent {
    id: string;
    user_id: string;
    google_event_id: string | null;
    event_type: string;
    title: string;
    scheduled_at: string;
    completed: boolean;
    created_at: string;
}

// ============================================
// USER MANAGEMENT
// ============================================

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

// ============================================
// WORKOUT PROGRESS SYNC (Cross-Device)
// ============================================

interface WorkoutProgress {
    user_id: string;
    workout_id: string;
    completed_indices: number[];
    active_idx: number;
    updated_at: string;
}

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

export const storeMemory = async (
    userId: string,
    memoryType: 'conversation' | 'preference' | 'pattern' | 'achievement',
    content: string,
    embedding?: number[],
    importanceScore = 0.5
): Promise<UserMemory | null> => {
    try {
        const { data, error } = await supabase
            .from('user_memories')
            .insert({
                user_id: userId,
                memory_type: memoryType,
                content,
                embedding,
                importance_score: importanceScore
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (e) {
        console.error('Error storing memory:', e);
        return null;
    }
};

export const searchMemories = async (
    userId: string,
    queryEmbedding: number[],
    matchCount = 3,
    matchThreshold = 0.7
): Promise<{ id: string; content: string; similarity: number }[]> => {
    try {
        const { data, error } = await supabase
            .rpc('match_memories', {
                query_embedding: queryEmbedding,
                match_threshold: matchThreshold,
                match_count: matchCount,
                p_user_id: userId
            });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error searching memories:', e);
        return [];
    }
};

export const getRecentMemories = async (userId: string, limit = 5): Promise<UserMemory[]> => {
    try {
        const { data, error } = await supabase
            .from('user_memories')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting memories:', e);
        return [];
    }
};

// ============================================
// SCHEDULED EVENTS (Calendar Integration)
// ============================================

export const createScheduledEvent = async (
    userId: string,
    event: {
        eventType: string;
        title: string;
        scheduledAt: string;
        googleEventId?: string;
    }
): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('scheduled_events')
            .insert({
                user_id: userId,
                event_type: event.eventType,
                title: event.title,
                scheduled_at: event.scheduledAt,
                google_event_id: event.googleEventId
            });

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error creating event:', e);
        return false;
    }
};

export const getUpcomingEvents = async (userId: string, limit = 5) => {
    try {
        const { data, error } = await supabase
            .from('scheduled_events')
            .select('*')
            .eq('user_id', userId)
            .eq('completed', false)
            .gte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting events:', e);
        return [];
    }
};



// ============================================
// MESSAGE SYNC (Cross-Device)
// ============================================

export interface MessageRecord {
    id: string;
    user_id: string;
    message_id: string;
    role: string;
    text: string;
    timestamp: number;
    ui_component: any | null;
    grounding_chunks: any | null;
    // Optional columns (may not exist in all deployments)
    message_context?: string | null;
    related_workout_id?: string | null;
    created_at: string;
}

export const saveMessage = async (
    userId: string,
    message: {
        id: string;
        role: string;
        text: string;
        timestamp: number;
        uiComponent?: any;
        groundingChunks?: any[];
        messageContext?: string;
        relatedWorkoutId?: string;
    }
): Promise<boolean> => {
    try {
        const basePayload: any = {
            user_id: userId,
            message_id: message.id,
            role: message.role,
            text: message.text,
            timestamp: message.timestamp,
            ui_component: message.uiComponent || null,
            grounding_chunks: message.groundingChunks || null
        };

        // Try to persist guidance routing metadata if columns exist.
        // If the database hasn't been migrated yet, fall back without failing.
        const payloadWithContext: any = {
            ...basePayload,
            message_context: message.messageContext,
            related_workout_id: message.relatedWorkoutId
        };

        const attemptInsert = async (payload: any) => {
            const { error } = await supabase.from('user_messages').insert(payload);
            return error;
        };

        const err = await attemptInsert(payloadWithContext);
        if (err) {
            const msg = (err as any)?.message || '';
            // Postgres schema mismatch → retry without new fields.
            if (/column .* does not exist/i.test(msg) || /message_context|related_workout_id/i.test(msg)) {
                const err2 = await attemptInsert(basePayload);
                if (err2) throw err2;
            } else {
                throw err;
            }
        }
        return true;
    } catch (e) {
        console.error('Error saving message:', e);
        return false;
    }
};

export const getMessages = async (userId: string, limit = 100): Promise<MessageRecord[]> => {
    try {
        const { data, error } = await supabase
            .from('user_messages')
            .select('*')
            .eq('user_id', userId)
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting messages:', e);
        return [];
    }
};

export const deleteAllMessages = async (userId: string): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('user_messages')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error deleting messages:', e);
        return false;
    }
};

// ============================================
// PSYCHOLOGY-FIRST ONBOARDING
// ============================================

export type OnboardingStage = 'initial' | 'goals_set' | 'motivation_known' | 'preferences_inferred' | 'complete';
export type PsychologicalState = 'high_engagement' | 'action_oriented' | 'hesitant' | 'stressed' | 'unknown';
export type OpennessLevel = 'high' | 'medium' | 'low' | 'unknown';
export type MotivationStyle = 'self_driven' | 'needs_encouragement' | 'competitive' | null;

export interface OnboardingState {
    id: string;
    userId: string;
    stage: OnboardingStage;
    profileCompleteness: number;
    primaryMotivation: string | null;
    motivationDetails: string | null;
    healthConditions: string[];
    preferredWorkoutTime: string | null;
    preferredActivityTypes: string[];
    typicalSessionDuration: number | null;
    opennessLevel: OpennessLevel;
    motivationStyle: MotivationStyle;
    stressBaseline: string | null;
    respondsWellTo: string[];
    totalInteractions: number;
    questionsAskedCount: number;
    lastQuestionAskedAt: string | null;
    consecutiveActionRequests: number;
    firstWorkoutCompletedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export const getOnboardingState = async (userId: string): Promise<OnboardingState | null> => {
    try {
        const { data, error } = await supabase
            .from('user_onboarding_state')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        if (!data) return null;

        return {
            id: data.id,
            userId: data.user_id,
            stage: data.onboarding_stage,
            profileCompleteness: data.profile_completeness,
            primaryMotivation: data.primary_motivation,
            motivationDetails: data.motivation_details,
            healthConditions: data.health_conditions || [],
            preferredWorkoutTime: data.preferred_workout_time,
            preferredActivityTypes: data.preferred_activity_types || [],
            typicalSessionDuration: data.typical_session_duration,
            opennessLevel: data.openness_level,
            motivationStyle: data.motivation_style,
            stressBaseline: data.stress_baseline,
            respondsWellTo: data.responds_well_to || [],
            totalInteractions: data.total_interactions,
            questionsAskedCount: data.questions_asked_count,
            lastQuestionAskedAt: data.last_question_asked_at,
            consecutiveActionRequests: data.consecutive_action_requests,
            firstWorkoutCompletedAt: data.first_workout_completed_at,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    } catch (e) {
        console.error('Error getting onboarding state:', e);
        return null;
    }
};

export const createOnboardingState = async (userId: string): Promise<OnboardingState | null> => {
    try {
        const { data, error } = await supabase
            .from('user_onboarding_state')
            .insert({ user_id: userId })
            .select()
            .single();

        if (error) throw error;
        return getOnboardingState(userId);
    } catch (e) {
        console.error('Error creating onboarding state:', e);
        return null;
    }
};

export const updateOnboardingState = async (
    userId: string,
    updates: Partial<{
        stage: OnboardingStage;
        profileCompleteness: number;
        primaryMotivation: string;
        motivationDetails: string;
        healthConditions: string[];
        preferredWorkoutTime: string;
        preferredActivityTypes: string[];
        typicalSessionDuration: number;
        opennessLevel: OpennessLevel;
        motivationStyle: MotivationStyle;
        stressBaseline: string;
        respondsWellTo: string[];
        totalInteractions: number;
        questionsAskedCount: number;
        lastQuestionAskedAt: string;
        consecutiveActionRequests: number;
        firstWorkoutCompletedAt: string;
    }>
): Promise<boolean> => {
    try {
        // Map camelCase to snake_case
        const dbUpdates: Record<string, any> = {};
        if (updates.stage !== undefined) dbUpdates.onboarding_stage = updates.stage;
        if (updates.profileCompleteness !== undefined) dbUpdates.profile_completeness = updates.profileCompleteness;
        if (updates.primaryMotivation !== undefined) dbUpdates.primary_motivation = updates.primaryMotivation;
        if (updates.motivationDetails !== undefined) dbUpdates.motivation_details = updates.motivationDetails;
        if (updates.healthConditions !== undefined) dbUpdates.health_conditions = updates.healthConditions;
        if (updates.preferredWorkoutTime !== undefined) dbUpdates.preferred_workout_time = updates.preferredWorkoutTime;
        if (updates.preferredActivityTypes !== undefined) dbUpdates.preferred_activity_types = updates.preferredActivityTypes;
        if (updates.typicalSessionDuration !== undefined) dbUpdates.typical_session_duration = updates.typicalSessionDuration;
        if (updates.opennessLevel !== undefined) dbUpdates.openness_level = updates.opennessLevel;
        if (updates.motivationStyle !== undefined) dbUpdates.motivation_style = updates.motivationStyle;
        if (updates.stressBaseline !== undefined) dbUpdates.stress_baseline = updates.stressBaseline;
        if (updates.respondsWellTo !== undefined) dbUpdates.responds_well_to = updates.respondsWellTo;
        if (updates.totalInteractions !== undefined) dbUpdates.total_interactions = updates.totalInteractions;
        if (updates.questionsAskedCount !== undefined) dbUpdates.questions_asked_count = updates.questionsAskedCount;
        if (updates.lastQuestionAskedAt !== undefined) dbUpdates.last_question_asked_at = updates.lastQuestionAskedAt;
        if (updates.consecutiveActionRequests !== undefined) dbUpdates.consecutive_action_requests = updates.consecutiveActionRequests;
        if (updates.firstWorkoutCompletedAt !== undefined) dbUpdates.first_workout_completed_at = updates.firstWorkoutCompletedAt;

        const { error } = await supabase
            .from('user_onboarding_state')
            .update(dbUpdates)
            .eq('user_id', userId);

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error updating onboarding state:', e);
        return false;
    }
};

/**
 * Detect psychological state from recent messages and behavior patterns.
 * This helps Zen adapt questioning style in real-time.
 */
export const detectPsychologicalState = (
    recentMessages: { text: string; role: string; timestamp: number }[],
    onboardingState: OnboardingState | null
): PsychologicalState => {
    if (recentMessages.length === 0) return 'unknown';

    const userMessages = recentMessages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return 'unknown';

    const lastUserMessage = userMessages[userMessages.length - 1]?.text.toLowerCase() || '';
    const avgMessageLength = userMessages.reduce((sum, m) => sum + m.text.length, 0) / userMessages.length;

    // Stress detection patterns
    const stressPatterns = /overwhelm|stressed|anxious|can't think|exhausted|tired|drained|help me|too much/i;
    if (stressPatterns.test(lastUserMessage)) {
        return 'stressed';
    }

    // Action-oriented patterns (short, direct requests)
    const actionPatterns = /^(workout|timer|start|go|let's|begin|do it|ready|next)/i;
    if (actionPatterns.test(lastUserMessage) || (avgMessageLength < 30 && userMessages.length > 1)) {
        return 'action_oriented';
    }

    // High engagement patterns (long messages, questions, elaboration)
    if (avgMessageLength > 80 || lastUserMessage.includes('because') || lastUserMessage.includes('?')) {
        return 'high_engagement';
    }

    // Hesitant patterns
    const hesitantPatterns = /idk|don't know|not sure|whatever|ok|fine|i guess/i;
    if (hesitantPatterns.test(lastUserMessage)) {
        return 'hesitant';
    }

    // Check consecutive action requests from stored state
    if (onboardingState && onboardingState.consecutiveActionRequests >= 2) {
        return 'action_oriented';
    }

    return 'unknown';
};

/**
 * Determine if it's appropriate to ask an onboarding question based on:
 * - Psychological state
 * - Question pacing
 * - Context (post-workout, during break, etc.)
 */
export const shouldAskOnboardingQuestion = async (
    userId: string,
    psychologicalState: PsychologicalState,
    context: { postWorkout?: boolean; timerRest?: boolean; sessionStart?: boolean }
): Promise<{ canAsk: boolean; reason: string }> => {
    const state = await getOnboardingState(userId);

    // New user - always allow initial question
    if (!state) {
        return { canAsk: true, reason: 'new_user' };
    }

    // Stressed users - never ask questions, just support
    if (psychologicalState === 'stressed') {
        return { canAsk: false, reason: 'user_stressed' };
    }

    // Hesitant users with low interaction count - build trust first
    if (psychologicalState === 'hesitant' && state.totalInteractions < 5) {
        return { canAsk: false, reason: 'building_trust' };
    }

    // High engagement - can ask more freely
    if (psychologicalState === 'high_engagement') {
        // Still limit to 4 questions per session, but more lenient
        if (state.questionsAskedCount < 4) {
            return { canAsk: true, reason: 'high_engagement' };
        }
    }

    // Action-oriented - only ask during natural breaks
    if (psychologicalState === 'action_oriented') {
        if (context.postWorkout || context.timerRest) {
            return { canAsk: true, reason: 'natural_break' };
        }
        return { canAsk: false, reason: 'user_focused_on_action' };
    }

    // Check time since last question (at least 1 interaction gap)
    if (state.lastQuestionAskedAt) {
        const lastQuestionTime = new Date(state.lastQuestionAskedAt).getTime();
        const timeSinceLastQuestion = Date.now() - lastQuestionTime;
        // At least 2 minutes between questions in same session
        if (timeSinceLastQuestion < 2 * 60 * 1000) {
            return { canAsk: false, reason: 'question_cooldown' };
        }
    }

    // Onboarding complete - minimal questioning
    if (state.stage === 'complete') {
        return { canAsk: false, reason: 'onboarding_complete' };
    }

    // Default: allow with standard pacing
    return { canAsk: true, reason: 'standard_pacing' };
};

/**
 * Increment interaction count and update action patterns
 */
export const recordInteraction = async (
    userId: string,
    isActionRequest: boolean
): Promise<void> => {
    const state = await getOnboardingState(userId);
    if (!state) {
        await createOnboardingState(userId);
        return;
    }

    const updates: Partial<{ totalInteractions: number; consecutiveActionRequests: number }> = {
        totalInteractions: state.totalInteractions + 1
    };

    if (isActionRequest) {
        updates.consecutiveActionRequests = state.consecutiveActionRequests + 1;
    } else {
        updates.consecutiveActionRequests = 0;
    }

    await updateOnboardingState(userId, updates);
};

/**
 * Calculate profile completeness based on filled fields
 */
export const calculateProfileCompleteness = (state: OnboardingState): number => {
    let score = 0;
    const weights = {
        primaryMotivation: 20,
        motivationDetails: 10,
        healthConditions: 10,
        preferredWorkoutTime: 15,
        preferredActivityTypes: 15,
        motivationStyle: 10,
        firstWorkoutCompletedAt: 20
    };

    if (state.primaryMotivation) score += weights.primaryMotivation;
    if (state.motivationDetails) score += weights.motivationDetails;
    if (state.healthConditions.length > 0) score += weights.healthConditions;
    if (state.preferredWorkoutTime) score += weights.preferredWorkoutTime;
    if (state.preferredActivityTypes.length > 0) score += weights.preferredActivityTypes;
    if (state.motivationStyle) score += weights.motivationStyle;
    if (state.firstWorkoutCompletedAt) score += weights.firstWorkoutCompletedAt;

    return Math.min(100, score);
};

/**
 * Extract and store onboarding context from user message.
 * Called automatically when user sends a message.
 */
export const extractOnboardingContext = async (
    userId: string,
    messageText: string
): Promise<void> => {
    const state = await getOnboardingState(userId);
    if (!state) {
        await createOnboardingState(userId);
        return;
    }

    const updates: Partial<OnboardingState> = {};
    const lowerText = messageText.toLowerCase();

    // Extract motivation keywords
    if (!state.primaryMotivation) {
        if (/stress|anxious|anxiety|mental|calm|relax/i.test(lowerText)) {
            updates.primaryMotivation = 'stress_relief';
        } else if (/weight|lose|fat|slim|diet/i.test(lowerText)) {
            updates.primaryMotivation = 'weight_loss';
        } else if (/muscle|strength|strong|bulk|gain/i.test(lowerText)) {
            updates.primaryMotivation = 'muscle_building';
        } else if (/doctor|health|blood pressure|diabetes|medical/i.test(lowerText)) {
            updates.primaryMotivation = 'health_concern';
        } else if (/energy|tired|fatigue|more active/i.test(lowerText)) {
            updates.primaryMotivation = 'energy_boost';
        } else if (/wedding|event|competition|race|marathon/i.test(lowerText)) {
            updates.primaryMotivation = 'specific_event';
        }
    }

    // Extract health conditions
    const healthPatterns = [
        { pattern: /knee|knees/i, condition: 'knee_issue' },
        { pattern: /back|spine/i, condition: 'back_issue' },
        { pattern: /shoulder/i, condition: 'shoulder_issue' },
        { pattern: /blood pressure|bp/i, condition: 'blood_pressure' },
        { pattern: /diabetes/i, condition: 'diabetes' },
        { pattern: /pregnant|pregnancy/i, condition: 'pregnancy' },
        { pattern: /injury|injured/i, condition: 'general_injury' }
    ];

    for (const { pattern, condition } of healthPatterns) {
        if (pattern.test(lowerText) && !state.healthConditions.includes(condition)) {
            updates.healthConditions = [...state.healthConditions, condition];
            break;
        }
    }

    // Extract time preferences
    if (!state.preferredWorkoutTime) {
        if (/morning|early|before work|am workout/i.test(lowerText)) {
            updates.preferredWorkoutTime = 'morning';
        } else if (/evening|after work|night|pm workout/i.test(lowerText)) {
            updates.preferredWorkoutTime = 'evening';
        } else if (/afternoon|lunch|midday/i.test(lowerText)) {
            updates.preferredWorkoutTime = 'afternoon';
        }
    }

    // Detect openness level from message length and detail
    if (messageText.length > 100 && state.opennessLevel !== 'high') {
        updates.opennessLevel = 'high';
    } else if (messageText.length < 20 && state.opennessLevel === 'unknown') {
        updates.opennessLevel = 'low';
    }

    // Store motivation details if elaborating
    if (messageText.length > 50 && !state.motivationDetails) {
        updates.motivationDetails = messageText.slice(0, 500);
    }

    // Update profile completeness
    if (Object.keys(updates).length > 0) {
        const newState = { ...state, ...updates };
        updates.profileCompleteness = calculateProfileCompleteness(newState as OnboardingState);

        // Auto-advance stage based on completeness
        if (updates.profileCompleteness >= 70 && state.stage !== 'complete') {
            updates.stage = 'complete';
        } else if (updates.profileCompleteness >= 50 && state.stage === 'initial') {
            updates.stage = 'preferences_inferred';
        } else if (updates.primaryMotivation && state.stage === 'initial') {
            updates.stage = 'motivation_known';
        }

        await updateOnboardingState(userId, updates as any);
    }
};
