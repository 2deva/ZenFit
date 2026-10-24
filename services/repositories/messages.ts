import { supabase } from '../../supabaseConfig';


export interface MessageRecord {
    id: string;
    user_id: string;
    message_id: string;
    role: string;
    text: string;
    timestamp: number;
    ui_component: any | null;
    grounding_chunks: any | null;
    // Optional columns (may not exist in all deployments)
    message_context?: string | null;
    related_workout_id?: string | null;
    created_at: string;
}

export const saveMessage = async (
    userId: string,
    message: {
        id: string;
        role: string;
        text: string;
        timestamp: number;
        uiComponent?: any;
        groundingChunks?: any[];
        messageContext?: string;
        relatedWorkoutId?: string;
    }
): Promise<boolean> => {
    try {
        const basePayload: any = {
            user_id: userId,
            message_id: message.id,
            role: message.role,
            text: message.text,
            timestamp: message.timestamp,
            ui_component: message.uiComponent || null,
            grounding_chunks: message.groundingChunks || null
        };

        // Try to persist guidance routing metadata if columns exist.
        // If the database hasn't been migrated yet, fall back without failing.
        const payloadWithContext: any = {
            ...basePayload,
            message_context: message.messageContext,
            related_workout_id: message.relatedWorkoutId
        };

        const attemptInsert = async (payload: any) => {
            const { error } = await supabase.from('user_messages').insert(payload);
            return error;
        };

        const err = await attemptInsert(payloadWithContext);
        if (err) {
            const msg = (err as any)?.message || '';
            // Postgres schema mismatch → retry without new fields.
            if (/column .* does not exist/i.test(msg) || /message_context|related_workout_id/i.test(msg)) {
                const err2 = await attemptInsert(basePayload);
                if (err2) throw err2;
            } else {
                throw err;
            }
        }
        return true;
    } catch (e) {
        console.error('Error saving message:', e);
        return false;
    }
};

export const getMessages = async (userId: string, limit = 100): Promise<MessageRecord[]> => {
    try {
        const { data, error } = await supabase
            .from('user_messages')
            .select('*')
            .eq('user_id', userId)
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Error getting messages:', e);
        return [];
    }
};

export const deleteAllMessages = async (userId: string): Promise<boolean> => {
    try {
        const { error } = await supabase
            .from('user_messages')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;
        return true;
    } catch (e) {
        console.error('Error deleting messages:', e);
        return false;
    }
};

// ============================================
// PSYCHOLOGY-FIRST ONBOARDING
// ============================================

