import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService, type SyncOperation } from '../syncService';
import { getSyncQueue, setSyncQueue } from '../storageService';
import { saveMessage, saveWorkoutProgress, saveUserGoals, deleteWorkoutProgress, deleteAllMessages } from '../supabaseService';
const db = vi.hoisted(() => ({ from: vi.fn(), delete: vi.fn(), eq: vi.fn() }));
vi.mock('../../supabaseConfig', () => ({ supabase: db }));
vi.mock('../supabaseService', () => ({ saveMessage: vi.fn(), saveWorkoutProgress: vi.fn(), saveUserGoals: vi.fn(), deleteWorkoutProgress: vi.fn(), deleteAllMessages: vi.fn() }));
let service: SyncService;
const online = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
const progress = (userId = 'u1') => ({ userId, workoutId: 'w1', completedIndices: [0], activeIdx: 1 });
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); online(false);
  for (const fn of [saveMessage, saveWorkoutProgress, saveUserGoals, deleteWorkoutProgress, deleteAllMessages]) vi.mocked(fn).mockResolvedValue(true);
  db.from.mockReturnValue(db); db.delete.mockReturnValue(db); db.eq.mockResolvedValue({ error: null });
  service = new SyncService();
});
afterEach(() => service.dispose());

describe('offline synchronization', () => {
  it('persists offline work and replays it when online', async () => {
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress());
    expect(saveWorkoutProgress).not.toHaveBeenCalled();
    expect(getSyncQueue()).toHaveLength(1);
    online(true); await service.processQueue();
    expect(saveWorkoutProgress).toHaveBeenCalledWith('u1', 'w1', [0], 1);
    expect(getSyncQueue()).toEqual([]);
  });
  it('deduplicates progress per user and workout', () => {
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress());
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', { ...progress(), activeIdx: 2 });
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress('u2'));
    const queue = getSyncQueue<SyncOperation>();
    expect(queue).toHaveLength(2);
    expect(queue[0].payload).toMatchObject({ userId: 'u1', activeIdx: 2 });
    expect(queue[1].payload.userId).toBe('u2');
  });
  it('retains failed guidance saves for retry', async () => {
    vi.mocked(saveWorkoutProgress).mockResolvedValue(false);
    service.scheduleOperation('SAVE_GUIDANCE_STATE', progress());
    online(true); await service.processQueue();
    expect(getSyncQueue<SyncOperation>()[0]).toMatchObject({ retryCount: 1, status: 'pending' });
    vi.mocked(saveWorkoutProgress).mockResolvedValue(true);
    await service.processQueue(); expect(getSyncQueue()).toEqual([]);
  });
  it('executes deletion operations rather than silently discarding them', async () => {
    service.scheduleOperation('DELETE_WORKOUT_PROGRESS', { userId: 'u1', workoutId: 'w1' });
    online(true); await service.processQueue();
    expect(deleteWorkoutProgress).toHaveBeenCalledWith('u1', 'w1');
    expect(getSyncQueue()).toEqual([]);
  });
  it('recovers an interrupted processing operation after reload', async () => {
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress());
    const queue = getSyncQueue<SyncOperation>(); queue[0].status = 'processing'; setSyncQueue(queue);
    service.dispose(); service = new SyncService(); online(true); await service.processQueue();
    expect(saveWorkoutProgress).toHaveBeenCalledOnce(); expect(getSyncQueue()).toEqual([]);
  });
  it('retains exhausted operations and supports an explicit retry', async () => {
    vi.mocked(saveWorkoutProgress).mockResolvedValue(false);
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress()); online(true);
    for (let i = 0; i < 8; i++) await service.processQueue();
    expect(saveWorkoutProgress).toHaveBeenCalledTimes(6);
    expect(getSyncQueue<SyncOperation>()[0].status).toBe('failed');
    online(false); service.retryFailedOperations();
    expect(getSyncQueue<SyncOperation>()[0]).toMatchObject({ status: 'pending', retryCount: 0 });
    vi.mocked(saveWorkoutProgress).mockResolvedValue(true); online(true); await service.processQueue();
    expect(getSyncQueue()).toEqual([]);
  });
  it('does not acknowledge partially failed data deletion', async () => {
    db.eq.mockResolvedValue({ error: { message: 'database unavailable' } });
    service.scheduleOperation('DELETE_ALL_DATA', { userId: 'u1' }); online(true); await service.processQueue();
    expect(getSyncQueue<SyncOperation>()[0].status).toBe('pending');
    expect(db.from).toHaveBeenCalledWith('user_memories');
  });
  it('stops deletion if the initial message deletion fails', async () => {
    vi.mocked(deleteAllMessages).mockResolvedValue(false);
    service.scheduleOperation('DELETE_ALL_DATA', { userId: 'u1' }); online(true); await service.processQueue();
    expect(db.from).not.toHaveBeenCalled(); expect(getSyncQueue()).toHaveLength(1);
  });
  it('deletes all child data after successful message deletion', async () => {
    service.scheduleOperation('DELETE_ALL_DATA', { userId: 'u1' }); online(true); await service.processQueue();
    expect(db.from).toHaveBeenCalledTimes(5); expect(getSyncQueue()).toEqual([]);
  });
  it('handles rejected network promises without losing work', async () => {
    vi.mocked(saveUserGoals).mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.scheduleOperation('SAVE_GOALS', { userId: 'u1', goals: [] }); online(true); await service.processQueue();
    expect(getSyncQueue<SyncOperation>()[0].retryCount).toBe(1);
  });
  it('drains a message added during a request without duplicate processing', async () => {
    vi.mocked(saveWorkoutProgress).mockImplementation(async () => {
      service.scheduleOperation('SAVE_MESSAGE', { userId: 'u1', message: { id: 'm1', role: 'user', text: 'Ready', timestamp: 123 } });
      return true;
    });
    service.scheduleOperation('SAVE_WORKOUT_PROGRESS', progress()); online(true);
    await Promise.all([service.processQueue(), service.processQueue()]);
    expect(saveWorkoutProgress).toHaveBeenCalledOnce(); expect(saveMessage).toHaveBeenCalledOnce();
    expect(getSyncQueue()).toEqual([]);
  });
});
