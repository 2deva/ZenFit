import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActivityState } from '../useActivityState';
import { setAppState } from '../../services/storageService';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); localStorage.clear(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('activity clock', () => {
  it('runs, pauses, resumes and completes on one clock', () => {
    const { result } = renderHook(useActivityState); const listener = vi.fn();
    act(() => { result.current.registerActivityListener(listener); result.current.startActivity({ activityId: 'timer', type: 'timer', label: 'Reset', totalSeconds: 5 }); });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.activityTimers.timer.remainingSeconds).toBe(3);
    act(() => result.current.pauseActivity('timer'));
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.activityTimers.timer.remainingSeconds).toBe(3);
    act(() => result.current.resumeActivity('timer'));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.activitySessions.timer.state).toBe('completed');
    expect(result.current.activeTimer?.remainingSeconds).toBe(0);
    expect(listener.mock.calls.filter(([e]) => e.type === 'completed')).toHaveLength(1);
  });
  it('supports independent timers and ignores operations for missing IDs', () => {
    const { result } = renderHook(useActivityState);
    act(() => {
      result.current.startActivity({ activityId: 'a', type: 'timer', label: 'A', totalSeconds: 5 });
      result.current.startActivity({ activityId: 'b', type: 'workout', label: 'B', totalSeconds: 10, workoutMeta: { totalSegments: 2 } });
    });
    act(() => result.current.pauseActivity('a')); act(() => vi.advanceTimersByTime(2000));
    expect(result.current.activityTimers.a.remainingSeconds).toBe(5);
    expect(result.current.activityTimers.b.remainingSeconds).toBe(8);
    act(() => { result.current.pauseActivity('missing'); result.current.resumeActivity('missing'); result.current.completeActivity('missing'); result.current.stopActivity('missing'); });
    expect(Object.keys(result.current.activitySessions)).toHaveLength(2);
  });
  it('emits mindful phase transitions and isolates event subscribers', () => {
    const { result } = renderHook(useActivityState); const events: any[] = [];
    act(() => {
      result.current.registerActivityListener(e => { e.session.label = 'changed by subscriber'; });
      result.current.registerActivityListener(e => events.push(e));
      result.current.startActivity({ activityId: 'mind', type: 'breathing', label: 'Breathing', totalSeconds: 4, intent: 'breathing_reset', phases: [
        { id: 'settle', kind: 'settle', durationSeconds: 2, order: 0 },
        { id: 'breath', kind: 'breath_cycle', durationSeconds: 2, order: 1 },
      ] });
    });
    act(() => vi.advanceTimersByTime(2500));
    expect(events[0].session.label).toBe('Breathing');
    expect(events.some(e => e.phase?.id === 'breath')).toBe(true);
    expect(result.current.activitySessions.mind.label).toBe('Breathing');
  });
  it('unsubscribes listeners and treats stopping as idempotent', () => {
    const { result } = renderHook(useActivityState); const listener = vi.fn(); let unsubscribe = () => {};
    act(() => { unsubscribe = result.current.registerActivityListener(listener); result.current.startActivity({ activityId: 'a', type: 'timer', label: 'A', totalSeconds: 5 }); });
    act(() => result.current.stopActivity('a')); act(() => result.current.stopActivity('a'));
    expect(listener.mock.calls.filter(([e]) => e.type === 'completed')).toHaveLength(1);
    unsubscribe(); act(() => result.current.startActivity({ type: 'timer', label: 'B', totalSeconds: 2 }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('restores elapsed persisted time and saves the current state', () => {
    setAppState({ activeTimer: { label: 'Saved', totalSeconds: 60, remainingSeconds: 40, isRunning: true, startedAt: 70000 }, currentWorkoutProgress: null, lastGeneratedWorkout: null, recentUIInteractions: [], timestamp: 90000 });
    const { result } = renderHook(useActivityState);
    expect(result.current.activeTimer?.remainingSeconds).toBe(30);
    act(() => result.current.addUIInteraction('timer'));
    act(() => window.dispatchEvent(new Event('beforeunload')));
    expect(JSON.parse(localStorage.getItem('zenfit_app_state_v1')!).recentUIInteractions).toHaveLength(1);
  });
  it('retains only four recent UI interactions', () => {
    const { result } = renderHook(useActivityState);
    for (let i = 0; i < 7; i++) act(() => result.current.addUIInteraction(String(i)));
    expect(result.current.recentUIInteractions.map(e => e.type)).toEqual(['3', '4', '5', '6']);
  });
  it.each([0, -1, NaN, Infinity, 86401])('rejects invalid duration %s', totalSeconds => {
    const { result } = renderHook(useActivityState);
    expect(() => act(() => result.current.startActivity({ type: 'timer', label: 'Invalid', totalSeconds }))).toThrow(RangeError);
  });
});
