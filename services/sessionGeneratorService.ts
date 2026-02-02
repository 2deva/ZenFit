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

/** Normalize builder level/intensity to low | moderate | high for consistent programming. */
function normalizeLevelToIntensity(raw: string | null | undefined): 'low' | 'moderate' | 'high' {
  if (!raw) return 'moderate';
  const t = raw.toLowerCase();
  if (t.includes('beginner') || t.includes('easy') || t.includes('low')) return 'low';
  if (t.includes('advanced') || t.includes('high') || t.includes('hiit') || t.includes('intense')) return 'high';
  return 'moderate';
}

/**
 * Generate a deterministic session from builder selections.
 * Builder contract: category ids may be type|focus, duration, level|intensity.
 * Option ids for focus: strength, cardio, mobility, exercise (generic). Level: beginner, intermediate, advanced.
 *
 * @param selections - Builder category selections (e.g., { focus: 'strength', duration: '10', level: 'beginner' })
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
 * Wrap main exercises with warmup (first) and cooldown (last) for safe, first-principles structure.
 * Short sessions: 1 slot warmup, N main, 1 slot cooldown; main count is reduced so total fits.
 */
function wrapWithWarmupCooldown(
  mainExercises: WorkoutListConfig['exercises'],
  durationMinutes: number
): WorkoutListConfig['exercises'] {
  const warmup: WorkoutListConfig['exercises'][0] = {
    name: 'Warm-up',
    duration: durationMinutes <= 10 ? '45 seconds' : '1 minute',
    restAfter: 0
  };
  const cooldown: WorkoutListConfig['exercises'][0] = {
    name: 'Cool-down',
    duration: durationMinutes <= 10 ? '30 seconds' : '1 minute',
    restAfter: 0
  };
  return [warmup, ...mainExercises, cooldown];
}

/**
 * Generate a WorkoutList config for physical sessions.
 * Uses normalized level (beginner → low, advanced → high) and adds warmup + cooldown.
 */
function generateWorkoutList(
  type: string,
  durationMinutes: number,
  selections: Record<string, string>
): WorkoutListConfig {
  const normalizedType = normalizeGoalType(type);
  const rawLevel = selections.intensity ?? selections.level ?? '';
  const intensity = normalizeLevelToIntensity(rawLevel);

  let title = '';
  let mainExercises: WorkoutListConfig['exercises'] = [];

  // Strength workouts
  if (normalizedType === 'strength' || type.includes('strength') || type.includes('lift')) {
    title = `${durationMinutes}-Minute Strength Session`;
    mainExercises = generateStrengthExercises(durationMinutes, intensity);
  }
  // Cardio workouts
  else if (normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run')) {
    title = `${durationMinutes}-Minute Cardio Session`;
    mainExercises = generateCardioExercises(durationMinutes, intensity);
  }
  // Mobility/yoga
  else if (normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch')) {
    title = `${durationMinutes}-Minute Mobility Session`;
    mainExercises = generateMobilityExercises(durationMinutes, intensity);
  }
  // Generic/fallback (e.g. type "exercise")
  else {
    title = `${durationMinutes}-Minute Workout`;
    mainExercises = generateGenericExercises(durationMinutes, intensity);
  }

  const exercises = wrapWithWarmupCooldown(mainExercises, durationMinutes);
  return { title, exercises };
}

/** Slice main exercises so total with warmup+cooldown fits duration (2 main for ≤10 min, 4 for ≤15, else 6). */
function sliceByDuration<T>(arr: T[], durationMinutes: number): T[] {
  if (durationMinutes <= 10) return arr.slice(0, 2);
  if (durationMinutes <= 15) return arr.slice(0, 4);
  return arr.slice(0, 6);
}

/**
 * Generate strength exercises based on duration and normalized intensity.
 * Low (beginner): fewer reps, longer rest. High: more reps, shorter rest.
 */
function generateStrengthExercises(durationMinutes: number, intensity: 'low' | 'moderate' | 'high'): WorkoutListConfig['exercises'] {
  const repsPerSet = intensity === 'low' ? '6-8' : intensity === 'high' ? '12-15' : '8-12';
  const restSeconds = intensity === 'low' ? 50 : intensity === 'high' ? 30 : 45;

  const exercises: WorkoutListConfig['exercises'] = [
    { name: 'Push-ups', reps: `${repsPerSet} reps`, restAfter: restSeconds },
    { name: 'Dumbbell Rows', reps: `${repsPerSet} reps per arm`, restAfter: restSeconds },
    { name: 'Squats', reps: `${repsPerSet} reps`, restAfter: restSeconds },
    { name: 'Lunges', reps: `${repsPerSet} reps per leg`, restAfter: restSeconds },
    { name: 'Plank', duration: intensity === 'low' ? '20-30 seconds' : '30-45 seconds', restAfter: restSeconds },
    { name: 'Mountain Climbers', reps: intensity === 'low' ? '10 reps' : '20 reps', restAfter: restSeconds },
    { name: 'Burpees', reps: '8-10 reps', restAfter: restSeconds },
    { name: 'Deadlifts (bodyweight)', reps: `${repsPerSet} reps`, restAfter: restSeconds }
  ];
  return sliceByDuration(exercises, durationMinutes);
}

/**
 * Generate cardio exercises. Low (beginner): longer work/rest, lower-impact first. High: shorter work/rest.
 */
function generateCardioExercises(durationMinutes: number, intensity: 'low' | 'moderate' | 'high'): WorkoutListConfig['exercises'] {
  const workDuration = intensity === 'low' ? '45 seconds' : intensity === 'high' ? '30 seconds' : '45 seconds';
  const restDuration = intensity === 'low' ? 30 : intensity === 'high' ? 15 : 30;

  // Beginner-friendly order: lower impact first (march, step jacks) then progress
  const all = intensity === 'low'
    ? [
        { name: 'March in Place', duration: workDuration, restAfter: restDuration },
        { name: 'Step Jacks', duration: workDuration, restAfter: restDuration },
        { name: 'Jumping Jacks', duration: workDuration, restAfter: restDuration },
        { name: 'High Knees', duration: workDuration, restAfter: restDuration },
        { name: 'Mountain Climbers', duration: workDuration, restAfter: restDuration },
        { name: 'Squat Jumps', duration: workDuration, restAfter: restDuration },
        { name: 'Butt Kicks', duration: workDuration, restAfter: restDuration },
        { name: 'Star Jumps', duration: workDuration, restAfter: restDuration }
      ]
    : [
        { name: 'Jumping Jacks', duration: workDuration, restAfter: restDuration },
        { name: 'High Knees', duration: workDuration, restAfter: restDuration },
        { name: 'Burpees', duration: workDuration, restAfter: restDuration },
        { name: 'Mountain Climbers', duration: workDuration, restAfter: restDuration },
        { name: 'Squat Jumps', duration: workDuration, restAfter: restDuration },
        { name: 'Plank Jacks', duration: workDuration, restAfter: restDuration },
        { name: 'Butt Kicks', duration: workDuration, restAfter: restDuration },
        { name: 'Star Jumps', duration: workDuration, restAfter: restDuration }
      ];
  return sliceByDuration(all, durationMinutes);
}

/**
 * Generate mobility/yoga exercises. Intensity affects hold length and count.
 */
function generateMobilityExercises(durationMinutes: number, intensity: 'low' | 'moderate' | 'high'): WorkoutListConfig['exercises'] {
  const holdDuration = intensity === 'low' ? '20-30 seconds' : '30-45 seconds';
  const restBetween = intensity === 'low' ? 15 : 10;

  const exercises: WorkoutListConfig['exercises'] = [
    { name: 'Cat-Cow Stretch', duration: '10 reps', restAfter: 0 },
    { name: 'Downward Dog', duration: holdDuration, restAfter: restBetween },
    { name: 'Warrior I (Right)', duration: holdDuration, restAfter: restBetween },
    { name: 'Warrior I (Left)', duration: holdDuration, restAfter: restBetween },
    { name: 'Child\'s Pose', duration: '30 seconds', restAfter: restBetween },
    { name: 'Seated Forward Fold', duration: holdDuration, restAfter: restBetween },
    { name: 'Pigeon Pose (Right)', duration: holdDuration, restAfter: restBetween },
    { name: 'Pigeon Pose (Left)', duration: holdDuration, restAfter: restBetween },
    { name: 'Supine Twist', duration: '30 seconds per side', restAfter: restBetween }
  ];
  return sliceByDuration(exercises, durationMinutes);
}

/**
 * Generate generic mixed exercises (fallback when type is e.g. "exercise"). Level affects volume and rest.
 */
function generateGenericExercises(durationMinutes: number, intensity: 'low' | 'moderate' | 'high'): WorkoutListConfig['exercises'] {
  const workDuration = intensity === 'low' ? '45 seconds' : '45 seconds';
  const restDuration = intensity === 'low' ? 35 : intensity === 'high' ? 25 : 30;
  const reps = intensity === 'low' ? '8-10' : intensity === 'high' ? '12-15' : '10-12';

  const exercises: WorkoutListConfig['exercises'] = [
    { name: 'Jumping Jacks', duration: workDuration, restAfter: restDuration },
    { name: 'Push-ups', reps: `${reps} reps`, restAfter: restDuration },
    { name: 'Squats', reps: intensity === 'low' ? '10-12 reps' : '12-15 reps', restAfter: restDuration },
    { name: 'Plank', duration: intensity === 'low' ? '20 seconds' : '30 seconds', restAfter: restDuration },
    { name: 'Lunges', reps: `${intensity === 'low' ? '8' : '10'} reps per leg`, restAfter: restDuration },
    { name: 'Burpees', reps: intensity === 'low' ? '5-6 reps' : '8-10 reps', restAfter: restDuration }
  ];
  return sliceByDuration(exercises, durationMinutes);
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
