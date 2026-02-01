// Embedding Service for Semantic Memory (Tier 3)
// Uses Gemini text-embedding-004 for generating embeddings

import { storeMemory, searchMemories } from "./supabaseService";
import { supabase } from "../supabaseConfig";
import { ai } from "./opikGemini";
const EMBEDDING_MODEL = "text-embedding-004";

/**
 * Generate embedding vector for a text using Gemini's embedding model
 */
export const generateEmbedding = async (text: string): Promise<number[] | null> => {
    try {
        const result = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
        });

        return result.embeddings?.[0]?.values || null;
    } catch (e) {
        console.error("Error generating embedding:", e);
        return null;
    }
};

/**
 * Extract important context from a message and store as semantic memory
 * Only stores messages that contain meaningful, personal information
 */
export const extractAndStoreSummary = async (
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<boolean> => {
    // Filter: Only store if message contains meaningful personal context
    const meaningfulPatterns = [
        /goal|want|trying|prefer|like|hate|love|struggle/i,
        /morning|evening|afternoon|usually|always|never/i,
        /work|job|busy|tired|energy|motivated/i,
        /injury|pain|can't|difficult|challenge/i,
        /weight|strength|cardio|flexibility|mobility/i,
        /\d+ (min|minute|hour|day|week|month)/i,
    ];

    const isMeaningful = meaningfulPatterns.some((pattern) => pattern.test(userMessage));

    if (!isMeaningful) {
        return false;
    }

    // Create a summary combining user query and AI insight
    const summary = `User said: "${userMessage.substring(0, 200)}". Context: ${aiResponse.substring(0, 100)}`;

    // Generate embedding for the summary
    const embedding = await generateEmbedding(summary);

    if (!embedding) {
        console.warn("Could not generate embedding, storing without vector");
    }

    // Store in user_memories table
    const result = await storeMemory(
        userId,
        "conversation",
        summary,
        embedding || undefined,
        0.7 // Default importance score
    );

    return result !== null;
};

/**
 * Search for relevant memories based on a query
 */
export const findRelevantMemories = async (
    userId: string,
    query: string,
    limit: number = 3
): Promise<string[]> => {
    const embedding = await generateEmbedding(query);

    if (!embedding) {
        return [];
    }

    const results = await searchMemories(userId, embedding, limit, 0.6);
    return results.map((r) => r.content);
};

/**
 * Determine memory type based on message content
 */
export const classifyMemoryType = (
    message: string
): "conversation" | "preference" | "pattern" | "achievement" => {
    if (/completed|finished|achieved|hit|reached|streak/i.test(message)) {
        return "achievement";
    }
    if (/prefer|like|hate|love|favorite|always|never/i.test(message)) {
        return "preference";
    }
    if (/usually|often|sometimes|routine|habit/i.test(message)) {
        return "pattern";
    }
    return "conversation";
};
