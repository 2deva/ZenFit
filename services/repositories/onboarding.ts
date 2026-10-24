import { supabase } from '../../supabaseConfig';


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
