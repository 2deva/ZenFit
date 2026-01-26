import React, { useRef, useEffect } from 'react';
import { Send, Mic, Trash2 } from 'lucide-react';
import { ChatInterface } from './ChatInterface';
import { VoiceControls } from './VoiceControls';
import { AuthButton } from './AuthButton';
import { Button } from './ui/Button';
import { useAppContext } from '../contexts/AppContext';
import { useLiveSessionContext } from '../contexts/LiveSessionContext';
import { LiveStatus } from '../types';

// Claude-inspired Zen Logo Component
const ZenLogo = () => (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="logoGradientClaude" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E87A38" />
                <stop offset="100%" stopColor="#D96922" />
            </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11" stroke="url(#logoGradientClaude)" strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="55 14" />
        <circle cx="16" cy="16" r="4" fill="url(#logoGradientClaude)" />
    </svg>
);

export const AppLayout: React.FC = () => {
    const {
        messages,
        isTyping,
        supabaseUserId,
        handleActionWrapper,
        handleSendMessage,
        addMessageToChat,
        inputValue,
        setInputValue,
        activeTimer,
        activeWorkoutMessageId,
        workoutProgress,
        showDeleteConfirm,
        setShowDeleteConfirm,
        clearHistory
    } = useAppContext();

    const {
        liveStatus,
        toggleLive,
        audioDataRef,
        liveIsSpeaking,
        isInterrupted,
        liveIsMuted,
        setLiveIsMuted,
        handleActivityControl,
        startLiveModeAndSendMessage
    } = useLiveSessionContext();

    const [isFocused, setIsFocused] = React.useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustTextareaHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    };

    useEffect(() => {
        adjustTextareaHeight();
    }, [inputValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleAction = async (action: string, data: any) => {
        if (action === 'liveWorkoutSubmit' && liveStatus === LiveStatus.CONNECTED) {
            // Format the message for the model
            const params = data as Record<string, string>;
            const selections = Object.entries(params)
                .map(([category, value]) => `${category}: ${value}`)
                .join(', ');

            const prompt = `I've configured my session with: ${selections}. Please generate the workout/session for me now.`;
            addMessageToChat(prompt);
            startLiveModeAndSendMessage(prompt);
            return;
        }

        await handleActionWrapper(action, data);
    };

    return (
        <div className="flex flex-col h-full bg-sand-50 relative overflow-hidden noise">

            {/* Ambient Mesh Background */}
            <div className="absolute inset-0 mesh-bg-claude pointer-events-none"></div>

            {/* Floating Warm Orbs - Responsive sizing */}
            <div className="absolute -top-20 sm:-top-40 -right-20 sm:-right-40 w-[250px] sm:w-[500px] h-[250px] sm:h-[500px] rounded-full bg-gradient-radial from-claude-200/30 via-claude-100/10 to-transparent blur-3xl animate-float-slow pointer-events-none"></div>
            <div className="absolute -bottom-32 sm:-bottom-60 -left-32 sm:-left-60 w-[200px] sm:w-[400px] h-[200px] sm:h-[400px] rounded-full bg-gradient-radial from-sand-300/40 via-sand-200/10 to-transparent blur-3xl animate-float-gentle pointer-events-none"></div>

            {/* Header - Responsive */}
            <header className="flex-none h-16 sm:h-20 flex items-center justify-between px-4 sm:px-6 z-20 relative">
                <div className="flex items-center space-x-3 sm:space-x-4">
                    {/* Premium Logo */}
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-br from-claude-400 to-claude-600 rounded-xl sm:rounded-2xl blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-500"></div>
                        <div className="relative w-10 h-10 sm:w-12 sm:h-12 bg-white border border-sand-200 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-soft-md transform group-hover:scale-105 transition-all duration-300">
                            <ZenLogo />
                        </div>
                    </div>
                    <div>
                        <h1 className="font-display text-lg sm:text-xl font-bold text-ink-900 tracking-tight">ZenFit</h1>
                        <p className="text-[10px] sm:text-xs text-ink-400 font-medium hidden sm:block">Mindful movement</p>
                    </div>
                </div>

                <div className="flex items-center space-x-1 sm:space-x-2">
                    {messages.length > 0 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full hover:bg-red-50 h-9 w-9 sm:h-10 sm:w-10"
                            onClick={() => setShowDeleteConfirm(true)}
                            title="Clear All Data"
                        >
                            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 text-ink-400 hover:text-red-500 transition-colors" />
                        </Button>
                    )}
                    <AuthButton variant="compact" />
                </div>
            </header>

            {/* Chat Area */}
            <ChatInterface
                messages={messages}
                isTyping={isTyping}
                userId={supabaseUserId || undefined}
                onAction={handleAction}
                onSendMessage={(text) => {
                    setInputValue(text);
                    setTimeout(() => handleSendMessage(text), 50);
                }}
                onAddMessageToChat={addMessageToChat}
                // Live Mode Integration
                isLiveMode={liveStatus === LiveStatus.CONNECTED}
                audioDataRef={audioDataRef}
                aiState={
                    liveIsSpeaking ? 'speaking' :
                        liveStatus === LiveStatus.CONNECTED ? 'listening' : 'idle'
                }
                onLiveControl={handleActivityControl}
                onStartLiveMode={startLiveModeAndSendMessage}
                activeWorkoutMessageId={activeWorkoutMessageId}
                activeTimer={activeTimer}
                // Controlled workout progress for sync
                workoutProgress={workoutProgress}
            />



            {/* Floating Input Capsule - Responsive */}
            <div className="flex-none px-3 sm:px-4 pb-4 sm:pb-8 z-30 relative">
                {liveStatus === LiveStatus.DISCONNECTED ? (
                    <div
                        className={`
                        mx-auto bg-white/95 backdrop-blur-xl rounded-2xl sm:rounded-[28px] p-1.5 sm:p-2 flex items-center space-x-1.5 sm:space-x-2 transition-all duration-500 ease-out
                        ${isFocused ? 'max-w-3xl border-claude-400/60 shadow-glow-claude' : 'max-w-2xl border-sand-300 shadow-soft-lg'}
                    `}
                    >

                        <textarea
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                adjustTextareaHeight();
                            }}
                            onFocus={() => {
                                setIsFocused(true);
                                setTimeout(adjustTextareaHeight, 0);
                            }}
                            onBlur={() => setIsFocused(false)}
                            onKeyDown={handleKeyDown}
                            placeholder="What's on your mind?"
                            className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:border-none focus:ring-0 resize-none py-2.5 sm:py-3 px-3 sm:px-5 text-ink-800 placeholder:text-ink-300 text-sm sm:text-[15px] leading-relaxed font-body font-medium appearance-none shadow-none no-scrollbar"
                            rows={1}
                            style={{ minHeight: '44px', maxHeight: '200px', height: 'auto', boxShadow: 'none' }}
                        />

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5 sm:gap-2 pr-0.5 sm:pr-1">
                            {!inputValue.trim() ? (
                                <button
                                    onClick={toggleLive}
                                    className="h-9 sm:h-11 px-0 sm:px-0 flex items-center justify-center text-ink-400 hover:text-claude-600 transition-all duration-500 ease-in-out rounded-full hover:bg-claude-50 group overflow-hidden bg-transparent border-none min-w-[36px] sm:min-w-[44px] hover:min-w-[110px] sm:hover:min-w-[130px] hover:px-4"
                                    title="Live Mode"
                                >
                                    <div className="flex items-center justify-center">
                                        <Mic className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" />
                                        <span className="max-w-0 group-hover:max-w-[100px] opacity-0 group-hover:opacity-100 transition-all duration-500 ease-in-out overflow-hidden whitespace-nowrap ml-0 group-hover:ml-2 text-xs sm:text-sm font-semibold tracking-tight">
                                            Live Mode
                                        </span>
                                    </div>
                                </button>
                            ) : (
                                <Button
                                    onClick={() => handleSendMessage()}
                                    variant="primary"
                                    size="icon"
                                    className="h-9 w-9 sm:h-11 sm:w-11 rounded-full"
                                    disabled={!inputValue.trim()}
                                >
                                    <Send className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <VoiceControls
                            status={liveStatus === 'connected' ? LiveStatus.CONNECTED : liveStatus === 'connecting' ? LiveStatus.CONNECTING : LiveStatus.DISCONNECTED}
                            onToggle={toggleLive}
                            audioDataRef={audioDataRef}
                            isInterrupted={isInterrupted}
                            variant="inline"
                            isMuted={liveIsMuted}
                            onMuteToggle={() => setLiveIsMuted(!liveIsMuted)}
                        />
                    </div>
                )}

                {/* Keyboard Hint - Hide on mobile */}
                <div className="hidden sm:flex justify-center mt-3">
                    <span className="text-[10px] text-ink-300 font-medium">Press <kbd className="px-1.5 py-0.5 bg-sand-100 border border-sand-200 rounded text-ink-400 font-mono text-[9px]">Enter</kbd> to send</span>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={() => setShowDeleteConfirm(false)}
                    />

                    {/* Modal */}
                    <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className="text-center">
                            <div className="w-14 h-14 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                                <Trash2 className="w-7 h-7 text-red-500" />
                            </div>
                            <h3 className="text-lg font-display font-bold text-ink-900 mb-2">Clear All Data?</h3>
                            <p className="text-sm text-ink-500 mb-6">
                                This will permanently delete all your chat history, workout data, streaks, goals, and memories. This action cannot be undone.
                            </p>

                            <div className="flex gap-3">
                                <Button
                                    variant="secondary"
                                    className="flex-1 rounded-xl"
                                    onClick={() => setShowDeleteConfirm(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 border-red-500"
                                    onClick={clearHistory}
                                >
                                    Delete Everything
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
