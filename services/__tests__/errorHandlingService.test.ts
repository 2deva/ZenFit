import { describe, expect, it, vi } from 'vitest';
import * as errors from '../errorHandlingService';

describe('voice error recovery', () => {
  it('escalates clarification attempts, then resets after understanding', () => {
    let state = errors.createClarificationState('workout');
    for (let i = 0; i < state.maxAttempts + 1; i++) {
      const next = errors.getNextClarification(state); expect(next.prompt.length).toBeGreaterThan(0);
      state = errors.incrementClarification(state, next.prompt);
    }
    expect(errors.getNextClarification(state)).toMatchObject({ shouldPause: true, isExhausted: true });
    expect(errors.resetClarification(state)).toMatchObject({ attemptCount: 0, lastPrompt: '', originalContext: 'workout' });
  });
  it('computes variance around the signal mean and rejects invalid audio frames', () => {
    const initial = errors.createAudioQualityState();
    const constant = errors.analyzeAudioQuality(initial, new Float32Array([0.25, 0.25, 0.25]));
    expect(constant.averageVolume).toBeCloseTo(0.25); expect(constant.noiseLevel).toBe(0);
    expect(errors.analyzeAudioQuality(initial, new Float32Array()).dropoutCount).toBe(1);
    expect(errors.analyzeAudioQuality(initial, new Float32Array([NaN])).dropoutCount).toBe(1);
    expect(errors.analyzeAudioQuality(initial, new Float32Array([0, 0])).dropoutCount).toBe(1);
  });
  it.each([
    [{ noiseLevel: 0.8 }, 'noise'], [{ dropoutCount: 4, sampleCount: 11 }, 'dropouts'],
    [{ averageVolume: 0.01, sampleCount: 6 }, 'volume'],
  ])('selects adaptation for %j', (overrides, reason) => {
    expect(errors.shouldAdaptToAudioQuality({ ...errors.createAudioQualityState(), ...overrides })).toMatchObject({ shouldAdapt: true, reason });
  });
  it.each([
    [{ connectionState: 'disconnected' }, 'CONNECTION_LOST'], [{ transcriptLength: 0 }, 'UNCLEAR_INPUT'],
    [{ transcriptConfidence: 0.2 }, 'UNCLEAR_INPUT'], [{ turnsSinceRefresh: 16 }, 'CONTEXT_STALE'],
    [{ expectedExercise: 'Squat', mentionedExercise: 'Plank' }, 'STATE_DESYNC'],
    [{ commandCount: 2 }, 'AMBIGUOUS_COMMAND'], [{ toolCallSuccess: false }, 'TOOL_FAILURE'],
    [{ audioQuality: { noiseLevel: 0.9 } }, 'AUDIO_QUALITY'],
  ])('detects %j as %s', (signals, type) => {
    expect(errors.detectError(signals as never)).toBe(type); expect(errors.getRecoveryStrategy(type as never).type).toBe(type);
  });
  it('accepts healthy signals and has recovery guidance for each tool', () => {
    expect(errors.detectError({ transcriptLength: 20, transcriptConfidence: 0.9 })).toBeNull();
    expect(errors.shouldAdaptToAudioQuality({ ...errors.createAudioQualityState(), averageVolume: 0.2 })).toMatchObject({ shouldAdapt: false, reason: null });
    for (const [type, props] of [
      ['timer', { duration: 90, label: 'Reset' }], ['workoutList', { exercises: [{ name: 'Plank' }] }],
      ['workoutBuilder', {}], ['goalSelector', { options: [{ label: 'Strength' }] }],
      ['dashboard', { stepsTaken: 100, stepsGoal: 8000, caloriesBurned: 10, activeMinutes: 2 }], ['unknown', {}],
    ] as const) expect(errors.generateVerbalFallback('renderUI', { type, props }).length).toBeGreaterThan(10);
    expect(errors.generateVerbalFallback('otherTool', null)).toContain("didn't work");
    expect(errors.generateReanchorMessage({ activityType: 'none' })).toContain('chatting');
    expect(errors.generateReanchorMessage({ activityType: 'workout', currentExercise: 'Plank', exerciseIndex: 1, totalExercises: 3, completedCount: 1 })).toContain('exercise 2 of 3');
    expect(errors.generateClarificationPrompt('reset', ['Rest', 'Restart'])).toContain('Rest or Restart');
    expect(errors.generateClarificationPrompt('reset', [])).toContain('option number');
    for (const type of ['NO_INPUT', 'UNKNOWN_COMMAND', 'TIMEOUT'] as const) expect(errors.generateErrorPrompt(type)).toBeTruthy();
  });
});
