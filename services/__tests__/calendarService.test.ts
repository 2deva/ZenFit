import { describe, expect, it, vi } from 'vitest';
import { getCalendarSnapshot, getUpcomingEvents, getCalendarContext, findFreeTimeSlots, calculateFreeTimeSlots, createCalendarEvent, getFreeSlotsContext, formatTimeSlot, type CalendarEvent } from '../calendarService';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const event = (start: string, end: string): CalendarEvent => ({ id: 'event', summary: 'Meeting', start: { dateTime: start }, end: { dateTime: end } });

describe('calendar connection semantics', () => {
  it('does not contact the server or invent availability without authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await getUpcomingEvents()).toEqual([]); expect(await findFreeTimeSlots(new Date())).toEqual([]);
    expect(await getFreeSlotsContext()).toEqual({ freeSlotsSummary: '', nextFreeWindow: '' });
    expect(await getCalendarContext()).toContain('Not connected'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500])('does not describe HTTP %i as an empty connected calendar', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, status));
    expect(await getCalendarContext('token')).not.toContain('No upcoming events');
    expect(await findFreeTimeSlots(new Date(), 'token')).toEqual([]);
  });
  it('distinguishes an empty connected calendar from network failure', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ connected: true, events: [] }));
    expect(await getCalendarSnapshot(5, 'token')).toEqual({ status: 'connected', events: [] });
    expect(await getCalendarContext('token')).toContain('No upcoming events');
    mock.mockRejectedValue(new Error('offline'));
    expect(await getCalendarContext('token')).toContain('could not be verified');
  });
  it('rejects malformed server data and preserves event descriptions', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ connected: true }));
    expect((await getCalendarSnapshot(5, 'token')).status).toBe('unavailable');
    mock.mockResolvedValue(response({ connected: true, events: [event('2026-10-24T09:00:00Z', '2026-10-24T10:00:00Z')] }));
    expect(await getCalendarContext('token')).toContain('Meeting');
  });
});

describe('verified free-time intervals', () => {
  const date = new Date(2026, 9, 24); const time = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
  it('merges overlapping events and clips events outside working hours', () => {
    const slots = calculateFreeTimeSlots(date, [event(time(24, 5), time(24, 8)), event(time(24, 7), time(24, 9)), event(time(24, 12), time(24, 23))]);
    expect(slots.map(slot => [slot.start.getHours(), slot.end.getHours()])).toEqual([[9, 12]]);
  });
  it('blocks overnight and all-day events', () => {
    const overnight = calculateFreeTimeSlots(date, [event(time(23, 23), time(24, 8))]);
    expect(overnight[0].start.getHours()).toBe(8);
    expect(calculateFreeTimeSlots(date, [{ id: 'all-day', summary: 'Away', start: { date: '2026-10-24' }, end: { date: '2026-10-25' } }])).toEqual([]);
  });
  it('handles no events, invalid dates and gaps under 30 minutes', () => {
    expect(calculateFreeTimeSlots(date, [])).toHaveLength(1);
    expect(calculateFreeTimeSlots(new Date(NaN), [])).toEqual([]);
    const slots = calculateFreeTimeSlots(date, [event(time(24, 6), time(24, 21) )]);
    expect(formatTimeSlot(slots[0])).toContain('9:00 PM');
  });
});

describe('calendar writes', () => {
  it('requires a token and valid event timing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await createCalendarEvent({ summary: 'Workout', start: new Date(), durationMinutes: 10 })).toBeNull();
    expect(await createCalendarEvent({ summary: 'Workout', start: new Date(NaN), durationMinutes: 10 }, 'token')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends a validated event and handles rejected writes', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ connected: true, event: { id: 'created' } }));
    expect(await createCalendarEvent({ summary: 'Workout', start: new Date('2026-10-24T10:00:00Z'), durationMinutes: 10 }, 'token')).toEqual({ id: 'created' });
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toMatchObject({ title: 'Workout', durationMinutes: 10 });
    mock.mockResolvedValue(response({}, 403)); expect(await createCalendarEvent({ summary: 'Workout', start: new Date(), durationMinutes: 10 }, 'token')).toBeNull();
  });
});
