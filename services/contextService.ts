
import { UserContext } from './geminiService';
import { getOnboardingState } from './supabaseService';
import { getFullUserContext, buildLifeContext } from './userContextService';
import { SYSTEM_INSTRUCTION, API_KEY, MODEL_FAST } from '../constants';
import { GoogleGenAI } from "@google/genai";
import { Message, MessageRole } from '../types';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Extension of UserContext for Live Mode
export interface UnifiedContext extends UserContext {
    voiceSessionActive: boolean;
    lastContextRefresh: number;
    pendingToolResults: any[]; // Placeholder for pending tool outputs
    conversationTurnCount: number; // Added for tracking refresh
    recentConversation?: { role: string; text: string }[]; // Added for Live Mode continuity
}

export interface ContextTiers {
    essential: EssentialContext;    // Never compressed, always included
    important: ImportantContext;    // Recent, included when space allows
    summarized: string;             // LLM-summarized history
}

type EssentialContext = Pick<UnifiedContext, 'userName' | 'isAuthenticated' | 'location' | 'time' | 'fitnessStats'>;
type ImportantContext = Pick<UnifiedContext, 'activeTimer' | 'currentWorkoutProgress' | 'onboardingState' | 'memoryContext'>;

// Context budget management
export const CONTEXT_BUDGET = {
    essential: 500,   // tokens - user identity, current activity
    important: 1000,  // tokens - recent messages, timer/workout state
    summarized: 500,  // tokens - compressed history
    total: 2000       // tokens - total budget for system instruction
};

// Refresh triggers
export const REFRESH_TRIGGERS = {
    turnCount: 10,        // Refresh after 10 conversation turns
    timeMinutes: 5,       // Refresh every 5 minutes
    activityChange: true  // Refresh when activity changes
} as const;

/**
 * Compresses the full context into a token-budget-aware string.
 */
export async function compressContext(
    fullContext: UnifiedContext,
    budget: number = CONTEXT_BUDGET.total
): Promise<string> {
    // 1. Always include essential context
    let output = formatEssentialContext(fullContext);

    // 2. Add important context if budget allows
    // (Simple estimation: 1 word ~= 1.3 tokens. 4 characters ~= 1 token)
    const importantText = formatImportantContext(fullContext);

    if (estimateTokens(output + importantText) <= budget) {
        output += importantText;
    } else {
        // If we can't fit all important context, we prioritize: active activity > onboarding > memory
        if (fullContext.activeTimer || fullContext.currentWorkoutProgress) {
            const activityText = formatActivityContext(fullContext);
            if (estimateTokens(output + activityText) <= budget) {
                output += activityText;
            }
        }
    }

    return output;
}

/**
 * Builds the complete system instruction string for Live Mode.
 * This combines the base SYSTEM_INSTRUCTION with dynamic user context.
 */
export function buildSystemContext(context: UnifiedContext, conversationHistory?: Message[]): string {
    let systemContext = SYSTEM_INSTRUCTION;

    // Add Essential Context
    systemContext += `\n\n=== CURRENT CONTEXT ===\nDate: ${context.date}\nTime: ${context.time}`;
    if (context.timezone) {
        systemContext += `\nTimezone: ${context.timezone} (UTC Offset: ${context.timezoneOffset} min)`;
    }
    if (context.location) {
        systemContext += `\nUser Location Lat/Lng: ${context.location.lat}, ${context.location.lng}`;
    }

    // Add Identity & Auth
    if (context.isAuthenticated && context.userName) {
        systemContext += `\n\n[USER IDENTITY]
User Name: ${context.userName}
Status: Authenticated
INSTRUCTION: Address user by name when appropriate. They have cross-session memory enabled.`;
    } else {
        systemContext += `\n\n[USER IDENTITY]
Status: Guest (Not signed in)
INSTRUCTION: Subtly encourage sign-in for personalization and progress tracking when relevant.`;
    }

    // Add Fitness Stats (Essential)
    if (context.fitnessStats) {
        systemContext += `\n\n[REAL-TIME FITNESS DATA DETECTED]
Steps Today: ${context.fitnessStats.steps} / ${context.fitnessStats.stepsGoal}
Calories Burned: ${context.fitnessStats.calories}
Active Minutes: ${context.fitnessStats.activeMinutes}
Health Data Source: ${context.fitnessStats.steps > 0 ? 'Connected' : 'Unavailable'}`;
    }

    // Add Detailed Important Context
    systemContext += formatImportantContext(context);

    // Adherence: suggested next action (same as text chat) for proactive nudge
    if (context.lifeContext?.suggestedNextAction) {
        systemContext += `\n\n[SUGGESTED NEXT ACTION] ${context.lifeContext.suggestedNextAction}\nINSTRUCTION: Use for a short proactive nudge when relevant (e.g. no movement today, streak). Deliver value first; never block action with questions.`;
    }

    return systemContext;
}

/**
 * Refreshes the context from Supabase and current local state.
 * @param userId - The user's ID
 * @param localOverrides - Current local state (timers, etc) that isn't in DB yet
 */
export async function refreshContext(
    userId: string | undefined,
    localOverrides: Partial<UnifiedContext> = {}
): Promise<UnifiedContext> {
    const now = new Date();

    // Default base context
    const baseContext: UnifiedContext = {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: now.getTimezoneOffset(),
        voiceSessionActive: true,
        lastContextRefresh: Date.now(),
        conversationTurnCount: 0,
        pendingToolResults: [],
        isAuthenticated: !!userId,
        ...localOverrides
    };

    if (!userId) {
        return baseContext;
    }

    try {
        // Fetch fresh state from Supabase
        const [fullContext, onboardingState, lifeContext] = await Promise.all([
            getFullUserContext(userId),
            getOnboardingState(userId),
            buildLifeContext(userId)
        ]);

        return {
            ...baseContext,
            // Merge Supabase context
            memoryContext: fullContext ? {
                goals: fullContext.goals,
                streaks: fullContext.streaks,
                recentWorkouts: fullContext.recentWorkouts,
                relevantMemories: fullContext.relevantMemories,
                upcomingEvents: fullContext.upcomingEvents
            } : undefined,
            // Merge Onboarding state
            onboardingState: onboardingState ? {
                stage: onboardingState.stage,
                profileCompleteness: onboardingState.profileCompleteness,
                psychologicalState: (onboardingState as any).psychologicalState || 'unknown', // Adjust type if needed
                canAskQuestion: true, // We'll assume true for refresh or recalc logic in App
                primaryMotivation: onboardingState.primaryMotivation || undefined,
                healthConditions: onboardingState.healthConditions,
                preferredWorkoutTime: onboardingState.preferredWorkoutTime || undefined,
                totalInteractions: onboardingState.totalInteractions
            } : undefined,
            lifeContext: lifeContext || undefined,
            userName: localOverrides.userName // Prefer local username if passed, or could rely on Supabase user profile fetch in App
        };
    } catch (e) {
        console.error("ContextService: Failed to refresh context", e);
        return baseContext;
    }
}

/**
 * Formats the UnifiedContext into an object suitable for Gemini Live API configuration.
 */
export function formatContextForLive(context: UnifiedContext): object {
    return {
        // Defines the tools and system instruction for the live session
        // Note: The actual Tool definitions are passed in the 'tools' array in useLiveSession
        // This function primarily focuses on data preparation if we need structured objects
        // For now, we return the instruction string to be used
        systemInstruction: buildSystemContext(context)
    };
}

/**
 * Summarizes conversation history using a fast model.
 */
export async function summarizeHistory(messages: Message[]): Promise<string> {
    if (messages.length === 0) return "";

    try {
        const result = await ai.models.generateContent({
            model: MODEL_FAST,
            contents: [{
                role: 'user',
                parts: [{
                    text: `Summarize this conversation for a fitness coach AI context. 
                           Focus on: goals mentioned, activities completed, mood/energy levels.
                           Max 100 words.
                           
                           ${messages.map(m => `${m.role}: ${m.text}`).join('\n')}`
                }]
            }]
        });
        return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
        console.error("ContextService: Summarization failed", e);
        return "";
    }
}

/**
 * Check if context needs refresh based on triggers.
 */
/**
 * Check if context needs refresh based on triggers.
 * Supports both signature styles for compatibility.
 */
export function shouldRefreshContext(
    arg1: UnifiedContext | number,
    arg2?: number,
    arg3: boolean = false
): boolean {
    if (typeof arg1 === 'object') {
        const ctx = arg1;
        return shouldRefreshContext(ctx.lastContextRefresh, ctx.conversationTurnCount);
    }

    const lastRefreshTime = arg1;
    const turnCountSinceRefresh = arg2 || 0;
    const forceRefresh = arg3;

    if (forceRefresh) return true;

    const now = Date.now();
    const minutesSinceRefresh = (now - lastRefreshTime) / 60000;

    // Time-based refresh
    if (minutesSinceRefresh >= REFRESH_TRIGGERS.timeMinutes) {
        return true;
    }

    // Turn-count based refresh
    if (turnCountSinceRefresh >= REFRESH_TRIGGERS.turnCount) {
        return true;
    }

    return false;
}

/**
 * Create a fresh context object with defaults.
 */
export function createEmptyContext(): UnifiedContext {
    const now = new Date();
    return {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: now.getTimezoneOffset(),
        isAuthenticated: false,
        voiceSessionActive: false,
        lastContextRefresh: Date.now(),
        conversationTurnCount: 0,
        pendingToolResults: []
    };
}

/**
 * Merge partial context updates into existing context.
 */
export function updateContext(
    existing: UnifiedContext,
    updates: Partial<UnifiedContext>
): UnifiedContext {
    return {
        ...existing,
        ...updates,
        // Update timestamp
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString()
    };
}

// --- Helpers ---

function formatEssentialContext(c: UnifiedContext): string {
    return `User: ${c.userName || 'Guest'} | Time: ${c.time}`;
}

function formatActivityContext(c: UnifiedContext): string {
    let text = "";
    if (c.activeTimer) {
        text += `\n[ACTIVE TIMER] ${c.activeTimer.label}: ${c.activeTimer.remainingSeconds}s remaining (Running: ${c.activeTimer.isRunning})`;
        text += `\n[GUIDANCE MODE ACTIVE] You are currently providing voice guidance for this timer. When you receive simple guidance cues (numbers, breathing instructions), speak them directly without conversational responses like "Let me check". Just say the cue immediately.`;
    }
    if (c.currentWorkoutProgress) {
        const p = c.currentWorkoutProgress;
        text += `\n[ACTIVE WORKOUT] ${p.title}: ${p.completedCount}/${p.totalExercises} completed.`;
        text += `\n[GUIDANCE MODE ACTIVE] You are currently providing voice guidance for this workout. When you receive simple guidance cues (numbers, exercise instructions), speak them directly without conversational responses. Just say the cue immediately.`;
    }
    return text;
}

function formatImportantContext(c: UnifiedContext): string {
    let text = formatActivityContext(c);

    // Onboarding
    if (c.onboardingState) {
        const os = c.onboardingState;
        text += `\n[ONBOARDING] Stage: ${os.stage} | Psych: ${os.psychologicalState}`;
    }

    // Memory (Goals & Streaks) - Enhanced for tool integration
    if (c.memoryContext) {
        const mc = c.memoryContext;
        if (mc.goals.length > 0) {
            text += `\n[GOALS] ${mc.goals.map(g => g.label).join(', ')}`;
        }
        if (mc.streaks.length > 0) {
            text += `\n[STREAKS] ${mc.streaks.map(s => `${s.habitType}: ${s.currentStreak}d (best: ${s.longestStreak}d)`).join(', ')}`;
            // Highlight milestone streaks for achievement badges
            mc.streaks.forEach(s => {
                if (s.currentStreak === 7 || s.currentStreak === 14 || s.currentStreak === 30) {
                    text += `\n[MILESTONE ALERT] ${s.habitType} streak at ${s.currentStreak} days - consider showing achievementBadge`;
                }
            });
        }
        if (mc.recentWorkouts && mc.recentWorkouts.length > 0) {
            const completedCount = mc.recentWorkouts.filter(w => w.completed).length;
            const totalCount = mc.recentWorkouts.length;
            text += `\n[RECENT WORKOUTS] ${completedCount}/${totalCount} completed in last 3 days`;
            // Suggest progress visualization if user has been active
            if (completedCount >= 2) {
                text += `\n[PROGRESS VISUALIZATION] User has ${completedCount} recent workouts - consider showing streakTimeline or habitHeatmap`;
            }
        }
        if (mc.relevantMemories && mc.relevantMemories.length > 0) {
            text += `\n[MEMORIES] ${mc.relevantMemories.slice(0, 2).map(m => `"${m}"`).join('; ')}`;
        }
    }

    return text;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
