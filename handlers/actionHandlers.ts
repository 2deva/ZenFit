/**
 * Action Handlers
 * Handles user actions from UI components (goals, workouts, timers, etc.)
 */

import { UserProfile } from '../types';
import { saveUserGoals, logWorkoutSession, getStreak, getRecentWorkouts, updateOnboardingState, getOnboardingState, getUserGoals } from '../services/supabaseService';
import { normalizeGoalType } from '../services/userContextService';
import { generateSessionFromBuilder } from '../services/sessionGeneratorService';
import { ACTIONS, NUMBERS } from '../constants/app';
import { Message, MessageRole, UIComponentData } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { generateAchievementBadgeProps, generateHabitHeatmapProps } from '../services/toolIntegrationService';
import { ActivitySession, ActivityIntent, ActivityPhase } from '../hooks/useActivityState';

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
    // Unified ActivityEngine API (optional in tests; required in app)
    startActivity?: (config: {
        type: ActivitySession['type'];
        label: string;
        totalSeconds: number;
        goalType?: string;
        goalIds?: string[];
        activityId?: string;
        intent?: ActivityIntent;
        phases?: ActivityPhase[];
        workoutMeta?: { totalSegments?: number; initialSegmentIndex?: number };
    }) => string;
    pauseActivity?: (activityId: string) => void;
    resumeActivity?: (activityId: string) => void;
    completeActivity?: (activityId: string) => void;
    stopActivity?: (activityId: string) => void;
    activitySessions?: Record<string, ActivitySession>;
}

/**
 * Creates action handlers for UI component interactions
 */
export const createActionHandlers = (options: ActionHandlersOptions, timerActivityIds: Map<string, string>) => {
    const {
        userProfile,
        setUserProfile,
        supabaseUserId,
        onboardingState,
        setOnboardingState,
        setCurrentWorkoutProgress,
        addUIInteraction,
        handleSendMessage,
        setMessages,
        startActivity: startActivityRaw,
        pauseActivity: pauseActivityRaw,
        resumeActivity: resumeActivityRaw,
        completeActivity: completeActivityRaw,
        stopActivity: stopActivityRaw
    } = options;

    // Provide safe no-op defaults for tests that don't wire ActivityEngine.
    const startActivity = startActivityRaw ?? (() => '');
    const pauseActivity = pauseActivityRaw ?? (() => { /* noop */ });
    const resumeActivity = resumeActivityRaw ?? (() => { /* noop */ });
    const completeActivity = completeActivityRaw ?? (() => { /* noop */ });
    const stopActivity = stopActivityRaw ?? (() => { /* noop */ });

    // Helper to resolve activity ID from label, checking persistence if needed
    const getActivityId = (label: string): string | undefined => {
        let id = timerActivityIds.get(label);
        if (!id && options.activitySessions) {
            const found = Object.values(options.activitySessions).find(
                s => s.label === label && s.state !== 'stopped' && s.state !== 'completed'
            );
            if (found) {
                id = found.id;
                timerActivityIds.set(label, id);
            }
        }
        return id;
    };

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

        [ACTIONS.ADD_MESSAGE]: async (data: { text?: string } | string) => {
            const text = typeof data === 'object' && data?.text ? data.text : String(data ?? '');
            if (text) await handleSendMessage(text);
        },

        [ACTIONS.GENERATE_WORKOUT]: async (data: Record<string, string>) => {
            addUIInteraction('workoutBuilder');

            // 1. Generate a preliminary config to check the type
            // We use this to detect if it's a "Mindful/Timer" session (which we keep deterministic)
            // or a "Physical/Workout" session (which we want Gemini to generate dynamically).
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

            // CASE A: Mindfulness/Timer Session
            // We keep this deterministic because it generates complex "phases" and "mindfulConfig" 
            // that the current LLM schema doesn't support well yet.
            if (sessionConfig.type === 'timer') {
                const timerProps = sessionConfig.props as any;
                const uiComponent: UIComponentData = {
                    type: 'timer',
                    props: {
                        duration: timerProps.duration,
                        label: timerProps.label,
                        goalType: sessionConfig.goalType,
                        goalIds: goalIds.length > 0 ? goalIds : undefined,
                        meta: timerProps.meta
                    }
                };

                const sessionMsg: Message = {
                    id: uuidv4(),
                    role: MessageRole.MODEL,
                    text: `Perfect! I've set up your ${sessionConfig.type === 'timer' ? 'session' : 'workout'}. Ready to begin?`,
                    timestamp: Date.now(),
                    uiComponent
                };

                setMessages((prev: Message[]) => [...prev, sessionMsg]);
                return;
            }

            // CASE B: Physical Workout
            // We discard the deterministic config and ask Gemini to generate it.
            // This leverages the "Context-Aware" prompt and the 800+ exercise database we injected.

            // Format the builder params into a natural language request
            const params = Object.entries(data)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');

            // Create a pseudo-user message that describes the intent clearly
            // We don't just send the raw params, we make it sound conversational 
            // so the LLM responds naturally.
            const prompt = `Generate a ${data.type || 'fitness'} workout with the following preferences: ${params}. Ensure it uses exercises from your supported database.`;

            // Use handleSendMessage to trigger the full AI flow (Model -> renderUI -> WorkoutList)
            await handleSendMessage(prompt);
        },

        [ACTIONS.TIMER_STATE_CHANGE]: (data: any) => {
            const label: string = data.label;
            const totalSeconds: number = data.totalSeconds;
            const remainingSeconds: number = data.remainingSeconds;
            const isRunning: boolean = data.isRunning;
            const meta = data.meta || {};
            const mindfulConfig = meta.mindfulConfig;
            const phases = meta.phases;

            const maybeId = getActivityId(label);

            // Interpret state transitions as semantic commands for ActivityEngine:
            // - isRunning === true  → start or resume activity
            // - isRunning === false & remaining < total → pause activity
            // - isRunning === false & remaining === total → reset/stop activity

            if (isRunning) {
                if (maybeId) {
                    // Resume existing timer
                    resumeActivity(maybeId);
                } else {
                    // Start a new timer activity
                    const activityId = startActivity({
                        type: 'timer',
                        label,
                        totalSeconds,
                        goalType: data.goalType,
                        goalIds: data.goalIds,
                        intent: mindfulConfig?.intent,
                        phases
                    });
                    timerActivityIds.set(label, activityId);
                }
            } else {
                if (!maybeId) {
                    // No known activity – nothing to control
                    return;
                }

                if (remainingSeconds < totalSeconds) {
                    // Pause
                    pauseActivity(maybeId);
                } else {
                    // Reset / stop – treat as explicit stop and clear mapping
                    stopActivity(maybeId);
                    timerActivityIds.delete(label);
                }
            }
        },

        [ACTIONS.TIMER_COMPLETE]: async (data: any) => {
            // Ensure the corresponding ActivityEngine session is marked complete
            if (data.label && typeof data.label === 'string') {
                const maybeId = getActivityId(data.label);
                if (maybeId) {
                    try {
                        completeActivity(maybeId);
                        timerActivityIds.delete(data.label);
                    } catch (e) {
                        console.warn('TIMER_COMPLETE: failed to mark ActivityEngine session complete', e);
                    }
                }
            }

            // Defaults
            let streakCount: number = NUMBERS.DEFAULT_STREAK_COUNT;
            let longestStreak: number = NUMBERS.DEFAULT_STREAK_COUNT;
            
            if (supabaseUserId) {
                try {
                    // Log session
                    const workoutType = data.goalType || normalizeGoalType(data.label || 'timer');
                    const goalIds = data.goalIds || [];
                    
                    await logWorkoutSession(supabaseUserId, {
                        workoutType: workoutType === 'other' ? 'mindfulness' : workoutType,
                        durationSeconds: data.durationSeconds || 60,
                        completed: true,
                        exercises: [],
                        goalIds
                    });

                    // Update onboarding
                    if (onboardingState && !onboardingState.firstWorkoutCompletedAt) {
                        await updateOnboardingState(supabaseUserId, {
                            firstWorkoutCompletedAt: new Date().toISOString()
                        });
                        const updatedState = await getOnboardingState(supabaseUserId);
                        if (updatedState) setOnboardingState(updatedState);
                    }

                    // Get streaks for celebration
                    const streak = await getStreak(supabaseUserId, workoutType === 'other' ? 'mindfulness' : workoutType);
                    if (streak) {
                        streakCount = streak.current_streak;
                        longestStreak = streak.longest_streak;
                    }
                } catch (e) {
                    console.warn('[TIMER_COMPLETE] Logging/Streak error:', e);
                }
            }

            const workoutType = data.goalType || normalizeGoalType(data.label || 'timer');
            const isMentalSession = ['mindfulness', 'meditation', 'breathing', 'sleep', 'stress', 'recovery'].includes(normalizeGoalType(workoutType));

            // Celebration Message
            let celebrationText = '';
            if (isMentalSession) {
                celebrationText = `🌿 **Wonderful practice.** You've given yourself a moment of calm.\n\n`;
            } else {
                celebrationText = `🎉 **Well done!** You completed your ${data.label || 'session'}!\n\n`;
            }

            if (supabaseUserId && streakCount > 0) {
                celebrationText += `You've built a **${streakCount}-day streak**! ${streakCount >= longestStreak ? "That's your best ever! 🏆" : "Keep it up!"}`;
            }

            const celebrationMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: celebrationText,
                timestamp: Date.now()
            };

            setMessages((prev: Message[]) => [...prev, celebrationMsg]);

            // Next Steps (Reflection or Cooldown)
            if (isMentalSession) {
                const reflectionMsg: Message = {
                    id: uuidv4(),
                    role: MessageRole.MODEL,
                    text: `✨ Take a moment to notice how you feel right now. More grounded? Lighter? I'm here if you'd like to journal a thought or two.`,
                    timestamp: Date.now()
                };
                setTimeout(() => {
                    setMessages((prev: Message[]) => [...prev, reflectionMsg]);
                }, 1500);
            } else {
                // Determine cooldown duration
                const cooldownDuration = 2; // mins
                const cooldownLabel = "Breathing Practice";
                
                const cooldownTimerProps = {
                     duration: cooldownDuration * 60,
                     label: cooldownLabel,
                     meta: {
                        mindfulConfig: {
                            intent: 'breathing_reset',
                            totalMinutes: cooldownDuration,
                            guidanceStyle: 'light',
                            pattern: 'calming'
                        }
                     }
                };

                const cooldownMessage: Message = {
                    id: uuidv4(),
                    role: MessageRole.MODEL,
                    text: `✨ How about a quick ${cooldownDuration}-minute breathing cooldown to help your body and mind recover?`,
                    timestamp: Date.now() + 100, // slight delay
                    uiComponent: {
                        type: 'timer',
                        props: cooldownTimerProps
                    }
                };
                setMessages((prev: Message[]) => [...prev, cooldownMessage]);
            }
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
        // Default stats for guests
        let streakCount: number = NUMBERS.DEFAULT_STREAK_COUNT;
        let longestStreak: number = NUMBERS.DEFAULT_STREAK_COUNT;
        let recentWorkouts: any[] = [];
        let achievements: Array<{ type: string; props: any }> = [];

        if (supabaseUserId) {
            // Use goalIds from the enriched callback if available (from Timer/WorkoutList props).
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
            recentWorkouts = await getRecentWorkouts(supabaseUserId, NUMBERS.STREAK_TIMELINE_DAYS);
            streakCount = streak?.current_streak || NUMBERS.DEFAULT_STREAK_COUNT;
            longestStreak = streak?.longest_streak || streakCount;
            const completedWorkouts = recentWorkouts.filter(w => w.completed).length;

            // Detect achievements
            // First workout achievement
            if (completedWorkouts === 1) {
                const badgeProps = await generateAchievementBadgeProps('first_workout', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'first_workout', props: badgeProps });
            }

            // Streak milestones
            if (streakCount === 7) {
                const badgeProps = await generateAchievementBadgeProps('streak_7', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'streak_7', props: badgeProps });
            } else if (streakCount === 14) {
                const badgeProps = await generateAchievementBadgeProps('streak_14', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'streak_14', props: badgeProps });
            } else if (streakCount === 30) {
                const badgeProps = await generateAchievementBadgeProps('streak_30', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'streak_30', props: badgeProps });
            }

            // Workout count milestones
            if (completedWorkouts === 10) {
                const badgeProps = await generateAchievementBadgeProps('workouts_10', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'workouts_10', props: badgeProps });
            } else if (completedWorkouts === 25) {
                const badgeProps = await generateAchievementBadgeProps('workouts_25', supabaseUserId);
                if (badgeProps.unlocked) achievements.push({ type: 'workouts_25', props: badgeProps });
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
                if (badgeProps.unlocked) achievements.push({ type: 'consistency_week', props: badgeProps });
            }
        }

        // Build days array for StreakTimeline (Guest gets empty/default)
        const days = Array.from({ length: NUMBERS.STREAK_TIMELINE_DAYS }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (NUMBERS.STREAK_TIMELINE_DAYS - 1 - i));
            const dateStr = date.toISOString().split('T')[0];
            const hasWorkout = recentWorkouts.some(w =>
                new Date(w.created_at).toISOString().split('T')[0] === dateStr && w.completed
            );
            return { date: dateStr, completed: hasWorkout };
        });

        const isMentalSession = ['mindfulness', 'sleep', 'stress', 'recovery'].includes(normalizeGoalType(data.workoutType || ''));

        // Build celebration message
        let celebrationText = '';

        if (isMentalSession) {
            celebrationText = `🌿 **Wonderful practice.** You've given yourself a moment of calm.\n\n`;
        } else {
            celebrationText = `🎉 **Amazing work!** You just crushed that ${data.workoutType} workout!\n\n`;
        }

        if (achievements.length > 0) celebrationText += `**Achievement Unlocked!** 🏆\n\n`;

        if (supabaseUserId) {
            celebrationText += `You've built a **${streakCount}-day streak** — every day you show up is another proof of your commitment. ${streakCount >= longestStreak ? "That's your best streak ever! 🏆" : `Your best is ${longestStreak} days — keep pushing!`}\n\nHere's your progress:`;
        } else {
            celebrationText += `A great session! **Log in** to start tracking your streaks and unlocking achievements.`;
        }

        const celebrationMsg: Message = {
            id: uuidv4(),
            role: MessageRole.MODEL,
            text: celebrationText,
            timestamp: Date.now(),
            uiComponent: {
                type: 'streakTimeline',
                props: {
                    habitName: isMentalSession ? 'Mindfulness' : 'Workout',
                    currentStreak: streakCount,
                    longestStreak: longestStreak,
                    days: days
                }
            }
        };

        setMessages((prev: Message[]) => [...prev, celebrationMsg]);

        if (isMentalSession) {
            const reflectionMsg: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: `✨ Take a moment to notice how you feel right now. More grounded? Lighter? I'm here if you'd like to journal a thought or two.`,
                timestamp: Date.now()
            };
            setTimeout(() => {
                setMessages((prev: Message[]) => [...prev, reflectionMsg]);
            }, 1500);
        } else {
            const cooldownDuration = 2; // minutes
            const cooldownLabel = `Breathing Practice (${cooldownDuration} min)`;
            const cooldownTimerProps = {
                duration: cooldownDuration * 60,
                label: cooldownLabel,
                meta: {
                    mindfulConfig: {
                        intent: 'breathing_reset',
                        totalMinutes: cooldownDuration,
                        guidanceStyle: 'light',
                        pattern: 'calming'
                    }
                }
            };

            const cooldownMessage: Message = {
                id: uuidv4(),
                role: MessageRole.MODEL,
                text: `✨ How about a quick ${cooldownDuration}-minute breathing cooldown to help your body and mind recover?`,
                timestamp: Date.now(),
                uiComponent: {
                    type: 'timer',
                    props: cooldownTimerProps
                }
            };

            setMessages((prev: Message[]) => [...prev, cooldownMessage]);
        }

        // ADDED: Proactively suggested Habit Heatmap / Badges for signed-in users only
        if (supabaseUserId) {
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
            const completedWorkouts = recentWorkouts.filter(w => w.completed).length;
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
                    setTimeout(() => {
                        setMessages((prev: Message[]) => [...prev, heatmapMsg]);
                    }, 2000);
                }
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
