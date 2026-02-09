/**
 * Session Generator Service
 *
 * Deterministic generator for Timer and WorkoutList sessions from builder configs.
 * Physical workouts are built from the exercise pool (category, equipment, level); see EXERCISE_POOL_ANALYSIS.md.
 */

import { normalizeGoalType, LifeContextGoalType } from './userContextService';

/** Pool entry shape for filtering; matches exercise DB fields we use. */
export type PoolEntry = { name: string; category?: string; equipment?: string | null; level?: string };
type RichPoolEntry = PoolEntry & {
  mechanic?: string | null;
  force?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
};

export interface PhysicalSafetyContext {
  healthConditions?: string[];
}

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

export interface PhysicalWorkoutRequest {
  title?: string;
  exercises?: Array<{ name: string; reps?: string; duration?: string; restAfter?: number }>;
  durationMinutes?: number;
  focus?: string;
  level?: string;
  equipment?: string;
}

function clampDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(60, Math.round(value)));
}

function inferDurationMinutesFromText(input?: string): number | undefined {
  if (!input) return undefined;
  const match = input.toLowerCase().match(/(\d+)\s*-?\s*(?:minute|minutes|min)\b/);
  if (!match) return undefined;
  const parsed = parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function resolveRequestedDurationMinutes(request: PhysicalWorkoutRequest): number {
  const fromArgs = typeof request.durationMinutes === 'number' ? request.durationMinutes : undefined;
  const fromFocus = inferDurationMinutesFromText(request.focus);
  const fromTitle = inferDurationMinutesFromText(request.title);
  // Prefer explicit natural-language duration from the request text/title over
  // model-provided numeric defaults, which are often generic (e.g. 10).
  return clampDurationMinutes(fromFocus ?? fromTitle ?? fromArgs ?? 10);
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
  pool?: PoolEntry[],
  safetyContext?: PhysicalSafetyContext
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
  const workoutConfig = generateWorkoutList(type, durationMinutes, selections, pool, safetyContext);
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
  durationMinutes: number,
  pool?: RichPoolEntry[],
  selections?: Record<string, string>,
  safetyContext?: PhysicalSafetyContext
): WorkoutListConfig['exercises'] {
  const warmupDuration = durationMinutes <= 10 ? '45 seconds' : '1 minute';
  const cooldownDuration = durationMinutes <= 10 ? '30 seconds' : '1 minute';
  const existingNames = new Set(mainExercises.map(ex => normalizeText(ex.name)));
  const warmupFallbacks = ['Jumping Jack', 'March in Place', 'Arm Circles'];
  const cooldownFallbacks = ['Child\'s Pose', 'Seated Forward Fold', 'Cat Stretch'];

  const warmupCandidate = pickBoundaryExercise('warmup', pool, selections, safetyContext, existingNames) || warmupFallbacks[0];
  const warmupName = existingNames.has(normalizeText(warmupCandidate))
    ? warmupFallbacks.find(name => !existingNames.has(normalizeText(name))) || warmupCandidate
    : warmupCandidate;

  existingNames.add(normalizeText(warmupName));

  const cooldownCandidate = pickBoundaryExercise('cooldown', pool, selections, safetyContext, existingNames) || cooldownFallbacks[0];
  const cooldownName = existingNames.has(normalizeText(cooldownCandidate))
    ? cooldownFallbacks.find(name => !existingNames.has(normalizeText(name))) || cooldownCandidate
    : cooldownCandidate;
  const warmup: WorkoutListConfig['exercises'][0] = { name: warmupName, duration: warmupDuration, restAfter: 0 };
  const cooldown: WorkoutListConfig['exercises'][0] = { name: cooldownName, duration: cooldownDuration, restAfter: 0 };
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
  pool: RichPoolEntry[],
  type: string,
  normalizedType: LifeContextGoalType,
  selections: Record<string, string>,
  safetyContext?: PhysicalSafetyContext
): RichPoolEntry[] {
  const categories = new Set(getDbCategoriesForFocus(normalizedType, type));
  const bodyweightOnly = isBodyweightOnly(selections);
  const rawLevel = selections.intensity ?? selections.level ?? '';
  const conditions = normalizeConditions(safetyContext?.healthConditions);

  const filtered = pool.filter((e) => {
    if (e.category && !categories.has(e.category)) return false;
    if (bodyweightOnly) {
      if (e.equipment !== 'body only' && e.equipment != null) return false;
    }
    if (!isLevelAllowed(e.level, rawLevel)) return false;
    if (!isExerciseSafeForConditions(e.name, conditions)) return false;
    return true;
  });

  // The exercise DB can contain duplicate names under different IDs.
  // Keep only one entry per normalized exercise name to avoid repeated rows.
  const uniqueByName = new Map<string, RichPoolEntry>();
  for (const entry of filtered) {
    const key = normalizeText(entry.name);
    if (!uniqueByName.has(key)) {
      uniqueByName.set(key, entry);
    }
  }
  return Array.from(uniqueByName.values());
}

/** Assign dose (reps or duration, restAfter) per category and intensity. */
function assignDose(
  entries: RichPoolEntry[],
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

function normalizeConditions(conditions?: string[]): string[] {
  if (!Array.isArray(conditions)) return [];
  return conditions.map(c => c.toLowerCase());
}

function isExerciseSafeForConditions(name: string, normalizedConditions: string[]): boolean {
  if (normalizedConditions.length === 0) return true;
  const n = name.toLowerCase();
  if (normalizedConditions.some(c => c.includes('knee'))) {
    if (/(jump|burpee|sprint|box jump|depth jump|broad jump)/.test(n)) return false;
  }
  if (normalizedConditions.some(c => c.includes('wrist'))) {
    if (/(push-up|plank|burpee|mountain climber|handstand)/.test(n)) return false;
  }
  if (normalizedConditions.some(c => c.includes('shoulder'))) {
    if (/(overhead|military press|snatch|jerk|handstand)/.test(n)) return false;
  }
  if (normalizedConditions.some(c => c.includes('back') || c.includes('spine'))) {
    if (/(deadlift|good morning|back extension|hyperextension)/.test(n)) return false;
  }
  return true;
}

function toMovementBucket(entry: RichPoolEntry, focus: LifeContextGoalType): string {
  const n = entry.name.toLowerCase();
  if (focus === 'strength') {
    if (/(row|pull|chin-up|lat|curl)/.test(n)) return 'pull';
    if (/(press|push|dip|tricep)/.test(n)) return 'push';
    if (/(squat|lunge|deadlift|calf|hamstring|quad)/.test(n)) return 'lower';
    return 'core';
  }
  if (focus === 'mobility') {
    if (/(hip|lunge|pigeon|groin)/.test(n)) return 'hip';
    if (/(shoulder|chest|thoracic|arm)/.test(n)) return 'upper';
    if (/(hamstring|calf|ankle)/.test(n)) return 'lower';
    return 'spine';
  }
  if (/(jump|sprint|burpee|high knees)/.test(n)) return 'high';
  if (/(march|walk|step|shadow)/.test(n)) return 'low';
  return 'mixed';
}

function stableNameScore(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function selectBalancedEntries(entries: RichPoolEntry[], focus: LifeContextGoalType, maxCount: number): RichPoolEntry[] {
  if (entries.length <= maxCount) return entries;
  const sorted = [...entries].sort((a, b) => stableNameScore(a.name) - stableNameScore(b.name));
  const selected: RichPoolEntry[] = [];
  const usedBuckets = new Set<string>();

  for (const entry of sorted) {
    if (selected.length >= maxCount) break;
    const bucket = toMovementBucket(entry, focus);
    if (!usedBuckets.has(bucket)) {
      selected.push(entry);
      usedBuckets.add(bucket);
    }
  }
  for (const entry of sorted) {
    if (selected.length >= maxCount) break;
    if (!selected.find(s => s.name === entry.name)) {
      selected.push(entry);
    }
  }
  return selected.slice(0, maxCount);
}

function pickBoundaryExercise(
  kind: 'warmup' | 'cooldown',
  pool?: RichPoolEntry[],
  selections?: Record<string, string>,
  safetyContext?: PhysicalSafetyContext,
  excludedNames?: Set<string>
): string | undefined {
  if (!pool || pool.length === 0) return undefined;
  const conditions = normalizeConditions(safetyContext?.healthConditions);
  const bodyweightOnly = isBodyweightOnly(selections || {});
  const rawLevel = selections?.intensity ?? selections?.level ?? '';
  const candidates = pool.filter((e) => {
    if (bodyweightOnly && e.equipment !== 'body only' && e.equipment != null) return false;
    if (!isLevelAllowed(e.level, rawLevel)) return false;
    if (!isExerciseSafeForConditions(e.name, conditions)) return false;
    const n = e.name.toLowerCase();
    if (kind === 'warmup') {
      return (e.category === 'stretching' || e.category === 'cardio') &&
        (/(jumping jack|march|dynamic|arm circle|cat stretch|walking)/.test(n) || e.category === 'stretching');
    }
    return e.category === 'stretching' || /(child|forward fold|cobra|hamstring|hip flexor|cat stretch)/.test(n);
  });

  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => stableNameScore(a.name) - stableNameScore(b.name));
  if (!excludedNames || excludedNames.size === 0) {
    return sorted[0]?.name;
  }
  const nonDuplicate = sorted.find(entry => !excludedNames.has(normalizeText(entry.name)));
  return nonDuplicate?.name || sorted[0]?.name;
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
  pool?: PoolEntry[],
  safetyContext?: PhysicalSafetyContext
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
    const filtered = filterPool(pool as RichPoolEntry[], type, normalizedType, selections, safetyContext);
    const targetCount = durationMinutes <= 10 ? 2 : durationMinutes <= 15 ? 4 : 6;
    const selected = selectBalancedEntries(filtered, normalizedType, targetCount);
    const sliced = sliceByDuration(selected, durationMinutes);
    if (sliced.length > 0) {
      mainExercises = assignDose(sliced, normalizedType, type, intensity);
    } else {
      mainExercises = getFallbackExercises(normalizedType, type, durationMinutes, intensity);
    }
  } else {
    mainExercises = getFallbackExercises(normalizedType, type, durationMinutes, intensity);
  }

  const exercises = wrapWithWarmupCooldown(mainExercises, durationMinutes, pool as RichPoolEntry[] | undefined, selections, safetyContext);
  return { title, exercises };
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferFocusFromRequest(request: PhysicalWorkoutRequest, pool?: PoolEntry[]): string {
  if (request.focus) return request.focus;
  const title = (request.title || '').toLowerCase();
  if (/(strength|lift|muscle)/.test(title)) return 'strength';
  if (/(cardio|hiit|endurance|run)/.test(title)) return 'cardio';
  if (/(mobility|stretch|yoga|recovery)/.test(title)) return 'mobility';
  if (request.exercises && request.exercises.length > 0) {
    const nameText = request.exercises.map(ex => (ex.name || '').toLowerCase()).join(' ');
    if (/(stretch|pose|fold|mobility|yoga|cat|cow|hamstring|hip flexor|child)/.test(nameText)) return 'mobility';
    if (/(jump|burpee|high knees|mountain climber|sprint|cardio|run)/.test(nameText)) return 'cardio';
    if (/(push|pull|press|squat|lunge|deadlift|plank|strength)/.test(nameText)) return 'strength';
  }
  if (request.exercises && request.exercises.length > 0 && pool && pool.length > 0) {
    const categoryCounts: Record<string, number> = {};
    for (const ex of request.exercises) {
      const best = pool.find(p => normalizeText(p.name) === normalizeText(ex.name));
      const category = best?.category;
      if (category) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
    const top = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top === 'stretching') return 'mobility';
    if (top === 'cardio' || top === 'plyometrics') return 'cardio';
    if (top) return 'strength';
  }
  return 'exercise';
}

function shouldKeepRequestTitle(title: string | undefined, resolvedDurationMinutes: number): boolean {
  if (!title || !title.trim()) return false;
  const t = title.trim();
  const lower = t.toLowerCase();

  const titleDuration = inferDurationMinutesFromText(title);
  if (typeof titleDuration === 'number' && titleDuration !== resolvedDurationMinutes) {
    // Keep title duration consistent with resolved duration.
    return false;
  }

  if (/\d+\s*(?:minute|minutes|min)\b/.test(lower)) return true;
  if (/^(workout|session|routine|exercise)$/i.test(lower)) return false;
  return true;
}

export function composePhysicalWorkoutFromRequest(
  request: PhysicalWorkoutRequest,
  pool?: PoolEntry[],
  safetyContext?: PhysicalSafetyContext
): WorkoutListConfig {
  const focus = inferFocusFromRequest(request, pool);
  const durationMinutes = resolveRequestedDurationMinutes(request);
  const selections: Record<string, string> = {
    focus,
    duration: String(durationMinutes),
    level: request.level || 'intermediate',
    equipment: request.equipment || ''
  };
  const providedExercises = Array.isArray(request.exercises) ? request.exercises : [];
  if (providedExercises.length === 0) {
    return generateWorkoutList(focus, durationMinutes, selections, pool, safetyContext);
  }

  const normalizedProvided: WorkoutListConfig['exercises'] = [];
  const seen = new Set<string>();
  const richPool = (pool || []) as RichPoolEntry[];
  const conditions = normalizeConditions(safetyContext?.healthConditions);
  const normalizedType = normalizeGoalType(focus);
  const intensity = normalizeLevelToIntensity(request.level);

  const defaultRest = normalizedType === 'cardio' ? 30 : normalizedType === 'mobility' ? 10 : 45;
  const defaultDuration = normalizedType === 'mobility' ? '30-45 seconds' : '45 seconds';
  const defaultReps = intensity === 'low' ? '6-8 reps' : intensity === 'high' ? '12-15 reps' : '8-12 reps';

  for (const candidate of providedExercises) {
    if (!candidate?.name) continue;
    const normalizedName = normalizeText(candidate.name);
    if (!normalizedName || seen.has(normalizedName)) continue;

    const matched = richPool.find(entry => normalizeText(entry.name) === normalizedName);
    const resolvedName = matched?.name || candidate.name;
    if (!isExerciseSafeForConditions(resolvedName, conditions)) continue;

    const exercise: WorkoutListConfig['exercises'][0] = {
      name: resolvedName,
      reps: candidate.reps,
      duration: candidate.duration,
      restAfter: typeof candidate.restAfter === 'number' ? candidate.restAfter : defaultRest
    };

    if (!exercise.reps && !exercise.duration) {
      if (normalizedType === 'strength') {
        exercise.reps = defaultReps;
      } else {
        exercise.duration = defaultDuration;
      }
    }

    seen.add(normalizedName);
    normalizedProvided.push(exercise);
  }

  const generated = generateWorkoutList(focus, durationMinutes, selections, pool, safetyContext);
  if (normalizedProvided.length === 0) {
    return generated;
  }

  return {
    title: shouldKeepRequestTitle(request.title, durationMinutes) ? request.title!.trim() : generated.title,
    exercises: normalizedProvided
  };
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
