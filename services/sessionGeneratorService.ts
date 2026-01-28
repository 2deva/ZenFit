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
    return {
      type: 'timer',
      props: {
        duration: durationMinutes * 60, // Convert to seconds
        label
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
