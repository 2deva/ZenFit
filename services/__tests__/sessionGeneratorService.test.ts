import { describe, expect, it } from 'vitest';
import {
  buildWorkoutBrief, buildMindfulPhases, composePhysicalWorkoutFromRequest,
  generateSessionFromBuilder, resolveRequestedDurationMinutes,
  type MindfulSessionConfig,
} from '../sessionGeneratorService';

describe('workout personalization', () => {
  it('includes goals, constraints and session preferences', () => {
    const brief = buildWorkoutBrief({ primaryMotivation: 'build_strength', healthConditions: ['knee pain'] },
      { equipment: 'bodyweight', focus: 'strength', duration: '15', level: 'beginner' });
    expect(brief).toContain('build strength');
    expect(brief).toContain('knee pain');
    expect(brief).toContain('NO equipment');
    expect(brief).toContain('strength, 15 min, beginner');
  });
  it('prefers builder equipment over onboarding', () => {
    expect(buildWorkoutBrief({ preferredActivityTypes: ['gym'] }, { equipment: 'none' })).toContain('NO equipment');
    expect(buildWorkoutBrief({ preferredActivityTypes: ['home'] }, { equipment: 'dumbbells' })).toContain('weights OK');
  });
  it('uses onboarding equipment when the builder does not specify it', () => {
    expect(buildWorkoutBrief({ preferredActivityTypes: ['home'] }, {})).toContain('NO equipment');
    expect(buildWorkoutBrief({ preferredActivityTypes: ['gym'] }, {})).toContain('weights OK');
  });
  it('handles a missing profile', () => {
    expect(buildWorkoutBrief(null, {})).toContain('10 min');
  });
});

describe('requested workout duration', () => {
  it.each([
    [{}, 10], [{ durationMinutes: 20 }, 20], [{ durationMinutes: -8 }, 1],
    [{ durationMinutes: 999 }, 60], [{ durationMinutes: NaN }, 10],
    [{ durationMinutes: Infinity }, 10], [{ durationMinutes: 2.8 }, 3],
    [{ focus: '5-minute cardio', durationMinutes: 10 }, 5],
    [{ title: '15 min reset', durationMinutes: 10 }, 15],
    [{ focus: '7 minutes', title: '20 minutes' }, 7],
    [{ focus: '0 minutes', durationMinutes: 8 }, 8],
  ])('resolves %j to %i minutes', (request, expected) => {
    expect(resolveRequestedDurationMinutes(request)).toBe(expected);
  });
});

describe('builder sessions', () => {
  it.each(['breathing', 'meditation', 'sleep', 'calm', 'mindfulness'])('builds a %s timer with consistent phases', focus => {
    const session = generateSessionFromBuilder({ focus, duration: '5' });
    expect(session.type).toBe('timer');
    if (!('duration' in session.props)) throw new Error('Expected timer');
    expect(session.props.duration).toBe(300);
    expect(session.props.meta?.phases?.reduce((sum, p) => sum + p.durationSeconds, 0)).toBe(300);
  });
  it.each(['-5', '0', 'Infinity', 'NaN', '999'])('bounds invalid duration %s', duration => {
    const session = generateSessionFromBuilder({ focus: 'breathing', duration });
    if (!('duration' in session.props)) throw new Error('Expected timer');
    expect(Number.isFinite(session.props.duration)).toBe(true);
    expect(session.props.duration).toBeGreaterThanOrEqual(60);
    expect(session.props.duration).toBeLessThanOrEqual(3600);
  });
  it.each(['strength', 'cardio', 'mobility', 'exercise'])('adds warmup and cooldown to %s', focus => {
    const session = generateSessionFromBuilder({ focus, duration: '10', equipment: 'bodyweight' });
    expect(session.type).toBe('workoutList');
    if (!('exercises' in session.props)) throw new Error('Expected workout');
    expect(session.props.exercises.length).toBeGreaterThanOrEqual(3);
    expect(session.props.exercises[0].duration).toBeTruthy();
    expect(session.props.exercises.at(-1)?.duration).toBeTruthy();
  });
  it('removes duplicate and incompatible supplied exercises', () => {
    const workout = composePhysicalWorkoutFromRequest({ focus: 'strength', exercises: [
      { name: 'Push-Up', reps: '8' }, { name: 'push-up', reps: '10' }, { name: '' },
    ] });
    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0]).toMatchObject({ name: 'Push-Up', reps: '8' });
  });
  it('replaces titles that contradict the requested duration', () => {
    const workout = composePhysicalWorkoutFromRequest({ title: '20 min cardio', focus: '5 min cardio', exercises: [{ name: 'March in Place' }] });
    expect(workout.title).not.toContain('20');
  });
});

describe('mindful phase budgets', () => {
  it.each(['breathing_reset', 'sleep_prep', 'focus_block', 'deep_meditation'] as const)('%s preserves the total duration', intent => {
    for (const totalMinutes of [1, 2, 5, 10, 60]) {
      const config: MindfulSessionConfig = { intent, totalMinutes, guidanceStyle: 'light' };
      const phases = buildMindfulPhases(config);
      expect(phases.reduce((sum, phase) => sum + phase.durationSeconds, 0)).toBe(totalMinutes * 60);
      expect(phases.every(phase => phase.durationSeconds >= 0)).toBe(true);
    }
  });
});
