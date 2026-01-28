/**
 * Tool Integration Service
 *
 * Connects UI tools with data persistence, habit tracking, and LifeContext.
 * Provides helper functions to generate UI props from user data and the
 * same underlying helpers used by the conversational context.
 */

import { getStreak, getRecentWorkouts, getUserGoals } from './supabaseService';
import { normalizeGoalType } from './userContextService';

export interface ToolDataHelpers {
  generateStreakTimelineProps: (habitType: string, userId: string) => Promise<any>;
  generateHabitHeatmapProps: (habitType: string, userId: string, weeks?: number) => Promise<any>;
  generateChartProps: (metric: 'steps' | 'workouts' | 'activeMinutes' | 'streak', userId: string, days?: number) => Promise<any>;
  generateAchievementBadgeProps: (achievementType: string, userId: string) => Promise<any>;
  generateDashboardProps: (fitnessStats: any) => any;
  getDashboardSnapshot: (userId: string, fitnessStats?: any) => Promise<DashboardSnapshot>;
}

export type DashboardAchievementKey =
  | 'first_workout'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'workouts_10'
  | 'workouts_25'
  | 'consistency_week';

export interface DashboardSnapshot {
  generatedAt: number;
  userId: string;
  goals: Array<{
    id: string;
    type: string;
    label: string;
    motivation: string | null;
    createdAt: string;
  }>;
  recentWorkouts: Array<{
    workoutType: string | null;
    durationSeconds: number | null;
    completed: boolean;
    createdAt: string;
  }>;
  tools: {
    dashboard?: ReturnType<typeof generateDashboardProps>;
    streakTimeline: Awaited<ReturnType<typeof generateStreakTimelineProps>>;
    habitHeatmap: Awaited<ReturnType<typeof generateHabitHeatmapProps>>;
    weeklyWorkoutsChart: Awaited<ReturnType<typeof generateChartProps>>;
  };
  achievements: {
    unlocked: Array<{ key: DashboardAchievementKey; props: Awaited<ReturnType<typeof generateAchievementBadgeProps>> }>;
    nextUp: Array<{ key: DashboardAchievementKey; props: Awaited<ReturnType<typeof generateAchievementBadgeProps>> }>;
  };
}

const DASHBOARD_ACHIEVEMENTS: DashboardAchievementKey[] = [
  'first_workout',
  'streak_7',
  'streak_14',
  'streak_30',
  'workouts_10',
  'workouts_25',
  'consistency_week'
];

/**
 * Unified, single-source snapshot for the profile dashboard popup.
 * This is the canonical aggregator used by UI (popup) + other surfaces.
 */
export async function getDashboardSnapshot(
  userId: string,
  fitnessStats?: { steps: number; calories: number; activeMinutes: number; stepsGoal: number }
): Promise<DashboardSnapshot> {
  const generatedAt = Date.now();

  try {
    const [
      goalsRaw,
      recentWorkoutsRaw,
      streakTimeline,
      habitHeatmap,
      weeklyWorkoutsChart,
      achievementsProps
    ] = await Promise.all([
      getUserGoals(userId),
      getRecentWorkouts(userId, 30),
      generateStreakTimelineProps('workout', userId),
      generateHabitHeatmapProps('workout', userId, 12),
      generateChartProps('workouts', userId, 7),
      Promise.all(
        DASHBOARD_ACHIEVEMENTS.map(async (key) => ({
          key,
          props: await generateAchievementBadgeProps(key, userId)
        }))
      )
    ]);

    const goals = goalsRaw.map(g => ({
      id: g.id,
      type: normalizeGoalType(g.goal_type),
      label: g.goal_label,
      motivation: g.motivation,
      createdAt: g.created_at
    }));

    const recentWorkouts = (recentWorkoutsRaw || []).map(w => ({
      workoutType: w.workout_type ?? null,
      durationSeconds: w.duration_seconds ?? null,
      completed: !!w.completed,
      createdAt: w.created_at
    }));

    const unlocked = achievementsProps.filter(a => a.props?.unlocked);
    const nextUp = achievementsProps.filter(a => !a.props?.unlocked);

    return {
      generatedAt,
      userId,
      goals,
      recentWorkouts,
      tools: {
        dashboard: fitnessStats ? generateDashboardProps(fitnessStats) : undefined,
        streakTimeline,
        habitHeatmap,
        weeklyWorkoutsChart
      },
      achievements: {
        unlocked,
        nextUp
      }
    };
  } catch (error) {
    console.error('Error generating dashboard snapshot:', error);
    return {
      generatedAt,
      userId,
      goals: [],
      recentWorkouts: [],
      tools: {
        dashboard: fitnessStats ? generateDashboardProps(fitnessStats) : undefined,
        streakTimeline: { habitName: 'Workout', currentStreak: 0, longestStreak: 0, days: [] },
        habitHeatmap: { habitName: 'Workout', weeks: 12, data: [] },
        weeklyWorkoutsChart: { chartTitle: 'Workouts Completed (Last 7 Days)', dataKey: 'value', data: [] }
      },
      achievements: { unlocked: [], nextUp: [] }
    };
  }
}

/**
 * Generate props for StreakTimeline component from user data
 */
export async function generateStreakTimelineProps(
  habitType: string,
  userId: string
): Promise<{
  habitName: string;
  currentStreak: number;
  longestStreak: number;
  days: Array<{ date: string; completed: boolean }>;
}> {
  try {
    const streak = await getStreak(userId, habitType);
    const recentWorkouts = await getRecentWorkouts(userId, 14);

    const currentStreak = streak?.current_streak || 0;
    const longestStreak = streak?.longest_streak || currentStreak;

    // Generate days array for last 14 days
    const days = Array.from({ length: 14 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (13 - i));
      const dateStr = date.toISOString().split('T')[0];

      // Check if there's a workout on this date
      const hasWorkout = recentWorkouts.some(w => {
        const workoutDate = new Date(w.created_at).toISOString().split('T')[0];
        return workoutDate === dateStr && w.completed;
      });

      return {
        date: dateStr,
        completed: hasWorkout
      };
    });

    return {
      habitName: habitType.charAt(0).toUpperCase() + habitType.slice(1),
      currentStreak,
      longestStreak,
      days
    };
  } catch (error) {
    console.error('Error generating streak timeline props:', error);
    return {
      habitName: habitType,
      currentStreak: 0,
      longestStreak: 0,
      days: []
    };
  }
}

/**
 * Generate props for HabitHeatmap component from user data
 */
export async function generateHabitHeatmapProps(
  habitType: string,
  userId: string,
  weeks: number = 12
): Promise<{
  habitName: string;
  weeks: number;
  data: Array<{ date: string; value: number }>;
}> {
  try {
    const recentWorkouts = await getRecentWorkouts(userId, weeks * 7);

    // Generate data for the specified number of weeks
    const days: Array<{ date: string; value: number }> = [];
    const today = new Date();

    for (let i = weeks * 7 - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Find workouts on this date
      const dayWorkouts = recentWorkouts.filter(w => {
        const workoutDate = new Date(w.created_at).toISOString().split('T')[0];
        return workoutDate === dateStr && w.completed;
      });

      // Calculate intensity value (0-4)
      // 0 = no activity, 1 = light, 2 = moderate, 3 = intense, 4 = very intense
      let value = 0;
      if (dayWorkouts.length > 0) {
        // Check duration to estimate intensity
        const totalDuration = dayWorkouts.reduce((sum, w) => sum + (w.duration_seconds || 0), 0);
        const minutes = totalDuration / 60;

        if (minutes >= 45) value = 4; // Very intense
        else if (minutes >= 30) value = 3; // Intense
        else if (minutes >= 15) value = 2; // Moderate
        else value = 1; // Light
      }

      days.push({ date: dateStr, value });
    }

    return {
      habitName: habitType.charAt(0).toUpperCase() + habitType.slice(1),
      weeks,
      data: days
    };
  } catch (error) {
    console.error('Error generating habit heatmap props:', error);
    return {
      habitName: habitType,
      weeks,
      data: []
    };
  }
}

/**
 * Generate props for Chart component from user data
 */
export async function generateChartProps(
  metric: 'steps' | 'workouts' | 'activeMinutes' | 'streak',
  userId: string,
  days: number = 7
): Promise<{
  chartTitle: string;
  dataKey: string;
  data: Array<{ name: string; value: number }>;
}> {
  try {
    const recentWorkouts = await getRecentWorkouts(userId, days);

    // Group by day
    const dayData: Record<string, number> = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = dayNames[date.getDay()];

      switch (metric) {
        case 'workouts':
          dayData[dayName] = recentWorkouts.filter(w => {
            const workoutDate = new Date(w.created_at).toISOString().split('T')[0];
            return workoutDate === dateStr && w.completed;
          }).length;
          break;
        case 'activeMinutes':
          dayData[dayName] = recentWorkouts
            .filter(w => {
              const workoutDate = new Date(w.created_at).toISOString().split('T')[0];
              return workoutDate === dateStr && w.completed;
            })
            .reduce((sum, w) => sum + Math.floor((w.duration_seconds || 0) / 60), 0);
          break;
        case 'streak':
          // For streak, we need to calculate daily streak value
          const streak = await getStreak(userId, 'workout');
          dayData[dayName] = streak?.current_streak || 0;
          break;
        default:
          dayData[dayName] = 0;
      }
    }

    const data = Object.entries(dayData).map(([name, value]) => ({ name, value }));

    const titles: Record<string, string> = {
      steps: `Daily Steps (Last ${days} Days)`,
      workouts: `Workouts Completed (Last ${days} Days)`,
      activeMinutes: `Active Minutes (Last ${days} Days)`,
      streak: `Streak Progress (Last ${days} Days)`
    };

    return {
      chartTitle: titles[metric] || `Progress (Last ${days} Days)`,
      dataKey: 'value',
      data
    };
  } catch (error) {
    console.error('Error generating chart props:', error);
    return {
      chartTitle: `Progress (Last ${days} Days)`,
      dataKey: 'value',
      data: []
    };
  }
}

/**
 * Generate props for AchievementBadge component
 */
export async function generateAchievementBadgeProps(
  achievementType: string,
  userId: string
): Promise<{
  type: 'streak' | 'milestone' | 'first' | 'consistency' | 'challenge' | 'special';
  title: string;
  description?: string;
  value?: number;
  unlocked: boolean;
  celebrateOnMount: boolean;
}> {
  try {
    const streak = await getStreak(userId, 'workout');
    const recentWorkouts = await getRecentWorkouts(userId, 30);
    const completedWorkouts = recentWorkouts.filter(w => w.completed).length;
    const currentStreak = streak?.current_streak || 0;

    // Determine achievement type and details
    let type: 'streak' | 'milestone' | 'first' | 'consistency' | 'challenge' | 'special' = 'streak';
    let title = '';
    let description = '';
    let value: number | undefined = undefined;
    let unlocked = false;
    let celebrateOnMount = false;

    switch (achievementType) {
      case 'first_workout':
        if (completedWorkouts >= 1) {
          type = 'first';
          title = 'First Steps';
          description = 'You completed your first workout!';
          value = 1;
          unlocked = true;
          celebrateOnMount = true;
        }
        break;

      case 'streak_7':
        if (currentStreak >= 7) {
          type = 'streak';
          title = 'Week Warrior';
          description = '7-day streak achieved!';
          value = 7;
          unlocked = true;
          celebrateOnMount = currentStreak === 7; // Only celebrate when first hitting 7
        }
        break;

      case 'streak_14':
        if (currentStreak >= 14) {
          type = 'streak';
          title = 'Two Week Champion';
          description = '14-day streak achieved!';
          value = 14;
          unlocked = true;
          celebrateOnMount = currentStreak === 14;
        }
        break;

      case 'streak_30':
        if (currentStreak >= 30) {
          type = 'streak';
          title = 'Monthly Master';
          description = '30-day streak achieved!';
          value = 30;
          unlocked = true;
          celebrateOnMount = currentStreak === 30;
        }
        break;

      case 'workouts_10':
        if (completedWorkouts >= 10) {
          type = 'milestone';
          title = 'Tenacious';
          description = '10 workouts completed!';
          value = 10;
          unlocked = true;
          celebrateOnMount = completedWorkouts === 10;
        }
        break;

      case 'workouts_25':
        if (completedWorkouts >= 25) {
          type = 'milestone';
          title = 'Quarter Century';
          description = '25 workouts completed!';
          value = 25;
          unlocked = true;
          celebrateOnMount = completedWorkouts === 25;
        }
        break;

      case 'consistency_week':
        // Check if user completed workouts 5+ days in the last week
        const weekWorkouts = recentWorkouts.filter(w => {
          const workoutDate = new Date(w.created_at);
          const daysAgo = Math.floor((Date.now() - workoutDate.getTime()) / (1000 * 60 * 60 * 24));
          return daysAgo <= 7 && w.completed;
        });
        const uniqueDays = new Set(weekWorkouts.map(w =>
          new Date(w.created_at).toISOString().split('T')[0]
        )).size;

        if (uniqueDays >= 5) {
          type = 'consistency';
          title = 'Consistency Champion';
          description = '5+ workouts this week!';
          value = uniqueDays;
          unlocked = true;
          celebrateOnMount = uniqueDays === 5;
        }
        break;

      default:
        // Default to current streak if no specific type
        type = 'streak';
        title = `${currentStreak}-Day Streak`;
        description = 'Keep the momentum going!';
        value = currentStreak;
        unlocked = currentStreak > 0;
    }

    return {
      type,
      title,
      description,
      value,
      unlocked,
      celebrateOnMount
    };
  } catch (error) {
    console.error('Error generating achievement badge props:', error);
    return {
      type: 'streak',
      title: 'Achievement',
      unlocked: false,
      celebrateOnMount: false
    };
  }
}

/**
 * Generate props for Dashboard component from fitness stats
 */
export function generateDashboardProps(fitnessStats: {
  steps: number;
  calories: number;
  activeMinutes: number;
  stepsGoal: number;
}): {
  dailyProgress: number;
  caloriesBurned: number;
  stepsTaken: number;
  stepsGoal: number;
  activeMinutes: number;
} {
  const dailyProgress = fitnessStats.stepsGoal > 0
    ? Math.min(100, Math.round((fitnessStats.steps / fitnessStats.stepsGoal) * 100))
    : 0;

  return {
    dailyProgress,
    caloriesBurned: fitnessStats.calories || 0,
    stepsTaken: fitnessStats.steps || 0,
    stepsGoal: fitnessStats.stepsGoal || 8000,
    activeMinutes: fitnessStats.activeMinutes || 0
  };
}

/**
 * Check if user should see progress visualization based on their activity
 */
export async function shouldShowProgressVisualization(
  userId: string,
  lastShown?: number
): Promise<boolean> {
  try {
    // Show progress visualization if:
    // 1. User has completed at least 3 workouts
    // 2. It's been at least 24 hours since last shown
    const recentWorkouts = await getRecentWorkouts(userId, 30);
    const completedCount = recentWorkouts.filter(w => w.completed).length;

    if (completedCount < 3) return false;

    if (lastShown) {
      const hoursSinceLastShown = (Date.now() - lastShown) / (1000 * 60 * 60);
      if (hoursSinceLastShown < 24) return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking progress visualization:', error);
    return false;
  }
}

/**
 * Get comprehensive tool data helpers
 */
export const toolDataHelpers: ToolDataHelpers = {
  generateStreakTimelineProps,
  generateHabitHeatmapProps,
  generateChartProps,
  generateAchievementBadgeProps,
  generateDashboardProps,
  getDashboardSnapshot
};
