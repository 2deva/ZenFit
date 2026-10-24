import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserGoals, getStepGoalForUser, saveWorkoutProgress, getWorkoutProgress, getRecentWorkouts, getOnboardingState, updateOnboardingState, getMessages, saveMessage, getUpcomingEvents } from '../supabaseService';

const { query, client } = vi.hoisted(() => {
  const query: any = { result: { data: null, error: null } };
  for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'gte', 'order', 'limit', 'maybeSingle', 'single']) query[method] = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(query.result).then(resolve);
  return { query, client: { from: vi.fn(() => query) } };
});
vi.mock('../../supabaseConfig', () => ({ supabase: client }));

beforeEach(() => {
  vi.clearAllMocks(); query.result = { data: null, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('data access compatibility after domain separation', () => {
  it('queries only active goals for the selected user', async () => {
    query.result.data = [{ id: 'goal-1' }];
    expect(await getUserGoals('user-1')).toEqual([{ id: 'goal-1' }]);
    expect(client.from).toHaveBeenCalledWith('user_goals');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(query.eq).toHaveBeenCalledWith('is_active', true);
  });
  it.each([500, 1000, 12000, 50000, 50001])('resolves step target %i within supported bounds', async target_value => {
    query.result.data = [{ goal_type: 'cardio', goal_label: 'Steps', target_value }];
    expect(await getStepGoalForUser('user-1')).toBe(target_value >= 1000 && target_value <= 50000 ? target_value : 8000);
  });
  it('uses a stable conflict key for progress upserts', async () => {
    expect(await saveWorkoutProgress('user-1', 'workout-1', [0, 1], 2)).toBe(true);
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', workout_id: 'workout-1', completed_indices: [0, 1], active_idx: 2 }), { onConflict: 'user_id,workout_id' });
  });
  it('maps persisted progress and applies missing-field defaults', async () => {
    query.result.data = { completed_indices: [0], active_idx: 1 };
    expect(await getWorkoutProgress('user-1', 'workout-1')).toEqual({ completed: [0], activeIdx: 1 });
    query.result.data = {};
    expect(await getWorkoutProgress('user-1', 'workout-1')).toEqual({ completed: [], activeIdx: 0 });
  });
  it('maps onboarding data to application names', async () => {
    query.result.data = { id: 'onboarding-1', user_id: 'user-1', onboarding_stage: 'initial', primary_motivation: 'strength' };
    expect(await getOnboardingState('user-1')).toMatchObject({ userId: 'user-1', stage: 'initial', primaryMotivation: 'strength', healthConditions: [], preferredActivityTypes: [] });
    expect(await updateOnboardingState('user-1', { totalInteractions: 4, primaryMotivation: 'cardio' })).toBe(true);
    expect(query.update).toHaveBeenCalledWith({ total_interactions: 4, primary_motivation: 'cardio' });
  });
  it('reports failed writes through the existing boolean contract', async () => {
    query.result.error = { message: 'database unavailable' };
    expect(await saveWorkoutProgress('user-1', 'workout-1', [], 0)).toBe(false);
    expect(await updateOnboardingState('user-1', { totalInteractions: 1 })).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
  it('preserves empty read fallbacks on database failure', async () => {
    query.result.error = { message: 'database unavailable' };
    expect(await getUserGoals('user-1')).toEqual([]);
    expect(await getRecentWorkouts('user-1')).toEqual([]);
    expect(await getMessages('user-1')).toEqual([]);
    expect(await getUpcomingEvents('user-1')).toEqual([]);
    expect(await getWorkoutProgress('user-1', 'workout-1')).toBeNull();
  });
  it('persists message routing metadata', async () => {
    expect(await saveMessage('user-1', { id: 'message-1', role: 'user', text: 'Ready', timestamp: 123, messageContext: 'workout_guidance', relatedWorkoutId: 'workout-1' })).toBe(true);
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'message-1', message_context: 'workout_guidance', related_workout_id: 'workout-1' }));
  });
});
