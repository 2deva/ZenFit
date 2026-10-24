import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStreakTimelineProps, generateHabitHeatmapProps, generateChartProps, generateAchievementBadgeProps, generateDashboardProps, getDashboardSnapshot, shouldShowProgressVisualization } from '../toolIntegrationService';
import { getRecentWorkouts, getStreak, getUserGoals } from '../supabaseService';
vi.mock('../supabaseService', () => ({ getRecentWorkouts: vi.fn(), getStreak: vi.fn(), getUserGoals: vi.fn() }));
const now = new Date('2026-10-24T12:00:00Z');
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(getRecentWorkouts).mockResolvedValue([]); vi.mocked(getStreak).mockResolvedValue(null); vi.mocked(getUserGoals).mockResolvedValue([]);
});

describe('progress views from recorded activity', () => {
  it('renders empty charts without manufacturing sessions', async () => {
    expect((await generateChartProps('workouts', 'user', 7)).data.every(row => row.value === 0)).toBe(true);
    expect((await generateStreakTimelineProps('workout', 'user')).days.every(day => !day.completed)).toBe(true);
    expect((await generateHabitHeatmapProps('workout', 'user', 1)).data.every(day => day.value === 0)).toBe(true);
  });
  it('counts completed workouts in charts, heatmaps and streak history', async () => {
    vi.mocked(getRecentWorkouts).mockResolvedValue([
      { completed: true, created_at: now.toISOString(), duration_seconds: 600 },
      { completed: false, created_at: now.toISOString(), duration_seconds: 300 },
    ] as never);
    vi.mocked(getStreak).mockResolvedValue({ current_streak: 7, longest_streak: 9 } as never);
    expect((await generateChartProps('workouts', 'user', 7)).data.reduce((sum, row) => sum + row.value, 0)).toBe(1);
    expect((await generateChartProps('activeMinutes', 'user', 7)).data.reduce((sum, row) => sum + row.value, 0)).toBe(10);
    expect(await generateStreakTimelineProps('workout', 'user')).toMatchObject({ currentStreak: 7, longestStreak: 9 });
    expect((await generateHabitHeatmapProps('workout', 'user', 1)).data.some(day => day.value > 0)).toBe(true);
  });
  it.each(['first_workout', 'streak_7', 'streak_14', 'streak_30', 'workouts_10', 'workouts_25', 'consistency_week'])('unlocks %s only when the recorded threshold is met', async key => {
    expect((await generateAchievementBadgeProps(key, 'user')).unlocked).toBe(false);
    vi.mocked(getStreak).mockResolvedValue({ current_streak: 30, longest_streak: 30 } as never);
    vi.mocked(getRecentWorkouts).mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ completed: true, created_at: new Date(now.getTime() - (i % 7) * 86400000).toISOString(), duration_seconds: 300 })) as never);
    expect((await generateAchievementBadgeProps(key, 'user')).unlocked).toBe(true);
  });
  it('caps dashboard progress and carries its data provenance', () => {
    expect(generateDashboardProps({ steps: 12000, stepsGoal: 8000, activeMinutes: 30, calories: 100, dataSource: 'simulated' })).toMatchObject({ dailyProgress: 100, dataSource: 'simulated' });
    expect(generateDashboardProps({ steps: 0, stepsGoal: 0, activeMinutes: 0, calories: 0 }).dailyProgress).toBe(0);
  });
  it('honors visualization cooldown and builds a consistent snapshot', async () => {
    vi.mocked(getRecentWorkouts).mockResolvedValue(Array.from({ length: 3 }, () => ({ completed: true, created_at: now.toISOString() })) as never);
    expect(await shouldShowProgressVisualization('user')).toBe(true);
    expect(await shouldShowProgressVisualization('user', now.getTime() - 3600000)).toBe(false);
    expect(await getDashboardSnapshot('user')).toMatchObject({ userId: 'user', goals: [], tools: { weeklyWorkoutsChart: { chartType: 'bar' } } });
  });
  it('returns empty views when the database cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.mocked(getRecentWorkouts).mockRejectedValue(new Error('offline'));
    expect((await generateChartProps('workouts', 'user')).data).toEqual([]);
    expect((await generateHabitHeatmapProps('workout', 'user')).data).toEqual([]);
    expect((await generateStreakTimelineProps('workout', 'user')).days).toEqual([]);
    expect(await shouldShowProgressVisualization('user')).toBe(false);
    expect((await getDashboardSnapshot('user')).recentWorkouts).toEqual([]);
    vi.useRealTimers();
  });
});
