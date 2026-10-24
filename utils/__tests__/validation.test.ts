import { describe, expect, it } from 'vitest';
import { validateMessage, validateUserId, validateTimerDuration, validateWorkoutExercises, validateUIProps, validateFitnessStats, validateUserProfile, validateEnvironment } from '../validation';
import { normalizeTimerProps } from '../timerProps';
import { isIntentSafeReadinessUtterance } from '../liveReadiness';
import { resolveMindfulTimer } from '../mindfulTimer';
import { shouldUseSharedNumericCountdown } from '../liveGuidancePolicy';

describe('untrusted UI payloads', () => {
  it.each([null, undefined, 1, {}, '', '   ', 'a'.repeat(10001)])('rejects invalid message %j', input => {
    expect(validateMessage(input).isValid).toBe(false);
  });
  it('accepts messages at the size boundary', () => {
    expect(validateMessage('a'.repeat(10000)).isValid).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, '60', 86401, null])('rejects invalid timer %j', duration => {
    expect(validateTimerDuration(duration).isValid).toBe(false);
    expect(validateUIProps('timer', { duration }).isValid).toBe(false);
  });
  it.each([1, 60, 86400])('accepts timer %i', duration => {
    expect(validateTimerDuration(duration).isValid).toBe(true);
  });
  it.each([null, [], [null], [{}], [{ name: '' }], [{ name: '  ' }], [{ name: 12 }], [{ name: 'Plank', restAfter: NaN }], [{ name: 'Plank', restAfter: -1 }], [{ name: 'Squat', reps: 10 }]])('rejects malformed workout %j without throwing', input => {
    expect(validateWorkoutExercises(input).isValid).toBe(false);
    expect(validateUIProps('workoutList', { exercises: input }).isValid).toBe(false);
  });
  it('accepts zero rest and valid exercise details', () => {
    expect(validateWorkoutExercises([{ name: 'Plank', duration: '30 seconds', restAfter: 0 }]).isValid).toBe(true);
  });
  it.each([0, -1, 1.5, Infinity, 101])('rejects invalid round count %s', rounds => {
    expect(validateUIProps('workoutList', { exercises: [{ name: 'Squat' }], rounds }).isValid).toBe(false);
  });
  it('validates builder categories and nullable props', () => {
    expect(validateUIProps('timer', null).isValid).toBe(false);
    expect(validateUIProps('workoutBuilder', { categories: [null] }).isValid).toBe(false);
    expect(validateUIProps('workoutBuilder', { categories: [{ options: [] }] }).isValid).toBe(false);
    expect(validateUIProps('workoutBuilder', { categories: [{ options: [{ id: 'cardio' }] }] }).isValid).toBe(true);
  });
  it('validates profiles, UUIDs and finite fitness values', () => {
    expect(validateUserId('123e4567-e89b-12d3-a456-426614174000').isValid).toBe(true);
    expect(validateUserId('not-a-uuid').isValid).toBe(false);
    expect(validateFitnessStats({ steps: -1 }).isValid).toBe(false);
    expect(validateFitnessStats({ steps: Infinity }).isValid).toBe(false);
    expect(validateFitnessStats({ steps: '100' }).isValid).toBe(false);
    expect(validateFitnessStats({ steps: 100, activeMinutes: 2 }).isValid).toBe(true);
    expect(validateUserProfile([]).isValid).toBe(false);
    expect(validateUserProfile({ goals: 'strength' }).isValid).toBe(false);
    expect(validateUserProfile({ goals: ['strength'] }).isValid).toBe(true);
  });
});

describe('timer and voice policy', () => {
  it('aligns timer with stated duration and preserves metadata', () => {
    expect(normalizeTimerProps({ duration: 60, meta: { intent: 'reset' } }, '', 'Take 5 minutes')).toMatchObject({ duration: 300, meta: { intent: 'reset' } });
    expect(normalizeTimerProps({ duration: 300 }, 'one minute please').duration).toBe(60);
    expect(normalizeTimerProps({ duration: Infinity }).duration).toBe(60);
  });
  it.each(['ready', "I'm ready!", "Let's go", 'YES'])('accepts direct readiness: %s', text => {
    expect(isIntentSafeReadinessUtterance(text)).toBe(true);
  });
  it.each(['not ready', 'I am not ready', 'start tomorrow', '', 'yes but wait'])('does not auto-start on %s', text => {
    expect(isIntentSafeReadinessUtterance(text)).toBe(false);
  });
  it('resolves mindful intent before labels and avoids duplicate countdowns', () => {
    expect(resolveMindfulTimer({ label: 'Session', meta: { mindfulConfig: { intent: 'breathing_reset' } } }).activityType).toBe('breathing');
    expect(resolveMindfulTimer({ label: 'Meditation' }).activityType).toBe('meditation');
    expect(resolveMindfulTimer({ label: 'Plank' }).activityType).toBeNull();
    expect(shouldUseSharedNumericCountdown('timer', 'sleep_prep')).toBe(false);
    expect(shouldUseSharedNumericCountdown('timer')).toBe(true);
    expect(shouldUseSharedNumericCountdown('workoutList')).toBe(false);
  });
});

describe('public environment validation', () => {
  const env = { VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'project', VITE_FIREBASE_APP_ID: 'app', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' };
  it('reports missing variable names without exposing values', () => {
    expect(validateEnvironment({}).error).toContain('VITE_FIREBASE_API_KEY');
    expect(validateEnvironment(env).isValid).toBe(true);
    expect(validateEnvironment({ ...env, VITE_SUPABASE_URL: 'javascript:alert(1)' }).isValid).toBe(false);
  });
});
