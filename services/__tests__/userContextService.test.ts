import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoalStreakSummary, getMovementBaseline, getScheduleProfile, getPsychologySummary, inferHabitsFromData, getFullUserContext, buildLifeContext, inferTargetFrequency } from '../userContextService';
import * as database from '../supabaseService';
import { findRelevantMemories } from '../embeddingService';
import { getFitnessData, getFitnessDataLast7Days } from '../fitnessService';
import { STORAGE_KEYS } from '../../constants/app';
vi.mock('../supabaseService', () => ({ getUserGoals: vi.fn(), getAllStreaks: vi.fn(), getRecentWorkouts: vi.fn(), getRecentMemories: vi.fn(), getUpcomingEvents: vi.fn(), getOnboardingState: vi.fn() }));
vi.mock('../embeddingService', () => ({ findRelevantMemories: vi.fn() }));
vi.mock('../fitnessService', () => ({ getFitnessData: vi.fn(), getFitnessDataLast7Days: vi.fn() }));
const now = new Date('2026-10-24T12:00:00Z');
const goal = { id: 'g1', goal_type: 'strength', goal_label: 'Build strength', motivation: 'Feel stronger', created_at: now.toISOString() };
beforeEach(() => {
  vi.clearAllMocks(); vi.useRealTimers(); vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  for (const fn of [database.getUserGoals, database.getAllStreaks, database.getRecentWorkouts, database.getRecentMemories, database.getUpcomingEvents]) vi.mocked(fn).mockResolvedValue([]);
  vi.mocked(database.getOnboardingState).mockResolvedValue(null); vi.mocked(findRelevantMemories).mockResolvedValue([]);
  vi.mocked(getFitnessData).mockResolvedValue({ steps: 0, activeMinutes: 0, calories: 0, stepsGoal: 8000, dataSource: 'google_fit' });
  vi.mocked(getFitnessDataLast7Days).mockResolvedValue([]);
});

describe('goal attribution and context aggregation', () => {
  it('attributes explicit goal tags and counts each completed date once', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.mocked(database.getUserGoals).mockResolvedValue([goal] as never);
    vi.mocked(database.getRecentWorkouts).mockResolvedValue([
      { completed: true, created_at: now.toISOString(), goal_ids: ['g1'], workout_type: 'strength' },
      { completed: true, created_at: now.toISOString(), goal_ids: ['g1'] },
      { completed: true, created_at: '2026-10-23T12:00:00Z', workout_type: 'strength' },
      { completed: false, created_at: '2026-10-22T12:00:00Z', goal_ids: ['g1'] },
    ] as never);
    expect((await getGoalStreakSummary('user')).g1).toEqual({ currentStreak: 2, bestStreak: 2, completionsThisWeek: 2 });
    vi.useRealTimers();
  });
  it('preserves legacy streak fallback and returns safe defaults after failures', async () => {
    vi.mocked(database.getUserGoals).mockResolvedValue([goal] as never);
    vi.mocked(database.getAllStreaks).mockResolvedValue([{ habit_type: 'workout', current_streak: 3, longest_streak: 8 }] as never);
    expect((await getGoalStreakSummary('user')).g1).toMatchObject({ currentStreak: 3, bestStreak: 8 });
    vi.mocked(database.getUserGoals).mockRejectedValue(new Error('offline')); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getGoalStreakSummary('user')).toEqual({}); expect(await getFullUserContext('user')).toBeNull();
  });
  it('uses semantic search when available and falls back to stored memories', async () => {
    vi.mocked(database.getUserGoals).mockResolvedValue([goal] as never);
    vi.mocked(findRelevantMemories).mockResolvedValue(['Prefers short sessions']);
    expect(await getFullUserContext('user', 'workout')).toMatchObject({ goals: [{ label: 'Build strength' }], relevantMemories: ['Prefers short sessions'] });
    vi.mocked(findRelevantMemories).mockRejectedValue(new Error('unavailable')); vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(database.getRecentMemories).mockResolvedValue([{ content: 'Enjoys mornings' }] as never);
    expect((await getFullUserContext('user', 'workout'))?.relevantMemories).toEqual(['Enjoys mornings']);
  });
});

describe('movement data provenance', () => {
  it('does not turn simulated values into measured history', async () => {
    vi.mocked(getFitnessData).mockResolvedValue({ steps: 9000, activeMinutes: 90, calories: 50, stepsGoal: 8000, dataSource: 'simulated' });
    expect(await getMovementBaseline('user')).toMatchObject({ source: 'none', avgDailySteps: undefined, last7Days: [] });
    expect((await buildLifeContext('user'))?.suggestedNextAction).toContain('Movement data unavailable');
  });
  it('averages actual days and keeps a single measured day when history is unavailable', async () => {
    localStorage.setItem(STORAGE_KEYS.FITNESS_TOKEN, 'token');
    vi.mocked(getFitnessDataLast7Days).mockResolvedValue([{ date: '2026-10-23', steps: 4000, activeMinutes: 10 }, { date: '2026-10-24', steps: 8000, activeMinutes: 20 }]);
    expect(await getMovementBaseline('user')).toMatchObject({ source: 'google_fit', avgDailySteps: 6000, avgDailyActiveMinutes: 15 });
    vi.mocked(getFitnessDataLast7Days).mockResolvedValue([]);
    expect((await getMovementBaseline('user')).last7Days).toHaveLength(1);
  });
  it.each([0, 3000, 6000, 10000])('describes measured movement at %i steps', async steps => {
    vi.mocked(getFitnessData).mockResolvedValue({ steps, activeMinutes: steps / 100, calories: 0, stepsGoal: 8000, dataSource: 'google_fit' });
    expect((await getMovementBaseline('user')).patternSummary.length).toBeGreaterThan(10);
  });
});

describe('schedule, habits and coaching profile', () => {
  it.each(['morning', 'afternoon', 'evening'])('uses the user-reported %s training preference', async preferredWorkoutTime => {
    vi.mocked(database.getOnboardingState).mockResolvedValue({ preferredWorkoutTime } as never);
    expect((await getScheduleProfile('user')).preferredTrainingWindows[0].source).toBe('user_reported');
  });
  it('keeps unknown habits unknown and summarizes volunteered preferences', async () => {
    expect(inferHabitsFromData({}).sleepConsistency?.avgHours).toBeUndefined();
    expect(inferHabitsFromData({ onboarding: { typicalSleepHours: 7, stressBaseline: 'high', preferredWorkoutTime: 'morning' } })).toMatchObject({ sleepConsistency: { avgHours: 7 }, stressSignals: { userReportedLevel: 'high' } });
    vi.mocked(database.getOnboardingState).mockResolvedValue({ primaryMotivation: 'stress relief', motivationDetails: 'Better sleep', stressBaseline: 'high' } as never);
    vi.mocked(database.getRecentMemories).mockResolvedValue([{ content: 'I feel overwhelmed and anxious; I am a perfectionist' }] as never);
    const psychology = await getPsychologySummary('user'); expect(psychology.primaryWhy).toBe('stress relief'); expect(psychology.riskPatterns).toContain('burnout_risk');
    expect((await getScheduleProfile(null)).preferredTrainingWindows).toEqual([]);
  });
  it('builds a useful anonymous profile without claiming a known identity', async () => {
    expect(await buildLifeContext(null)).toMatchObject({ profile: {}, goals: [] });
    expect(inferTargetFrequency({ type: 'strength' })).toBe(3); expect(inferTargetFrequency({ type: 'mindfulness' })).toBe(5); expect(inferTargetFrequency({ type: 'other' })).toBeUndefined();
  });
  it('builds a personalized context and retains explicit goal metadata', async () => {
    vi.mocked(database.getUserGoals).mockResolvedValue([goal] as never);
    vi.mocked(database.getOnboardingState).mockResolvedValue({ preferredActivityTypes: ['gym'], preferredWorkoutTime: 'evening' } as never);
    expect(await buildLifeContext('user')).toMatchObject({ profile: { environment: 'gym_access' }, goals: [{ id: 'g1', type: 'strength', targetPerWeek: 3 }] });
  });
});
