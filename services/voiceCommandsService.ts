/**
 * Voice Commands Service
 * 
 * Handles user voice command recognition and execution during Live Mode.
 * Provides hands-free control for activities like pause, resume, skip, etc.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface VoiceCommand {
    triggers: string[];           // Phrases that activate this command
    action: string;               // Internal action identifier
    requiresConfirmation: boolean; // Whether to confirm before executing
    response: string;             // What Zen says in response (empty = dynamic)
}

export interface ActivityPaceState {
    basePace: 'slow' | 'normal' | 'fast';
    currentMultiplier: number;  // 0.5 to 2.0
    isPaused: boolean;
    pausedAt?: number;
    pauseDuration?: number;     // Total time spent paused
}

export interface VoiceCommandResult {
    command: VoiceCommand | null;
    action: string | null;
    response: string | null;
    requiresConfirmation: boolean;
}

// ============================================================================
// VOICE COMMANDS REGISTRY
// ============================================================================

export const VOICE_COMMANDS: VoiceCommand[] = [
    // ── PACING CONTROLS ──────────────────────────────────────────────────────
    {
        triggers: ['pause', 'hold on', 'wait', 'stop', 'one moment', 'hold'],
        action: 'PAUSE_ACTIVITY',
        requiresConfirmation: false,
        response: "Pausing. Say 'continue' or 'resume' when you're ready."
    },
    {
        triggers: ['resume', 'continue', 'go', "let's go", 'start again', 'ready', 'unpause'],
        action: 'RESUME_ACTIVITY',
        requiresConfirmation: false,
        response: "Resuming in 3... 2... 1..."
    },
    {
        triggers: ['repeat', 'say that again', 'what was that', 'one more time', 'again'],
        action: 'REPEAT_LAST',
        requiresConfirmation: false,
        response: "" // Will repeat last guidance cue
    },
    {
        triggers: ['slow down', 'slower', 'too fast', 'go slower'],
        action: 'SLOW_PACE',
        requiresConfirmation: false,
        response: "Slowing the pace. Let me know if this feels better."
    },
    {
        triggers: ['speed up', 'faster', 'too slow', 'go faster', 'quicker'],
        action: 'SPEED_PACE',
        requiresConfirmation: false,
        response: "Picking up the pace."
    },

    // ── NAVIGATION CONTROLS ──────────────────────────────────────────────────
    {
        triggers: ['skip', 'next', 'skip this', 'next exercise', 'next one'],
        action: 'SKIP_CURRENT',
        requiresConfirmation: false,
        response: "Skipping to the next exercise."
    },
    {
        triggers: ['go back', 'previous', 'repeat last exercise', 'back', 'redo'],
        action: 'GO_BACK',
        requiresConfirmation: false,
        response: "Going back to the previous exercise."
    },
    {
        triggers: ['restart', 'start over', 'begin again', 'from the top'],
        action: 'RESTART_ACTIVITY',
        requiresConfirmation: true,
        response: "Restart the workout from the beginning? Say 'yes' to confirm."
    },

    // ── INFORMATION REQUESTS ─────────────────────────────────────────────────
    {
        triggers: ['how much time', 'how long', 'time left', 'remaining', 'time remaining'],
        action: 'TIME_CHECK',
        requiresConfirmation: false,
        response: "" // Will announce remaining time dynamically
    },
    {
        triggers: ['what exercise', 'which one', "what's next", 'current exercise', 'where am i'],
        action: 'CURRENT_STATUS',
        requiresConfirmation: false,
        response: "" // Will announce current/next exercise dynamically
    },
    {
        triggers: ['how many left', 'exercises left', 'remaining exercises'],
        action: 'EXERCISES_REMAINING',
        requiresConfirmation: false,
        response: "" // Will announce remaining exercise count
    },

    // ── REP CONFIRMATION (ADAPTIVE PACING) ────────────────────────────────────
    {
        triggers: ['rep', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
        action: 'CONFIRM_REP',
        requiresConfirmation: false,
        response: "" // Just counts the rep silently
    },
    {
        triggers: ['done', 'finished', 'complete', 'that was the last one', 'all done'],
        action: 'COMPLETE_EXERCISE',
        requiresConfirmation: false,
        response: "Great job! Moving on."
    },

    // ── SESSION CONTROLS ─────────────────────────────────────────────────────
    {
        triggers: ['stop workout', 'end session', "i'm done", 'finish', 'end workout', 'quit'],
        action: 'END_SESSION',
        requiresConfirmation: true,
        response: "Are you sure you want to end the session? Say 'yes' to confirm or 'no' to continue."
    },
    {
        triggers: ['yes', 'confirm', 'do it', 'yeah', 'yep', 'sure'],
        action: 'CONFIRM',
        requiresConfirmation: false,
        response: "" // Confirmation of pending action
    },
    {
        triggers: ['no', 'cancel', 'never mind', 'nope', 'keep going'],
        action: 'CANCEL',
        requiresConfirmation: false,
        response: "Alright, continuing."
    },

    // ── HELP & GUIDANCE ──────────────────────────────────────────────────────
    {
        triggers: ['help', 'what can i say', 'commands', 'voice commands'],
        action: 'SHOW_HELP',
        requiresConfirmation: false,
        response: "You can say: pause, resume, skip, go back, slower, faster, time left, or end session."
    },
    {
        triggers: ['mute', 'quiet', 'be quiet', 'silence'],
        action: 'MUTE_GUIDANCE',
        requiresConfirmation: false,
        response: "Muting guidance. Say 'unmute' when you want me again."
    },
    {
        triggers: ['unmute', 'speak', 'talk', 'guide me'],
        action: 'UNMUTE_GUIDANCE',
        requiresConfirmation: false,
        response: "I'm back. Let's continue."
    }
];

// ============================================================================
// COMMAND PROCESSING
// ============================================================================

import { SelectionOption, SelectionResult } from '../types';

/**
 * Process a voice transcript to detect commands.
 * Returns the matched command or null if no match.
 */
export function processVoiceCommand(transcript: string): VoiceCommandResult {
    const normalizedText = transcript.toLowerCase().trim();

    // Check each command's triggers
    for (const command of VOICE_COMMANDS) {
        for (const trigger of command.triggers) {
            // Match trigger at word boundaries to avoid false positives
            // e.g., "stop" shouldn't match "stopwatch"
            const regex = new RegExp(`\\b${escapeRegex(trigger)}\\b`, 'i');
            if (regex.test(normalizedText)) {
                return {
                    command,
                    action: command.action,
                    response: command.response || null,
                    requiresConfirmation: command.requiresConfirmation
                };
            }
        }
    }

    return {
        command: null,
        action: null,
        response: null,
        requiresConfirmation: false
    };
}

/**
 * Process a voice transcript to select an option from a list.
 * Supports ordinal ("first", "option 1") and label matching (fuzzy/synonyms).
 */
export function processSelection(transcript: string, options: SelectionOption[]): SelectionResult | null {
    const text = transcript.toLowerCase().trim();

    // 1. Ordinal Matching
    const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
    const numberMatch = text.match(/\b(option|number|#)?\s*(\d+)\b/);

    if (numberMatch && numberMatch[2]) {
        const index = parseInt(numberMatch[2], 10) - 1;
        if (index >= 0 && index < options.length) {
            return { selectedId: options[index].id, confidence: 'high' };
        }
    }

    for (let i = 0; i < ordinals.length; i++) {
        if (text.includes(ordinals[i]) && i < options.length) {
            return { selectedId: options[i].id, confidence: 'high' };
        }
    }

    // 2. Exact & Substring Label Matching
    for (const option of options) {
        const label = option.label.toLowerCase();
        if (text === label || text.includes(label)) {
            return { selectedId: option.id, confidence: 'high' };
        }
    }

    // 3. Synonym/Fuzzy Matching (Simple implementation)
    // In a real app, use Levenshtein distance or more robust NLP
    for (const option of options) {
        // Check provided synonyms
        if (option.synonyms) {
            for (const synonym of option.synonyms) {
                if (text.includes(synonym.toLowerCase())) {
                    return { selectedId: option.id, confidence: 'high' };
                }
            }
        }

        // Split label into significant words and check overlap
        const significantWords = option.label.toLowerCase().split(' ').filter(w => w.length > 3);
        let matches = 0;
        for (const word of significantWords) {
            if (text.includes(word)) matches++;
        }

        if (matches > 0 && matches >= significantWords.length / 2) {
            // Partial match found
            return { selectedId: option.id, confidence: 'medium', requiresConfirmation: true };
        }
    }

    return null; // No match found
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// PACE MANAGEMENT
// ============================================================================

/**
 * Create initial pace state.
 */
export function createPaceState(basePace: 'slow' | 'normal' | 'fast' = 'normal'): ActivityPaceState {
    const multipliers = { slow: 1.5, normal: 1.0, fast: 0.75 };
    return {
        basePace,
        currentMultiplier: multipliers[basePace],
        isPaused: false,
        pauseDuration: 0
    };
}

/**
 * Adjust pace based on voice command.
 */
export function adjustPace(
    state: ActivityPaceState,
    action: 'SLOW_PACE' | 'SPEED_PACE' | 'RESET_PACE'
): ActivityPaceState {
    const PACE_STEP = 0.25;
    const MIN_MULTIPLIER = 0.5;
    const MAX_MULTIPLIER = 2.0;

    switch (action) {
        case 'SLOW_PACE':
            return {
                ...state,
                currentMultiplier: Math.min(state.currentMultiplier + PACE_STEP, MAX_MULTIPLIER)
            };
        case 'SPEED_PACE':
            return {
                ...state,
                currentMultiplier: Math.max(state.currentMultiplier - PACE_STEP, MIN_MULTIPLIER)
            };
        case 'RESET_PACE':
            const multipliers = { slow: 1.5, normal: 1.0, fast: 0.75 };
            return {
                ...state,
                currentMultiplier: multipliers[state.basePace]
            };
        default:
            return state;
    }
}

/**
 * Pause the activity.
 */
export function pauseActivity(state: ActivityPaceState): ActivityPaceState {
    if (state.isPaused) return state;

    return {
        ...state,
        isPaused: true,
        pausedAt: Date.now()
    };
}

/**
 * Resume the activity.
 */
export function resumeActivity(state: ActivityPaceState): ActivityPaceState {
    if (!state.isPaused) return state;

    const pausedDuration = state.pausedAt ? Date.now() - state.pausedAt : 0;

    return {
        ...state,
        isPaused: false,
        pausedAt: undefined,
        pauseDuration: (state.pauseDuration || 0) + pausedDuration
    };
}

// ============================================================================
// DYNAMIC RESPONSE GENERATION
// ============================================================================

interface ActivityStatus {
    currentExercise?: string;
    currentExerciseIndex?: number;
    totalExercises?: number;
    remainingTime?: number;      // seconds
    elapsedTime?: number;        // seconds
    completedCount?: number;
}

/**
 * Generate dynamic response for status/time queries.
 */
export function generateDynamicResponse(
    action: string,
    status: ActivityStatus
): string {
    switch (action) {
        case 'TIME_CHECK':
            if (status.remainingTime !== undefined) {
                const mins = Math.floor(status.remainingTime / 60);
                const secs = status.remainingTime % 60;
                if (mins > 0) {
                    return `About ${mins} minute${mins > 1 ? 's' : ''} and ${secs} seconds remaining.`;
                }
                return `${secs} seconds remaining.`;
            }
            if (status.elapsedTime !== undefined) {
                const mins = Math.floor(status.elapsedTime / 60);
                return `You've been going for ${mins} minute${mins > 1 ? 's' : ''}.`;
            }
            return "I'm not sure about the time right now.";

        case 'CURRENT_STATUS':
            if (status.currentExercise && status.totalExercises) {
                return `You're on ${status.currentExercise}, exercise ${(status.currentExerciseIndex || 0) + 1} of ${status.totalExercises}.`;
            }
            return "I'm not tracking a specific exercise right now.";

        case 'EXERCISES_REMAINING':
            if (status.totalExercises && status.completedCount !== undefined) {
                const remaining = status.totalExercises - status.completedCount;
                return `${remaining} exercise${remaining !== 1 ? 's' : ''} left to go.`;
            }
            return "I'm not tracking exercise count right now.";

        default:
            return "";
    }
}

// ============================================================================
// CONFIRMATION HANDLING
// ============================================================================

interface PendingConfirmation {
    action: string;
    createdAt: number;
    expiresAt: number;
}

const CONFIRMATION_TIMEOUT_MS = 10000; // 10 seconds to confirm

let pendingConfirmation: PendingConfirmation | null = null;

/**
 * Set a pending confirmation.
 */
export function setPendingConfirmation(action: string): void {
    pendingConfirmation = {
        action,
        createdAt: Date.now(),
        expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS
    };
}

/**
 * Get and clear pending confirmation if valid.
 */
export function consumeConfirmation(): string | null {
    if (!pendingConfirmation) return null;

    if (Date.now() > pendingConfirmation.expiresAt) {
        pendingConfirmation = null;
        return null;
    }

    const action = pendingConfirmation.action;
    pendingConfirmation = null;
    return action;
}

/**
 * Clear pending confirmation.
 */
export function clearPendingConfirmation(): void {
    pendingConfirmation = null;
}

/**
 * Check if there's a pending confirmation.
 */
export function hasPendingConfirmation(): boolean {
    if (!pendingConfirmation) return false;
    if (Date.now() > pendingConfirmation.expiresAt) {
        pendingConfirmation = null;
        return false;
    }
    return true;
}
