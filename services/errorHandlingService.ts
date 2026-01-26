/**
 * Error Handling Service for Live Mode
 * 
 * Provides graceful error recovery, clarification dialogs,
 * and audio quality detection for voice interactions.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type ErrorType =
    | 'UNCLEAR_INPUT'
    | 'CONTEXT_STALE'
    | 'CONNECTION_LOST'
    | 'STATE_DESYNC'
    | 'AMBIGUOUS_COMMAND'
    | 'TOOL_FAILURE'
    | 'AUDIO_QUALITY';

export interface ErrorRecovery {
    type: ErrorType;
    detection: string;
    fallback: string;
    userMessage: string;
    shouldPause: boolean;
}

export interface AudioQualityState {
    averageVolume: number;       // 0-1 scale
    noiseLevel: number;          // Background noise estimate 0-1
    dropoutCount: number;        // Audio gaps detected
    lastClearInput: number;      // Timestamp of last clear transcription
    sampleCount: number;         // Number of samples analyzed
}

export interface ClarificationState {
    attemptCount: number;
    maxAttempts: number;
    lastPrompt: string;
    originalContext: string;
}

// ============================================================================
// ERROR RECOVERY DEFINITIONS
// ============================================================================

export const ERROR_RECOVERY: ErrorRecovery[] = [
    {
        type: 'UNCLEAR_INPUT',
        detection: 'Low transcription confidence or very short input',
        fallback: 'Request clarification with options',
        userMessage: "I didn't quite catch that. Did you want to pause, skip, or continue?",
        shouldPause: false
    },
    {
        type: 'CONTEXT_STALE',
        detection: 'Session exceeded time limit or too many turns without refresh',
        fallback: 'Summarize and re-anchor',
        userMessage: "Let me catch up — I'll summarize where we are.",
        shouldPause: true
    },
    {
        type: 'CONNECTION_LOST',
        detection: 'WebSocket close or timeout',
        fallback: 'Auto-reconnect with session resumption',
        userMessage: "Connection interrupted. Reconnecting... Your progress is saved.",
        shouldPause: true
    },
    {
        type: 'STATE_DESYNC',
        detection: "User mentions exercise that doesn't match current state",
        fallback: 'Confirm current state',
        userMessage: "I want to make sure I'm with you. Which exercise are you on?",
        shouldPause: false
    },
    {
        type: 'AMBIGUOUS_COMMAND',
        detection: 'Multiple commands detected or conflicting intent',
        fallback: 'Offer choices',
        userMessage: "I heard a few things there. Did you want to pause or skip?",
        shouldPause: false
    },
    {
        type: 'TOOL_FAILURE',
        detection: 'UI tool call failed or returned error',
        fallback: 'Verbal description instead of UI',
        userMessage: "", // Dynamic based on what failed
        shouldPause: false
    },
    {
        type: 'AUDIO_QUALITY',
        detection: 'High noise or frequent dropouts',
        fallback: 'Simplify interactions',
        userMessage: "There's some background noise. I'll keep my responses brief.",
        shouldPause: false
    }
];

// ============================================================================
// SAFE DEFAULTS
// ============================================================================

export const SAFE_DEFAULTS = {
    onUnknownCommand: 'continue_activity' as const,  // Don't stop, keep going
    onTranscriptionFail: 'pause_and_ask' as const,   // Pause and wait for retry
    onContextLoss: 'summarize_and_continue' as const, // Re-anchor with summary
    onToolFail: 'verbal_fallback' as const           // Describe instead of render
};

// ============================================================================
// CLARIFICATION DIALOG PATTERNS
// ============================================================================

interface ClarificationPattern {
    attempt: number;
    prompt: string;
    style: 'open' | 'choices' | 'binary' | 'default';
}

const CLARIFICATION_PATTERNS: ClarificationPattern[] = [
    {
        attempt: 1,
        prompt: "I didn't catch that. What would you like to do?",
        style: 'open'
    },
    {
        attempt: 2,
        prompt: "Sorry, I'm still not getting it. Say 'continue' to keep going, or 'stop' to end.",
        style: 'binary'
    },
    {
        attempt: 3,
        prompt: "I'll pause here. When you're ready, say 'resume' to continue your workout.",
        style: 'default'
    }
];

/**
 * Create initial clarification state.
 */
export function createClarificationState(originalContext: string = ''): ClarificationState {
    return {
        attemptCount: 0,
        maxAttempts: CLARIFICATION_PATTERNS.length,
        lastPrompt: '',
        originalContext
    };
}

/**
 * Get the next clarification prompt.
 */
export function getNextClarification(state: ClarificationState): {
    prompt: string;
    shouldPause: boolean;
    isExhausted: boolean;
} {
    const nextAttempt = state.attemptCount + 1;

    if (nextAttempt > state.maxAttempts) {
        return {
            prompt: CLARIFICATION_PATTERNS[state.maxAttempts - 1].prompt,
            shouldPause: true,
            isExhausted: true
        };
    }

    const pattern = CLARIFICATION_PATTERNS.find(p => p.attempt === nextAttempt)
        || CLARIFICATION_PATTERNS[0];

    return {
        prompt: pattern.prompt,
        shouldPause: pattern.style === 'default',
        isExhausted: nextAttempt >= state.maxAttempts
    };
}

/**
 * Increment clarification attempt.
 */
export function incrementClarification(state: ClarificationState, prompt: string): ClarificationState {
    return {
        ...state,
        attemptCount: state.attemptCount + 1,
        lastPrompt: prompt
    };
}

/**
 * Reset clarification state after successful understanding.
 */
export function resetClarification(state: ClarificationState): ClarificationState {
    return {
        ...state,
        attemptCount: 0,
        lastPrompt: ''
    };
}

// ============================================================================
// AUDIO QUALITY ANALYSIS
// ============================================================================

/**
 * Create initial audio quality state.
 */
export function createAudioQualityState(): AudioQualityState {
    return {
        averageVolume: 0,
        noiseLevel: 0,
        dropoutCount: 0,
        lastClearInput: Date.now(),
        sampleCount: 0
    };
}

/**
 * Analyze audio samples and update quality metrics.
 */
export function analyzeAudioQuality(
    state: AudioQualityState,
    samples: Float32Array
): AudioQualityState {
    if (samples.length === 0) {
        return {
            ...state,
            dropoutCount: state.dropoutCount + 1
        };
    }

    // Calculate RMS (Root Mean Square) for volume
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);

    // Update running average
    const newSampleCount = state.sampleCount + 1;
    const weight = 1 / Math.min(newSampleCount, 10); // Smooth over last 10 samples
    const newAvgVolume = state.averageVolume * (1 - weight) + rms * weight;

    // Estimate noise level (simplistic: high variance = noise)
    let variance = 0;
    for (let i = 0; i < samples.length; i++) {
        const diff = samples[i] - (sumSquares / samples.length);
        variance += diff * diff;
    }
    const noiseEstimate = Math.min(1, Math.sqrt(variance / samples.length) * 10);
    const newNoiseLevel = state.noiseLevel * (1 - weight) + noiseEstimate * weight;

    // Detect dropout (very low volume)
    const isDropout = rms < 0.01;

    return {
        averageVolume: newAvgVolume,
        noiseLevel: newNoiseLevel,
        dropoutCount: isDropout ? state.dropoutCount + 1 : state.dropoutCount,
        lastClearInput: isDropout ? state.lastClearInput : Date.now(),
        sampleCount: newSampleCount
    };
}

/**
 * Check if audio quality requires adaptation.
 */
export function shouldAdaptToAudioQuality(state: AudioQualityState): {
    shouldAdapt: boolean;
    reason: 'noise' | 'dropouts' | 'volume' | null;
    recommendation: string;
} {
    // High noise environment
    if (state.noiseLevel > 0.5) {
        return {
            shouldAdapt: true,
            reason: 'noise',
            recommendation: 'Use brief responses and clear enunciation'
        };
    }

    // Frequent dropouts
    if (state.dropoutCount > 3 && state.sampleCount > 10) {
        return {
            shouldAdapt: true,
            reason: 'dropouts',
            recommendation: 'Simplify interactions, wait longer for responses'
        };
    }

    // Very low volume
    if (state.averageVolume < 0.05 && state.sampleCount > 5) {
        return {
            shouldAdapt: true,
            reason: 'volume',
            recommendation: 'Speak louder or move closer to mic'
        };
    }

    return {
        shouldAdapt: false,
        reason: null,
        recommendation: ''
    };
}

// ============================================================================
// ERROR DETECTION
// ============================================================================

/**
 * Detect error type from various signals.
 */
export function detectError(signals: {
    transcriptLength?: number;
    transcriptConfidence?: number;
    turnsSinceRefresh?: number;
    connectionState?: 'connected' | 'disconnected' | 'reconnecting';
    expectedExercise?: string;
    mentionedExercise?: string;
    commandCount?: number;
    toolCallSuccess?: boolean;
    audioQuality?: AudioQualityState;
}): ErrorType | null {
    // Connection issues
    if (signals.connectionState === 'disconnected' || signals.connectionState === 'reconnecting') {
        return 'CONNECTION_LOST';
    }

    // Very short or no transcript
    if (signals.transcriptLength !== undefined && signals.transcriptLength < 3) {
        return 'UNCLEAR_INPUT';
    }

    // Low confidence (if available)
    if (signals.transcriptConfidence !== undefined && signals.transcriptConfidence < 0.5) {
        return 'UNCLEAR_INPUT';
    }

    // Context staleness
    if (signals.turnsSinceRefresh !== undefined && signals.turnsSinceRefresh > 15) {
        return 'CONTEXT_STALE';
    }

    // Exercise mismatch
    if (signals.expectedExercise && signals.mentionedExercise &&
        signals.expectedExercise.toLowerCase() !== signals.mentionedExercise.toLowerCase()) {
        return 'STATE_DESYNC';
    }

    // Multiple commands
    if (signals.commandCount !== undefined && signals.commandCount > 1) {
        return 'AMBIGUOUS_COMMAND';
    }

    // Tool failure
    if (signals.toolCallSuccess === false) {
        return 'TOOL_FAILURE';
    }

    // Audio quality issues
    if (signals.audioQuality) {
        const quality = shouldAdaptToAudioQuality(signals.audioQuality);
        if (quality.shouldAdapt) {
            return 'AUDIO_QUALITY';
        }
    }

    return null;
}

/**
 * Get recovery strategy for error type.
 */
export function getRecoveryStrategy(errorType: ErrorType): ErrorRecovery {
    return ERROR_RECOVERY.find(e => e.type === errorType) || ERROR_RECOVERY[0];
}

// ============================================================================
// VERBAL FALLBACKS
// ============================================================================

/**
 * Generate verbal description for failed UI tool call.
 */
export function generateVerbalFallback(toolName: string, args: any): string {
    if (toolName !== 'renderUI' || !args) {
        return "I tried to show you something but it didn't work. Let me describe it instead.";
    }

    const { type, props } = args;

    switch (type) {
        case 'timer':
            if (props?.duration) {
                const mins = Math.floor(props.duration / 60);
                const secs = props.duration % 60;
                const timeStr = mins > 0 ? `${mins} minutes ${secs > 0 ? `and ${secs} seconds` : ''}` : `${secs} seconds`;
                return `Starting a ${timeStr} ${props.label || 'timer'}. I'll count for you.`;
            }
            return "Starting a timer. I'll let you know when it's done.";

        case 'workoutList':
            if (props?.exercises && Array.isArray(props.exercises)) {
                const names = props.exercises.map((e: any) => e.name).join(', ');
                return `Here's your workout: ${names}. Say 'start' when you're ready.`;
            }
            return "I've prepared a workout for you. Say 'start' when ready.";

        case 'workoutBuilder':
            return "I need a few details about your workout. What type of session would you like - strength, cardio, or flexibility?";

        case 'goalSelector':
            if (props?.options && Array.isArray(props.options)) {
                const labels = props.options.slice(0, 3).map((o: any) => o.label).join(', ');
                return `Choose your focus: ${labels}, or something else?`;
            }
            return "What would you like to focus on today?";

        case 'dashboard':
            let status = "Here's your progress today: ";
            if (props?.stepsTaken !== undefined && props?.stepsGoal) {
                status += `${props.stepsTaken} of ${props.stepsGoal} steps. `;
            }
            if (props?.caloriesBurned !== undefined) {
                status += `${props.caloriesBurned} calories burned. `;
            }
            if (props?.activeMinutes !== undefined) {
                status += `${props.activeMinutes} active minutes.`;
            }
            return status || "Let me check your progress...";

        default:
            return `I was going to show you a ${type} but it didn't load. Is there something specific I can help with?`;
    }
}

// ============================================================================
// RE-ANCHORING
// ============================================================================

interface ActivityState {
    activityType: 'workout' | 'breathing' | 'meditation' | 'stretching' | 'none';
    currentExercise?: string;
    exerciseIndex?: number;
    totalExercises?: number;
    elapsedTime?: number;
    completedCount?: number;
}

/**
 * Generate a re-anchoring message to restore context.
 */
export function generateReanchorMessage(state: ActivityState): string {
    if (state.activityType === 'none') {
        return "We were just chatting. What would you like to do?";
    }

    const activityNames = {
        workout: 'workout',
        breathing: 'breathing exercise',
        meditation: 'meditation',
        stretching: 'stretching session'
    };

    let message = `Let me catch up — you're in a ${activityNames[state.activityType]}. `;

    if (state.currentExercise && state.totalExercises) {
        message += `You're on ${state.currentExercise}, exercise ${(state.exerciseIndex || 0) + 1} of ${state.totalExercises}. `;
    }

    if (state.completedCount !== undefined && state.completedCount > 0) {
        message += `You've completed ${state.completedCount} so far. `;
    }

    message += "Ready to continue?";

    return message;
}

/**
 * Generates a polite prompt to clarify ambiguous voice inputs.
 */
export function generateClarificationPrompt(input: string, ambiguousOptions: string[]): string {
    if (ambiguousOptions.length === 2) {
        return `Did you mean ${ambiguousOptions[0]} or ${ambiguousOptions[1]}?`;
    }
    return "I'm not sure which one you meant. Could you say the option number?";
}

/**
 * Generates an error response for voice recognition failures.
 */
export function generateErrorPrompt(errorType: 'NO_INPUT' | 'UNKNOWN_COMMAND' | 'TIMEOUT'): string {
    switch (errorType) {
        case 'NO_INPUT':
            return "I didn't hear anything. Are you still there?";
        case 'UNKNOWN_COMMAND':
            return "I didn't catch that clearly. Could you repeat it?";
        case 'TIMEOUT':
            return "I'm waiting for your choice. You can also tap the screen to select.";
        default:
            return "Sorry, something went wrong.";
    }
}
