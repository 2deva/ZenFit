/**
 * useMessages Hook
 * Manages message state, persistence, and synchronization with Supabase
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, MessageRole } from '../types';
import { getMessages as getSupabaseMessages, saveMessage, deleteAllMessages, MessageRecord } from '../services/supabaseService';

import { getMessages as getLocalMessages, setMessages as setLocalMessages } from '../services/storageService';
import { syncService } from '../services/syncService';
import { supabase, isSupabaseConfigured } from '../supabaseConfig';
import { STORAGE_KEYS } from '../constants/app';

interface UseMessagesOptions {
    supabaseUserId: string | null;
}

interface UseMessagesReturn {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    addMessage: (message: Message) => void;
    clearMessages: () => Promise<void>;
}

/**
 * Custom hook for managing messages with automatic persistence
 */
export const useMessages = ({ supabaseUserId }: UseMessagesOptions): UseMessagesReturn => {
    const [messages, setMessages] = useState<Message[]>([]);
    const savedMessageIdsRef = useRef<Set<string>>(new Set());
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load messages on mount
    useEffect(() => {
        const loadInitialMessages = async () => {
            // First, try to load from localStorage (for immediate display)
            const localMessages = getLocalMessages();
            if (localMessages.length > 0) {
                setMessages(localMessages);
                localMessages.forEach(m => savedMessageIdsRef.current.add(m.id));
            }

            // Then, if authenticated, load from Supabase
            if (supabaseUserId) {
                await loadMessagesFromSupabase();
            }
        };

        loadInitialMessages();
    }, []);

    // Load messages from Supabase when user ID changes
    useEffect(() => {
        if (supabaseUserId) {
            loadMessagesFromSupabase();
        }
    }, [supabaseUserId]);

    // Set up real-time subscription for cross-device sync
    useEffect(() => {
        if (!supabaseUserId || !isSupabaseConfigured) return;

        const channel = supabase
            .channel(`messages:${supabaseUserId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'user_messages',
                filter: `user_id=eq.${supabaseUserId}`
            }, (payload: any) => {
                const newRecord = payload.new;
                savedMessageIdsRef.current.add(newRecord.message_id);

                setMessages(prev => {
                    if (prev.some(m => m.id === newRecord.message_id)) return prev;
                    return [...prev, {
                        id: newRecord.message_id,
                        role: newRecord.role as MessageRole,
                        text: newRecord.text,
                        timestamp: newRecord.timestamp,
                        uiComponent: newRecord.ui_component,
                        groundingChunks: newRecord.grounding_chunks
                    }];
                });
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('Supabase realtime subscription error:', err.message);
                }
            });

        return () => {
            supabase.removeChannel(channel).catch(console.error);
        };
    }, [supabaseUserId]);

    // Auto-save messages with debouncing
    useEffect(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (messages.length > 0) {
                // Always save to localStorage
                setLocalMessages(messages);

                // Save to Supabase (via Sync Queue) if authenticated
                if (supabaseUserId) {
                    const latestMessage = messages[messages.length - 1];
                    if (!savedMessageIdsRef.current.has(latestMessage.id)) {
                        // Offline-First: Schedule operation
                        // Note: import syncService from ../services/syncService
                        // const { syncService } = await import('../services/syncService'); // Using static import
                        syncService.scheduleOperation('SAVE_MESSAGE', {
                            userId: supabaseUserId,
                            message: {
                                id: latestMessage.id,
                                role: latestMessage.role,
                                text: latestMessage.text,
                                timestamp: latestMessage.timestamp,
                                uiComponent: latestMessage.uiComponent,
                                groundingChunks: latestMessage.groundingChunks
                            }
                        });

                        savedMessageIdsRef.current.add(latestMessage.id);
                    }
                }
            }
        }, 500); // From constants: TIMING.MESSAGE_SAVE_DEBOUNCE

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [messages, supabaseUserId]);

    // Load messages from Supabase
    const loadMessagesFromSupabase = async () => {
        if (!supabaseUserId) return;

        try {
            const records = await getSupabaseMessages(supabaseUserId);
            const formattedMessages: Message[] = records.reverse().map(r => ({
                id: r.message_id,
                role: r.role as MessageRole,
                text: r.text,
                timestamp: r.timestamp,
                uiComponent: r.ui_component,
                groundingChunks: r.grounding_chunks
            }));

            formattedMessages.forEach(m => savedMessageIdsRef.current.add(m.id));

            // Smart merge: preserve local UI components if missing from cloud
            setMessages(prevLocal => {
                if (formattedMessages.length === 0) {
                    // No cloud messages, migrate local to cloud
                    migrateLocalToCloud(prevLocal);
                    return prevLocal;
                }

                return formattedMessages.map(cloudMsg => {
                    const localMsg = prevLocal.find(m => m.id === cloudMsg.id);
                    if (localMsg && localMsg.uiComponent && !cloudMsg.uiComponent) {
                        return { ...cloudMsg, uiComponent: localMsg.uiComponent };
                    }
                    return cloudMsg;
                });
            });
        } catch (error) {
            console.error('Failed to load messages from Supabase:', error);
        }
    };

    // Migrate local messages to Supabase
    const migrateLocalToCloud = async (localMessages: Message[]) => {
        if (!supabaseUserId) return;

        for (const msg of localMessages) {
            if (!savedMessageIdsRef.current.has(msg.id)) {
                await saveMessage(supabaseUserId, {
                    id: msg.id,
                    role: msg.role as MessageRole,
                    text: msg.text,
                    timestamp: msg.timestamp,
                    uiComponent: msg.uiComponent,
                    groundingChunks: msg.groundingChunks
                });
                savedMessageIdsRef.current.add(msg.id);
            }
        }

        // Clear localStorage after migration
        localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    };

    // Add a new message
    const addMessage = useCallback((message: Message) => {
        setMessages(prev => [...prev, message]);
    }, []);

    // Clear all messages
    const clearMessages = useCallback(async () => {
        setMessages([]);
        savedMessageIdsRef.current.clear();
        setLocalMessages([]);

        if (supabaseUserId) {
            // const { syncService } = await import('../services/syncService'); // Using static import
            syncService.scheduleOperation('DELETE_ALL_DATA', { userId: supabaseUserId });
        }
    }, [supabaseUserId]);

    return {
        messages,
        setMessages,
        addMessage,
        clearMessages
    };
};
