import React, { createContext, useContext, useRef, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAppContext } from './AppContext';
import { useLiveSession } from '../hooks/useLiveSession';
import { LiveStatus, Message, MessageRole, UIComponentData } from '../types';
import { TIMING, TEXT, ACTIONS } from '../constants/app';
import { v4 as uuidv4 } from 'uuid';
import { setMessages as saveMessages } from '../services/storageService';
import { refreshContext } from '../services/contextService';
import { syncWorkoutProgressToCloud } from '../services/persistenceService';
import { getStreak, getRecentWorkouts } from '../services/supabaseService';
import { NUMBERS } from '../constants/app';

interface LiveSessionContextType {
    liveStatus: LiveStatus;
    connectLive: () => void;
    disconnectLive: (manual?: boolean) => void;
    toggleLive: () => void;
    startLiveModeAndSendMessage: (message: string) => void;

    audioDataRef: React.MutableRefObject<Float32Array>;
    liveIsSpeaking: boolean;
    isInterrupted: boolean;
    liveIsMuted: boolean;
    setLiveIsMuted: (muted: boolean) => void;

    handleActivityControl: (action: 'pause' | 'resume' | 'skip' | 'stop' | 'back') => void;
    handleVoiceCommand: (action: string, response: string | null) => void;

    // Additional properties exposed for UI
    isExpectingGuidanceResponse: React.MutableRefObject<boolean>;
    isGuidanceActive: React.MutableRefObject<boolean>;
    sendMessageToLive: ((text: string) => void) | null;
}

const LiveSessionContext = createContext<LiveSessionContextType | undefined>(undefined);

export function LiveSessionContextProvider({ children }: { children: ReactNode }) {
    const {
        supabaseUserId,
        getUserContext,
        messages, setMessages,
        activeTimer, setActiveTimer,
        currentWorkoutProgress, setCurrentWorkoutProgress,
        workoutProgress, setWorkoutProgress,
        activeWorkoutMessageId, setActiveWorkoutMessageId,
        activeWorkoutMessageIdRef,
        currentLiveModelMessageIdRef,
        currentLiveUserMessageIdRef,
        handleActionWrapper,
        userProfile,
        setUserProfile,
        onboardingState,
        setOnboardingState
    } = useAppContext();

    const audioDataRef = useRef<Float32Array>(new Float32Array(0));
    const [isInterrupted, setIsInterrupted] = useState(false);

    // Buffers
    const userTranscriptBufferRef = useRef<string>('');
    const modelTranscriptBufferRef = useRef<string>('');
    const pendingLiveMessageRef = useRef<string | null>(null);
    const timerActivityConfigRef = useRef<{ activityType: string; config: any } | null>(null);
    
    // Track workout completion to prevent duplicate handling
    const workoutCompletionHandledRef = useRef<Set<string>>(new Set());

    // --- Callbacks for useLiveSession ---

    const handleLiveTranscription = useCallback((text: string, isUser: boolean, isFinal: boolean) => {
        if (isUser) {
            // STRICT TURN HANDLING: Detect Role Switch (Model -> User)
            if (currentLiveModelMessageIdRef.current) {
                currentLiveModelMessageIdRef.current = null;
                modelTranscriptBufferRef.current = '';
            }

            if (!text && isFinal) {
                if (currentLiveUserMessageIdRef.current && userTranscriptBufferRef.current) {
                    setMessages(prev => prev.map(msg =>
                        msg.id === currentLiveUserMessageIdRef.current
                            ? { ...msg, text: userTranscriptBufferRef.current }
                            : msg
                    ));
                }
                currentLiveUserMessageIdRef.current = null;
                userTranscriptBufferRef.current = '';
                return;
            }

            if (text.startsWith(userTranscriptBufferRef.current.substring(0, Math.min(10, userTranscriptBufferRef.current.length)))) {
                userTranscriptBufferRef.current = text;
            } else if (userTranscriptBufferRef.current && !userTranscriptBufferRef.current.endsWith(text)) {
                userTranscriptBufferRef.current += text;
            } else {
                userTranscriptBufferRef.current = text;
            }

            if (currentLiveUserMessageIdRef.current) {
                setMessages(prev => prev.map(msg =>
                    msg.id === currentLiveUserMessageIdRef.current
                        ? { ...msg, text: userTranscriptBufferRef.current }
                        : msg
                ));
            } else {
                const id = uuidv4();
                currentLiveUserMessageIdRef.current = id;
                const newMessage: Message = {
                    id,
                    role: MessageRole.USER,
                    text: userTranscriptBufferRef.current,
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, newMessage]);
            }
        } else {
            // STRICT TURN HANDLING: Detect Role Switch (User -> Model)
            if (currentLiveUserMessageIdRef.current) {
                currentLiveUserMessageIdRef.current = null;
                userTranscriptBufferRef.current = '';
            }

            // Gemini Live streams partial chunks that sometimes omit whitespace at boundaries.
            // Join chunks with a space only when needed to avoid "wordsstucktogether".
            const incoming = text || '';
            const existing = modelTranscriptBufferRef.current || '';
            if (!existing) {
                modelTranscriptBufferRef.current = incoming;
            } else if (!incoming) {
                // no-op
            } else {
                const lastChar = existing.slice(-1);
                const firstChar = incoming[0];
                const needsSpace =
                    !/\s/.test(lastChar) &&
                    !/[\s.,!?;:)\]]/.test(firstChar) &&
                    !/[(\[]/.test(firstChar);
                modelTranscriptBufferRef.current = existing + (needsSpace ? ' ' : '') + incoming;
            }

            // Use isGuidanceActive.current directly from hook instead of synced ref for immediate updates
            const guidanceActive = isGuidanceActive.current;
            const workoutMsgId = activeWorkoutMessageIdRef.current;

            if (currentLiveModelMessageIdRef.current) {
                setMessages(prev => prev.map(msg => {
                    if (msg.id === currentLiveModelMessageIdRef.current) {
                        let updateData: Partial<Message> = { text: modelTranscriptBufferRef.current };
                        if (guidanceActive && !msg.messageContext && workoutMsgId && !msg.uiComponent) {
                            updateData.messageContext = 'workout_guidance';
                            updateData.relatedWorkoutId = workoutMsgId;
                        }
                        return { ...msg, ...updateData };
                    }
                    return msg;
                }));
            } else {
                const id = uuidv4();
                currentLiveModelMessageIdRef.current = id;

                let messageContext: 'workout_guidance' | 'general' | undefined;
                let relatedWorkoutId: string | undefined;

                if (guidanceActive && workoutMsgId) {
                    messageContext = 'workout_guidance';
                    relatedWorkoutId = workoutMsgId;
                }

                const newMessage: Message = {
                    id,
                    role: MessageRole.MODEL,
                    text: modelTranscriptBufferRef.current,
                    timestamp: Date.now(),
                    ...(messageContext && { messageContext }),
                    ...(relatedWorkoutId && { relatedWorkoutId })
                };
                setMessages(prev => [...prev, newMessage]);
            }
        }
    // NOTE: Don't include `isGuidanceActive` in deps here (it's a ref and declared later),
    // and referencing it in the deps array would hit TDZ / "used before declaration".
    }, [setMessages, activeWorkoutMessageIdRef, currentLiveModelMessageIdRef, currentLiveUserMessageIdRef]);

    const handleLiveToolCall = useCallback((component: UIComponentData) => {
        setMessages(prev => {
            let updatedMessages: Message[];
            let messageId: string;

            if (currentLiveModelMessageIdRef.current) {
                messageId = currentLiveModelMessageIdRef.current;
                updatedMessages = prev.map(msg =>
                    msg.id === currentLiveModelMessageIdRef.current
                        ? { ...msg, uiComponent: component }
                        : msg
                );
            } else {
                messageId = uuidv4();
                currentLiveModelMessageIdRef.current = messageId;
                updatedMessages = [...prev, {
                    id: messageId,
                    role: MessageRole.MODEL,
                    text: "",
                    timestamp: Date.now(),
                    uiComponent: component
                }];
            }

            if (component.type === 'workoutList' || component.type === 'timer') {
                activeWorkoutMessageIdRef.current = messageId;
                setActiveWorkoutMessageId(messageId);

                if (component.type === 'timer' && component.props) {
                    const label = component.props.label || '';
                    const duration = component.props.duration ?? 60;
                    const isBreathing = label.toLowerCase().includes('breathing') || label.toLowerCase().includes('breath');
                    const isMeditation = label.toLowerCase().includes('meditation') || label.toLowerCase().includes('mindful');

                    if (isBreathing || isMeditation) {
                        const activityType = isBreathing ? 'breathing' : 'meditation';
                        const config = {
                            duration: duration,
                            durationMinutes: Math.floor(duration / 60),
                            label: label,
                            ...(isBreathing && { pattern: { name: 'box', cycles: Math.floor(duration / 60) } })
                        };
                        timerActivityConfigRef.current = { activityType, config };
                    }
                }
            }
            saveMessages(updatedMessages);
            return updatedMessages;
        });
    }, [setMessages, activeWorkoutMessageIdRef, setActiveWorkoutMessageId, currentLiveModelMessageIdRef]);

    const handleLiveError = useCallback((type: string, message: string) => {
        console.warn(`Live Mode Error [${type}]:`, message);
    }, []);

    const handleVoiceCommand = useCallback((action: string, response: string | null) => {
        console.log(`Voice Command Executed: ${action}`, response);
    }, []);

    // Placeholder ref for the hook's return value
    const isGuidanceActiveRef = useRef<boolean>(false);
    
    // Refs for live mode values (needed in callbacks before hook returns them)
    const liveStatusRef = useRef<LiveStatus>(LiveStatus.DISCONNECTED);
    const sendMessageToLiveRef = useRef<((text: string) => void) | null>(null);

    const getContextForLive = async () => {
        const localContext = getUserContext();
        return refreshContext(supabaseUserId || undefined, localContext);
    };

    // --- The Hook ---
    const {
        status: liveStatus,
        connect: connectLive,
        disconnect: disconnectLive,
        paceState: livePaceState,
        isMuted: liveIsMuted,
        setIsMuted: setLiveIsMuted,
        isSpeaking: liveIsSpeaking,
        isExpectingGuidanceResponse,
        isGuidanceActive, // This is a ref from the hook
        sendMessageToLive,
        pauseGuidance,
        resumeGuidance,
        startGuidanceForTimer,
        stopGuidance,
    } = useLiveSession({
        onTranscription: handleLiveTranscription,
        onAudioData: (data) => {
            // Performance: Store directly in ref, do NOT trigger state update
            audioDataRef.current = data;
        },
        onToolCall: handleLiveToolCall,
        onInterruption: () => {
            setIsInterrupted(true);
            setTimeout(() => setIsInterrupted(false), TIMING.INTERRUPTION_RESET);
        },
        getContext: getContextForLive,
        conversationHistory: messages,
        onVoiceCommand: handleVoiceCommand,
        // We need to define handleActivityControl before using it in the hook? 
        // Circular dependency again if we define handleActivityControl using 'pauseGuidance' returned by hook.
        // Solution: useLiveSession takes 'onActivityControl'.
        // Inside 'handleActivityControl', we need 'activeTimer', 'workoutProgress', AND 'pauseGuidance' etc.
        // We can define a proxy callback that calls a ref which we update after hook returns.
        onActivityControl: (action) => activityControlRef.current?.(action),
        onError: handleLiveError,
        onReconnecting: () => console.log('Live session reconnecting...'),
        userId: supabaseUserId,
        onGuidedActivityStart: async (activityType, config) => {
            console.log(`Guided activity update [${activityType}]:`, config);
            if (activityType === 'workout' && config.exercises) {
                const currentExerciseIndex = config.currentExerciseIndex ?? 0;
                const completedExercises: string[] = config.completedExercises || [];
                const completedIndices: number[] = [];
                config.exercises.forEach((e: any, idx: number) => {
                    const isNameCompleted = completedExercises.includes(e.name);
                    const isBeforeCurrent = idx < currentExerciseIndex;
                    if (isNameCompleted || isBeforeCurrent) {
                        completedIndices.push(idx);
                    }
                });

                // DETECT WORKOUT COMPLETION (all exercises done)
                const allExercisesCompleted = completedExercises.length >= config.exercises.length || 
                    completedIndices.length >= config.exercises.length;

                setCurrentWorkoutProgress({
                    title: config.title || TEXT.VOICE_WORKOUT_DEFAULT_TITLE,
                    exercises: config.exercises.map((e: any, idx: number) => ({
                        name: e.name,
                        completed: completedIndices.includes(idx)
                    })),
                    startedAt: config.startedAt || Date.now()
                });

                setWorkoutProgress({
                    currentExerciseIndex,
                    completedIndices,
                    isTimerRunning: config.isTimerRunning ?? false,
                    isResting: config.isResting ?? false,
                    restDuration: config.restDuration,
                    timerDuration: config.timerDuration,
                    timerStartTime: config.isTimerRunning ? Date.now() : undefined
                });

                if (!activeWorkoutMessageIdRef.current) {
                    // Logic to find workout message if missing
                    // We need access to 'messages' active state here
                    // But 'messages' is in scope.
                    // Note: 'messages' in onGuidedActivityStart closure might be stale if not careful.
                    // useLiveSession should handle dependnecy updates.
                }

                if (supabaseUserId && activeWorkoutMessageIdRef.current) {
                    syncWorkoutProgressToCloud(
                        supabaseUserId,
                        activeWorkoutMessageIdRef.current,
                        completedIndices,
                        currentExerciseIndex
                    ).catch(console.warn);
                }

                // HANDLE WORKOUT COMPLETION IN LIVE MODE
                // Use workout message ID as unique key to prevent duplicate handling
                const workoutKey = activeWorkoutMessageIdRef.current || config.title || 'workout';
                
                if (allExercisesCompleted && supabaseUserId && handleActionWrapper && 
                    !workoutCompletionHandledRef.current.has(workoutKey)) {
                    
                    // Mark as handled to prevent duplicates
                    workoutCompletionHandledRef.current.add(workoutKey);
                    
                    // Calculate workout duration
                    const startedAt = config.startedAt || (currentWorkoutProgress?.startedAt || Date.now());
                    const durationSeconds = Math.floor((Date.now() - startedAt) / 1000);

                    // Extract exercise data for completion handler
                    const exerciseData = config.exercises.map((e: any) => ({
                        name: e.name,
                        reps: e.reps,
                        duration: e.duration,
                        restAfter: e.restAfter
                    }));

                    // Trigger workout completion handler (logs workout, updates streaks, shows achievements)
                    await handleActionWrapper(ACTIONS.WORKOUT_COMPLETE, {
                        workoutType: config.title || TEXT.VOICE_WORKOUT_DEFAULT_TITLE,
                        durationSeconds,
                        exercises: exerciseData
                    });

                    // ANNOUNCE ACHIEVEMENTS VERBALLY IN LIVE MODE
                    // Use refs to access liveStatus and sendMessageToLive (they're returned from hook)
                    const currentLiveStatus = liveStatusRef.current;
                    const currentSendMessage = sendMessageToLiveRef.current;
                    
                    if (currentLiveStatus === LiveStatus.CONNECTED && currentSendMessage) {
                        // Get updated streak and achievements
                        const streak = await getStreak(supabaseUserId, 'workout');
                        const recentWorkouts = await getRecentWorkouts(supabaseUserId, NUMBERS.STREAK_TIMELINE_DAYS);
                        const streakCount = streak?.current_streak || NUMBERS.DEFAULT_STREAK_COUNT;
                        const completedWorkouts = recentWorkouts.filter(w => w.completed).length;

                        // Build verbal announcement
                        let announcement = `Amazing work! You just completed your ${config.title || 'workout'}! `;
                        
                        // Announce streak
                        if (streakCount > 0) {
                            announcement += `You've built a ${streakCount}-day streak! `;
                            if (streakCount === 7 || streakCount === 14 || streakCount === 30) {
                                announcement += `That's a major milestone! `;
                            }
                        }

                        // Detect and announce achievements
                        const achievements: string[] = [];
                        
                        if (completedWorkouts === 1) {
                            achievements.push('First Steps - You completed your first workout!');
                        }
                        if (streakCount === 7) {
                            achievements.push('Week Warrior - 7-day streak achieved!');
                        } else if (streakCount === 14) {
                            achievements.push('Two Week Champion - 14-day streak achieved!');
                        } else if (streakCount === 30) {
                            achievements.push('Monthly Master - 30-day streak achieved!');
                        }
                        if (completedWorkouts === 10) {
                            achievements.push('Tenacious - 10 workouts completed!');
                        } else if (completedWorkouts === 25) {
                            achievements.push('Quarter Century - 25 workouts completed!');
                        }

                        // Consistency check
                        const weekWorkouts = recentWorkouts.filter(w => {
                            const workoutDate = new Date(w.created_at);
                            const daysAgo = Math.floor((Date.now() - workoutDate.getTime()) / (1000 * 60 * 60 * 24));
                            return daysAgo <= 7 && w.completed;
                        });
                        const uniqueDays = new Set(weekWorkouts.map(w => 
                            new Date(w.created_at).toISOString().split('T')[0]
                        )).size;
                        
                        if (uniqueDays === 5) {
                            achievements.push('Consistency Champion - 5 workouts this week!');
                        }

                        // Add achievement announcements
                        if (achievements.length > 0) {
                            announcement += `Achievement unlocked! ${achievements.join(' ')} `;
                        }

                        announcement += `Keep up the amazing work!`;

                        // Send verbal announcement to live mode
                        setTimeout(() => {
                            if (currentSendMessage && liveStatusRef.current === LiveStatus.CONNECTED) {
                                currentSendMessage(`[SPEAK]: ${announcement}`);
                            }
                        }, 1000); // Small delay to let completion handler finish
                    }
                }
            } else if (activityType === 'breathing' || activityType === 'meditation') {
                const duration = config.duration || config.durationMinutes * 60 || (config.pattern ? config.pattern.cycles * 60 : 300);
                const label = config.label ||
                    (activityType === 'breathing' ? `${config.pattern?.name || 'Breathing'} Exercise` :
                        `${config.style || 'Guided'} Meditation`);

                setActiveTimer({
                    label: label,
                    totalSeconds: duration,
                    remainingSeconds: duration,
                    isRunning: true,
                    startedAt: Date.now()
                });
                timerActivityConfigRef.current = { activityType, config };
                // Similar logic for activeWorkoutMessageId if needed
            }
        },
        onMemoryExtracted: (content, type) => {
            console.log(`Memory extracted [${type}]:`, content.substring(0, 50));
        },
        onGuidanceMessage: (guidanceMsg) => {
            setMessages(prev => {
                const newMessage: Message = {
                    id: guidanceMsg.id,
                    role: MessageRole.MODEL,
                    text: guidanceMsg.text,
                    timestamp: guidanceMsg.timestamp,
                    messageContext: guidanceMsg.messageContext,
                    relatedWorkoutId: guidanceMsg.relatedWorkoutId
                };
                return [...prev, newMessage];
            });
        },
        activeWorkoutMessageId: activeWorkoutMessageId // This is reactive from context
    });

    // Sync refs for live mode values (needed in callbacks)
    useEffect(() => {
        liveStatusRef.current = liveStatus;
        sendMessageToLiveRef.current = sendMessageToLive;
        isGuidanceActiveRef.current = isGuidanceActive.current;
    }, [liveStatus, sendMessageToLive, isGuidanceActive]);


    const handleActivityControl = useCallback((action: 'pause' | 'resume' | 'skip' | 'stop' | 'back') => {
        console.log(`Activity Control: ${action}`);

        if (action === 'pause') {
            if (activeTimer) {
                setActiveTimer((prev: any) => {
                    if (!prev) return null;
                    const elapsed = typeof prev.startedAt === 'number' ? Date.now() - prev.startedAt : 0;
                    const remaining = Math.max(0, (prev.totalSeconds * 1000) - elapsed);
                    return { ...prev, isRunning: false, remainingAtPause: remaining };
                });
            }
            if (workoutProgress) {
                setWorkoutProgress(prev => {
                    if (!prev) return null;
                    // Calculate remaining time
                    const startTime = prev.timerStartTime || Date.now();
                    const durationMs = (prev.timerDuration || 0) * 1000;
                    const elapsed = Date.now() - startTime;
                    const remaining = Math.max(0, durationMs - elapsed);

                    return {
                        ...prev,
                        isTimerRunning: false,
                        timerRemainingAtPause: remaining
                    };
                });
            }
            pauseGuidance();
        }

        if (action === 'resume') {
            if (activeTimer) {
                setActiveTimer((prev: any) => {
                    if (!prev) return null;
                    const durationMs = prev.totalSeconds * 1000;
                    const remaining = prev.remainingAtPause !== undefined ? prev.remainingAtPause : durationMs;
                    // Backdate start time so elapsed calculation is correct: now - start = (total - remaining)
                    const newStartTime = Date.now() - (durationMs - remaining);
                    return { ...prev, isRunning: true, startedAt: newStartTime, remainingAtPause: undefined };
                });
                // If Live Mode is disconnected (e.g., user closed it), do NOT resume guidance cues.
                // Otherwise you'll get text-only guidance with no audio (bad UX) and may trigger reconnect side-effects.
                if (timerActivityConfigRef.current) {
                    if (liveStatus === LiveStatus.CONNECTED) {
                        const { activityType, config } = timerActivityConfigRef.current;
                        startGuidanceForTimer(activityType, config);
                    } else {
                        pauseGuidance();
                    }
                } else {
                    if (liveStatus === LiveStatus.CONNECTED) {
                        resumeGuidance();
                    } else {
                        pauseGuidance();
                    }
                }
            } else if (workoutProgress) {
                setWorkoutProgress(prev => {
                    if (!prev) return null;
                    const durationMs = (prev.timerDuration || 0) * 1000;
                    const remaining = prev.timerRemainingAtPause !== undefined ? prev.timerRemainingAtPause : durationMs;
                    // Backdate start time
                    const newStartTime = Date.now() - (durationMs - remaining);

                    return {
                        ...prev,
                        isTimerRunning: true,
                        timerStartTime: newStartTime,
                        timerRemainingAtPause: undefined
                    };
                });
                // Same rule: don't resume guidance unless Live Mode is connected (audio available)
                if (liveStatus === LiveStatus.CONNECTED) {
                    resumeGuidance();
                } else {
                    pauseGuidance();
                }
            }
        }

        if (action === 'skip') {
            if (currentWorkoutProgress) {
                setCurrentWorkoutProgress((prev: any) => {
                    if (!prev) return null;
                    const updatedExercises = [...prev.exercises];
                    const currentIndex = updatedExercises.findIndex((e: any) => !e.completed);
                    if (currentIndex !== -1) {
                        updatedExercises[currentIndex].completed = true;
                    }
                    return { ...prev, exercises: updatedExercises };
                });
            }
            if (workoutProgress) {
                setWorkoutProgress(prev => {
                    if (!prev) return null;
                    const newIndex = prev.currentExerciseIndex + 1;
                    const newCompleted = [...prev.completedIndices, prev.currentExerciseIndex];
                    return {
                        ...prev,
                        currentExerciseIndex: newIndex,
                        completedIndices: newCompleted,
                        isTimerRunning: false,
                        isResting: false
                    };
                });
            }
            // Note: GuidanceExecutor.skip() triggered internally by the hook if connected?
            // Actually useLiveSession exposes nothing for 'skip' directly, 
            // the Voice Command usually triggers "next/skip". 
            // If this function is called via UI, we might need to tell LiveSession to skip?
            // `sendMessageToLive("skip")`? Or is there a control method?
            // The original App.tsx didn't call anything on `guidance` for skip/back from this function 
            // except if it was triggered BY voice. 
            // IF triggered by UI, we might want to inform the model.
            // But strict refactor matches original behavior.
        }

        if (action === 'back') {
            // ... Similar implementation to App.tsx ...
            if (currentWorkoutProgress) {
                setCurrentWorkoutProgress((prev: any) => {
                    if (!prev) return null;
                    const currentIndex = prev.exercises.findIndex((e: any) => !e.completed);
                    if (currentIndex <= 0) return prev;
                    const updatedExercises = [...prev.exercises];
                    updatedExercises[currentIndex - 1].completed = false;
                    return { ...prev, exercises: updatedExercises };
                });
            }
            if (workoutProgress) {
                setWorkoutProgress(prev => {
                    if (!prev || prev.currentExerciseIndex <= 0) return prev;
                    const newIndex = prev.currentExerciseIndex - 1;
                    const newCompleted = prev.completedIndices.filter(i => i !== newIndex);
                    return {
                        ...prev,
                        currentExerciseIndex: newIndex,
                        completedIndices: newCompleted,
                        isTimerRunning: false,
                        isResting: false
                    };
                });
            }
        }

        if (action === 'stop') {
            setActiveTimer(null);
            setCurrentWorkoutProgress(null);
            setWorkoutProgress(null);
            stopGuidance();
            timerActivityConfigRef.current = null;
            // Clear completion tracking when workout stops
            if (activeWorkoutMessageIdRef.current) {
                workoutCompletionHandledRef.current.delete(activeWorkoutMessageIdRef.current);
            }
        }
    }, [activeTimer, workoutProgress, currentWorkoutProgress, setActiveTimer, setWorkoutProgress, setCurrentWorkoutProgress, pauseGuidance, resumeGuidance, startGuidanceForTimer, stopGuidance, liveStatus]);

    // Update the ref for usage in the hook
    const activityControlRef = useRef(handleActivityControl);
    useEffect(() => { activityControlRef.current = handleActivityControl; }, [handleActivityControl]);


    const toggleLive = useCallback(() => {
        if (liveStatus === 'connected' || liveStatus === 'connecting') {
            // Pause any active timer or workout when disconnecting
            if (activeTimer && activeTimer.isRunning) {
                setActiveTimer(prev => prev ? { ...prev, isRunning: false } : null);
            }
            if (workoutProgress && workoutProgress.isTimerRunning) {
                setWorkoutProgress(prev => prev ? { ...prev, isTimerRunning: false } : null);
            }
            // Also update global activity state if different
            if (currentWorkoutProgress && currentWorkoutProgress.isRunning) { // Note: currentWorkoutProgress type check needed
                // Actually currentWorkoutProgress structure is different (WorkougProgress interface in useActivityState doesn't have isRunning at top level usually, strict check needed)
                // Let's stick to the specific controlled states we know.
            }

            disconnectLive(true);
            currentLiveModelMessageIdRef.current = null;
            currentLiveUserMessageIdRef.current = null;
            userTranscriptBufferRef.current = '';
            modelTranscriptBufferRef.current = '';
        } else {
            userTranscriptBufferRef.current = '';
            modelTranscriptBufferRef.current = '';
            connectLive();
        }
    }, [liveStatus, disconnectLive, connectLive, currentLiveModelMessageIdRef, currentLiveUserMessageIdRef, activeTimer, workoutProgress, setActiveTimer, setWorkoutProgress, currentWorkoutProgress]);


    const startLiveModeAndSendMessage = useCallback((message: string) => {
        if (liveStatus === LiveStatus.CONNECTED) {
            if (sendMessageToLive) {
                sendMessageToLive(message);
            }
        } else {
            pendingLiveMessageRef.current = message;
            userTranscriptBufferRef.current = '';
            modelTranscriptBufferRef.current = '';
            if (liveStatus !== LiveStatus.CONNECTING) {
                connectLive();
            }
        }
    }, [liveStatus, connectLive, sendMessageToLive]);

    useEffect(() => {
        if (liveStatus === LiveStatus.CONNECTED && pendingLiveMessageRef.current && sendMessageToLive) {
            const message = pendingLiveMessageRef.current;
            pendingLiveMessageRef.current = null;
            setTimeout(() => {
                sendMessageToLive(message);
            }, 300);
        }
    }, [liveStatus, sendMessageToLive]);


    const value = {
        liveStatus,
        connectLive,
        disconnectLive,
        toggleLive,
        startLiveModeAndSendMessage,
        audioDataRef,
        liveIsSpeaking,
        isInterrupted,
        liveIsMuted,
        setLiveIsMuted,
        handleActivityControl,
        handleVoiceCommand,
        isExpectingGuidanceResponse,
        isGuidanceActive,
        sendMessageToLive
    };

    return (
        <LiveSessionContext.Provider value={value}>
            {children}
        </LiveSessionContext.Provider>
    );
}

export function useLiveSessionContext() {
    const context = useContext(LiveSessionContext);
    if (!context) {
        throw new Error('useLiveSessionContext must be used within a LiveSessionContextProvider');
    }
    return context;
}
