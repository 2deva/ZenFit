/**
 * Action Handlers
 * Handles user actions from UI components (goals, workouts, timers, etc.)
 */

import { UserProfile } from '../types';
import { saveUserGoals, logWorkoutSession, getStreak, getRecentWorkouts, updateOnboardingState, getOnboardingState, getUserGoals } from '../services/supabaseService';
import { normalizeGoalType } from '../services/userContextService';
import { generateSessionFromBuilder } from '../services/sessionGeneratorService';
import { ACTIONS, NUMBERS } from '../constants/app';
import { Message, MessageRole } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { generateAchievementBadgeProps, generateHabitHeatmapProps, generateChartProps } from '../services/toolIntegrationService';

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

            // Deterministic session generation: parse builder selections and generate
            // a concrete Timer or WorkoutList config locally, without relying on LLM.
            let goalIds: string[] = [];
            try {
                if (supabaseUserId) {
                    const activeGoals = await getUserGoals(supabaseUserId);
                    goalIds = activeGoals.map(g => g.id);
                }
            } catch (e) {
                console.warn('GENERATE_WORKOUT: Failed to load active goals', e);
            }

            const sessionConfig = generateSessionFromBuilder(data, goalIds);

            // Build UI component props with goal metadata
            let uiComponent: any;
            if (sessionConfig.type === 'timer') {
                const timerProps = sessionConfig.props as any;
                uiComponent = {
                    type: 'timer',
                    props: {
                        duration: timerProps.duration,
                        label: timerProps.label,
                        goalType: sessionConfig.goalType,
                        goalIds: goalIds.length > 0 ? goalIds : undefined
                    }
                };
            } else {
                const workoutProps = sessionConfig.props as any;
                uiComponent = {
                    type: 'workoutList',
                    props: {
                        title: workoutProps.title,
                        exercises: workoutProps.exercises,
                        goalType: sessionConfig.goalType,
                        goalIds: goalIds.length > 0 ? goalIds : undefined
                    }
                };
            }

            // Add the session UI component directly to messages
            const sessionMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: `Perfect! I've set up your ${sessionConfig.type === 'timer' ? 'session' : 'workout'}. Ready to begin?`,
                timestamp: Date.now(),
                uiComponent
            };

            setMessages((prev: Message[]) => [...prev, sessionMsg]);

            // Optionally send a brief message to Gemini for personalized coaching text
            // (but the session tool is already rendered, so this is just for context)
            const selections = Object.entries(data)
                .map(([category, value]) => `${category}: ${value}`)
                .join(', ');
            const contextText = `I've configured my session with: ${selections}. The session is ready.`;
            // Don't await this - let it run in background for optional coaching
            handleSendMessage(contextText).catch(console.warn);
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

        [ACTIONS.TIMER_COMPLETE]: async (data: any) => {
            if (!supabaseUserId) return;

            // Use goalIds from the enriched callback if available.
            // Otherwise, fall back to inferring from goalType or label.
            let goalIds: string[] = data.goalIds || [];
            
            if (goalIds.length === 0) {
                // Fallback: infer from goalType or label
                try {
                    const activeGoals = await getUserGoals(supabaseUserId);
                    if (activeGoals.length > 0) {
                        const inferredType = data.goalType || normalizeGoalType(data.label || '');
                        const matchingGoals = activeGoals.filter(g => normalizeGoalType(g.goal_type) === inferredType);

                        if (matchingGoals.length > 0 && inferredType !== 'other') {
                            goalIds = matchingGoals.map(g => g.id);
                        } else {
                            // For mental sessions, credit all mental goals (mindfulness/stress/sleep/recovery)
                            const mentalGoals = activeGoals.filter(g => {
                                const gType = normalizeGoalType(g.goal_type);
                                return gType === 'mindfulness' || gType === 'stress' || gType === 'sleep' || gType === 'recovery';
                            });
                            goalIds = mentalGoals.length > 0 ? mentalGoals.map(g => g.id) : activeGoals.map(g => g.id);
                        }
                    }
                } catch (e) {
                    console.warn('TIMER_COMPLETE: Failed to load active goals for tagging', e);
                }
            }

            // Log timer session as a workout session (for unified tracking)
            // Mental sessions are logged with workout_type derived from label/goalType
            const workoutType = data.goalType || normalizeGoalType(data.label || 'timer');
            await logWorkoutSession(supabaseUserId, {
                workoutType: workoutType === 'other' ? 'mindfulness' : workoutType,
                durationSeconds: data.durationSeconds,
                completed: true,
                exercises: [], // Timer sessions don't have exercises
                goalIds
            });

            // Mark first workout completed for onboarding (if not already marked)
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

            // Build celebration message
            const celebrationText = `🎉 **Well done!** You completed your ${data.label || 'session'}!\n\nYou've built a **${streakCount}-day streak** — every session counts! ${streakCount >= longestStreak ? "That's your best streak ever! 🏆" : `Your best is ${longestStreak} days — keep going!`}`;

            const celebrationMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: celebrationText,
                timestamp: Date.now()
            };

            setMessages((prev: Message[]) => [...prev, celebrationMsg]);
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

            // Use goalIds from the enriched callback if available (from Timer/WorkoutList props).
            // Otherwise, fall back to inferring from workoutType.
            let goalIds: string[] = data.goalIds || [];
            
            if (goalIds.length === 0) {
                // Fallback: infer from workoutType if goalIds weren't provided
                try {
                    const activeGoals = await getUserGoals(supabaseUserId);
                    if (activeGoals.length > 0) {
                        const workoutType = (data.workoutType || '') as string;
                        const workoutPrimaryType = normalizeGoalType(workoutType);

                        const matchingGoals = activeGoals.filter(g => normalizeGoalType(g.goal_type) === workoutPrimaryType);

                        if (matchingGoals.length > 0 && workoutPrimaryType !== 'other') {
                            goalIds = matchingGoals.map(g => g.id);
                        } else {
                            // Final fallback: credit all active goals
                            goalIds = activeGoals.map(g => g.id);
                        }
                    }
                } catch (e) {
                    console.warn('WORKOUT_COMPLETE: Failed to load active goals for tagging', e);
                }
            }

            // Log the workout session with goal tags
            await logWorkoutSession(supabaseUserId, {
                workoutType: data.workoutType,
                durationSeconds: data.durationSeconds,
                completed: true,
                exercises: data.exercises,
                goalIds
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
            const completedWorkouts = recentWorkouts.filter(w => w.completed).length;

            // Build days array for StreakTimeline
            const days = Array.from({ length: NUMBERS.STREAK_TIMELINE_DAYS }, (_, i) => {
                const date = new Date();
                date.setDate(date.getDate() - (NUMBERS.STREAK_TIMELINE_DAYS - 1 - i));
                const dateStr = date.toISOString().split('T')[0];
                const hasWorkout = recentWorkouts.some(w =>
                    new Date(w.created_at).toISOString().split('T')[0] === dateStr && w.completed
                );
                return { date: dateStr, completed: hasWorkout };
            });

            // Detect achievements
            const achievements: Array<{ type: string; props: any }> = [];
            
            // First workout achievement
            if (completedWorkouts === 1) {
                const badgeProps = await generateAchievementBadgeProps('first_workout', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'first_workout', props: badgeProps });
                }
            }

            // Streak milestones
            if (streakCount === 7) {
                const badgeProps = await generateAchievementBadgeProps('streak_7', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'streak_7', props: badgeProps });
                }
            } else if (streakCount === 14) {
                const badgeProps = await generateAchievementBadgeProps('streak_14', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'streak_14', props: badgeProps });
                }
            } else if (streakCount === 30) {
                const badgeProps = await generateAchievementBadgeProps('streak_30', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'streak_30', props: badgeProps });
                }
            }

            // Workout count milestones
            if (completedWorkouts === 10) {
                const badgeProps = await generateAchievementBadgeProps('workouts_10', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'workouts_10', props: badgeProps });
                }
            } else if (completedWorkouts === 25) {
                const badgeProps = await generateAchievementBadgeProps('workouts_25', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'workouts_25', props: badgeProps });
                }
            }

            // Consistency achievement (5+ workouts in last week)
            const weekWorkouts = recentWorkouts.filter(w => {
                const workoutDate = new Date(w.created_at);
                const daysAgo = Math.floor((Date.now() - workoutDate.getTime()) / (1000 * 60 * 60 * 24));
                return daysAgo <= 7 && w.completed;
            });
            const uniqueDays = new Set(weekWorkouts.map(w => 
                new Date(w.created_at).toISOString().split('T')[0]
            )).size;
            
            if (uniqueDays === 5) {
                const badgeProps = await generateAchievementBadgeProps('consistency_week', supabaseUserId);
                if (badgeProps.unlocked) {
                    achievements.push({ type: 'consistency_week', props: badgeProps });
                }
            }

            // Build celebration message with streak timeline
            let celebrationText = `🎉 **Amazing work!** You just crushed that ${data.workoutType} workout!\n\n`;
            
            if (achievements.length > 0) {
                celebrationText += `**Achievement Unlocked!** 🏆\n\n`;
            }
            
            celebrationText += `You've built a **${streakCount}-day streak** — every day you show up is another proof of your commitment. ${streakCount >= longestStreak ? "That's your best streak ever! 🏆" : `Your best is ${longestStreak} days — keep pushing!`}\n\nHere's your progress:`;

            const celebrationMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: celebrationText,
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

            // Add achievement badges if any unlocked
            for (const achievement of achievements) {
                const achievementMsg: Message = {
                    id: uuidv4(),
                    role: MessageRole.MODEL,
                    text: `🏆 **Achievement Unlocked!**\n\n${achievement.props.title}${achievement.props.description ? `\n${achievement.props.description}` : ''}`,
                    timestamp: Date.now(),
                    uiComponent: {
                        type: 'achievementBadge',
                        props: achievement.props
                    }
                };
                setMessages((prev: Message[]) => [...prev, achievementMsg]);
            }

            // Proactively show habit heatmap if user has been active for 2+ weeks
            if (completedWorkouts >= 10) {
                const heatmapProps = await generateHabitHeatmapProps('workout', supabaseUserId, 12);
                if (heatmapProps.data.length > 0) {
                    const heatmapMsg: Message = {
                        id: uuidv4(),
                        role: MessageRole.MODEL,
                        text: `Here's your activity pattern over the last 12 weeks. Consistency is key! 💪`,
                        timestamp: Date.now(),
                        uiComponent: {
                            type: 'habitHeatmap',
                            props: heatmapProps
                        }
                    };
                    // Delay heatmap slightly to avoid overwhelming user
                    setTimeout(() => {
                        setMessages((prev: Message[]) => [...prev, heatmapMsg]);
                    }, 2000);
                }
            }
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
