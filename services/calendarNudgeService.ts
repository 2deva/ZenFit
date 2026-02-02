/**
 * Calendar nudge: when user missed 1–2 workout days (not rest), add a simple return-workout event to their calendar.
 * Runs client-side; requires Supabase user, calendar token, and recent workout data.
 */

import { STORAGE_KEYS } from '../constants/app';
import { getRecentWorkouts } from './supabaseService';
import { createCalendarEvent } from './calendarService';
import { createScheduledEvent } from './supabaseService';

const NUDGE_TITLE = 'Zenfit: 10-min return workout';
const NUDGE_DURATION_MINUTES = 10;
const NUDGE_DESCRIPTION = 'Gentle return session — you’ve got this.';

const PREFERRED_HOUR: Record<string, number> = { morning: 7, afternoon: 13, evening: 18 };

/**
 * If user missed 1–2 workout days, calendar connected, and we haven't nudged today: add one return-workout event.
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

    const recent = await getRecentWorkouts(userId, 7);
    if (recent.some((w) => w.completed && w.created_at.startsWith(today))) return;

    const lastCompleted = recent.find((w) => w.completed);
    if (!lastCompleted) return;

    const lastDate = lastCompleted.created_at.split('T')[0];
    const daysMissed = Math.floor(
      (new Date(today).getTime() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000)
    );
    if (daysMissed !== 1 && daysMissed !== 2) return;

    const hour = PREFERRED_HOUR[(onboarding?.preferredWorkoutTime || 'evening').toLowerCase()] ?? 18;
    const start = new Date();
    start.setHours(hour, 0, 0, 0);
    if (start <= new Date()) {
      start.setDate(start.getDate() + 1);
    }

    const created = await createCalendarEvent({
      summary: NUDGE_TITLE,
      start,
      durationMinutes: NUDGE_DURATION_MINUTES,
      description: NUDGE_DESCRIPTION,
    }, idToken);

    if (created) {
      localStorage.setItem(STORAGE_KEYS.CALENDAR_NUDGE_DATE, today);
      await createScheduledEvent(userId, {
        eventType: 'workout',
        title: NUDGE_TITLE,
        scheduledAt: start.toISOString(),
        googleEventId: created.id,
      });
    }
  } catch (e) {
    console.warn('Calendar nudge skipped or failed:', e);
  }
}
