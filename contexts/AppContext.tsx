import React, { createContext, useContext, useState, useRef, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { Message, MessageRole, UserProfile, FitnessStats, UIComponentData, LifeContext } from '../types';
import { useMessages } from '../hooks/useMessages';
import { useActivityState, ActivitySession, ActivityTimer, ActivityEvent, ActivityIntent, ActivityPhase } from '../hooks/useActivityState';
import { extractOnboardingContext, recordInteraction, getOnboardingState, deleteAllMessages, OnboardingState } from '../services/supabaseService';
import { getFullUserContext, UserMemoryContext, buildLifeContext } from '../services/userContextService';
import { sendMessageToGemini, buildSystemInstruction } from '../services/geminiService';
import { extractAndStoreSummary } from '../services/embeddingService';
import { createCalendarEvent } from '../services/calendarService';
import { createActionHandlers, handleAction } from '../handlers/actionHandlers';
import { clearAllStorage } from '../services/storageService';
import { buildUserContext } from '../utils/contextBuilder';
import { normalizeTimerProps } from '../utils/timerProps';
import { TIMING, UI_LIMITS, PATTERNS, TEXT, ACTIONS } from '../constants/app';
import { supabase } from '../supabaseConfig';
import { v4 as uuidv4 } from 'uuid';
import { syncService } from '../services/syncService'; // Ensure singleton is active
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/toolIntegrationService';

interface AppContextType {
    // Core Data
    supabaseUserId: string | null;
    setSupabaseUserId: (id: string | null) => void;
    userProfile: UserProfile;
    setUserProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
    memoryContext: UserMemoryContext | null;
    setMemoryContext: React.Dispatch<React.SetStateAction<UserMemoryContext | null>>;
    onboardingState: OnboardingState | null;
    setOnboardingState: React.Dispatch<React.SetStateAction<OnboardingState | null>>;
    fitnessStats: FitnessStats | undefined;
    setFitnessStats: React.Dispatch<React.SetStateAction<FitnessStats | undefined>>;
    userLocation: { lat: number, lng: number } | undefined;
    setUserLocation: React.Dispatch<React.SetStateAction<{ lat: number, lng: number } | undefined>>;

    // Unified Dashboard Snapshot (Profile popup + other surfaces)
    dashboardSnapshot: DashboardSnapshot | null;
    refreshDashboardSnapshot: (options?: { force?: boolean }) => Promise<DashboardSnapshot | null>;
    lifeContext: LifeContext | null;

    // Messages
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    addMessageToChat: (text: string) => void;
    handleSendMessage: (text?: string, profileOverride?: UserProfile) => Promise<void>;

    // UI State
    inputValue: string;
    setInputValue: (val: string) => void;
    isTyping: boolean;
    setIsTyping: (val: boolean) => void;
    showDeleteConfirm: boolean;
    setShowDeleteConfirm: (val: boolean) => void;
    clearHistory: () => Promise<void>;

    // Activity State
    activeTimer: any;
    setActiveTimer: any;
    currentWorkoutProgress: any;
    setCurrentWorkoutProgress: any;
    lastGeneratedWorkout: any;
    setLastGeneratedWorkout: any;

    // Controlled Workout State (for Live Mode sync)
    workoutProgress: {
        currentExerciseIndex: number;
        completedIndices: number[];
        isTimerRunning: boolean;
        isResting?: boolean;
        restDuration?: number;
        timerDuration?: number;
        timerStartTime?: number;
        timerRemainingAtPause?: number;
    } | null;
    setWorkoutProgress: React.Dispatch<React.SetStateAction<{
        currentExerciseIndex: number;
        completedIndices: number[];
        isTimerRunning: boolean;
        isResting?: boolean;
        restDuration?: number;
        timerDuration?: number;
        timerStartTime?: number;
        timerRemainingAtPause?: number;
    } | null>>;
    activeWorkoutMessageId: string | null;
    setActiveWorkoutMessageId: React.Dispatch<React.SetStateAction<string | null>>;

    // Logic Refs & Helpers
    activeWorkoutMessageIdRef: React.MutableRefObject<string | null>;
    handleActionWrapper: (action: string, data: any) => Promise<void>;
    getUserContext: (profileOverride?: UserProfile) => any;

    // Shared Refs for Live Mode text buffers (exposed for LiveContext)
    currentLiveModelMessageIdRef: React.MutableRefObject<string | null>;
    currentLiveUserMessageIdRef: React.MutableRefObject<string | null>;

    // Unified ActivityEngine exposure
    activitySessions: Record<string, ActivitySession>;
    activityTimers: Record<string, ActivityTimer>;
    startActivity: (config: {
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
    pauseActivity: (activityId: string) => void;
    resumeActivity: (activityId: string) => void;
    completeActivity: (activityId: string) => void;
    stopActivity: (activityId: string) => void;
    registerActivityListener: (listener: (event: ActivityEvent) => void) => () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();

    // --- Core State ---
    const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile>({ goals: [] });
    const [memoryContext, setMemoryContext] = useState<UserMemoryContext | null>(null);
    const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
    const [fitnessStats, setFitnessStats] = useState<FitnessStats | undefined>(undefined);
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | undefined>(undefined);
    const [lastMessageTime, setLastMessageTime] = useState<number>(Date.now());
    const [dashboardSnapshot, setDashboardSnapshot] = useState<DashboardSnapshot | null>(null);
    const dashboardSnapshotRef = useRef<DashboardSnapshot | null>(null);
    const timerActivityIdsRef = useRef(new Map<string, string>());
    const [lifeContext, setLifeContext] = useState<LifeContext | null>(null);

    // --- UI State ---
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // --- Complex State Hooks ---
    const { messages, setMessages, clearMessages } = useMessages({ supabaseUserId });
    const {
        activeTimer, setActiveTimer,
        currentWorkoutProgress, setCurrentWorkoutProgress,
        lastGeneratedWorkout, setLastGeneratedWorkout,
        recentUIInteractions, addUIInteraction,
        activitySessions,
        activityTimers,
        startActivity,
        pauseActivity,
        resumeActivity,
        completeActivity,
        stopActivity,
        registerActivityListener
    } = useActivityState();

    // --- Workout/Live Sync State ---
    const [activeWorkoutMessageId, setActiveWorkoutMessageId] = useState<string | null>(null);
    const [workoutProgress, setWorkoutProgress] = useState<{
        currentExerciseIndex: number;
        completedIndices: number[];
        isTimerRunning: boolean;
        isResting?: boolean;
        restDuration?: number;
        timerDuration?: number;
        timerStartTime?: number;
        timerRemainingAtPause?: number;
    } | null>(null);

    // --- Refs ---
    const activeWorkoutMessageIdRef = useRef<string | null>(activeWorkoutMessageId);
    const currentLiveModelMessageIdRef = useRef<string | null>(null);
    const currentLiveUserMessageIdRef = useRef<string | null>(null);

    // Sync ref
    React.useEffect(() => {
        activeWorkoutMessageIdRef.current = activeWorkoutMessageId;
    }, [activeWorkoutMessageId]);

    // Keep a stable ref for snapshot to avoid refresh-loop re-renders
    React.useEffect(() => {
        dashboardSnapshotRef.current = dashboardSnapshot;
    }, [dashboardSnapshot]);


    // --- Context Builders ---
    const getUserContext = useCallback((profileOverride?: UserProfile) => {
        const base = buildUserContext({
            userProfile,
            userLocation,
            fitnessStats,
            isAuthenticated: !!user,
            userName: user?.displayName,
            memoryContext,
            onboardingState,
            messages,
            lastMessageTime,
            activityState: {
                activeTimer,
                currentWorkoutProgress,
                lastGeneratedWorkout,
                recentUIInteractions
            },
            profileOverride
        });
        if (lifeContext) {
            (base as any).lifeContext = lifeContext;
        }
        return base;
    }, [userProfile, userLocation, fitnessStats, user, memoryContext, onboardingState, messages, lastMessageTime, activeTimer, currentWorkoutProgress, lastGeneratedWorkout, recentUIInteractions, lifeContext]);

    const refreshDashboardSnapshot = useCallback(async (options?: { force?: boolean }) => {
        if (!supabaseUserId) return null;

        const force = !!options?.force;
        const now = Date.now();
        // Simple TTL to avoid refetch spam (popup open, rapid events, etc.)
        const current = dashboardSnapshotRef.current;
        if (!force && current && now - current.generatedAt < 60_000) {
            return current;
        }

        const [snapshot, lc] = await Promise.all([
            getDashboardSnapshot(supabaseUserId, fitnessStats),
            buildLifeContext(supabaseUserId, undefined)
        ]);
        setDashboardSnapshot(snapshot);
        setLifeContext(lc);
        return snapshot;
    }, [supabaseUserId, fitnessStats]);

    // Keep snapshot aligned with auth lifecycle
    React.useEffect(() => {
        if (!supabaseUserId) {
            setDashboardSnapshot(null);
            return;
        }
        // Initial load (non-blocking)
        refreshDashboardSnapshot({ force: true }).catch(console.warn);
    }, [supabaseUserId, refreshDashboardSnapshot]);

    // --- Actions ---
    const clearHistory = async () => {
        await clearMessages();
        setMemoryContext(null);
        setUserProfile({ goals: [] });
        clearAllStorage();

        if (supabaseUserId) {
            // const { syncService } = await import('../services/syncService'); // Using static import
            syncService.scheduleOperation('DELETE_ALL_DATA', { userId: supabaseUserId });
            console.log('All user data delete scheduled via Sync Service');
        }
        setShowDeleteConfirm(false);
    };

    const addMessageToChat = useCallback((text: string) => {
        // Check if this message was recently added (within last 2 seconds) to avoid duplicates
        // Note: using 'messages' from closure might be stale if not careful, but setMessages uses callback
        setMessages(prev => {
            const recentMessage = prev.find(msg =>
                msg.role === MessageRole.USER &&
                msg.text === text &&
                Date.now() - msg.timestamp < 2000
            );

            if (!recentMessage) {
                const userMsg: Message = {
                    id: uuidv4(),
                    role: MessageRole.USER,
                    text: text,
                    timestamp: Date.now()
                };
                // We should also persist here, but useMessages handles persistence on change usually?
                // The original code called saveMessages explicitly. 
                // We will rely on the effect in App (to be moved) or similar mechanism.
                // Actually useMessages inside AppContext doesn't auto-save on every setMessages if it's just state... 
                // Wait, useMessages usually has an effect for persistence.
                return [...prev, userMsg];
            }
            return prev;
        });
    }, [setMessages]);

    const handleSendMessage = async (text?: string, profileOverride?: UserProfile) => {
        const content = text || inputValue;
        if (!content.trim()) return;

        // Reset live refs just in case mixed usage
        currentLiveModelMessageIdRef.current = null;
        currentLiveUserMessageIdRef.current = null;

        const userMsg: Message = {
            id: uuidv4(),
            role: MessageRole.USER,
            text: content,
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);

        let enrichedMemoryContext = memoryContext;
        if (supabaseUserId) {
            try {
                enrichedMemoryContext = await getFullUserContext(supabaseUserId, content);
            } catch (e) {
                console.warn('Failed to fetch semantic context, using cached:', e);
            }
        }

        const context = getUserContext(profileOverride);
        if (enrichedMemoryContext) {
            context.memoryContext = enrichedMemoryContext;
        }

        let response: { text?: string; uiComponent?: UIComponentData; groundingChunks?: unknown[]; functionCalls?: { name: string; args: unknown }[] };
        try {
            const systemInstruction = await buildSystemInstruction(context);
            const apiRes = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: messages.concat(userMsg).map(m => ({ role: m.role, text: m.text })),
                    newMessage: userMsg.text,
                    systemInstruction,
                }),
            });
            if (apiRes.ok) {
                response = await apiRes.json();
            } else {
                response = await sendMessageToGemini(messages.concat(userMsg), userMsg.text, context);
            }
        } catch {
            response = await sendMessageToGemini(messages.concat(userMsg), userMsg.text, context);
        }

        // Normalize timer duration so "1 min" requests don't show 5:00 (model sometimes sends 300 or omits)
        let uiComponent = response.uiComponent;
        if (uiComponent?.type === 'timer' && uiComponent.props) {
            uiComponent = { ...uiComponent, props: normalizeTimerProps(uiComponent.props, content) };
        }

        const modelMsg: Message = {
            id: uuidv4(),
            role: MessageRole.MODEL,
            text: response.text ?? '',
            timestamp: Date.now(),
            uiComponent,
            groundingChunks: response.groundingChunks
        };

        if (response.functionCalls) {
            for (const call of response.functionCalls) {
                if (call.name === 'createCalendarEvent') {
                    await createCalendarEvent(call.args as Parameters<typeof createCalendarEvent>[0]);
                    modelMsg.text += TEXT.CALENDAR_EVENT_CONFIRMATION;
                }
            }
        }

        setMessages(prev => [...prev, modelMsg]);
        setIsTyping(false);
        setLastMessageTime(Date.now());

        if (response.uiComponent) {
            addUIInteraction(response.uiComponent.type);
            if (response.uiComponent.type === 'workoutList' && response.uiComponent.props?.exercises) {
                const exercises = response.uiComponent.props.exercises as { name: string }[];
                setLastGeneratedWorkout({
                    title: response.uiComponent.props.title || TEXT.WORKOUT_DEFAULT_TITLE,
                    exerciseCount: exercises.length,
                    generatedAt: Date.now()
                });
                setCurrentWorkoutProgress({
                    title: response.uiComponent.props.title || TEXT.WORKOUT_DEFAULT_TITLE,
                    exercises: exercises.map(e => ({ name: e.name, completed: false })),
                    startedAt: Date.now()
                });
            }
        }

        if (supabaseUserId && content.length > UI_LIMITS.MIN_MESSAGE_LENGTH_FOR_MEMORY) {
            extractAndStoreSummary(supabaseUserId, content, response.text || '').catch(console.error);
        }

        if (supabaseUserId) {
            const isActionRequest = PATTERNS.ACTION_REQUEST.test(content.toLowerCase());
            recordInteraction(supabaseUserId, isActionRequest).catch(console.error);
            extractOnboardingContext(supabaseUserId, content).then(async () => {
                const updatedState = await getOnboardingState(supabaseUserId);
                if (updatedState) setOnboardingState(updatedState);
            }).catch(console.error);
        }
    };

    // --- Action Handling ---
    const actionHandlers = createActionHandlers({
        userProfile, setUserProfile,
        supabaseUserId,
        onboardingState, setOnboardingState,
        setActiveTimer,
        setCurrentWorkoutProgress,
        setLastGeneratedWorkout,
        addUIInteraction,
        handleSendMessage,
        setMessages,
        startActivity,
        pauseActivity,
        resumeActivity,
        completeActivity,
        stopActivity,
        activitySessions
    }, timerActivityIdsRef.current);

    const handleActionWrapper = async (action: string, data: any) => {
        // Live mode specific logic will be injected or handled via a check in LiveSessionContext
        // For now, we delegate the 'liveWorkoutSubmit' to be handled where live session is available, 
        // OR we expose a way for LiveSessionContext to intercept.
        // However, keep simple for now: this handles 'text' mostly.
        // If we strictly move logic, `handleActionWrapper` in App.tsx had:
        /*
          if (action === 'liveWorkoutSubmit' && liveStatus === LiveStatus.CONNECTED && sendMessageToLive) { ... }
        */
        // We will functionality need to bridge this. 
        // Implementation Detail: We'll allow the caller (ChatInterface) to check live status OR we handle it in LiveContext.
        // BUT ChatInterface props `onAction` expects a function.
        // We will likely wrap this in App.tsx or use a Combined Provider.

        // For now, execute standard actions
        await handleAction(action, data, actionHandlers);

        // Keep the unified dashboard snapshot in sync (text + live mode share this path)
        if (supabaseUserId && (action === ACTIONS.WORKOUT_COMPLETE || action === ACTIONS.TIMER_COMPLETE || action === ACTIONS.SAVE_GOALS)) {
            refreshDashboardSnapshot({ force: true }).catch(console.warn);
        }
    };

    const value = {
        supabaseUserId, setSupabaseUserId,
        userProfile, setUserProfile,
        memoryContext, setMemoryContext,
        onboardingState, setOnboardingState,
        fitnessStats, setFitnessStats,
        userLocation, setUserLocation,
        dashboardSnapshot,
        refreshDashboardSnapshot,
        lifeContext,

        messages, setMessages,
        addMessageToChat,
        handleSendMessage,

        inputValue, setInputValue,
        isTyping, setIsTyping,
        showDeleteConfirm, setShowDeleteConfirm,
        clearHistory,

        activeTimer, setActiveTimer,
        currentWorkoutProgress, setCurrentWorkoutProgress,
        lastGeneratedWorkout, setLastGeneratedWorkout,

        workoutProgress, setWorkoutProgress,
        activeWorkoutMessageId, setActiveWorkoutMessageId,

        activeWorkoutMessageIdRef,
        handleActionWrapper,
        getUserContext,

        currentLiveModelMessageIdRef,
        currentLiveUserMessageIdRef,

        activitySessions,
        activityTimers,
        startActivity,
        pauseActivity,
        resumeActivity,
        completeActivity,
        stopActivity,
        registerActivityListener
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppContextProvider');
    }
    return context;
}
