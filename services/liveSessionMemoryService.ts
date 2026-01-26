/**
 * Live Session Memory Service
 * 
 * Handles mid-session memory extraction from voice transcriptions
 * and session summary generation when live mode ends.
 */

import { GoogleGenAI } from "@google/genai";
import { API_KEY, MODEL_FAST } from "../constants";
import { Message, MessageRole } from "../types";
import { storeMemory } from "./supabaseService";
import { generateEmbedding, classifyMemoryType } from "./embeddingService";

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface LiveTranscript {
    text: string;
    isUser: boolean;
    timestamp: number;
    isFinal: boolean;
}

export interface SessionSummary {
    userHighlights: string[];
    aiResponses: string[];
    activitiesCompleted: string[];
    memorableQuotes: string[];
    mood: 'positive' | 'neutral' | 'challenging' | 'unknown';
    duration: number; // minutes
}

export interface ExtractedMemory {
    content: string;
    type: 'conversation' | 'preference' | 'pattern' | 'achievement';
    importance: number;
    timestamp: number;
}

// ============================================================================
// MEMORY EXTRACTION PATTERNS
// ============================================================================

// Patterns that indicate meaningful content worth storing
const MEANINGFUL_PATTERNS = {
    goals: /goal|want|trying|aim|need|wish|hope|plan/i,
    preferences: /prefer|like|hate|love|favorite|enjoy|can't stand/i,
    habits: /usually|always|never|morning|evening|routine|habit/i,
    physical: /injury|pain|sore|tired|energy|strong|weak|flexible/i,
    achievements: /completed|finished|did|achieved|streak|personal best|PR/i,
    emotions: /feel|feeling|stressed|happy|anxious|motivated|frustrated|great/i,
    schedule: /busy|work|job|time|schedule|available|free/i,
    fitness: /weight|reps|sets|minutes|miles|steps|calories/i
};

// Patterns that should be ignored (too generic)
const IGNORE_PATTERNS = [
    /^(ok|okay|yes|no|sure|thanks|thank you|please|hello|hi|hey)$/i,
    /^(start|stop|pause|resume|skip|next|back)$/i,
    /^(\d+|one|two|three|four|five)$/i,
    /^\s*$/
];

// ============================================================================
// MID-SESSION MEMORY EXTRACTION
// ============================================================================

/**
 * Check if a transcript contains meaningful content worth storing.
 */
export function isMeaningfulContent(text: string): boolean {
    // Skip if too short
    if (text.length < 15) return false;

    // Skip if matches ignore patterns
    for (const pattern of IGNORE_PATTERNS) {
        if (pattern.test(text.trim())) return false;
    }

    // Check if matches any meaningful pattern
    for (const [key, pattern] of Object.entries(MEANINGFUL_PATTERNS)) {
        if (pattern.test(text)) return true;
    }

    return false;
}

/**
 * Classify the type and importance of extracted content.
 */
export function classifyContent(text: string): { type: ExtractedMemory['type']; importance: number } {
    let type: ExtractedMemory['type'] = 'conversation';
    let importance = 0.5;

    // Check for achievements (highest importance)
    if (MEANINGFUL_PATTERNS.achievements.test(text)) {
        type = 'achievement';
        importance = 0.9;
    }
    // Check for fitness/workout related - store as achievement
    else if (MEANINGFUL_PATTERNS.fitness.test(text) || MEANINGFUL_PATTERNS.physical.test(text)) {
        type = 'achievement';
        importance = 0.8;
    }
    // Check for preferences
    else if (MEANINGFUL_PATTERNS.preferences.test(text)) {
        type = 'preference';
        importance = 0.7;
    }
    // Check for patterns/habits
    else if (MEANINGFUL_PATTERNS.habits.test(text)) {
        type = 'pattern';
        importance = 0.7;
    }
    // Check for goals
    else if (MEANINGFUL_PATTERNS.goals.test(text)) {
        importance = 0.8;
    }
    // Check for emotions (important for psychological state)
    else if (MEANINGFUL_PATTERNS.emotions.test(text)) {
        importance = 0.6;
    }

    return { type, importance };
}

/**
 * Extract and store meaningful content from a live transcription.
 * Called in real-time as voice transcriptions come in.
 */
export async function extractFromTranscription(
    userId: string,
    transcript: LiveTranscript,
    contextHint?: string
): Promise<ExtractedMemory | null> {
    // Only process meaningful user messages
    if (!transcript.isUser || !transcript.isFinal) return null;
    if (!isMeaningfulContent(transcript.text)) return null;

    const { type, importance } = classifyContent(transcript.text);

    // Create memory content
    let content = transcript.text;
    if (contextHint) {
        content = `[During ${contextHint}] ${transcript.text}`;
    }

    // Generate embedding for semantic search
    const embedding = await generateEmbedding(content);

    // Store to database
    const result = await storeMemory(
        userId,
        type,
        content,
        embedding || undefined,
        importance
    );

    if (result) {
        console.log(`LiveMemory: Stored ${type} memory (importance: ${importance})`);
        return {
            content,
            type,
            importance,
            timestamp: transcript.timestamp
        };
    }

    return null;
}

// ============================================================================
// SESSION SUMMARY EXTRACTION
// ============================================================================

/**
 * Buffer for collecting transcripts during a live session.
 */
class TranscriptBuffer {
    private transcripts: LiveTranscript[] = [];
    private startTime: number = Date.now();

    add(transcript: LiveTranscript) {
        this.transcripts.push(transcript);
    }

    getAll(): LiveTranscript[] {
        return [...this.transcripts];
    }

    getUserMessages(): string[] {
        return this.transcripts
            .filter(t => t.isUser && t.text.length > 5)
            .map(t => t.text);
    }

    getAIMessages(): string[] {
        return this.transcripts
            .filter(t => !t.isUser && t.text.length > 10)
            .map(t => t.text);
    }

    getDuration(): number {
        if (this.transcripts.length === 0) return 0;
        const lastTime = this.transcripts[this.transcripts.length - 1].timestamp;
        return Math.floor((lastTime - this.startTime) / 60000);
    }

    clear() {
        this.transcripts = [];
        this.startTime = Date.now();
    }
}

// Singleton buffer for current session
let sessionBuffer = new TranscriptBuffer();

/**
 * Add a transcript to the current session buffer.
 */
export function bufferTranscript(transcript: LiveTranscript): void {
    sessionBuffer.add(transcript);
}

/**
 * Clear the session buffer (call when starting new session).
 */
export function clearSessionBuffer(): void {
    sessionBuffer.clear();
}

/**
 * Generate a summary of the live session using LLM.
 */
export async function generateSessionSummary(): Promise<SessionSummary | null> {
    const userMessages = sessionBuffer.getUserMessages();
    const aiMessages = sessionBuffer.getAIMessages();
    const duration = sessionBuffer.getDuration();

    if (userMessages.length < 2) {
        // Too few messages to summarize
        return null;
    }

    try {
        const prompt = `Analyze this voice conversation from a fitness/wellness app and extract key insights.

USER MESSAGES:
${userMessages.slice(-20).map((m, i) => `${i + 1}. "${m}"`).join('\n')}

AI RESPONSES:
${aiMessages.slice(-10).map((m, i) => `${i + 1}. "${m.substring(0, 100)}..."`).join('\n')}

Return a JSON object with:
{
  "userHighlights": ["key things user mentioned or accomplished"],
  "activitiesCompleted": ["workouts, exercises, or wellness activities done"],
  "memorableQuotes": ["notable things user said worth remembering"],
  "mood": "positive|neutral|challenging|unknown",
  "briefSummary": "1-2 sentence summary of the session"
}

Only include concrete, specific insights. Skip generic greetings.`;

        const result = await ai.models.generateContent({
            model: MODEL_FAST,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json' }
        });

        const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) return null;

        const parsed = JSON.parse(responseText);

        return {
            userHighlights: parsed.userHighlights || [],
            aiResponses: [parsed.briefSummary || ''],
            activitiesCompleted: parsed.activitiesCompleted || [],
            memorableQuotes: parsed.memorableQuotes || [],
            mood: parsed.mood || 'unknown',
            duration
        };
    } catch (e) {
        console.error('Failed to generate session summary:', e);
        return null;
    }
}

/**
 * Extract summary from live session and store to memory.
 * Call this when disconnecting from live mode.
 */
export async function extractAndStoreSessionSummary(userId: string): Promise<boolean> {
    const summary = await generateSessionSummary();

    if (!summary || (summary.userHighlights.length === 0 && summary.activitiesCompleted.length === 0)) {
        console.log('LiveMemory: No significant content to store from session');
        clearSessionBuffer();
        return false;
    }

    let storedCount = 0;

    // Store activities as achievement memories
    for (const activity of summary.activitiesCompleted) {
        const content = `[Voice Session] Completed: ${activity}`;
        const embedding = await generateEmbedding(content);
        const result = await storeMemory(userId, 'achievement', content, embedding || undefined, 0.9);
        if (result) storedCount++;
    }

    // Store memorable quotes as conversation memories
    for (const quote of summary.memorableQuotes) {
        const content = `[Voice Session] User said: "${quote}"`;
        const embedding = await generateEmbedding(content);
        const { type, importance } = classifyContent(quote);
        const result = await storeMemory(userId, type, content, embedding || undefined, importance);
        if (result) storedCount++;
    }

    // Store overall session summary
    if (summary.userHighlights.length > 0) {
        const summaryContent = `[Voice Session Summary - ${summary.duration}min] Mood: ${summary.mood}. Highlights: ${summary.userHighlights.join('; ')}`;
        const embedding = await generateEmbedding(summaryContent);
        const result = await storeMemory(userId, 'conversation', summaryContent, embedding || undefined, 0.7);
        if (result) storedCount++;
    }

    console.log(`LiveMemory: Stored ${storedCount} memories from voice session`);

    // Clear buffer after processing
    clearSessionBuffer();

    return storedCount > 0;
}

// ============================================================================
// REAL-TIME CONTEXT UPDATE
// ============================================================================

/**
 * Check if recent transcripts indicate a context change that needs refresh.
 */
export function detectContextChange(recentTranscripts: LiveTranscript[]): {
    needsRefresh: boolean;
    reason?: string;
} {
    const last5 = recentTranscripts.slice(-5);

    // Check for activity transitions
    const activityKeywords = ['finished', 'done', 'complete', 'start', 'begin', 'next', 'moving on'];
    for (const t of last5) {
        if (t.isUser) {
            for (const keyword of activityKeywords) {
                if (t.text.toLowerCase().includes(keyword)) {
                    return { needsRefresh: true, reason: `Activity transition detected: "${keyword}"` };
                }
            }
        }
    }

    // Check for mood changes
    const moodKeywords = ['tired', 'exhausted', 'energized', 'motivated', 'struggling', 'great'];
    for (const t of last5) {
        if (t.isUser) {
            for (const keyword of moodKeywords) {
                if (t.text.toLowerCase().includes(keyword)) {
                    return { needsRefresh: true, reason: `Mood indication: "${keyword}"` };
                }
            }
        }
    }

    return { needsRefresh: false };
}
