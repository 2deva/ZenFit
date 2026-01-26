/**
 * Live Session Handlers
 * Handles live mode transcription, tool calls, and activity control
 */

import { v4 as uuidv4 } from 'uuid';
import { Message, MessageRole, UIComponentData } from '../types';
import { setMessages as setLocalMessages } from '../services/storageService';

interface LiveSessionHandlers {
    handleTranscription: (text: string, isUser: boolean, isFinal: boolean) => {
        updateMessages: (prev: Message[]) => Message[];
        resetBuffers?: () => void;
    };
    handleToolCall: (component: UIComponentData) => {
        updateMessages: (prev: Message[]) => Message[];
    };
    handleActivityControl: (action: 'pause' | 'resume' | 'skip' | 'stop' | 'back') => {
        updateTimer?: (prev: any) => any;
        updateWorkout?: (prev: any) => any;
    };
}

interface LiveSessionState {
    currentLiveModelMessageId: string | null;
    currentLiveUserMessageId: string | null;
    userTranscriptBuffer: string;
    modelTranscriptBuffer: string;
}

/**
 * Creates live session handlers with state management
 */
export const createLiveSessionHandlers = (
    state: LiveSessionState,
    setState: (updates: Partial<LiveSessionState>) => void,
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
    setActiveTimer: React.Dispatch<React.SetStateAction<any>>,
    setCurrentWorkoutProgress: React.Dispatch<React.SetStateAction<any>>
): LiveSessionHandlers => {
    const handleTranscription = (text: string, isUser: boolean, isFinal: boolean) => {
        if (isUser) {
            // Detect role switch (Model -> User)
            if (state.currentLiveModelMessageId) {
                setState({
                    currentLiveModelMessageId: null,
                    modelTranscriptBuffer: ''
                });
            }

            // Handle turn complete
            if (!text && isFinal) {
                if (state.currentLiveUserMessageId && state.userTranscriptBuffer) {
                    return {
                        updateMessages: (prev: Message[]) => prev.map(msg =>
                            msg.id === state.currentLiveUserMessageId
                                ? { ...msg, text: state.userTranscriptBuffer }
                                : msg
                        ),
                        resetBuffers: () => setState({
                            currentLiveUserMessageId: null,
                            userTranscriptBuffer: ''
                        })
                    };
                }
                return {
                    updateMessages: (prev: Message[]) => prev,
                    resetBuffers: () => setState({
                        currentLiveUserMessageId: null,
                        userTranscriptBuffer: ''
                    })
                };
            }

            // Accumulate text
            let newBuffer = state.userTranscriptBuffer;
            if (text.startsWith(state.userTranscriptBuffer.substring(0, Math.min(10, state.userTranscriptBuffer.length)))) {
                newBuffer = text; // Cumulative
            } else if (state.userTranscriptBuffer && !state.userTranscriptBuffer.endsWith(text)) {
                newBuffer = state.userTranscriptBuffer + text; // Delta
            } else {
                newBuffer = text; // New
            }

            setState({ userTranscriptBuffer: newBuffer });

            if (state.currentLiveUserMessageId) {
                return {
                    updateMessages: (prev: Message[]) => prev.map(msg =>
                        msg.id === state.currentLiveUserMessageId
                            ? { ...msg, text: newBuffer }
                            : msg
                    )
                };
            } else {
                const id = uuidv4();
                setState({ currentLiveUserMessageId: id });
                return {
                    updateMessages: (prev: Message[]) => [...prev, {
                        id,
                        role: MessageRole.USER,
                        text: newBuffer,
                        timestamp: Date.now()
                    }]
                };
            }
        } else {
            // Model transcripts
            if (state.currentLiveUserMessageId) {
                setState({
                    currentLiveUserMessageId: null,
                    userTranscriptBuffer: ''
                });
            }

            const newBuffer = state.modelTranscriptBuffer + text;
            setState({ modelTranscriptBuffer: newBuffer });

            if (state.currentLiveModelMessageId) {
                return {
                    updateMessages: (prev: Message[]) => prev.map(msg =>
                        msg.id === state.currentLiveModelMessageId
                            ? { ...msg, text: newBuffer }
                            : msg
                    )
                };
            } else {
                const id = uuidv4();
                setState({ currentLiveModelMessageId: id });
                return {
                    updateMessages: (prev: Message[]) => [...prev, {
                        id,
                        role: MessageRole.MODEL,
                        text: newBuffer,
                        timestamp: Date.now()
                    }]
                };
            }
        }
    };

    const handleToolCall = (component: UIComponentData) => {
        return {
            updateMessages: (prev: Message[]) => {
                let updatedMessages: Message[];

                if (state.currentLiveModelMessageId) {
                    updatedMessages = prev.map(msg =>
                        msg.id === state.currentLiveModelMessageId
                            ? { ...msg, uiComponent: component }
                            : msg
                    );
                } else {
                    const id = uuidv4();
                    setState({ currentLiveModelMessageId: id });
                    updatedMessages = [...prev, {
                        id,
                        role: MessageRole.MODEL,
                        text: "",
                        timestamp: Date.now(),
                        uiComponent: component
                    }];
                }

                // Synchronously save to localStorage
                try {
                    setLocalMessages(updatedMessages);
                } catch (e) {
                    console.warn('Failed to sync save UI component:', e);
                }

                return updatedMessages;
            }
        };
    };

    const handleActivityControl = (action: 'pause' | 'resume' | 'skip' | 'stop' | 'back') => {
        const updates: {
            updateTimer?: (prev: any) => any;
            updateWorkout?: (prev: any) => any;
        } = {};

        if (action === 'pause') {
            updates.updateTimer = (prev: any) => prev ? { ...prev, isRunning: false } : null;
        }
        if (action === 'resume') {
            updates.updateTimer = (prev: any) => prev ? { ...prev, isRunning: true } : null;
        }
        if (action === 'skip') {
            updates.updateWorkout = (prev: any) => {
                if (!prev) return null;
                const updatedExercises = [...prev.exercises];
                const currentIndex = updatedExercises.findIndex(e => !e.completed);
                if (currentIndex !== -1) {
                    updatedExercises[currentIndex].completed = true;
                }
                return { ...prev, exercises: updatedExercises };
            };
        }
        if (action === 'stop') {
            updates.updateTimer = () => null;
            updates.updateWorkout = () => null;
        }

        return updates;
    };

    return {
        handleTranscription,
        handleToolCall,
        handleActivityControl
    };
};
