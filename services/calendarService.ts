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

/**
 * Fetch upcoming events from the backend calendar proxy.
 * idToken should be a Firebase ID token for the current user.
 */
export const getUpcomingEvents = async (maxResults = 10, idToken?: string | null): Promise<CalendarEvent[]> => {
    if (!idToken) {
        return [];
    }

    try {
        const res = await fetch(`/api/google/calendar/events?${new URLSearchParams({
            maxResults: String(maxResults),
            range: 'week'
        }).toString()}`, {
            headers: {
                Authorization: `Bearer ${idToken}`
            }
        });

        if (res.status === 401) {
            // Caller is responsible for refreshing the Firebase token if needed.
            return [];
        }

        if (!res.ok) {
            return [];
        }

        const data = (await res.json()) as { connected: boolean; events: CalendarEvent[] };
        if (!data.connected) return [];
        return data.events || [];
    } catch (e) {
        console.warn('Calendar fetch failed:', e);
        return [];
    }
};

/**
 * Create a new event via backend calendar proxy.
 */
export const createCalendarEvent = async (
    event: {
        summary: string;
        description?: string;
        start: Date;
        durationMinutes: number;
    },
    idToken?: string | null
): Promise<CalendarEvent | null> => {
    if (!idToken) {
        return null;
    }

    try {
        const response = await fetch('/api/google/calendar/events', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: event.summary,
                description: event.description || 'Created by Zenfit',
                startIso: event.start.toISOString(),
                durationMinutes: event.durationMinutes
            })
        });

        if (response.status === 401 || response.status === 403) {
            return null;
        }

        if (!response.ok) {
            return null;
        }

        const data = (await response.json()) as { connected: boolean; event?: CalendarEvent };
        if (!data.connected || !data.event) return null;
        return data.event;
    } catch (e) {
        console.error('Failed to create calendar event:', e);
        return null;
    }
};

/**
 * Analyze calendar to find free time slots
 */
export const findFreeTimeSlots = async (date: Date, idToken?: string | null): Promise<TimeSlot[]> => {
    const events = await getUpcomingEvents(50, idToken);
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
 * Free slots and next-window summary for nudge context (stick-to-goals).
 * Used to inject "Free today" and "Next free window" into system instruction.
 */
export const getFreeSlotsContext = async (idToken?: string | null): Promise<{ freeSlotsSummary: string; nextFreeWindow: string }> => {
    if (!idToken) return { freeSlotsSummary: '', nextFreeWindow: '' };

    try {
        const today = new Date();
        const slots = await findFreeTimeSlots(today, idToken);
        const freeSlotsSummary = slots.length > 0
            ? slots.map(s => formatTimeSlot(s)).join(', ')
            : 'No free slots of 30 min or more today.';

        let nextFreeWindow = '';
        const now = today.getTime();
        const firstUpcoming = slots.find(s => s.end.getTime() > now);
        if (firstUpcoming) {
            nextFreeWindow = formatTimeSlot(firstUpcoming);
        }

        return { freeSlotsSummary, nextFreeWindow };
    } catch {
        return { freeSlotsSummary: '', nextFreeWindow: '' };
    }
};

/**
 * Get calendar context for Gemini injection.
 * Distinguishes not-connected from connected-but-no-events so the model can reply appropriately.
 */
export const getCalendarContext = async (idToken?: string | null): Promise<string> => {
    if (!idToken) {
        return 'Calendar: Not connected. The user has not signed in with Google or calendar access is missing. Suggest connecting Google Calendar in settings to view and add events.';
    }

    const events = await getUpcomingEvents(5, idToken);
    if (events.length === 0) {
        return 'Calendar: Connected. No upcoming events in the next 7 days. The user is free to schedule workouts.';
    }

    let context = 'Calendar: Connected. Upcoming events:\n';
    events.forEach(event => {
        const startTime = event.start.dateTime
            ? new Date(event.start.dateTime).toLocaleString()
            : event.start.date || 'All day';
        context += `- ${event.summary} at ${startTime}\n`;
    });
    return context;
};
