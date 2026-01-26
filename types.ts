
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
  type: 'goalSelector' | 'timer' | 'chart' | 'map' | 'dashboard' | 'workoutList' | 'workoutBuilder' | 'streakTimeline' | 'habitHeatmap' | 'achievementBadge';
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
