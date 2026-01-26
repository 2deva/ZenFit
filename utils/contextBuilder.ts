/**
 * Context Builder Utility
 * Builds UserContext for Gemini API calls
 */

import { UserContext } from '../services/geminiService';
import { UserProfile, FitnessStats } from '../types';
import { OnboardingState, detectPsychologicalState, getOnboardingState } from '../services/supabaseService';
import { UserMemoryContext } from '../services/userContextService';
import { Message } from '../types';
import { NUMBERS, UI_LIMITS } from '../constants/app';

interface ActivityState {
    activeTimer: {
        label: string;
        totalSeconds: number;
        remainingSeconds: number;
        isRunning: boolean;
        startedAt: number;
    } | null;
    currentWorkoutProgress: {
        title: string;
        exercises: { name: string; completed: boolean }[];
        startedAt: number;
    } | null;
    lastGeneratedWorkout: {
        title: string;
        exerciseCount: number;
        generatedAt: number;
    } | null;
    recentUIInteractions: {
        type: string;
        timestamp: number;
    }[];
}

interface BuildContextOptions {
    userProfile: UserProfile;
    userLocation?: { lat: number; lng: number };
    fitnessStats?: FitnessStats;
    isAuthenticated: boolean;
    userName?: string;
    memoryContext?: UserMemoryContext | null;
    onboardingState?: OnboardingState | null;
    messages: Message[];
    lastMessageTime: number;
    activityState: ActivityState;
    profileOverride?: UserProfile;
}

/**
 * Builds UserContext for Gemini API calls
 */
export const buildUserContext = (options: BuildContextOptions): UserContext => {
    const {
        userProfile,
        userLocation,
        fitnessStats,
        isAuthenticated,
        userName,
        memoryContext,
        onboardingState,
        messages,
        lastMessageTime,
        activityState,
        profileOverride
    } = options;

    const now = new Date();
    const nowMs = Date.now();

    // Build activity context
    const activityContext: Partial<UserContext> = {};

    if (activityState.activeTimer) {
        activityContext.activeTimer = {
            label: activityState.activeTimer.label,
            totalSeconds: activityState.activeTimer.totalSeconds,
            remainingSeconds: activityState.activeTimer.remainingSeconds,
            isRunning: activityState.activeTimer.isRunning,
            startedAt: activityState.activeTimer.startedAt
        };
    }

    if (activityState.currentWorkoutProgress) {
        const completed = activityState.currentWorkoutProgress.exercises.filter(e => e.completed);
        const remaining = activityState.currentWorkoutProgress.exercises.filter(e => !e.completed);
        activityContext.currentWorkoutProgress = {
            title: activityState.currentWorkoutProgress.title,
            totalExercises: activityState.currentWorkoutProgress.exercises.length,
            completedCount: completed.length,
            completedExercises: completed.map(e => e.name),
            remainingExercises: remaining.map(e => e.name),
            startedAt: activityState.currentWorkoutProgress.startedAt,
            minutesSinceStarted: Math.floor((nowMs - activityState.currentWorkoutProgress.startedAt) / NUMBERS.MS_TO_MINUTES_DIVISOR)
        };
    }

    if (activityState.lastGeneratedWorkout) {
        activityContext.lastGeneratedWorkout = {
            title: activityState.lastGeneratedWorkout.title,
            exerciseCount: activityState.lastGeneratedWorkout.exerciseCount,
            generatedAt: activityState.lastGeneratedWorkout.generatedAt,
            minutesAgo: Math.floor((nowMs - activityState.lastGeneratedWorkout.generatedAt) / NUMBERS.MS_TO_MINUTES_DIVISOR)
        };
    }

    if (activityState.recentUIInteractions.length > 0) {
        activityContext.recentUIInteractions = activityState.recentUIInteractions.slice(-UI_LIMITS.RECENT_INTERACTIONS_COUNT).map(ui => ({
            type: ui.type,
            timestamp: ui.timestamp,
            minutesAgo: Math.floor((nowMs - ui.timestamp) / NUMBERS.MS_TO_MINUTES_DIVISOR)
        }));
    }

    // Build psychology-first onboarding context
    let onboardingContext: UserContext['onboardingState'] = undefined;
    if (onboardingState) {
        const recentMsgs = messages.slice(-UI_LIMITS.RECENT_MESSAGES_FOR_PSYCH).map(m => ({
            text: m.text,
            role: m.role,
            timestamp: m.timestamp
        }));
        const psychState = detectPsychologicalState(recentMsgs, onboardingState);

        // Determine if we can ask a question
        const isPostWorkout = activityState.currentWorkoutProgress &&
            activityState.currentWorkoutProgress.exercises.every(e => e.completed);
        const isTimerRest = activityState.activeTimer && !activityState.activeTimer.isRunning;
        let canAsk = true;

        // Quick sync rules
        if (psychState === 'stressed') canAsk = false;
        if (psychState === 'hesitant' && onboardingState.totalInteractions < UI_LIMITS.MIN_INTERACTIONS_FOR_TRUST) canAsk = false;
        if (psychState === 'action_oriented' && !isPostWorkout && !isTimerRest) canAsk = false;

        onboardingContext = {
            stage: onboardingState.stage,
            profileCompleteness: onboardingState.profileCompleteness,
            psychologicalState: psychState,
            canAskQuestion: canAsk,
            primaryMotivation: onboardingState.primaryMotivation || undefined,
            healthConditions: onboardingState.healthConditions,
            preferredWorkoutTime: onboardingState.preferredWorkoutTime || undefined,
            totalInteractions: onboardingState.totalInteractions
        };
    }

    return {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: now.getTimezoneOffset(),
        location: userLocation,
        profile: profileOverride || userProfile,
        fitnessStats: fitnessStats,
        isAuthenticated: isAuthenticated,
        userName: userName,
        memoryContext: memoryContext || undefined,
        onboardingState: onboardingContext,
        minutesSinceLastMessage: Math.floor((nowMs - lastMessageTime) / NUMBERS.MS_TO_MINUTES_DIVISOR),
        ...activityContext
    };
};
