import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidanceExecutor, type GuidanceCallbacks } from '../guidanceExecutor';

describe('guidance lifecycle', () => {
  let executor: GuidanceExecutor;
  let callbacks: GuidanceCallbacks;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    executor = new GuidanceExecutor();
    callbacks = { onCue: vi.fn(), onExerciseStart: vi.fn(), onExerciseComplete: vi.fn(), onActivityComplete: vi.fn(), onProgressUpdate: vi.fn(), onTimerControl: vi.fn(), onError: vi.fn() };
  });
  afterEach(() => { executor.reset(); vi.clearAllTimers(); vi.useRealTimers(); });
  const initWorkout = () => executor.initialize({ activity: 'workout', exercises: [{ name: 'Squat', reps: '5' }, { name: 'Plank', duration: '30s' }] }, callbacks);
  it('cancels scheduled cues while paused, then resumes them', () => {
    initWorkout(); executor.start(); vi.advanceTimersByTime(1000); executor.pause();
    const before = vi.mocked(callbacks.onCue).mock.calls.length;
    vi.advanceTimersByTime(10000);
    expect(callbacks.onCue).toHaveBeenCalledTimes(before);
    executor.resume(); vi.advanceTimersByTime(4000);
    expect(vi.mocked(callbacks.onCue).mock.calls.length).toBeGreaterThan(before);
  });
  it('cancels countdowns and progress intervals on stop', () => {
    initWorkout(); executor.start(); executor.skip(); executor.stop();
    const before = vi.mocked(callbacks.onCue).mock.calls.length;
    vi.advanceTimersByTime(60000);
    expect(callbacks.onCue).toHaveBeenCalledTimes(before);
    expect(callbacks.onActivityComplete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('removes completed timeout entries from persisted state', () => {
    initWorkout(); executor.start();
    vi.advanceTimersByTime(5000);
    expect(executor.getDetailedState().scheduledCues.every(c => c.scheduledFor > Date.now())).toBe(true);
  });
  it('does not advance paused restored state', () => {
    initWorkout(); executor.start();
    const state = executor.getDetailedState();
    executor.pause(); executor.restoreDetailedState({ ...state, status: 'paused' });
    vi.advanceTimersByTime(60000);
    expect(executor.getDetailedState().currentCueIndex).toBe(state.currentCueIndex);
    expect(callbacks.onActivityComplete).not.toHaveBeenCalled();
  });
  it('reports a missing initialization rather than starting', () => {
    executor.start(); expect(executor.getProgress().status).toBe('idle');
  });
});
