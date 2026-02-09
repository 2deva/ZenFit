/**
 * Calendar nudge: when user misses workout days, add a return event to their calendar.
 * Escalates based on gap length: 1-2 days (workout), 3-7 days (stretch), 7+ days (check-in).
 * The event description includes a deep link so the user can open the app.
 */

import { STORAGE_KEYS } from '../constants/app';
import { getRecentWorkouts } from './supabaseService';
import { createCalendarEvent } from './calendarService';
import { createScheduledEvent } from './supabaseService';
import { supabase } from '../supabaseConfig';

export const RETURN_WORKOUT_PARAM = 'start=return-workout';

/**
 * Track nudge actions for feedback loop (click, complete, dismiss)
 */
export async function trackNudgeAction(
  userId: string,
  action: 'deep_link_clicked' | 'workout_completed' | 'dismissed'
): Promise<void> {
  try {
    await supabase.from('nudge_actions').insert({
      user_id: userId,
      action,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('Failed to track nudge action:', e);
  }
}

/**
 * Get the optimal hour for nudging this user based on past response patterns.
 * Returns the hour (0-23) when they most often clicked nudge links.
 * Falls back to preferredHour if no data.
 */
export async function getOptimalNudgeHour(
  userId: string,
  preferredHour: number = 18
): Promise<number> {
  try {
    const { data } = await supabase
      .from('nudge_actions')
      .select('created_at')
      .eq('user_id', userId)
      .eq('action', 'deep_link_clicked')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!data || data.length < 3) return preferredHour; // Need minimum data

    // Count clicks per hour
    const hourCounts: Record<number, number> = {};
    for (const row of data) {
      const hour = new Date(row.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    // Find hour with most clicks
    let bestHour = preferredHour;
    let maxCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestHour = parseInt(hour);
      }
    }

    return bestHour;
  } catch (e) {
    console.warn('Failed to get optimal nudge hour:', e);
    return preferredHour;
  }
}

export function getReturnWorkoutDeepLink(): string {
  if (typeof window === 'undefined') return '';
  const base = `${window.location.origin}${window.location.pathname || '/'}`.replace(/\/$/, '') || window.location.origin;
  return `${base}?${RETURN_WORKOUT_PARAM}`;
}

/**
 * Check if user is making a comeback after a gap.
 * Returns celebration message if they are, null otherwise.
 */
export async function checkStreakComeback(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('workout_sessions')
      .select('created_at, completed')
      .eq('user_id', userId)
      .eq('completed', true)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!data || data.length < 2) return null;

    // Check gap between most recent (today) and second most recent workout
    const today = new Date().toISOString().split('T')[0];
    const mostRecent = data[0]?.created_at?.split('T')[0];
    if (mostRecent !== today) return null; // Not completing today

    const previousDate = data[1]?.created_at?.split('T')[0];
    if (!previousDate) return null;

    const daysSinceLastWorkout = Math.floor(
      (new Date(today).getTime() - new Date(previousDate).getTime()) / (24 * 60 * 60 * 1000)
    );

    if (daysSinceLastWorkout >= 2 && daysSinceLastWorkout <= 7) {
      return "Welcome back! 🎉 Coming back after a break is the hardest part, and you did it.";
    }
    if (daysSinceLastWorkout > 7) {
      return "Look at you! 🌟 After a longer break, you showed up. That takes real strength.";
    }

    return null; // No gap or gap too short
  } catch (e) {
    console.warn('Failed to check streak comeback:', e);
    return null;
  }
}

/**
 * Nudge configuration based on days missed
 */
const PREFERRED_HOUR: Record<string, number> = { morning: 7, afternoon: 13, evening: 18 };

interface NudgeConfig {
  title: string;
  durationMinutes: number;
  description: string;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Returns nudge config based on days missed AND time of day.
 * Morning: energizing start. Afternoon: quick energy boost. Evening: gentle wind-down.
 */
function getNudgeConfig(daysMissed: number, timeOfDay: TimeOfDay = getTimeOfDay()): NudgeConfig | null {
  if (daysMissed === 1 || daysMissed === 2) {
    // Recent miss: full return workout, tailored to time
    const variants: Record<TimeOfDay, NudgeConfig> = {
      morning: {
        title: 'Zenfit: 10-min morning activation',
        durationMinutes: 10,
        description: 'Start your day with movement. Quick workout to activate your body.'
      },
      afternoon: {
        title: 'Zenfit: 10-min energy boost',
        durationMinutes: 10,
        description: 'Beat the afternoon slump. Quick workout to re-energize.'
      },
      evening: {
        title: 'Zenfit: 10-min evening workout',
        durationMinutes: 10,
        description: "Gentle return session - you've got this."
      }
    };
    return variants[timeOfDay];
  }

  if (daysMissed >= 3 && daysMissed <= 7) {
    // Medium gap: gentle re-entry
    const variants: Record<TimeOfDay, NudgeConfig> = {
      morning: {
        title: 'Zenfit: 5-min morning stretch',
        durationMinutes: 5,
        description: 'Gentle stretching to wake up your body. No pressure.'
      },
      afternoon: {
        title: 'Zenfit: 5-min desk stretch',
        durationMinutes: 5,
        description: 'Quick stretch break. Just 5 minutes of movement.'
      },
      evening: {
        title: 'Zenfit: 5-min wind-down stretch',
        durationMinutes: 5,
        description: 'Relaxing stretches to release the day. Breathe and unwind.'
      }
    };
    return variants[timeOfDay];
  }

  if (daysMissed > 7) {
    // Long gap: minimal friction, just check in
    return {
      title: 'Zenfit: Quick check-in',
      durationMinutes: 3,
      description: "Open the app and say hi — that's all. We'll figure out next steps together."
    };
  }

  return null; // Worked out today or no history
}

/**
 * If user missed workouts, calendar connected, and we haven't nudged today: add appropriate return event.
 * Escalates based on gap length: 1-2 days (workout), 3-7 days (stretch), 7+ days (check-in).
 */
export async function tryCalendarNudge(
  userId: string,
  onboarding?: { preferredWorkoutTime?: string | null } | null,
  idToken?: string | null
): Promise<void> {
  try {
    if (!idToken) return;

    const today = new Date().toISOString().split('T')[0];
    if (localStorage.getItem(STORAGE_KEYS.CALENDAR_NUDGE_DATE) === today) return;

    const recent = await getRecentWorkouts(userId, 14); // Extended to 14 days for longer gaps
    if (recent.some((w) => w.completed && w.created_at.startsWith(today))) return;

    const lastCompleted = recent.find((w) => w.completed);
    if (!lastCompleted) return;

    const lastDate = lastCompleted.created_at.split('T')[0];
    const daysMissed = Math.floor(
      (new Date(today).getTime() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000)
    );

    const nudgeConfig = getNudgeConfig(daysMissed);
    if (!nudgeConfig) return;

    // Use learned optimal hour, falling back to preferred time
    const preferredHour = PREFERRED_HOUR[(onboarding?.preferredWorkoutTime || 'evening').toLowerCase()] ?? 18;
    const hour = await getOptimalNudgeHour(userId, preferredHour);

    const start = new Date();
    start.setHours(hour, 0, 0, 0);
    if (start <= new Date()) {
      start.setDate(start.getDate() + 1);
    }

    const deepLink = getReturnWorkoutDeepLink();
    const description = deepLink
      ? `${nudgeConfig.description}\n\nStart: ${deepLink}`
      : nudgeConfig.description;

    const created = await createCalendarEvent({
      summary: nudgeConfig.title,
      start,
      durationMinutes: nudgeConfig.durationMinutes,
      description,
    }, idToken);

    if (created) {
      localStorage.setItem(STORAGE_KEYS.CALENDAR_NUDGE_DATE, today);
      await createScheduledEvent(userId, {
        eventType: 'nudge',
        title: nudgeConfig.title,
        scheduledAt: start.toISOString(),
        googleEventId: created.id,
      });
    }
  } catch (e) {
    console.warn('Calendar nudge skipped or failed:', e);
  }
}

