/**
 * Session Generator Service
 * 
 * Deterministic generator for Timer and WorkoutList sessions from builder configs.
 * This ensures every builder submission yields a concrete, well-typed session tool
 * without relying on LLM guessing.
 */

import { normalizeGoalType, LifeContextGoalType } from './userContextService';

export interface SessionConfig {
  type: 'timer' | 'workoutList';
  props: TimerConfig | WorkoutListConfig;
  goalType?: LifeContextGoalType;
}

export interface TimerConfig {
  duration: number;
  label: string;
  // Optional metadata for mindful sessions; ignored for generic timers.
  meta?: {
    mindfulConfig?: MindfulSessionConfig;
    phases?: Array<{
      id: string;
      kind: 'settle' | 'breath_cycle' | 'body_scan' | 'meditation' | 'closing';
      durationSeconds: number;
      order: number;
    }>;
  };
}

export interface WorkoutListConfig {
  title: string;
  exercises: Array<{
    name: string;
    reps?: string;
    duration?: string;
    restAfter?: number;
  }>;
}

// Exported so LiveSessionContext and GuidanceEngine can share the same
// mindful configuration semantics without duplicating types.
export interface MindfulSessionConfig {
  intent: 'breathing_reset' | 'deep_meditation' | 'sleep_prep' | 'focus_block';
  totalMinutes: number;
  guidanceStyle: 'full' | 'light' | 'silent';
  pattern?: 'box' | '4-7-8' | 'calming' | 'energizing';
}

/**
 * Generate a deterministic session from builder selections.
 * 
 * @param selections - Builder category selections (e.g., { type: 'meditation', duration: '5' })
 * @param activeGoalIds - Optional array of goal IDs to tag this session with
 * @returns SessionConfig with type, props, and inferred goalType
 */
export function generateSessionFromBuilder(
  selections: Record<string, string>,
  activeGoalIds?: string[]
): SessionConfig {
  const type = selections.type?.toLowerCase() || selections.focus?.toLowerCase() || '';
  const durationStr = selections.duration || '5';
  const durationMinutes = parseInt(durationStr) || 5;

  // Normalize type to determine session type and goal type
  const normalizedType = normalizeGoalType(type);
  
  // Mental/calm sessions → Timer
  if (
    normalizedType === 'mindfulness' ||
    normalizedType === 'stress' ||
    normalizedType === 'sleep' ||
    normalizedType === 'recovery' ||
    type.includes('meditation') ||
    type.includes('breathing') ||
    type.includes('calm') ||
    type.includes('mindful')
  ) {
    const label = getTimerLabel(type, durationMinutes);

    const mindfulConfig: MindfulSessionConfig = {
      intent: inferMindfulIntent(type, normalizedType),
      totalMinutes: durationMinutes,
      guidanceStyle: inferGuidanceStyle(selections),
      pattern: inferBreathingPattern(type)
    };

    const phases = buildMindfulPhases(mindfulConfig);

    return {
      type: 'timer',
      props: {
        duration: durationMinutes * 60, // Convert to seconds
        label,
        meta: {
          mindfulConfig,
          phases
        }
      },
      goalType: normalizedType
    };
  }

  // Physical sessions → WorkoutList
  const workoutConfig = generateWorkoutList(type, durationMinutes, selections);
  return {
    type: 'workoutList',
    props: workoutConfig,
    goalType: normalizedType
  };
}

/**
 * Generate a WorkoutList config for physical sessions
 */
function generateWorkoutList(
  type: string,
  durationMinutes: number,
  selections: Record<string, string>
): WorkoutListConfig {
  const normalizedType = normalizeGoalType(type);
  const intensity = selections.intensity?.toLowerCase() || selections.level?.toLowerCase() || 'moderate';
  
  let title = '';
  let exercises: WorkoutListConfig['exercises'] = [];

  // Strength workouts
  if (normalizedType === 'strength' || type.includes('strength') || type.includes('lift')) {
    title = `${durationMinutes}-Minute Strength Session`;
    exercises = generateStrengthExercises(durationMinutes, intensity);
  }
  // Cardio workouts
  else if (normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run')) {
    title = `${durationMinutes}-Minute Cardio Session`;
    exercises = generateCardioExercises(durationMinutes, intensity);
  }
  // Mobility/yoga
  else if (normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch')) {
    title = `${durationMinutes}-Minute Mobility Session`;
    exercises = generateMobilityExercises(durationMinutes, intensity);
  }
  // Generic/fallback
  else {
    title = `${durationMinutes}-Minute Workout`;
    exercises = generateGenericExercises(durationMinutes, intensity);
  }

  return { title, exercises };
}

/**
 * Generate strength exercises based on duration and intensity
 */
function generateStrengthExercises(durationMinutes: number, intensity: string): WorkoutListConfig['exercises'] {
  const exercises: WorkoutListConfig['exercises'] = [];
  const isHighIntensity = intensity.includes('high') || intensity.includes('intense');
  const repsPerSet = isHighIntensity ? '12-15' : '8-12';
  const restSeconds = isHighIntensity ? 30 : 45;

  // Upper body
  exercises.push({ name: 'Push-ups', reps: `${repsPerSet} reps`, restAfter: restSeconds });
  exercises.push({ name: 'Dumbbell Rows', reps: `${repsPerSet} reps per arm`, restAfter: restSeconds });
  
  // Lower body
  exercises.push({ name: 'Squats', reps: `${repsPerSet} reps`, restAfter: restSeconds });
  exercises.push({ name: 'Lunges', reps: `${repsPerSet} reps per leg`, restAfter: restSeconds });
  
  // Core
  exercises.push({ name: 'Plank', duration: '30-45 seconds', restAfter: restSeconds });
  exercises.push({ name: 'Mountain Climbers', reps: '20 reps', restAfter: restSeconds });

  // Adjust count based on duration
  if (durationMinutes <= 10) {
    return exercises.slice(0, 4);
  } else if (durationMinutes <= 15) {
    return exercises;
  } else {
    // Add more exercises for longer sessions
    exercises.push({ name: 'Burpees', reps: '8-10 reps', restAfter: restSeconds });
    exercises.push({ name: 'Deadlifts (bodyweight)', reps: `${repsPerSet} reps`, restAfter: restSeconds });
    return exercises;
  }
}

/**
 * Generate cardio exercises
 */
function generateCardioExercises(durationMinutes: number, intensity: string): WorkoutListConfig['exercises'] {
  const exercises: WorkoutListConfig['exercises'] = [];
  const isHighIntensity = intensity.includes('high') || intensity.includes('hiit');
  const workDuration = isHighIntensity ? '30 seconds' : '45 seconds';
  const restDuration = isHighIntensity ? 15 : 30;

  exercises.push({ name: 'Jumping Jacks', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'High Knees', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'Burpees', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'Mountain Climbers', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'Squat Jumps', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'Plank Jacks', duration: workDuration, restAfter: restDuration });

  if (durationMinutes <= 10) {
    return exercises.slice(0, 4);
  } else if (durationMinutes <= 15) {
    return exercises;
  } else {
    exercises.push({ name: 'Butt Kicks', duration: workDuration, restAfter: restDuration });
    exercises.push({ name: 'Star Jumps', duration: workDuration, restAfter: restDuration });
    return exercises;
  }
}

/**
 * Generate mobility/yoga exercises
 */
function generateMobilityExercises(durationMinutes: number, intensity: string): WorkoutListConfig['exercises'] {
  const exercises: WorkoutListConfig['exercises'] = [];
  const holdDuration = '30-45 seconds';

  exercises.push({ name: 'Cat-Cow Stretch', duration: '10 reps', restAfter: 0 });
  exercises.push({ name: 'Downward Dog', duration: holdDuration, restAfter: 10 });
  exercises.push({ name: 'Warrior I (Right)', duration: holdDuration, restAfter: 10 });
  exercises.push({ name: 'Warrior I (Left)', duration: holdDuration, restAfter: 10 });
  exercises.push({ name: 'Child\'s Pose', duration: '30 seconds', restAfter: 10 });
  exercises.push({ name: 'Seated Forward Fold', duration: holdDuration, restAfter: 10 });

  if (durationMinutes <= 10) {
    return exercises.slice(0, 4);
  } else if (durationMinutes <= 15) {
    return exercises;
  } else {
    exercises.push({ name: 'Pigeon Pose (Right)', duration: holdDuration, restAfter: 10 });
    exercises.push({ name: 'Pigeon Pose (Left)', duration: holdDuration, restAfter: 10 });
    exercises.push({ name: 'Supine Twist', duration: '30 seconds per side', restAfter: 10 });
    return exercises;
  }
}

/**
 * Generate generic exercises (fallback)
 */
function generateGenericExercises(durationMinutes: number, intensity: string): WorkoutListConfig['exercises'] {
  const exercises: WorkoutListConfig['exercises'] = [];
  const workDuration = '45 seconds';
  const restDuration = 30;

  exercises.push({ name: 'Jumping Jacks', duration: workDuration, restAfter: restDuration });
  exercises.push({ name: 'Push-ups', reps: '10-12 reps', restAfter: restDuration });
  exercises.push({ name: 'Squats', reps: '12-15 reps', restAfter: restDuration });
  exercises.push({ name: 'Plank', duration: '30 seconds', restAfter: restDuration });
  exercises.push({ name: 'Lunges', reps: '10 reps per leg', restAfter: restDuration });
  exercises.push({ name: 'Burpees', reps: '8-10 reps', restAfter: restDuration });

  if (durationMinutes <= 10) {
    return exercises.slice(0, 4);
  }
  return exercises;
}

/**
 * Get appropriate timer label based on session type
 */
function getTimerLabel(type: string, durationMinutes: number): string {
  const lower = type.toLowerCase();
  
  if (lower.includes('meditation') || lower.includes('mindful')) {
    return `Guided Meditation (${durationMinutes} min)`;
  }
  if (lower.includes('breathing') || lower.includes('breath')) {
    return `Breathing Practice (${durationMinutes} min)`;
  }
  if (lower.includes('calm') || lower.includes('stress')) {
    return `Calm Session (${durationMinutes} min)`;
  }
  if (lower.includes('sleep') || lower.includes('rest')) {
    return `Sleep Preparation (${durationMinutes} min)`;
  }
  
  return `Mindfulness Timer (${durationMinutes} min)`;
}

function inferMindfulIntent(type: string, normalizedType: LifeContextGoalType): MindfulSessionConfig['intent'] {
  const lower = type.toLowerCase();

  if (lower.includes('sleep') || lower.includes('rest')) {
    return 'sleep_prep';
  }
  if (lower.includes('focus') || lower.includes('deep work')) {
    return 'focus_block';
  }
  if (lower.includes('breathing') || lower.includes('breath') || normalizedType === 'recovery' || normalizedType === 'stress') {
    return 'breathing_reset';
  }
  // Default for generic mindfulness / meditation
  return 'deep_meditation';
}

function inferGuidanceStyle(selections: Record<string, string>): MindfulSessionConfig['guidanceStyle'] {
  const style = selections.guidance?.toLowerCase();
  if (style === 'silent') return 'silent';
  if (style === 'light') return 'light';
  if (style === 'full') return 'full';
  // Default: light guidance for most users
  return 'light';
}

function inferBreathingPattern(type: string): MindfulSessionConfig['pattern'] | undefined {
  const lower = type.toLowerCase();
  if (lower.includes('box')) return 'box';
  if (lower.includes('4-7-8') || lower.includes('4 7 8')) return '4-7-8';
  if (lower.includes('energ')) return 'energizing';
  if (lower.includes('calm') || lower.includes('relax')) return 'calming';
  return undefined;
}

// Exported helper so other layers (e.g., LiveSessionContext) can derive
// consistent phase splits for mindful sessions started outside the builder.
export function buildMindfulPhases(config: MindfulSessionConfig): Array<{
  id: string;
  kind: 'settle' | 'breath_cycle' | 'body_scan' | 'meditation' | 'closing';
  durationSeconds: number;
  order: number;
}> {
  const totalSeconds = config.totalMinutes * 60;

  // Simple, opinionated phase splits based on intent. These can be refined later
  // without changing external APIs.
  if (config.intent === 'breathing_reset') {
    const settle = Math.min(30, totalSeconds * 0.15);
    const closing = Math.min(20, totalSeconds * 0.15);
    const middle = Math.max(0, totalSeconds - settle - closing);
    return [
      { id: 'settle', kind: 'settle', durationSeconds: Math.round(settle), order: 0 },
      { id: 'breath', kind: 'breath_cycle', durationSeconds: Math.round(middle), order: 1 },
      { id: 'closing', kind: 'closing', durationSeconds: Math.round(closing), order: 2 }
    ];
  }

  if (config.intent === 'sleep_prep') {
    const settle = Math.min(60, totalSeconds * 0.25);
    const meditation = Math.max(0, totalSeconds - settle - 30);
    const closing = 30;
    return [
      { id: 'settle', kind: 'settle', durationSeconds: Math.round(settle), order: 0 },
      { id: 'meditation', kind: 'meditation', durationSeconds: Math.round(meditation), order: 1 },
      { id: 'closing', kind: 'closing', durationSeconds: closing, order: 2 }
    ];
  }

  if (config.intent === 'focus_block') {
    const settle = Math.min(20, totalSeconds * 0.1);
    const meditation = Math.max(0, totalSeconds - settle - 20);
    const closing = 20;
    return [
      { id: 'settle', kind: 'settle', durationSeconds: Math.round(settle), order: 0 },
      { id: 'focus', kind: 'meditation', durationSeconds: Math.round(meditation), order: 1 },
      { id: 'closing', kind: 'closing', durationSeconds: closing, order: 2 }
    ];
  }

  // deep_meditation default
  const settle = Math.min(45, totalSeconds * 0.2);
  const meditation = Math.max(0, totalSeconds - settle - 30);
  const closing = 30;
  return [
    { id: 'settle', kind: 'settle', durationSeconds: Math.round(settle), order: 0 },
    { id: 'meditation', kind: 'meditation', durationSeconds: Math.round(meditation), order: 1 },
    { id: 'closing', kind: 'closing', durationSeconds: closing, order: 2 }
  ];
}
