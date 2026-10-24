/** Scoped chat history; guest and different account records are never auto-migrated. */
import { useState, useEffect, useRef, useCallback } from 'react';
import { type Message, MessageRole } from '../types';
import { getMessages as getCloudMessages, type MessageRecord } from '../services/supabaseService';
import { getStorageItem, setStorageItem } from '../services/storageService';
import { messageHistoryKey, mergeMessageHistory } from '../services/messageHistory';
import { syncService } from '../services/syncService';
import { supabase, isSupabaseConfigured } from '../supabaseConfig';

interface UseMessagesOptions { supabaseUserId: string | null }
interface UseMessagesReturn {
  messages: Message[]; setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  addMessage: (message: Message) => void; clearMessages: () => Promise<void>; isInitialized: boolean;
}
function fromRecord(record: MessageRecord): Message {
  return { id: record.message_id, role: record.role as MessageRole, text: record.text, timestamp: record.timestamp,
    uiComponent: record.ui_component, groundingChunks: record.grounding_chunks,
    messageContext: record.message_context as Message['messageContext'], relatedWorkoutId: record.related_workout_id };
}

export function useMessages({ supabaseUserId }: UseMessagesOptions): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const savedIdsRef = useRef(new Set<string>());
  const loadedKeyRef = useRef<string | null>(null);
  const historyKey = messageHistoryKey(supabaseUserId);

  useEffect(() => {
    let active = true; loadedKeyRef.current = null; savedIdsRef.current.clear(); setIsInitialized(false);
    const stored = getStorageItem<Message[]>(historyKey, []);
    const local = Array.isArray(stored) ? stored : [];
    setMessages(local);
    const load = async () => {
      try {
        if (supabaseUserId) {
          const records = await getCloudMessages(supabaseUserId);
          if (!active) return;
          const cloud = records.filter(record => record.message_context !== 'workout_guidance').map(fromRecord);
          cloud.forEach(message => savedIdsRef.current.add(message.id));
          setMessages(current => mergeMessageHistory(current, cloud));
        }
      } catch (error) { console.warn('Could not load cloud messages; retaining local history', error); }
      if (active) { loadedKeyRef.current = historyKey; setIsInitialized(true); }
    };
    void load();
    return () => { active = false; };
  }, [supabaseUserId, historyKey]);

  useEffect(() => {
    if (!isInitialized || loadedKeyRef.current !== historyKey) return;
    const timer = setTimeout(() => {
      setStorageItem(historyKey, messages);
      if (!supabaseUserId) return;
      for (const message of messages) {
        if (savedIdsRef.current.has(message.id) || message.messageContext === 'workout_guidance') continue;
        try {
          syncService.scheduleOperation('SAVE_MESSAGE', { userId: supabaseUserId, message: {
            ...message, role: message.role,
          } });
          savedIdsRef.current.add(message.id);
        } catch (error) { console.warn('Could not persist pending message; retaining it locally', error); }
      }
    }, 500);
    const saveBeforeUnload = () => { setStorageItem(historyKey, messages); };
    window.addEventListener('beforeunload', saveBeforeUnload);
    return () => { clearTimeout(timer); window.removeEventListener('beforeunload', saveBeforeUnload); };
  }, [messages, supabaseUserId, historyKey, isInitialized]);

  useEffect(() => {
    if (!supabaseUserId || !isSupabaseConfigured) return;
    let active = true;
    const channel = supabase.channel(`messages:${supabaseUserId}`).on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'user_messages', filter: `user_id=eq.${supabaseUserId}`,
    }, payload => {
      const record = payload.new as MessageRecord;
      if (!active || record.message_context === 'workout_guidance') return;
      savedIdsRef.current.add(record.message_id);
      setMessages(current => mergeMessageHistory(current, [fromRecord(record)]));
    }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel).catch(console.error); };
  }, [supabaseUserId]);

  const addMessage = useCallback((message: Message) => setMessages(current => mergeMessageHistory(current, [message])), []);
  const clearMessages = useCallback(async () => {
    setMessages([]); savedIdsRef.current.clear(); setStorageItem(historyKey, []);
    if (supabaseUserId) syncService.scheduleOperation('DELETE_MESSAGES', { userId: supabaseUserId });
  }, [supabaseUserId, historyKey]);
  return { messages, setMessages, addMessage, clearMessages, isInitialized };
}
