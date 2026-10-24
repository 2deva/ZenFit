import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as persistence from '../persistenceService';
import { getWorkoutProgress, deleteWorkoutProgress } from '../supabaseService';
import { syncService } from '../syncService';
vi.mock('../syncService', () => ({ syncService: { scheduleOperation: vi.fn() } }));
vi.mock('../supabaseService', () => ({ saveWorkoutProgress: vi.fn(), getWorkoutProgress: vi.fn(), deleteWorkoutProgress: vi.fn() }));
const state: persistence.GuidanceState = { status: 'paused', activityType: 'workout', currentExerciseIndex: 2, totalExercises: 4, completedExercises: ['Squat', 'Plank'], elapsedTime: 30, timestamp: 100000 };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(100000); vi.mocked(getWorkoutProgress).mockResolvedValue(null); });

describe('durable session state', () => {
  it('stores local guidance and schedules progress sync', async () => {
    expect(await persistence.saveGuidanceState(state, 'user', 'workout')).toBe(true);
    expect(await persistence.loadGuidanceState()).toEqual(state);
    expect(syncService.scheduleOperation).toHaveBeenCalledWith('SAVE_GUIDANCE_STATE', expect.objectContaining({ userId: 'user', workoutId: 'workout', activeIdx: 2 }));
  });
  it('merges cloud progress with recent local cue details', async () => {
    await persistence.saveGuidanceState(state);
    vi.mocked(getWorkoutProgress).mockResolvedValue({ completed: [0, 2], activeIdx: 3 });
    expect(await persistence.loadGuidanceState('user', 'workout')).toMatchObject({ currentExerciseIndex: 3, completedExercises: ['exercise_0', 'exercise_2'], elapsedTime: 30 });
  });
  it('does not restore expired guidance', async () => {
    await persistence.saveGuidanceState({ ...state, timestamp: -600001 });
    expect(await persistence.loadGuidanceState()).toBeNull();
  });
  it('clears local and cloud progress', async () => {
    await persistence.saveGuidanceState(state); await persistence.clearGuidanceState('user', 'workout');
    expect(await persistence.loadGuidanceState()).toBeNull(); expect(deleteWorkoutProgress).toHaveBeenCalledWith('user', 'workout');
  });
  it('returns false when local persistence is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await persistence.saveGuidanceState(state, 'user', 'workout')).toBe(false);
    expect(persistence.saveGuidanceExecutorState({ ...state, currentCueIndex: 2, scheduledCues: [], repTimings: [], averageRepDuration: 2500, currentRep: 0, targetReps: 5, startTime: 90000, totalPausedDuration: 0 })).toBe(false);
    expect(persistence.saveWorkoutRefs({ lastWorkoutList: null, workoutListsMap: [] })).toBe(false);
    expect(persistence.saveAutoReconnectState({ shouldAutoReconnect: true, reason: 'timer_active', timestamp: 100000 })).toBe(false);
    expect(syncService.scheduleOperation).not.toHaveBeenCalled();
  });
  it('roundtrips executor, workout references and reconnect state with expiry', () => {
    const executor: persistence.GuidanceExecutorState = { currentCueIndex: 1, scheduledCues: [], repTimings: [2000], averageRepDuration: 2000, currentRep: 1, targetReps: 5, startTime: 90000, totalPausedDuration: 0, status: 'paused', timestamp: 100000 };
    expect(persistence.saveGuidanceExecutorState(executor)).toBe(true); expect(persistence.loadGuidanceExecutorState()).toEqual(executor);
    const refs = { lastWorkoutList: { exercises: [{ name: 'Plank' }], title: 'Reset', timestamp: 100000 }, workoutListsMap: [] };
    expect(persistence.saveWorkoutRefs(refs)).toBe(true); expect(persistence.loadWorkoutRefs()).toEqual(refs);
    const reconnect = { shouldAutoReconnect: true, reason: 'guidance_active' as const, timestamp: 100000 };
    persistence.saveAutoReconnectState(reconnect); expect(persistence.loadAutoReconnectState()).toEqual(reconnect);
    vi.mocked(Date.now).mockReturnValue(100000 + 31 * 60000); expect(persistence.loadAutoReconnectState()).toBeNull();
    persistence.clearAutoReconnectState(); expect(persistence.loadAutoReconnectState()).toBeNull();
    expect(persistence.loadGuidanceExecutorState()).toBeNull();
  });
  it('handles corrupted records and queue errors without reporting success', async () => {
    localStorage.setItem('zen_guidance_state', '{invalid'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await persistence.loadGuidanceState()).toBeNull();
    vi.mocked(syncService.scheduleOperation).mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    expect(await persistence.syncWorkoutProgressToCloud('user', 'workout', [], 0)).toBe(false);
    vi.mocked(getWorkoutProgress).mockRejectedValueOnce(new Error('offline'));
    expect(await persistence.syncWorkoutProgressFromCloud('user', 'workout')).toBeNull();
  });
});
