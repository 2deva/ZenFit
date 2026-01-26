
import React from 'react';
import { Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { Sparkles, ArrowRight, MessageCircle, Dumbbell, Target, Brain, ChevronDown } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useAuth } from '../contexts/AuthContext';

interface ChatInterfaceProps {
    messages: Message[];
    isTyping?: boolean;
    userId?: string; // Supabase user ID for cross-device sync
    onAction: (action: string, data: any) => void;
    onSendMessage?: (text: string) => void;
    onAddMessageToChat?: (text: string) => void; // Add message to chat without sending to Gemini
    // Live Mode Props
    isLiveMode?: boolean;
    audioDataRef?: React.MutableRefObject<Float32Array>; // Changed from Float32Array to ref
    aiState?: 'listening' | 'speaking' | 'processing' | 'idle';
    currentGuidanceText?: string;
    onLiveControl?: (action: 'pause' | 'resume' | 'skip' | 'back') => void;
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

// Animated Zen Mascot Component
const ZenMascot = () => (
    <div className="relative w-28 h-28 sm:w-36 sm:h-36 mx-auto mb-6 sm:mb-8">
        {/* Outer glow ring */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-claude-300/30 to-claude-500/20 animate-zen-glow"></div>

        {/* Rotating decorative ring */}
        <div className="absolute inset-2 sm:inset-3">
            <svg className="w-full h-full animate-zen-rotate" viewBox="0 0 100 100">
                <circle
                    cx="50" cy="50" r="45"
                    fill="none"
                    stroke="url(#mascotRingGradient)"
                    strokeWidth="1.5"
                    strokeDasharray="20 10 5 10"
                    strokeLinecap="round"
                    opacity="0.4"
                />
                <defs>
                    <linearGradient id="mascotRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#E87A38" />
                        <stop offset="100%" stopColor="#D96922" />
                    </linearGradient>
                </defs>
            </svg>
        </div>

        {/* Main Zen symbol */}
        <div className="absolute inset-4 sm:inset-5 animate-zen-float">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-white to-sand-100 border border-sand-200/50 shadow-soft-lg flex items-center justify-center">
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 sm:w-12 sm:h-12">
                    <defs>
                        <linearGradient id="zenSymbolGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#E87A38" />
                            <stop offset="100%" stopColor="#D96922" />
                        </linearGradient>
                    </defs>
                    <circle cx="16" cy="16" r="11" stroke="url(#zenSymbolGradient)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray="50 16" />
                    <circle cx="16" cy="16" r="4" fill="url(#zenSymbolGradient)" />
                </svg>
            </div>
        </div>

        {/* Sparkle accents */}
        <div className="absolute -top-1 -right-1 w-4 h-4 text-claude-400 animate-pulse" style={{ animationDelay: '0.5s' }}>
            <Sparkles className="w-full h-full" />
        </div>
        <div className="absolute -bottom-2 -left-2 w-3 h-3 text-claude-300 animate-pulse" style={{ animationDelay: '1s' }}>
            <Sparkles className="w-full h-full" />
        </div>
    </div>
);

// Conversation Starter Pill
interface StarterPillProps {
    icon: React.ReactNode;
    text: string;
    onClick: () => void;
    delay?: number;
}

const StarterPill: React.FC<StarterPillProps> = ({ icon, text, onClick, delay = 0 }) => (
    <button
        onClick={onClick}
        className="group flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 bg-white/90 backdrop-blur-sm rounded-full border border-sand-200 hover:border-claude-300 hover:shadow-glow-claude transition-all duration-500 opacity-0 animate-reveal-up shadow-soft"
        style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
        <span className="text-claude-500 group-hover:scale-110 transition-transform duration-300">
            {icon}
        </span>
        <span className="font-medium text-sm sm:text-base text-ink-700 group-hover:text-ink-900 transition-colors">
            {text}
        </span>
        <ArrowRight className="w-4 h-4 text-ink-300 group-hover:text-claude-500 group-hover:translate-x-1 transition-all duration-300" />
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
    const scrollTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    const lastScrollTime = React.useRef<number>(0);

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

    const previousMessagesLength = React.useRef(filteredMessages.length);

    // Threshold for "near bottom" detection (50px as per best practices)
    const BOTTOM_THRESHOLD = 50;

    // Smart scroll with debouncing: Only auto-scroll if user is at bottom or new message is from user
    React.useEffect(() => {
        const lastMessage = filteredMessages[filteredMessages.length - 1];
        const isNewMessage = filteredMessages.length > previousMessagesLength.current;
        const newMessageCount = filteredMessages.length - previousMessagesLength.current;
        const isUserMessage = lastMessage?.role === 'user';

        if (isNewMessage) {
            // Clear existing debounce
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }

            // Debounce rapid message bursts (wait 100ms for more messages)
            debounceTimeoutRef.current = setTimeout(() => {
                // Always scroll for user messages or if already at bottom
                if (isUserMessage || isAtBottom || shouldAutoScroll) {
                    scrollToBottom(true);
                    setUnreadCount(0); // Clear unread when auto-scrolling
                } else {
                    // User is scrolled up - increment unread count
                    setUnreadCount(prev => prev + newMessageCount);
                }
                previousMessagesLength.current = filteredMessages.length;
            }, 100);
        }

        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, [filteredMessages, isAtBottom, shouldAutoScroll]);

    // Scroll to bottom when typing indicator appears (if at bottom)
    // Use debouncing to prevent excessive scrolling during rapid typing updates
    React.useEffect(() => {
        if (isTyping && isAtBottom) {
            // Debounce typing indicator scrolls
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }

            debounceTimeoutRef.current = setTimeout(() => {
                scrollToBottom(true);
            }, 150);
        }

        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, [isTyping, isAtBottom]);

    // Initial scroll to bottom - only on mount
    React.useEffect(() => {
        if (filteredMessages.length > 0 && previousMessagesLength.current === 0) {
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                scrollToBottom(false);
            }, 150);
        }
    }, []); // Only on mount

    const scrollToBottom = (smooth: boolean = true) => {
        if (virtuosoRef.current && filteredMessages.length > 0) {
            const now = Date.now();
            const timeSinceLastScroll = now - lastScrollTime.current;

            // Adaptive timing: use instant scroll if scrolling frequently (within 500ms)
            // This prevents animation jank during rapid message bursts
            const shouldUseSmooth = smooth && timeSinceLastScroll > 500;

            lastScrollTime.current = now;

            if (shouldUseSmooth) {
                virtuosoRef.current.scrollToIndex({
                    index: filteredMessages.length - 1,
                    behavior: 'smooth',
                    align: 'end'
                });
            } else {
                // Instant scroll for better performance during rapid updates
                virtuosoRef.current.scrollToIndex({
                    index: filteredMessages.length - 1,
                    behavior: 'auto',
                    align: 'end'
                });
            }
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

        // Threshold-based: consider "at bottom" if within last 2 items (more forgiving)
        const isNearBottom = range.endIndex >= filteredMessages.length - 2;
        if (isNearBottom && !isAtBottom) {
            setIsAtBottom(true);
            setShouldAutoScroll(true);
            setUnreadCount(0);
        } else if (!isNearBottom && isAtBottom) {
            // User scrolled up significantly
            setIsAtBottom(false);
            setShouldAutoScroll(false);
        }
    }, [filteredMessages.length, isAtBottom]);

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

    // Handle window resize - maintain scroll position
    React.useEffect(() => {
        const handleResize = () => {
            if (isAtBottom && virtuosoRef.current) {
                // Small delay to let layout settle
                setTimeout(() => {
                    scrollToBottom(false);
                }, 100);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isAtBottom]);

    // Cleanup timeouts on unmount
    React.useEffect(() => {
        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, []);

    const handleStarterClick = (message: string, startLiveMode: boolean = false) => {
        if (startLiveMode && onStartLiveMode) {
            // Add message to chat for consistency (without sending to Gemini text mode)
            if (onAddMessageToChat) {
                onAddMessageToChat(message);
            }
            // Start Live Mode and send message directly to voice
            onStartLiveMode(message);
            // Scroll to bottom after starting
            setTimeout(() => scrollToBottom(true), 100);
        } else {
            // Regular text message flow
            if (onSendMessage) {
                onSendMessage(message);
                // Scroll to bottom after sending
                setTimeout(() => scrollToBottom(true), 100);
            }
        }
    };

    const greeting = getGreeting();
    const userName = user?.displayName?.split(' ')[0];

    return (
        <div className="flex-1 h-full relative">
            {/* Empty State - Premium Landing */}
            {filteredMessages.length === 0 && (
                <div className="absolute inset-0 flex flex-col justify-center items-center px-4 sm:px-8 pb-28 sm:pb-36 z-10 pointer-events-none">
                    <div className="pointer-events-auto w-full max-w-3xl mx-auto text-center">

                        {/* Personalized Greeting */}
                        <div className="opacity-0 animate-reveal-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                            <h1 className="font-display text-4xl sm:text-6xl font-bold text-ink-900 mb-3 sm:mb-4 tracking-tight">
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
                        </div>

                        {/* Tagline */}
                        <div className="opacity-0 animate-reveal-up" style={{ animationDelay: '150ms', animationFillMode: 'forwards' }}>
                            <p className="text-ink-500 text-lg sm:text-xl mb-10 sm:mb-14 max-w-xl mx-auto font-medium leading-relaxed">
                                {userName ? (
                                    <>
                                        Ready for your next session?<br className="hidden sm:block" /> Let's keep the momentum going.
                                    </>
                                ) : (
                                    <>
                                        Your mindful fitness companion.<br className="hidden sm:block" /> Let's build habits together.
                                    </>
                                )}
                            </p>
                        </div>

                        {/* Conversation Starters */}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 flex-wrap">
                            <StarterPill
                                icon={<Target className="w-4 h-4 sm:w-5 sm:h-5" />}
                                text="Start my journey"
                                onClick={() => handleStarterClick("I'm new here and want to build sustainable fitness habits. Help me understand how Zen works and set up my personalized wellness goals that balance physical health, mental wellness, and recovery.")}
                                delay={300}
                            />
                            <StarterPill
                                icon={<Dumbbell className="w-4 h-4 sm:w-5 sm:h-5" />}
                                text="Guided workout"
                                onClick={() => handleStarterClick("I want to do a workout with your voice guidance. Can you create a personalized routine and coach me through it in Live Mode?", true)}
                                delay={400}
                            />
                            <StarterPill
                                icon={<Brain className="w-4 h-4 sm:w-5 sm:h-5" />}
                                text="Mindful moment"
                                onClick={() => handleStarterClick("I need to reset my mind and body. Guide me through a breathing exercise or meditation session with your voice - something that helps with stress relief and recovery.", true)}
                                delay={500}
                            />
                            <StarterPill
                                icon={<MessageCircle className="w-4 h-4 sm:w-5 sm:h-5" />}
                                text="Explore features"
                                onClick={() => handleStarterClick("Hey Zen! Show me what you can do. What makes you different from other fitness apps? I want to understand your full capabilities.")}
                                delay={600}
                            />
                        </div>
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
                    className="absolute bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 z-20 
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

            {/* Virtual List with Smart Scrolling */}
            <Virtuoso
                ref={virtuosoRef}
                data={filteredMessages}
                className="no-scrollbar h-full"
                followOutput={shouldAutoScroll ? "auto" : false}
                initialTopMostItemIndex={filteredMessages.length > 0 ? filteredMessages.length - 1 : 0}
                alignToBottom={true}
                rangeChanged={handleRangeChanged}
                atBottomStateChange={handleAtBottomStateChange}
                increaseViewportBy={{ top: 200, bottom: 200 }}
                overscan={5}
                components={{
                    Footer: () => (
                        <div className="pb-28 sm:pb-36 pt-4">
                            {isTyping && (
                                <div className="flex w-full mb-8 justify-start animate-slide-up-fade px-3 sm:px-6 max-w-2xl mx-auto">
                                    <div className="flex items-start gap-2 sm:gap-3">
                                        {/* Avatar */}
                                        <div className="flex-shrink-0 mt-1">
                                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-gradient-to-br from-claude-500 to-claude-600 flex items-center justify-center shadow-soft text-white animate-breathe">
                                                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
                            guidanceMessages={msg.uiComponent?.type === 'workoutList' || msg.uiComponent?.type === 'timer' ? guidanceMessages : undefined}
                            activeTimer={msg.uiComponent?.type === 'timer' ? activeTimer : undefined}
                            workoutProgress={msg.uiComponent?.type === 'workoutList' ? workoutProgress : undefined}
                        />
                    </div>
                )}
            />
        </div>
    );
};
