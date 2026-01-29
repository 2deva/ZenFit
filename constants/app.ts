/**
 * Application Constants
 * Centralized constants to eliminate magic numbers and strings throughout the codebase
 */

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
    MESSAGES: 'zenfit_messages_v1',
    PROFILE: 'zenfit_profile_v1',
    APP_STATE: 'zenfit_app_state_v1',
    FITNESS_TOKEN: 'google_oauth_token',
    LIVE_SESSION: 'zen_live_session',
    LEGACY_CHAT_HISTORY: 'zen_chat_history',
    WORKOUT_PREFIX: 'zen_workout_',
    SYNC_QUEUE: 'zenfit_sync_queue_v1',
} as const;

// ============================================================================
// TIMING CONSTANTS (in milliseconds)
// ============================================================================

export const TIMING = {
    // Debounce delays
    MESSAGE_SAVE_DEBOUNCE: 500,        // Wait for streaming to settle
    STATE_SAVE_DEBOUNCE: 1000,         // Save app state every 1s
    INTERRUPTION_RESET: 800,           // Reset interruption state

    // Intervals
    FITNESS_STATS_REFRESH: 60000,      // Refresh fitness stats every minute

    // Time conversions
    MS_PER_SECOND: 1000,
    MS_PER_MINUTE: 60000,
    SECONDS_PER_MINUTE: 60,

    // Activity defaults
    DEFAULT_BREATHING_DURATION: 300,   // 5 minutes default
    BREATHING_CYCLE_DURATION: 16,      // Seconds per breathing cycle

    // Selection mode timeout
    SELECTION_MODE_TIMEOUT: 30000,     // 30 seconds
} as const;

// ============================================================================
// ACTION STRINGS
// ============================================================================

export const ACTIONS = {
    // Goal actions
    SAVE_GOALS: 'saveGoals',

    // Workout actions
    GENERATE_WORKOUT: 'generateWorkout',
    WORKOUT_PROGRESS_CHANGE: 'workoutProgressChange',
    WORKOUT_COMPLETE: 'workoutComplete',

    // Timer actions
    TIMER_STATE_CHANGE: 'timerStateChange',
    TIMER_COMPLETE: 'timerComplete',
} as const;

// ============================================================================
// UI INTERACTION LIMITS
// ============================================================================

export const UI_LIMITS = {
    RECENT_INTERACTIONS_COUNT: 3,      // Track last 3 UI interactions
    RECENT_MESSAGES_FOR_PSYCH: 5,      // Messages to analyze for psychological state
    MIN_MESSAGE_LENGTH_FOR_MEMORY: 20, // Minimum chars to extract memory
    MIN_INTERACTIONS_FOR_TRUST: 5,     // Interactions before asking hesitant users
} as const;

// ============================================================================
// NUMERIC CONSTANTS
// ============================================================================

export const NUMBERS = {
    // Array lengths
    STREAK_TIMELINE_DAYS: 14,
    RECENT_WORKOUTS_LIMIT: 3,

    // Time calculations
    MS_TO_SECONDS_DIVISOR: 1000,
    MS_TO_MINUTES_DIVISOR: 60000,

    // Defaults
    DEFAULT_STREAK_COUNT: 1,
} as const;

// ============================================================================
// REGEX PATTERNS
// ============================================================================

export const PATTERNS = {
    ACTION_REQUEST: /^(workout|timer|start|go|let's|begin|do it|ready|next)/i,
    GOAL_TYPE_NORMALIZE: /\s+/g,
} as const;

// ============================================================================
// TEXT CONSTANTS
// ============================================================================

export const TEXT = {
    CALENDAR_EVENT_CONFIRMATION: '\n\n(Event added to calendar ✅)',
    VOICE_WORKOUT_DEFAULT_TITLE: 'Voice Workout',
    WORKOUT_DEFAULT_TITLE: 'Workout',
} as const;

// ============================================================================
// EXPORT ALL CONSTANTS
// ============================================================================

export const CONSTANTS = {
    STORAGE_KEYS,
    TIMING,
    ACTIONS,
    UI_LIMITS,
    NUMBERS,
    PATTERNS,
    TEXT
} as const;

// ============================================================================
// TYPE HELPERS
// ============================================================================

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type ActionString = typeof ACTIONS[keyof typeof ACTIONS];
export type TimingValue = typeof TIMING[keyof typeof TIMING];
