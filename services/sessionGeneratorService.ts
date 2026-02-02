/**
 * Session Generator Service
 *
 * Deterministic generator for Timer and WorkoutList sessions from builder configs.
 * Physical workouts are built from the exercise pool (category, equipment, level); see EXERCISE_POOL_ANALYSIS.md.
 */

import { normalizeGoalType, LifeContextGoalType } from './userContextService';

/** Pool entry shape for filtering; matches exercise DB fields we use. */
export type PoolEntry = { name: string; category?: string; equipment?: string | null; level?: string };

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

/** Minimal onboarding slice for workout brief; avoids importing full OnboardingState. */
export interface WorkoutBriefOnboarding {
  primaryMotivation?: string | null;
  healthConditions?: string[];
  preferredActivityTypes?: string[];
}

/**
 * Build a short personalization brief for the physical-workout prompt.
 * Ensures Gemini gets goal, constraints, and equipment explicitly for this turn.
 * See .agent/docs/WORKOUT_PERSONALIZATION_FIRST_PRINCIPLES.md.
 */
export function buildWorkoutBrief(
  onboarding: WorkoutBriefOnboarding | null | undefined,
  selections: Record<string, string>
): string {
  const parts: string[] = [];
  if (onboarding?.primaryMotivation) {
    parts.push(`User's primary goal: ${onboarding.primaryMotivation.replace(/_/g, ' ')}.`);
  }
  if (onboarding?.healthConditions?.length) {
    parts.push(`Health considerations: ${onboarding.healthConditions.join(', ')}. Choose only safe, appropriate exercises (e.g. low-impact or knee-friendly if relevant).`);
  }
  // Equipment: prefer builder choice for this session, then onboarding
  const equipmentFromBuilder = (selections.equipment || selections.equipment_type || '').toLowerCase();
  const isBodyweightFromBuilder = equipmentFromBuilder && /bodyweight|no_equipment|none|body.?weight/.test(equipmentFromBuilder);
  const isGymFromBuilder = equipmentFromBuilder && /gym|weights|dumbbell|resistance/.test(equipmentFromBuilder);
  if (isBodyweightFromBuilder) {
    parts.push('Equipment: bodyweight only — choose exercises that require NO equipment.');
  } else if (isGymFromBuilder) {
    parts.push('Equipment: gym or weights OK.');
  } else if (onboarding?.preferredActivityTypes?.length) {
    const types = onboarding.preferredActivityTypes.map(t => t.toLowerCase());
    const bodyweight = types.some(t => t.includes('bodyweight') || t.includes('home'));
    const gym = types.some(t => t.includes('gym') || t.includes('weights'));
    if (bodyweight && !gym) parts.push('Equipment: bodyweight only — choose exercises that require NO equipment.');
    else if (gym) parts.push('Equipment: gym or weights OK.');
  }
  const focus = selections.focus || selections.type || '';
  const duration = selections.duration || '10';
  const level = selections.level || selections.intensity || '';
  if (focus || duration || level) {
    parts.push(`Request: ${[focus && `${focus}`, duration && `${duration} min`, level && level].filter(Boolean).join(', ')}.`);
  }
  if (parts.length === 0) return '';
  return `[Workout context for this user] ${parts.join(' ')} `;
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
 * @param pool - Optional exercise pool (from getExercisePool); when provided, physical workouts are built from filtered pool
 * @returns SessionConfig with type, props, and inferred goalType
 */
export function generateSessionFromBuilder(
  selections: Record<string, string>,
  activeGoalIds?: string[],
  pool?: PoolEntry[]
): SessionConfig {
  const type = selections.type?.toLowerCase() || selections.focus?.toLowerCase() || '';
  const durationStr = selections.duration || '5';
  const durationMinutes = parseInt(durationStr) || 5;

  // Normalize type to determine session type and goal type
  const normalizedType = normalizeGoalType(type);

  // Mental/calm sessions → Timer (ignore pool)
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

  // Physical sessions → WorkoutList (from pool or fallback)
  const workoutConfig = generateWorkoutList(type, durationMinutes, selections, pool);
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

/** Slice main exercises so total with warmup+cooldown fits duration (2 main for ≤10 min, 4 for ≤15, else 6). */
function sliceByDuration<T>(arr: T[], durationMinutes: number): T[] {
  if (durationMinutes <= 10) return arr.slice(0, 2);
  if (durationMinutes <= 15) return arr.slice(0, 4);
  return arr.slice(0, 6);
}

/** DB categories to include per builder focus. */
function getDbCategoriesForFocus(normalizedType: LifeContextGoalType, type: string): string[] {
  if (normalizedType === 'strength' || type.includes('strength') || type.includes('lift')) {
    return ['strength', 'strongman', 'powerlifting'];
  }
  if (normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run')) {
    return ['cardio', 'plyometrics'];
  }
  if (normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch')) {
    return ['stretching'];
  }
  return ['strength', 'cardio', 'plyometrics', 'stretching', 'strongman', 'powerlifting'];
}

/** Bodyweight only from selections (same logic as buildWorkoutBrief). */
function isBodyweightOnly(selections: Record<string, string>): boolean {
  const equipmentFromBuilder = (selections.equipment || selections.equipment_type || '').toLowerCase();
  return !!equipmentFromBuilder && /bodyweight|no_equipment|none|body.?weight/.test(equipmentFromBuilder);
}

/** Whether DB level is allowed for user level (beginner → only beginner; intermediate → beginner+intermediate; advanced → any). */
function isLevelAllowed(dbLevel: string | undefined, userLevel: string): boolean {
  if (!dbLevel) return true;
  const u = userLevel.toLowerCase();
  if (u.includes('beginner')) return dbLevel === 'beginner';
  if (u.includes('intermediate')) return dbLevel === 'beginner' || dbLevel === 'intermediate';
  return true; // advanced or expert: allow all
}

/** Filter pool by category, equipment, level. */
function filterPool(
  pool: PoolEntry[],
  type: string,
  normalizedType: LifeContextGoalType,
  selections: Record<string, string>
): PoolEntry[] {
  const categories = new Set(getDbCategoriesForFocus(normalizedType, type));
  const bodyweightOnly = isBodyweightOnly(selections);
  const rawLevel = selections.intensity ?? selections.level ?? '';

  return pool.filter((e) => {
    if (e.category && !categories.has(e.category)) return false;
    if (bodyweightOnly) {
      if (e.equipment !== 'body only' && e.equipment != null) return false;
    }
    if (!isLevelAllowed(e.level, rawLevel)) return false;
    return true;
  });
}

/** Assign dose (reps or duration, restAfter) per category and intensity. */
function assignDose(
  entries: PoolEntry[],
  normalizedType: LifeContextGoalType,
  type: string,
  intensity: 'low' | 'moderate' | 'high'
): WorkoutListConfig['exercises'] {
  const restSeconds = intensity === 'low' ? 50 : intensity === 'high' ? 30 : 45;
  const restCardio = intensity === 'low' ? 30 : intensity === 'high' ? 15 : 30;
  const workDuration = intensity === 'low' ? '45 seconds' : intensity === 'high' ? '30 seconds' : '45 seconds';
  const holdDuration = intensity === 'low' ? '20-30 seconds' : '30-45 seconds';
  const repsPerSet = intensity === 'low' ? '6-8' : intensity === 'high' ? '12-15' : '8-12';
  const restMobility = intensity === 'low' ? 15 : 10;

  const isStrength = normalizedType === 'strength' || type.includes('strength') || type.includes('lift');
  const isCardio = normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run');
  const isMobility = normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch');

  return entries.map((e) => {
    if (isStrength) {
      return { name: e.name, reps: `${repsPerSet} reps`, restAfter: restSeconds };
    }
    if (isCardio) {
      return { name: e.name, duration: workDuration, restAfter: restCardio };
    }
    if (isMobility) {
      return { name: e.name, duration: holdDuration, restAfter: restMobility };
    }
    return { name: e.name, reps: `${repsPerSet} reps`, restAfter: restSeconds };
  });
}

/** Minimal fallback when pool is empty or filter yields 0 (names that exist in DB). */
function getFallbackExercises(
  normalizedType: LifeContextGoalType,
  type: string,
  durationMinutes: number,
  intensity: 'low' | 'moderate' | 'high'
): WorkoutListConfig['exercises'] {
  const restSeconds = intensity === 'low' ? 50 : intensity === 'high' ? 30 : 45;
  const workDuration = intensity === 'low' ? '45 seconds' : intensity === 'high' ? '30 seconds' : '45 seconds';
  const holdDuration = intensity === 'low' ? '20-30 seconds' : '30-45 seconds';
  const repsPerSet = intensity === 'low' ? '6-8' : intensity === 'high' ? '12-15' : '8-12';
  const restMobility = intensity === 'low' ? 15 : 10;

  const isStrength = normalizedType === 'strength' || type.includes('strength') || type.includes('lift');
  const isCardio = normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run');
  const isMobility = normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch');

  let list: WorkoutListConfig['exercises'];
  if (isStrength) {
    list = [
      { name: 'Push-up', reps: `${repsPerSet} reps`, restAfter: restSeconds },
      { name: 'Squat', reps: `${repsPerSet} reps`, restAfter: restSeconds },
      { name: 'Plank', duration: intensity === 'low' ? '20-30 seconds' : '30-45 seconds', restAfter: restSeconds },
      { name: 'Lunge', reps: `${repsPerSet} reps per leg`, restAfter: restSeconds }
    ];
  } else if (isCardio) {
    list = [
      { name: 'Jumping Jack', duration: workDuration, restAfter: 30 },
      { name: 'High Knees', duration: workDuration, restAfter: 30 },
      { name: 'Mountain Climber', duration: workDuration, restAfter: 30 },
      { name: 'Burpee', duration: workDuration, restAfter: 30 }
    ];
  } else if (isMobility) {
    list = [
      { name: 'Cat Stretch', duration: '10 reps', restAfter: 0 },
      { name: 'Downward Dog', duration: holdDuration, restAfter: restMobility },
      { name: 'Child\'s Pose', duration: '30 seconds', restAfter: restMobility },
      { name: 'Seated Forward Fold', duration: holdDuration, restAfter: restMobility }
    ];
  } else {
    list = [
      { name: 'Jumping Jack', duration: workDuration, restAfter: restSeconds },
      { name: 'Push-up', reps: `${repsPerSet} reps`, restAfter: restSeconds },
      { name: 'Squat', reps: `${repsPerSet} reps`, restAfter: restSeconds },
      { name: 'Plank', duration: intensity === 'low' ? '20 seconds' : '30 seconds', restAfter: restSeconds }
    ];
  }
  return sliceByDuration(list, durationMinutes);
}

/**
 * Generate a WorkoutList config for physical sessions.
 * When pool is provided and filter yields exercises: filter by category, equipment, level; sort by name; slice; assign dose.
 * Otherwise: minimal fallback list (names that exist in DB).
 */
function generateWorkoutList(
  type: string,
  durationMinutes: number,
  selections: Record<string, string>,
  pool?: PoolEntry[]
): WorkoutListConfig {
  const normalizedType = normalizeGoalType(type);
  const rawLevel = selections.intensity ?? selections.level ?? '';
  const intensity = normalizeLevelToIntensity(rawLevel);

  let title = '';
  if (normalizedType === 'strength' || type.includes('strength') || type.includes('lift')) {
    title = `${durationMinutes}-Minute Strength Session`;
  } else if (normalizedType === 'cardio' || type.includes('cardio') || type.includes('hiit') || type.includes('run')) {
    title = `${durationMinutes}-Minute Cardio Session`;
  } else if (normalizedType === 'mobility' || type.includes('mobility') || type.includes('yoga') || type.includes('stretch')) {
    title = `${durationMinutes}-Minute Mobility Session`;
  } else {
    title = `${durationMinutes}-Minute Workout`;
  }

  let mainExercises: WorkoutListConfig['exercises'];
  if (pool && pool.length > 0) {
    const filtered = filterPool(pool, type, normalizedType, selections);
    const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    const sliced = sliceByDuration(sorted, durationMinutes);
    if (sliced.length > 0) {
      mainExercises = assignDose(sliced, normalizedType, type, intensity);
    } else {
      mainExercises = getFallbackExercises(normalizedType, type, durationMinutes, intensity);
    }
  } else {
    mainExercises = getFallbackExercises(normalizedType, type, durationMinutes, intensity);
  }

  const exercises = wrapWithWarmupCooldown(mainExercises, durationMinutes);
  return { title, exercises };
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
