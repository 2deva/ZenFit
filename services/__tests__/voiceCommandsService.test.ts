import { afterEach, describe, expect, it, vi } from 'vitest';
import { processVoiceCommand, processSelection, createPaceState, adjustPace, pauseActivity, resumeActivity, generateDynamicResponse, setPendingConfirmation, consumeConfirmation, clearPendingConfirmation, hasPendingConfirmation } from '../voiceCommandsService';

afterEach(() => { clearPendingConfirmation(); vi.useRealTimers(); });

describe('voice intent precedence', () => {
  it.each([
    ['stop workout', 'END_SESSION', true], ["I'm done", 'END_SESSION', true],
    ['go back', 'GO_BACK', false], ['go slower', 'SLOW_PACE', false],
    ['go faster', 'SPEED_PACE', false], ['repeat last exercise', 'GO_BACK', false],
    ['end session', 'END_SESSION', true], ['start over', 'RESTART_ACTIVITY', true],
    ['pause please', 'PAUSE_ACTIVITY', false], ['unmute', 'UNMUTE_GUIDANCE', false],
    ['time remaining', 'TIME_CHECK', false], ['how many left', 'EXERCISES_REMAINING', false],
    ['what exercise', 'CURRENT_STATUS', false], ['all done', 'COMPLETE_EXERCISE', false],
    ['yes', 'CONFIRM', false], ['no', 'CANCEL', false], ['help', 'SHOW_HELP', false],
  ])('recognizes %s', (text, action, confirmation) => {
    expect(processVoiceCommand(text)).toMatchObject({ action, requiresConfirmation: confirmation });
  });
  it.each(['stopwatch', 'yesterday', 'not ready', "don't stop", 'do not pause', ''])('ignores non-command or negated input: %s', text => {
    expect(processVoiceCommand(text).action).toBeNull();
  });
  it('selects ordinals, exact labels, synonyms and asks to confirm partial matches', () => {
    const options = [{ id: 'strength', label: 'Morning Strength Workout', index: 0, synonyms: ['weights'] }, { id: 'calm', label: 'Breathing Reset', index: 1 }];
    expect(processSelection('option 2', options)).toEqual({ selectedId: 'calm', confidence: 'high' });
    expect(processSelection('first', options)?.selectedId).toBe('strength');
    expect(processSelection('Breathing Reset', options)?.selectedId).toBe('calm');
    expect(processSelection('weights', options)?.selectedId).toBe('strength');
    expect(processSelection('Morning Strength', options)).toMatchObject({ selectedId: 'strength', requiresConfirmation: true });
    expect(processSelection('secondhand', options)).toBeNull();
    expect(processSelection('nothing matches', options)).toBeNull();
  });
});

describe('pace state and confirmation lifecycle', () => {
  it('bounds pace changes and preserves the base pace on reset', () => {
    let state = createPaceState('slow');
    for (let i = 0; i < 20; i++) state = adjustPace(state, 'SLOW_PACE');
    expect(state.currentMultiplier).toBe(2);
    for (let i = 0; i < 20; i++) state = adjustPace(state, 'SPEED_PACE');
    expect(state.currentMultiplier).toBe(0.5);
    expect(adjustPace(state, 'RESET_PACE').currentMultiplier).toBe(1.5);
  });
  it('counts only pause time and tolerates repeated pause/resume', () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const initial = createPaceState(); const paused = pauseActivity(initial);
    vi.advanceTimersByTime(2500); expect(pauseActivity(paused)).toBe(paused);
    const resumed = resumeActivity(paused);
    expect(resumed.pauseDuration).toBe(2500);
    expect(resumeActivity(resumed)).toBe(resumed);
    expect(initial.isPaused).toBe(false);
  });
  it('consumes each confirmation only once and expires stale confirmations', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    expect(consumeConfirmation()).toBeNull(); setPendingConfirmation('END_SESSION');
    expect(hasPendingConfirmation()).toBe(true);
    expect(consumeConfirmation()).toBe('END_SESSION'); expect(consumeConfirmation()).toBeNull();
    setPendingConfirmation('RESTART_ACTIVITY'); vi.advanceTimersByTime(10001);
    expect(hasPendingConfirmation()).toBe(false); expect(consumeConfirmation()).toBeNull();
  });
  it('formats status without fabricating missing values', () => {
    expect(generateDynamicResponse('TIME_CHECK', { remainingTime: 90 })).toContain('1 minute and 30 seconds');
    expect(generateDynamicResponse('TIME_CHECK', { remainingTime: 15 })).toBe('15 seconds remaining.');
    expect(generateDynamicResponse('TIME_CHECK', { elapsedTime: 120 })).toContain('2 minutes');
    expect(generateDynamicResponse('CURRENT_STATUS', { currentExercise: 'Plank', currentExerciseIndex: 1, totalExercises: 3 })).toContain('exercise 2 of 3');
    expect(generateDynamicResponse('EXERCISES_REMAINING', { totalExercises: 3, completedCount: 2 })).toBe('1 exercise left to go.');
    expect(generateDynamicResponse('TIME_CHECK', {})).toContain("not sure");
    expect(generateDynamicResponse('UNKNOWN', {})).toBe('');
  });
});
