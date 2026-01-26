// Google Calendar Service for Zenfit
// Fetches user events and creates workout reminders

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
    id: string;
    summary: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    description?: string;
}

export interface TimeSlot {
    start: Date;
    end: Date;
    available: boolean;
}

import { STORAGE_KEYS } from '../constants/app';

/**
 * Get the OAuth access token from localStorage
 * Set during Firebase Google Sign-In
 */
const getAccessToken = (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN);
};

/**
 * Fetch upcoming events from the user's primary calendar
 */
export const getUpcomingEvents = async (maxResults = 10): Promise<CalendarEvent[]> => {
    const token = getAccessToken();
    if (!token) {
        console.warn('No OAuth token available for Calendar API');
        return [];
    }

    try {
        const now = new Date().toISOString();
        const oneWeekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const response = await fetch(
            `${CALENDAR_API_BASE}/calendars/primary/events?` +
            new URLSearchParams({
                timeMin: now,
                timeMax: oneWeekLater,
                maxResults: maxResults.toString(),
                singleEvents: 'true',
                orderBy: 'startTime'
            }),
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Calendar API error: ${response.status}`);
        }

        const data = await response.json();
        return data.items || [];
    } catch (e) {
        console.error('Failed to fetch calendar events:', e);
        return [];
    }
};

/**
 * Create a new event on the user's primary calendar
 */
export const createCalendarEvent = async (event: {
    summary: string;
    description?: string;
    start: Date;
    durationMinutes: number;
}): Promise<CalendarEvent | null> => {
    const token = getAccessToken();
    if (!token) {
        console.warn('No OAuth token available for Calendar API');
        return null;
    }

    try {
        const endTime = new Date(event.start.getTime() + event.durationMinutes * 60 * 1000);

        const response = await fetch(
            `${CALENDAR_API_BASE}/calendars/primary/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    summary: event.summary,
                    description: event.description || 'Created by Zenfit',
                    start: {
                        dateTime: event.start.toISOString(),
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    end: {
                        dateTime: endTime.toISOString(),
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: 'popup', minutes: 30 }
                        ]
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Calendar API error: ${response.status}`);
        }

        return await response.json();
    } catch (e) {
        console.error('Failed to create calendar event:', e);
        return null;
    }
};

/**
 * Analyze calendar to find free time slots
 */
export const findFreeTimeSlots = async (date: Date): Promise<TimeSlot[]> => {
    const events = await getUpcomingEvents(50);
    if (events.length === 0) {
        // If no events or no access, return simulated free slots
        return getDefaultFreeSlots(date);
    }

    const slots: TimeSlot[] = [];
    const dayStart = new Date(date);
    dayStart.setHours(6, 0, 0, 0); // Day starts at 6 AM

    const dayEnd = new Date(date);
    dayEnd.setHours(22, 0, 0, 0); // Day ends at 10 PM

    // Filter events for the target date
    const targetDateStr = date.toDateString();
    const dayEvents = events.filter(e => {
        const eventDate = new Date(e.start.dateTime || e.start.date || '');
        return eventDate.toDateString() === targetDateStr;
    }).sort((a, b) => {
        const aTime = new Date(a.start.dateTime || a.start.date || '').getTime();
        const bTime = new Date(b.start.dateTime || b.start.date || '').getTime();
        return aTime - bTime;
    });

    // Find gaps between events
    let currentTime = dayStart;
    for (const event of dayEvents) {
        const eventStart = new Date(event.start.dateTime || event.start.date || '');
        const eventEnd = new Date(event.end.dateTime || event.end.date || '');

        if (currentTime < eventStart) {
            slots.push({
                start: new Date(currentTime),
                end: new Date(eventStart),
                available: true
            });
        }
        currentTime = eventEnd > currentTime ? eventEnd : currentTime;
    }

    // Add remaining time until end of day
    if (currentTime < dayEnd) {
        slots.push({
            start: new Date(currentTime),
            end: dayEnd,
            available: true
        });
    }

    return slots.filter(slot =>
        (slot.end.getTime() - slot.start.getTime()) >= 30 * 60 * 1000 // At least 30 min
    );
};

/**
 * Get default free slots when calendar access is unavailable
 */
const getDefaultFreeSlots = (date: Date): TimeSlot[] => {
    const slots: TimeSlot[] = [];

    // Morning slot (6-9 AM)
    const morning = new Date(date);
    morning.setHours(6, 0, 0, 0);
    const morningEnd = new Date(date);
    morningEnd.setHours(9, 0, 0, 0);
    slots.push({ start: morning, end: morningEnd, available: true });

    // Lunch slot (12-1 PM)
    const lunch = new Date(date);
    lunch.setHours(12, 0, 0, 0);
    const lunchEnd = new Date(date);
    lunchEnd.setHours(13, 0, 0, 0);
    slots.push({ start: lunch, end: lunchEnd, available: true });

    // Evening slot (6-9 PM)
    const evening = new Date(date);
    evening.setHours(18, 0, 0, 0);
    const eveningEnd = new Date(date);
    eveningEnd.setHours(21, 0, 0, 0);
    slots.push({ start: evening, end: eveningEnd, available: true });

    return slots;
};

/**
 * Format a time slot for display
 */
export const formatTimeSlot = (slot: TimeSlot): string => {
    const formatTime = (d: Date) => d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    return `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
};

/**
 * Get calendar context for Gemini injection
 */
export const getCalendarContext = async (): Promise<string> => {
    const events = await getUpcomingEvents(5);

    if (events.length === 0) {
        return 'Calendar: No upcoming events or calendar not connected.';
    }

    let context = 'Upcoming Calendar Events:\n';
    events.forEach(event => {
        const startTime = event.start.dateTime
            ? new Date(event.start.dateTime).toLocaleString()
            : event.start.date || 'All day';
        context += `- ${event.summary} at ${startTime}\n`;
    });

    return context;
};
