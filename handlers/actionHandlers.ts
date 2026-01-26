/**
 * Action Handlers
 * Handles user actions from UI components (goals, workouts, timers, etc.)
 */

import { UserProfile } from '../types';
import { saveUserGoals, logWorkoutSession, getStreak, getRecentWorkouts, updateOnboardingState, getOnboardingState } from '../services/supabaseService';
import { ACTIONS, NUMBERS } from '../constants/app';
import { Message, MessageRole } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface ActionHandlersOptions {
    userProfile: UserProfile;
    setUserProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
    supabaseUserId: string | null;
    onboardingState: any;
    setOnboardingState: React.Dispatch<React.SetStateAction<any>>;
    setActiveTimer: React.Dispatch<React.SetStateAction<any>>;
    setCurrentWorkoutProgress: React.Dispatch<React.SetStateAction<any>>;
    setLastGeneratedWorkout: React.Dispatch<React.SetStateAction<any>>;
    addUIInteraction: (type: string) => void;
    handleSendMessage: (text?: string, profileOverride?: UserProfile) => Promise<void>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

/**
 * Creates action handlers for UI component interactions
 */
export const createActionHandlers = (options: ActionHandlersOptions) => {
    const {
        userProfile,
        setUserProfile,
        supabaseUserId,
        onboardingState,
        setOnboardingState,
        setActiveTimer,
        setCurrentWorkoutProgress,
        setLastGeneratedWorkout,
        addUIInteraction,
        handleSendMessage,
        setMessages
    } = options;

    return {
        [ACTIONS.SAVE_GOALS]: async (data: string[]) => {
            const newProfile = { ...userProfile, goals: data };
            setUserProfile(newProfile);

            if (supabaseUserId) {
                const goalsToSave = data.map((label: string) => ({
                    type: label.toLowerCase().replace(/\s+/g, '_'),
                    label: label
                }));
                await saveUserGoals(supabaseUserId, goalsToSave);
            }

            const text = `I've selected the following goals: ${data.join(', ')}.`;
            await handleSendMessage(text, newProfile);
        },

        [ACTIONS.GENERATE_WORKOUT]: async (data: Record<string, string>) => {
            addUIInteraction('workoutBuilder');

            const selections = Object.entries(data)
                .map(([category, value]) => `${category}: ${value}`)
                .join(', ');

            const text = `I've configured my session with: ${selections}. Please generate the workout/session for me.`;
            await handleSendMessage(text);
        },

        [ACTIONS.TIMER_STATE_CHANGE]: (data: any) => {
            setActiveTimer({
                label: data.label,
                totalSeconds: data.totalSeconds,
                remainingSeconds: data.remainingSeconds,
                isRunning: data.isRunning,
                startedAt: Date.now()
            });
        },

        [ACTIONS.WORKOUT_PROGRESS_CHANGE]: (data: { completedExercises: string[] }) => {
            setCurrentWorkoutProgress((prev: any) => {
                if (!prev) return null;
                return {
                    ...prev,
                    exercises: prev.exercises.map((e: any) => ({
                        ...e,
                        completed: data.completedExercises.includes(e.name)
                    }))
                };
            });
        },

        [ACTIONS.WORKOUT_COMPLETE]: async (data: any) => {
            if (!supabaseUserId) return;

            // const { logWorkoutSession, getStreak, getRecentWorkouts } = await import('../services/supabaseService'); // Using static imports instead to avoid build warnings

            // Log the workout session
            await logWorkoutSession(supabaseUserId, {
                workoutType: data.workoutType,
                durationSeconds: data.durationSeconds,
                completed: true,
                exercises: data.exercises
            });

            // Mark first workout completed for onboarding
            if (onboardingState && !onboardingState.firstWorkoutCompletedAt) {
                await updateOnboardingState(supabaseUserId, {
                    firstWorkoutCompletedAt: new Date().toISOString()
                });
                const updatedState = await getOnboardingState(supabaseUserId);
                if (updatedState) {
                    setOnboardingState(updatedState);
                }
            }

            // Get updated streak and recent workouts
            const streak = await getStreak(supabaseUserId, 'workout');
            const recentWorkouts = await getRecentWorkouts(supabaseUserId, NUMBERS.STREAK_TIMELINE_DAYS);
            const streakCount = streak?.current_streak || NUMBERS.DEFAULT_STREAK_COUNT;
            const longestStreak = streak?.longest_streak || streakCount;

            // Build days array for StreakTimeline
            const days = Array.from({ length: NUMBERS.STREAK_TIMELINE_DAYS }, (_, i) => {
                const date = new Date();
                date.setDate(date.getDate() - (NUMBERS.STREAK_TIMELINE_DAYS - 1 - i));
                const dateStr = date.toISOString().split('T')[0];
                const hasWorkout = recentWorkouts.some(w =>
                    new Date(w.created_at).toISOString().split('T')[0] === dateStr
                );
                return { date: dateStr, completed: hasWorkout };
            });

            // Add celebration message
            const celebrationMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: `🎉 **Amazing work!** You just crushed that ${data.workoutType} workout!\n\nYou've built a **${streakCount}-day streak** — every day you show up is another proof of your commitment. ${streakCount >= longestStreak ? "That's your best streak ever! 🏆" : `Your best is ${longestStreak} days — keep pushing!`}\n\nHere's your progress:`,
                timestamp: Date.now(),
                uiComponent: {
                    type: 'streakTimeline',
                    props: {
                        habitName: 'Workout',
                        currentStreak: streakCount,
                        longestStreak: longestStreak,
                        days: days
                    }
                }
            };

            setMessages((prev: Message[]) => [...prev, celebrationMsg]);
        }
    };
};

/**
 * Main action handler dispatcher
 */
export const handleAction = async (
    action: string,
    data: any,
    handlers: ReturnType<typeof createActionHandlers>
): Promise<void> => {
    const handler = handlers[action as keyof typeof handlers];
    if (handler) {
        await handler(data);
    } else {
        console.warn(`Unknown action: ${action}`);
    }
};
