import { supabase } from '../../supabaseConfig';
import type { UserMemory, ScheduledEvent } from './types';

export const storeMemory = async (
    userId: string,
    memoryType: 'conversation' | 'preference' | 'pattern' | 'achievement',
    content: string,
    embedding?: number[],
    importanceScore = 0.5
): Promise<UserMemory | null> => {
    try {
        const { data, error } = await supabase
            .from('user_memories')
            .insert({
                user_id: userId,
                memory_type: memoryType,
                content,
                embedding,
                importance_score: importanceScore
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (e) {
        console.error('Error storing memory:', e);
        return null;
    }
};

export const searchMemories = async (
    userId: string,
    queryEmbedding: number[],
    matchCount = 3,
    matchThreshold = 0.7
): Promise<{ id: string; content: string; similarity: number }[]> => {
    try {
        const { data, error } = await supabase
            .rpc('match_memories', {
                query_embedding: queryEmbedding,
                match_threshold: matchThreshold,
                match_count: matchCount,
                p_user_id: userId
            });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error searching memories:', e);
        return [];
    }
};

export const getRecentMemories = async (userId: string, limit = 5): Promise<UserMemory[]> => {
    try {
        const { data, error } = await supabase
            .from('user_memories')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting memories:', e);
        return [];
    }
};

// ============================================
// SCHEDULED EVENTS (Calendar Integration)
// ============================================

export const createScheduledEvent = async (
    userId: string,
    event: {
        eventType: string;
        title: string;
        scheduledAt: string;
        googleEventId?: string;
    }
): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('scheduled_events')
            .insert({
                user_id: userId,
                event_type: event.eventType,
                title: event.title,
                scheduled_at: event.scheduledAt,
                google_event_id: event.googleEventId
            });

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error creating event:', e);
        return false;
    }
};

export const getUpcomingEvents = async (userId: string, limit = 5) => {
    try {
        const { data, error } = await supabase
            .from('scheduled_events')
            .select('*')
            .eq('user_id', userId)
            .eq('completed', false)
            .gte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting events:', e);
        return [];
    }
};



// ============================================
// MESSAGE SYNC (Cross-Device)
// ============================================

