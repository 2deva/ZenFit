export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateMessage(message: unknown): ValidationResult {
  if (typeof message !== 'string') return { isValid: false, error: 'Message must be a string' };
  if (!message.length) return { isValid: false, error: 'Message cannot be empty' };
  if (!message.trim()) return { isValid: false, error: 'Message cannot be whitespace only' };
  if (message.length > 10000) return { isValid: false, error: 'Message too long' };
  return { isValid: true };
}

export function validateUserId(userId: unknown): ValidationResult {
  return { isValid: typeof userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) };
}

export function validateTimerDuration(duration: unknown): ValidationResult {
  return { isValid: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && duration <= 86400 };
}

export function validateWorkoutExercises(exercises: unknown): ValidationResult {
  if (!Array.isArray(exercises) || !exercises.length) return { isValid: false };
  return { isValid: exercises.every(ex => isRecord(ex)
    && typeof ex.name === 'string' && ex.name.trim().length > 0
    && (ex.reps === undefined || typeof ex.reps === 'string')
    && (ex.duration === undefined || typeof ex.duration === 'string')
    && (ex.restAfter === undefined || (typeof ex.restAfter === 'number' && Number.isFinite(ex.restAfter) && ex.restAfter >= 0))) };
}

export function validateUIProps(type: string, props: unknown): ValidationResult {
  if (!isRecord(props)) return { isValid: false };
  if (type === 'timer') return validateTimerDuration(props.duration);
  if (type === 'workoutList') {
    return { isValid: validateWorkoutExercises(props.exercises).isValid
      && (props.rounds === undefined || (Number.isInteger(props.rounds) && Number(props.rounds) > 0 && Number(props.rounds) <= 100)) };
  }
  if (type === 'workoutBuilder') {
    return { isValid: Array.isArray(props.categories) && props.categories.length > 0
      && props.categories.every(cat => isRecord(cat) && Array.isArray(cat.options) && cat.options.length > 0) };
  }
  return { isValid: true };
}

export function validateFitnessStats(stats: unknown): ValidationResult {
  if (!isRecord(stats)) return { isValid: false };
  return { isValid: ['steps', 'calories', 'activeMinutes'].every(key =>
    stats[key] === undefined || (typeof stats[key] === 'number' && Number.isFinite(stats[key]) && Number(stats[key]) >= 0)) };
}

export function validateUserProfile(profile: unknown): ValidationResult {
  return { isValid: isRecord(profile) && (profile.goals === undefined || Array.isArray(profile.goals)) };
}

/** Validate public client configuration without reading or logging server secrets. */
export function validateEnvironment(env: Record<string, unknown> = import.meta.env): ValidationResult {
  const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missing = required.filter(key => typeof env[key] !== 'string' || !String(env[key]).trim());
  if (missing.length) return { isValid: false, error: `Missing configuration: ${missing.join(', ')}` };
  try {
    const url = new URL(String(env.VITE_SUPABASE_URL));
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
  } catch {
    return { isValid: false, error: 'VITE_SUPABASE_URL must be an HTTP(S) URL' };
  }
  return { isValid: true };
}
