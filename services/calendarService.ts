/** Calendar access preserves connection status so failed requests are not empty calendars. */
export interface CalendarEvent {
  id: string; summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
}
export interface TimeSlot { start: Date; end: Date; available: boolean }
export interface CalendarSnapshot { status: 'connected' | 'disconnected' | 'unavailable'; events: CalendarEvent[] }

export async function getCalendarSnapshot(maxResults = 10, idToken?: string | null): Promise<CalendarSnapshot> {
  if (!idToken) return { status: 'disconnected', events: [] };
  try {
    const response = await fetch(`/api/google/calendar/events?${new URLSearchParams({ maxResults: String(maxResults), range: 'week' })}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401 || response.status === 403) return { status: 'disconnected', events: [] };
    if (!response.ok) return { status: 'unavailable', events: [] };
    const data = await response.json();
    if (data?.connected !== true) return { status: 'disconnected', events: [] };
    if (!Array.isArray(data.events)) return { status: 'unavailable', events: [] };
    return { status: 'connected', events: data.events };
  } catch {
    return { status: 'unavailable', events: [] };
  }
}

export async function getUpcomingEvents(maxResults = 10, idToken?: string | null): Promise<CalendarEvent[]> {
  return (await getCalendarSnapshot(maxResults, idToken)).events;
}

export async function createCalendarEvent(event: { summary: string; description?: string; start: Date; durationMinutes: number }, idToken?: string | null): Promise<CalendarEvent | null> {
  if (!idToken || !Number.isFinite(event.start.getTime()) || !Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0 || event.durationMinutes > 1440) return null;
  try {
    const response = await fetch('/api/google/calendar/events', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: event.summary, description: event.description || 'Created by Zenfit', startIso: event.start.toISOString(), durationMinutes: event.durationMinutes }) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.connected && data.event ? data.event : null;
  } catch { return null; }
}

function eventTime(value: { dateTime?: string; date?: string }): number {
  return new Date(value?.dateTime || (value?.date ? `${value.date}T00:00:00` : '')).getTime();
}

/** Compute gaps within 06:00–22:00, including events that start on earlier days. */
export function calculateFreeTimeSlots(date: Date, events: CalendarEvent[]): TimeSlot[] {
  const start = new Date(date); start.setHours(6, 0, 0, 0);
  const end = new Date(date); end.setHours(22, 0, 0, 0);
  if (!Number.isFinite(start.getTime())) return [];
  const busy = events.map(event => ({ start: eventTime(event.start), end: eventTime(event.end) }))
    .filter(event => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start && event.start < end.getTime() && event.end > start.getTime())
    .map(event => ({ start: Math.max(event.start, start.getTime()), end: Math.min(event.end, end.getTime()) }))
    .sort((a, b) => a.start - b.start);
  const slots: TimeSlot[] = []; let cursor = start.getTime();
  for (const event of busy) {
    if (event.start - cursor >= 30 * 60000) slots.push({ start: new Date(cursor), end: new Date(event.start), available: true });
    cursor = Math.max(cursor, event.end);
  }
  if (end.getTime() - cursor >= 30 * 60000) slots.push({ start: new Date(cursor), end, available: true });
  return slots;
}

export async function findFreeTimeSlots(date: Date, idToken?: string | null): Promise<TimeSlot[]> {
  const calendar = await getCalendarSnapshot(50, idToken);
  return calendar.status === 'connected' ? calculateFreeTimeSlots(date, calendar.events) : [];
}
export function formatTimeSlot(slot: TimeSlot): string {
  const format = (date: Date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${format(slot.start)} - ${format(slot.end)}`;
}
export async function getFreeSlotsContext(idToken?: string | null): Promise<{ freeSlotsSummary: string; nextFreeWindow: string }> {
  const calendar = await getCalendarSnapshot(50, idToken);
  if (calendar.status !== 'connected') return { freeSlotsSummary: '', nextFreeWindow: '' };
  const today = new Date(); const slots = calculateFreeTimeSlots(today, calendar.events);
  const upcoming = slots.find(slot => slot.end.getTime() > today.getTime());
  return { freeSlotsSummary: slots.length ? slots.map(formatTimeSlot).join(', ') : 'No free slots of 30 min or more today.', nextFreeWindow: upcoming ? formatTimeSlot(upcoming) : '' };
}
export async function getCalendarContext(idToken?: string | null): Promise<string> {
  const calendar = await getCalendarSnapshot(5, idToken);
  if (calendar.status === 'disconnected') return 'Calendar: Not connected. Connect Google Calendar in settings to view availability.';
  if (calendar.status === 'unavailable') return 'Calendar: Temporarily unavailable. Availability could not be verified.';
  if (!calendar.events.length) return 'Calendar: Connected. No upcoming events in the next 7 days.';
  return 'Calendar: Connected. Upcoming events:\n' + calendar.events.map(event => `- ${event.summary} at ${event.start.dateTime ? new Date(event.start.dateTime).toLocaleString() : event.start.date || 'All day'}`).join('\n');
}
