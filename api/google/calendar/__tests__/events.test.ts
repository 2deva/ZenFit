import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../events';
import { verifyFirebaseToken } from '../../../_lib/verifyFirebaseToken';
import { getGoogleAccessToken } from '../../../_lib/googleAuthService';

vi.mock('../../../_lib/verifyFirebaseToken', () => ({ verifyFirebaseToken: vi.fn() }));
vi.mock('../../../_lib/googleAuthService', () => ({ getGoogleAccessToken: vi.fn() }));

const response = () => { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; };
beforeEach(() => {
  vi.mocked(verifyFirebaseToken).mockReset().mockResolvedValue({ userId: 'user-id' });
  vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access-token');
});

describe('calendar API boundary', () => {
  it('requires authentication', async () => {
    const res = response(); await handler({ headers: {}, method: 'POST', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(verifyFirebaseToken).not.toHaveBeenCalled();
  });
  it('rejects invalid Firebase tokens', async () => {
    vi.mocked(verifyFirebaseToken).mockResolvedValue(null);
    const res = response(); await handler({ headers: { authorization: 'Bearer bad-token' }, method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getGoogleAccessToken).not.toHaveBeenCalled();
  });
  it.each([
    { startIso: 'not-a-date' }, { startIso: '2026-10-24' }, { durationMinutes: -1 },
    { durationMinutes: Infinity }, { durationMinutes: '30' }, { durationMinutes: 0 },
    { title: {} }, { title: '' }, { description: [] },
  ])('returns 400 for %j before calling Google', async body => {
    const fetchMock = vi.spyOn(globalThis, 'fetch'); const res = response();
    await handler({ headers: { authorization: 'Bearer token' }, method: 'POST', body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getGoogleAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('creates the event with the validated time and duration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'event-id' }), { status: 200 }));
    const res = response();
    await handler({ headers: { authorization: 'Bearer token' }, method: 'POST', body: { title: 'Workout', startIso: '2026-10-24T10:00:00Z', durationMinutes: 15 } }, res);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ summary: 'Workout', end: { dateTime: '2026-10-24T10:15:00.000Z' } });
    expect(res.json).toHaveBeenCalledWith({ connected: true, event: { id: 'event-id' } });
  });
  it.each(['abc', '10oops', -1, 0, 251])('rejects invalid maxResults %s', maxResults => {
    const res = response();
    return handler({ headers: { authorization: 'Bearer token' }, method: 'GET', query: { maxResults } }, res).then(() => expect(res.status).toHaveBeenCalledWith(400));
  });
});
