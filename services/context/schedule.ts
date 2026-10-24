import { getOnboardingState, getUpcomingEvents } from '../supabaseService';
import type { LifeContextSchedule } from '../../types';

export async function getScheduleProfile(userId: string | null): Promise<LifeContextSchedule> {
    const now = new Date();

    if (!userId) {
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: [],
            hardBusyBlocksSummary: 'No account-linked schedule data available. Assume a standard day and ask the user when they prefer to move.'
        };
    }

    try {
        const onboarding = await getOnboardingState(userId);
        const upcoming = await getUpcomingEvents(userId, 10);

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Map preferredWorkoutTime (e.g. 'morning', 'afternoon', 'evening') into windows
        const trainingWindows: LifeContextSchedule['preferredTrainingWindows'] = [];
        const preferred = onboarding?.preferredWorkoutTime?.toLowerCase();

        const addWindow = (label: string, startHour: number, endHour: number, source: LifeContextSchedule['preferredTrainingWindows'][number]['source']) => {
            trainingWindows.push({
                label,
                days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                start: `${String(startHour).padStart(2, '0')}:00`,
                end: `${String(endHour).padStart(2, '0')}:00`,
                source
            });
        };

        if (preferred === 'morning') {
            addWindow('morning_block', 6, 9, 'user_reported');
        } else if (preferred === 'evening') {
            addWindow('evening_block', 17, 20, 'user_reported');
        } else if (preferred === 'afternoon') {
            addWindow('afternoon_block', 12, 14, 'user_reported');
        }

        // Derive busy periods from upcoming scheduled events (e.g., workouts / meetings)
        const busyCounts: Record<string, number> = {};
        for (const ev of upcoming) {
            if (!ev.scheduled_at) continue;
            const start = new Date(ev.scheduled_at);
            const hour = start.getHours();
            const bucket =
                hour < 9 ? 'early_morning' :
                    hour < 12 ? 'late_morning' :
                        hour < 17 ? 'afternoon' :
                            hour < 21 ? 'evening' : 'late_night';
            busyCounts[bucket] = (busyCounts[bucket] || 0) + 1;
        }

        const busiest = Object.entries(busyCounts).sort((a, b) => b[1] - a[1])[0];
        let hardBusyBlocksSummary = '';
        if (busiest) {
            const [slot] = busiest;
            switch (slot) {
                case 'early_morning':
                    hardBusyBlocksSummary = 'Mornings are often busy based on scheduled events. Avoid stacking long sessions before 9 AM unless the user asks.';
                    break;
                case 'late_morning':
                    hardBusyBlocksSummary = 'Late mornings are frequently booked. Consider suggesting early morning, afternoon, or evening sessions.';
                    break;
                case 'afternoon':
                    hardBusyBlocksSummary = 'Afternoons are often busy. Prefer morning or evening for new commitments.';
                    break;
                case 'evening':
                    hardBusyBlocksSummary = 'Evenings are usually busy. Be cautious suggesting long sessions after work hours.';
                    break;
                default:
                    hardBusyBlocksSummary = 'No strong busy time patterns detected in scheduled events.';
            }
        } else {
            hardBusyBlocksSummary = 'No upcoming events found. Use simple, flexible suggestions and ask the user about their preferred times.';
        }

        return {
            timezone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: trainingWindows,
            hardBusyBlocksSummary
        };
    } catch (e) {
        console.error('Error building schedule profile:', e);
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            typicalWakeTime: undefined,
            typicalSleepTime: undefined,
            preferredTrainingWindows: [],
            hardBusyBlocksSummary: 'Schedule information could not be loaded. Default to asking the user when they prefer to move.'
        };
    }
}

/**
 * Build a high-level psychological profile from onboarding data and
 * recent memories. This is intentionally coarse and focused on motivation
 * and coaching style, not any clinical assessment.
 */
