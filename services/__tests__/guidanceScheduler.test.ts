import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidanceScheduler } from '../guidanceScheduler';

describe('GuidanceScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it('runs cues in time order and removes fired entries', () => {
    const scheduler = new GuidanceScheduler<string>();
    const fired: string[] = [];
    scheduler.schedule('later', 100, () => fired.push('later'));
    scheduler.schedule('first', 50, () => fired.push('first'));
    expect(scheduler.pending).toContainEqual({ cue: 'later', scheduledFor: 1100 });
    vi.advanceTimersByTime(50);
    expect(fired).toEqual(['first']);
    expect(scheduler.pending).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(fired).toEqual(['first', 'later']);
    expect(scheduler.pending).toEqual([]);
  });
  it('cancels only selected exercise cues', () => {
    const scheduler = new GuidanceScheduler<number>();
    const cancelled = vi.fn(); const kept = vi.fn();
    scheduler.schedule(0, 50, cancelled);
    scheduler.schedule(1, 100, kept);
    scheduler.cancel(index => index === 0);
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });
  it('cancels everything on reset and supports repeated cancellation', () => {
    const scheduler = new GuidanceScheduler<null>(); const callback = vi.fn();
    scheduler.schedule(null, 0, callback);
    scheduler.cancel(); scheduler.cancel(); vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.pending).toEqual([]);
  });
  it.each([-1, NaN, Infinity])('rejects invalid delay %s', delay => {
    expect(() => new GuidanceScheduler().schedule(null, delay, vi.fn())).toThrow(RangeError);
  });
  it('allows callbacks to cancel remaining cues', () => {
    const scheduler = new GuidanceScheduler<null>(); const callback = vi.fn();
    scheduler.schedule(null, 10, () => scheduler.cancel());
    scheduler.schedule(null, 20, callback);
    vi.runAllTimers(); expect(callback).not.toHaveBeenCalled();
  });
});
