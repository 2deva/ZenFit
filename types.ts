
export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
    placeAnswerSources?: any[];
  };
}

export interface UIComponentData {
  type: 'goalSelector' | 'timer' | 'chart' | 'map' | 'dashboard' | 'workoutList' | 'workoutBuilder' | 'streakTimeline' | 'habitHeatmap' | 'achievementBadge' | 'calendar' | 'calendarEventAdded';
  props: any;
  voiceOptions?: SelectionOption[]; // Add voice options directly to base interface for easier consumption
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  isThinking?: boolean;
  uiComponent?: UIComponentData;
  groundingChunks?: GroundingChunk[];
  functionCalls?: { name: string; args: any }[];
  messageContext?: 'workout_guidance' | 'general' | 'system' | 'workout_control';
  relatedWorkoutId?: string; // Link to workoutList message ID for guidance messages
}

export interface UserProfile {
  name?: string;
  goals: string[];
}

export interface FitnessStats {
  steps: number;
  calories: number;
  activeMinutes: number;
  stepsGoal: number;
  /** Source of the data: real Fit API or simulated. */
  dataSource?: 'google_fit' | 'simulated';
  /** When dataSource is simulated after a 401, use 'disconnected' so UI can show Reconnect. */
  connectionStatus?: 'connected' | 'disconnected';
}

// ============================================================================
// LifeContext Types (Holistic User Profile)
// ============================================================================

export type LifeContextGoalType =
  | 'strength'
  | 'cardio'
  | 'mobility'
  | 'mindfulness'
  | 'sleep'
  | 'stress'
  | 'recovery'
  | 'other';

export type LifeContextWorkPattern =
  | 'nine_to_five'
  | 'shift'
  | 'freelance'
  | 'student'
  | 'caregiver';

export type LifeContextEnvironment =
  | 'home_only'
  | 'gym_access'
  | 'outdoor_friendly'
  | 'limited_space';

export interface LifeContextTrainingWindow {
  label: string;
  days: string[]; // e.g. ['Mon','Tue']
  start: string;  // "07:00"
  end: string;    // "08:00"
  source: 'user_reported' | 'calendar' | 'inferred';
}

export interface LifeContextGoalProgress {
  currentStreak?: number;
  bestStreak?: number;
  completionsThisWeek?: number;
}

export interface LifeContextGoal extends LifeContextGoalProgress {
  id: string;
  type: LifeContextGoalType;
  label: string;
  motivation?: string | null;
  createdAt: string;
  targetPerWeek?: number;
  priority?: 'high' | 'medium' | 'low';
}

export interface LifeContextMovementBaseline {
  source: 'google_fit' | 'device' | 'none';
  avgDailySteps?: number;
  avgDailyActiveMinutes?: number;
  last7Days: Array<{
    date: string;
    steps: number;
    activeMinutes: number;
  }>;
  patternSummary: string;
}

export interface LifeContextSleepConsistency {
  avgHours?: number;
  bedtimeVariabilityMinutes?: number;
  summary: string;
}

export interface LifeContextStressSignals {
  userReportedLevel?: 'low' | 'medium' | 'high';
  patternSummary: string;
}

export interface LifeContextHabits {
  sleepConsistency?: LifeContextSleepConsistency;
  stressSignals?: LifeContextStressSignals;
}

export interface LifeContextPsychology {
  primaryWhy: string;
  secondaryWhys: string[];
  riskPatterns: string[];
  toneGuardrails: string;
}

export interface LifeContextProfile {
  occupation?: string;
  workPattern?: LifeContextWorkPattern;
  environment?: LifeContextEnvironment;
}

export interface LifeContextSchedule {
  timezone?: string;
  typicalWakeTime?: string;
  typicalSleepTime?: string;
  preferredTrainingWindows: LifeContextTrainingWindow[];
  hardBusyBlocksSummary: string;
}

export interface LifeContext {
  profile: LifeContextProfile;
  schedule: LifeContextSchedule;
  goals: LifeContextGoal[];
  movementBaseline: LifeContextMovementBaseline;
  habits: LifeContextHabits;
  psychology: LifeContextPsychology;
  /** One-line instruction for the model, e.g. "No movement today — suggest 10-min session" or "2-day streak — nudge to maintain". */
  suggestedNextAction?: string;
}

export enum LiveStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  RECONNECTING = 'reconnecting'
}

export interface SelectionOption {
  id: string;
  label: string;
  index: number;
  synonyms?: string[];
  data?: any;
}

export interface SelectionResult {
  selectedId: string;
  confidence: 'high' | 'medium' | 'low';
  requiresConfirmation?: boolean;
}

export interface ExtendedUIComponentData extends UIComponentData {
  voiceOptions?: SelectionOption[];
  controlledActiveIndex?: number;
  controlledCompleted?: number[];
}
