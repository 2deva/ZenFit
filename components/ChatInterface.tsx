
import React from 'react';
import { Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { ArrowRight, MessageCircle, Dumbbell, Target, Brain, BarChart2, ChevronDown, Mic, Moon, Wind } from 'lucide-react';
import { ZenLogo } from './ZenLogo';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useAuth } from '../contexts/AuthContext';
import { OnboardingState } from '../services/supabaseService';

interface ChatInterfaceProps {
    messages: Message[];
    isTyping?: boolean;
    userId?: string; // Supabase user ID for cross-device sync
    onboardingState?: OnboardingState | null;
    onAction: (action: string, data: any) => void;
    onSendMessage?: (text: string) => void;
    onAddMessageToChat?: (text: string) => void; // Add message to chat without sending to Gemini
    // Live Mode Props
    isLiveMode?: boolean;
    audioDataRef?: React.MutableRefObject<Float32Array>; // Changed from Float32Array to ref
    aiState?: 'listening' | 'speaking' | 'processing' | 'idle';
    currentGuidanceText?: string;
    onLiveControl?: (action: 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'back' | 'reset') => void;
    onStartLiveMode?: (message: string) => void; // Callback to start Live Mode and send message
    // Active workout tracking
    activeWorkoutMessageId?: string | null;
    // Active timer state (for controlling timer component)
    activeTimer?: { label: string; totalSeconds: number; remainingSeconds: number; isRunning: boolean } | null;
    // Controlled workout progress (from guidance executor)
    workoutProgress?: {
        currentExerciseIndex: number;
        completedIndices: number[];
        isTimerRunning: boolean;
        isResting?: boolean;
        restDuration?: number;
        timerDuration?: number;
    } | null;
}





// Action Card Component
interface ActionCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    delay?: number;
}

// Creative Voice Mode Icon - Voice waveform visualizer
const VoiceModeIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <defs>
            <linearGradient id="voiceGradientHome" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E87A38" />
                <stop offset="100%" stopColor="#D96922" />
            </linearGradient>
        </defs>

        {/* Voice waveform bars - audio visualizer style */}
        <g className="group-hover:scale-110 transition-transform origin-center">
            {/* Left outer bar */}
            <rect x="2.5" y="8" width="3" height="8" rx="1.5" fill="url(#voiceGradientHome)" opacity="0.6" />

            {/* Left inner bar */}
            <rect x="6.5" y="5" width="3" height="14" rx="1.5" fill="url(#voiceGradientHome)" opacity="0.85" />

            {/* Center bar - tallest - fully opaque */}
            <rect x="10.5" y="3" width="3" height="18" rx="1.5" fill="url(#voiceGradientHome)" />

            {/* Right inner bar */}
            <rect x="14.5" y="5" width="3" height="14" rx="1.5" fill="url(#voiceGradientHome)" opacity="0.85" />

            {/* Right outer bar */}
            <rect x="18.5" y="8" width="3" height="8" rx="1.5" fill="url(#voiceGradientHome)" opacity="0.6" />
        </g>
    </svg>
);

const ActionCard: React.FC<ActionCardProps> = ({ icon, title, description, onClick, delay = 0 }) => (
    <button
        onClick={onClick}
        className="group flex items-center gap-4 p-3 sm:p-4 bg-white/80 backdrop-blur-sm rounded-2xl sm:rounded-[28px] border border-sand-200 hover:border-claude-300 hover:shadow-soft-lg transition-all duration-300 opacity-0 animate-reveal-up w-full text-left"
        style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
        <div className="p-3 bg-white rounded-xl shadow-soft group-hover:scale-110 transition-transform duration-300 text-claude-500 flex-shrink-0">
            {icon}
        </div>
        <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg text-ink-900 group-hover:text-claude-600 transition-colors mb-1 truncate">
                {title}
            </h3>
            <p className="text-sm text-ink-500 leading-relaxed line-clamp-2">
                {description}
            </p>
        </div>
        <ArrowRight className="w-5 h-5 text-ink-300 group-hover:text-claude-500 group-hover:translate-x-1 transition-all duration-300 flex-shrink-0" />
    </button>
);

// Get time-based greeting
const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    isTyping,
    userId,
    onboardingState,
    onAction,
    onSendMessage,
    onAddMessageToChat,
    isLiveMode,
    audioDataRef,
    aiState,
    currentGuidanceText,
    onLiveControl,
    onStartLiveMode,
    activeWorkoutMessageId,
    activeTimer,
    workoutProgress
}) => {
    const virtuosoRef = React.useRef<VirtuosoHandle>(null);
    const { user } = useAuth();
    const [isAtBottom, setIsAtBottom] = React.useState(true);
    const [shouldAutoScroll, setShouldAutoScroll] = React.useState(true);
    const [unreadCount, setUnreadCount] = React.useState(0);
    const [messagesFromBottom, setMessagesFromBottom] = React.useState(0);
    const previousMessagesLength = React.useRef(0); // Initialize with 0, will be updated in first effect

    // Threshold for showing scroll button (only show after scrolling past this many messages)
    const SCROLL_BUTTON_THRESHOLD = 7;

    // Filter messages to exclude guidance messages from main chat
    const filteredMessages = React.useMemo(() => {
        return messages.filter(msg =>
            !msg.messageContext ||
            msg.messageContext === 'general' ||
            msg.messageContext === 'workout_control' ||
            msg.messageContext === 'system'
        );
    }, [messages]);

    // Get guidance messages for active workout
    const guidanceMessages = React.useMemo(() => {
        if (!activeWorkoutMessageId) return [];
        return messages
            .filter(msg =>
                msg.messageContext === 'workout_guidance' &&
                msg.relatedWorkoutId === activeWorkoutMessageId
            )
            .map(msg => ({
                id: msg.id,
                text: msg.text,
                timestamp: msg.timestamp
            }));
    }, [messages, activeWorkoutMessageId]);

    // Threshold for "near bottom" detection (50px as per best practices)
    const BOTTOM_THRESHOLD = 50;

    // SCROLLING STRATEGY (Restored & Optimized):
    // We use manual controlled scrolling because 'followOutput' can be unreliable 
    // with complex dynamic content or initial loading states.
    // 1. Detect when NEW messages arrive.
    // 2. Smooth scroll if user is at bottom OR if it's their own message.
    // 3. Instant scroll on mount.

    const scrollToBottom = (smooth: boolean = true) => {
        if (virtuosoRef.current && filteredMessages.length > 0) {
            virtuosoRef.current.scrollToIndex({
                index: filteredMessages.length - 1,
                behavior: smooth ? 'smooth' : 'auto',
                align: 'end'
            });
        }
    };

    // Handle scroll position tracking with threshold-based detection
    const handleAtBottomStateChange = React.useCallback((atBottom: boolean) => {
        setIsAtBottom(atBottom);
        setShouldAutoScroll(atBottom);

        // If user scrolls back to bottom, clear unread count and reset distance
        if (atBottom) {
            if (unreadCount > 0) {
                setUnreadCount(0);
            }
            setMessagesFromBottom(0);
        }
    }, [unreadCount]);

    // Handle range changes for threshold-based "near bottom" detection
    const handleRangeChanged = React.useCallback((range: { startIndex: number; endIndex: number }) => {
        // Calculate how many messages from the bottom the user is
        const distanceFromBottom = Math.max(0, filteredMessages.length - 1 - range.endIndex);
        setMessagesFromBottom(distanceFromBottom);

        // Threshold-based: consider "at bottom" if within last 2 items
        const isNearBottom = range.endIndex >= filteredMessages.length - 2;

        // Only auto-recover auto-scroll if we are VERY close to bottom
        if (isNearBottom && !shouldAutoScroll) {
            setShouldAutoScroll(true);
            setUnreadCount(0);
        }
    }, [filteredMessages.length, shouldAutoScroll]);

    // Keyboard shortcuts: End key to scroll to bottom, Home to top
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if not typing in an input/textarea
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === 'End' || e.key === 'PageDown') {
                e.preventDefault();
                scrollToBottom(true);
                setShouldAutoScroll(true);
                setUnreadCount(0);
                setMessagesFromBottom(0);
            } else if (e.key === 'Home' || e.key === 'PageUp') {
                e.preventDefault();
                if (virtuosoRef.current) {
                    virtuosoRef.current.scrollToIndex({
                        index: 0,
                        behavior: 'smooth',
                        align: 'start'
                    });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // 3. Initial Mount Scroll (Instant) AND Async Load
    // This needs to run whenever the list GOES from empty to having items to catch the async load.
    React.useEffect(() => {
        // Only run if we transitioned from no messages to having messages
        // OR if this is the very first valid render with messages
        if (filteredMessages.length > 0 && previousMessagesLength.current === 0) {
            // Short delay to ensure Virtuoso has measured content
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: filteredMessages.length - 1,
                    align: 'end',
                    behavior: 'auto'
                });
            }, 50);
        }
    }, [filteredMessages.length]);

    const handleStarterClick = (message: string, startLiveMode: boolean = false) => {
        if (startLiveMode) {
            // Add message to chat for consistency (without sending to Gemini text mode)
            if (onAddMessageToChat) {
                onAddMessageToChat(message);
            }

            // Prefer Live startup path for live cards; fallback to text mode only when unavailable.
            if (onStartLiveMode) {
                onStartLiveMode(message);
            } else if (onSendMessage) {
                onSendMessage(message);
            }

            // Scroll to bottom after starting
            setTimeout(() => scrollToBottom(true), 100);
            return;
        }

        // Regular text message flow
        if (onSendMessage) {
            onSendMessage(message);
            // Scroll to bottom after sending
            setTimeout(() => scrollToBottom(true), 100);
        }
    };

    const greeting = getGreeting();
    const userName = user?.displayName?.split(' ')[0];
    // Treat signed-out users as first-time on landing, and signed-in users as first-time
    // until they complete their first workout.
    const isFirstTimeUser = !userId || !onboardingState || !onboardingState.firstWorkoutCompletedAt;

    // Context-aware prompt logic
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    const getContextCards = () => {
        const cards = [];

        // 1. Primary Action (Workout/Movement) - Time context. Prompts trigger immediate delivery + live (per system: do for user, action first).
        if (timeOfDay === 'morning') {
            cards.push({
                id: 'morning-flow',
                icon: <Dumbbell className="w-6 h-6" />,
                title: "Morning Mobility",
                description: "Feel looser in 5 minutes.",
                action: "I want a morning mobility session. Let me customize it with the workout builder.",
                isLive: true
            });
        } else if (timeOfDay === 'afternoon') {
            cards.push({
                id: 'afternoon-boost',
                icon: <Dumbbell className="w-6 h-6" />,
                title: "Energy Boost",
                description: "Reset focus and energy fast.",
                action: "I need a quick energy boost workout. Let me pick my preferences with the workout builder.",
                isLive: true
            });
        } else {
            cards.push({
                id: 'evening-unwind',
                icon: <Moon className="w-6 h-6" />,
                title: "Wind Down",
                description: "Ease stress before sleep.",
                action: "I want to wind down before bed. Let me set up a calming session with the workout builder.",
                isLive: true
            });
        }

        // 2. Secondary Action (Mindfulness). Specific ask â†’ timer/breathing UI + live.
        cards.push({
            id: 'breathing',
            icon: <Wind className="w-6 h-6" />,
            title: "Breathwork",
            description: "Calm your nervous system now.",
            action: "I want to do a 2-minute box breathing session. Set up a breathing timer for me.",
            isLive: true
        });

        // 3. Status/Progress. Prompts aligned to system: progress â†’ chart; goals â†’ invite-style, GoalSelector.
        if (isFirstTimeUser) {
            cards.push({
                id: 'set-goals',
                icon: <Target className="w-6 h-6" />,
                title: "Set Goals",
                description: "Build your personal plan.",
                action: "Help me set my first fitness goals and suggest a small session I can start with today.",
                isLive: false
            });
        } else {
            cards.push({
                id: 'progress',
                icon: <BarChart2 className="w-6 h-6" />,
                title: "Progress",
                description: "See wins and next best move.",
                action: "Show my progress this week and highlight one meaningful win plus one concrete next step I can do today.",
                isLive: false
            });
        }

        // 4. Open conversation. Sets expectation so Zen replies with warmth, not a workout.
        cards.push({
            id: 'chat',
            icon: <MessageCircle className="w-6 h-6" />,
            title: "Just Chat",
            description: "Get clarity, no pressure.",
            action: "I just want to talk for a minute, no workout yet. Help me quickly identify what I need most right now and offer two tiny options I can choose from.",
            isLive: false
        });

        return cards;
    };

    const actionCards = getContextCards();

    return (
        // Container that fills available space - uses absolute positioning to fill parent
        <div className="absolute inset-0 flex flex-col">
            {/* Empty State - Centered Pill Design */}
            {filteredMessages.length === 0 && (
                <div className="absolute inset-0 flex flex-col px-4 sm:px-6 z-10">
                    {/* Centered Content */}
                    <div className="flex-1 flex flex-col justify-center items-center max-w-4xl mx-auto w-full">
                        {/* Greeting */}
                        <div className="text-center mb-10 sm:mb-12">
                            <h1 className="font-display text-5xl sm:text-6xl font-bold text-ink-900 mb-4 tracking-tight">
                                {userName ? (
                                    <>
                                        {greeting}, <span className="text-gradient-claude">{userName}</span>
                                    </>
                                ) : (
                                    <>
                                        Meet <span className="text-gradient-claude">Zen</span>
                                    </>
                                )}
                            </h1>
                            <p className="text-ink-400 text-lg sm:text-xl leading-relaxed">
                                {userName ? (
                                    <>Consistency over perfection.<br />Ready for a quick {timeOfDay} session when you are.</>
                                ) : (
                                    <>Your calm coach for movement and mindfulness.<br />One session at a time.</>
                                )}
                            </p>
                        </div>

                        {/* Action Cards Grid */}
                        {/* Action Cards Grid - Aligned with input max-width */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl mb-8">
                            {actionCards.map((card, index) => (
                                <ActionCard
                                    key={card.id}
                                    icon={card.icon}
                                    title={card.title}
                                    description={card.description}
                                    onClick={() => handleStarterClick(card.action, card.isLive)}
                                    delay={index * 100}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Bottom Input */}
                    <div className="w-full max-w-2xl mx-auto pb-4 sm:pb-6">
                        <div className="bg-white/95 backdrop-blur-xl rounded-2xl sm:rounded-[28px] p-2 flex items-center gap-2 shadow-soft-lg border border-sand-300 transition-all focus-within:ring-2 focus-within:ring-claude-200">
                            <input
                                type="text"
                                placeholder="What's on your mind?"
                                className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 py-2.5 sm:py-3 px-3 sm:px-5 text-ink-800 placeholder:text-ink-400 text-sm sm:text-base font-medium"
                                data-testid="empty-state-input"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && onSendMessage) {
                                        const target = e.target as HTMLInputElement;
                                        const message = target.value.trim();
                                        if (message) {
                                            onSendMessage(message);
                                        }
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    const message = "Start a live session";
                                    // Show the intent in chat without triggering text-mode Gemini
                                    if (onAddMessageToChat) {
                                        onAddMessageToChat(message);
                                    }
                                    if (onStartLiveMode) {
                                        onStartLiveMode(message);
                                    }
                                }}
                                className="h-9 sm:h-11 px-0 sm:px-0 flex items-center justify-center text-ink-400 hover:text-claude-600 transition-all duration-500 ease-in-out rounded-full hover:bg-claude-50 group overflow-hidden bg-transparent border-none min-w-[36px] sm:min-w-[44px] hover:min-w-[110px] sm:hover:min-w-[130px] hover:px-4"
                                title="Live Mode"
                                data-testid="empty-state-live-button"
                            >
                                <div className="flex items-center justify-center">
                                    <VoiceModeIcon className="w-5 h-5 sm:w-6 sm:h-6 group-hover:scale-110 transition-transform" />
                                    <span className="max-w-0 group-hover:max-w-[100px] opacity-0 group-hover:opacity-100 transition-all duration-500 ease-in-out overflow-hidden whitespace-nowrap ml-0 group-hover:ml-2 text-xs sm:text-sm font-semibold tracking-tight">
                                        Live Mode
                                    </span>
                                </div>
                            </button>
                        </div>
                        <p className="text-center text-xs text-ink-300 mt-3">
                            Press <kbd className="px-1.5 py-0.5 bg-sand-100 border border-sand-200 rounded text-ink-400 font-mono text-[10px]">enter</kbd> to send
                        </p>
                    </div>
                </div>
            )}

            {/* Scroll to Bottom Button - Shows only when user scrolls past several messages */}
            {messagesFromBottom > SCROLL_BUTTON_THRESHOLD && filteredMessages.length > 0 && (
                <button
                    onClick={() => {
                        scrollToBottom(true);
                        setShouldAutoScroll(true);
                        setUnreadCount(0);
                        setMessagesFromBottom(0);
                    }}
                    className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-20 
                        rounded-full 
                        bg-gradient-to-br from-claude-500 to-claude-600 
                        text-white shadow-lg shadow-claude-500/30 
                        hover:shadow-xl hover:shadow-claude-500/40 
                        hover:scale-105 active:scale-95
                        transition-all duration-300 ease-out
                        flex items-center gap-2
                        animate-slide-up-fade
                        px-3 sm:px-4 py-2 sm:py-2.5"
                    aria-label={`Scroll to bottom${unreadCount > 0 ? ` (${unreadCount} new message${unreadCount > 1 ? 's' : ''})` : ''}`}
                >
                    <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                    {unreadCount > 0 && (
                        <span className="text-xs sm:text-sm font-display font-bold bg-white/20 px-2 py-0.5 rounded-full min-w-[20px] text-center">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </button>
            )}

            {/* Virtual List with Smart Scrolling - Fills all available space */}
            <div className="flex-1 min-h-0">
                <Virtuoso
                    ref={virtuosoRef}
                    data={filteredMessages}
                    className="no-scrollbar"
                    style={{ height: '100%' }}
                    // We handle scrolling manually for more control
                    followOutput={false}
                    alignToBottom={true}
                    rangeChanged={handleRangeChanged}
                    atBottomStateChange={handleAtBottomStateChange}
                    increaseViewportBy={{ top: 200, bottom: 200 }}
                    overscan={5}
                    components={{
                        Footer: () => (
                            <div className="pb-8 pt-4">
                                {isTyping && (
                                    <div className="flex w-full mb-8 justify-start animate-slide-up-fade px-3 sm:px-6 max-w-2xl mx-auto">
                                        <div className="flex items-start gap-2 sm:gap-3">
                                            {/* Avatar */}
                                            <div className="flex-shrink-0 mt-1">
                                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-gradient-to-br from-claude-500 to-claude-600 flex items-center justify-center shadow-soft text-white animate-breathe">
                                                    <ZenLogo className="w-4 h-4 sm:w-5 sm:h-5 text-white" monochrome />
                                                </div>
                                            </div>

                                            {/* Typing Indicator */}
                                            <div className="bg-white/90 backdrop-blur-sm px-4 sm:px-5 py-3 sm:py-4 rounded-2xl sm:rounded-3xl rounded-bl-lg border border-sand-200 shadow-soft">
                                                <div className="flex space-x-1.5 sm:space-x-2">
                                                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-claude-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-claude-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-claude-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    }}
                    itemContent={(index, msg) => (
                        <div className="px-3 sm:px-6 max-w-2xl mx-auto">
                            {(() => {
                                const isActiveGuidanceThread = !!activeWorkoutMessageId && msg.id === activeWorkoutMessageId;
                                return (
                                    <MessageBubble
                                        key={msg.id}
                                        message={msg}
                                        userId={userId}
                                        onAction={onAction}
                                        isLiveMode={isLiveMode}
                                        audioDataRef={audioDataRef}
                                        aiState={aiState}
                                        currentGuidanceText={currentGuidanceText}
                                        onLiveControl={onLiveControl}
                                        guidanceMessages={isActiveGuidanceThread && (msg.uiComponent?.type === 'workoutList' || msg.uiComponent?.type === 'timer') ? guidanceMessages : undefined}
                                        activeTimer={isActiveGuidanceThread && msg.uiComponent?.type === 'timer' ? activeTimer : undefined}
                                        workoutProgress={isActiveGuidanceThread && msg.uiComponent?.type === 'workoutList' ? workoutProgress : undefined}
                                    />
                                );
                            })()}
                        </div>
                    )}
                />
            </div>
        </div>
    );
};


