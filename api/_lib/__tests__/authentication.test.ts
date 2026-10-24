// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('SUPABASE_URL', 'https://evaluation.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'evaluation-server-key');
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'evaluation-firebase-key'); vi.stubEnv('GOOGLE_CLIENT_ID', 'evaluation-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'evaluation-secret');
  db.from.mockReturnValue(db); db.select.mockReturnValue(db); db.eq.mockReturnValue(db); db.maybeSingle.mockResolvedValue({ data: { id: 'internal-user' }, error: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('server-side identity verification', () => {
  it('maps the Firebase-verified UID to the internal database user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ users: [{ localId: 'firebase-alice' }] }), { status: 200 }));
    const { verifyFirebaseToken } = await import('../verifyFirebaseToken');
    expect(await verifyFirebaseToken('id-token')).toEqual({ userId: 'internal-user' });
    expect(db.eq).toHaveBeenCalledWith('firebase_uid', 'firebase-alice');
  });
  it('rejects missing tokens without contacting Firebase', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch'); const { verifyFirebaseToken } = await import('../verifyFirebaseToken');
    expect(await verifyFirebaseToken(null)).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects invalid tokens, unknown UIDs and database errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 401 }));
    const { verifyFirebaseToken } = await import('../verifyFirebaseToken');
    expect(await verifyFirebaseToken('invalid')).toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ users: [] }), { status: 200 })); expect(await verifyFirebaseToken('no-user')).toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ users: [{ localId: 'uid' }] }), { status: 200 }));
    db.maybeSingle.mockResolvedValue({ data: null, error: null }); expect(await verifyFirebaseToken('unmapped')).toBeNull();
    db.maybeSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } }); expect(await verifyFirebaseToken('database-failure')).toBeNull();
    fetchMock.mockRejectedValue(new Error('network')); expect(await verifyFirebaseToken('network-failure')).toBeNull();
  });
});

describe('server-side Google token refresh', () => {
  it('uses only the verified internal user to retrieve and exchange a refresh token', async () => {
    db.maybeSingle.mockResolvedValue({ data: { refresh_token: 'synthetic-refresh-token' }, error: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'synthetic-access-token' }), { status: 200 }));
    const { getGoogleAccessToken } = await import('../googleAuthService');
    expect(await getGoogleAccessToken('internal-user')).toBe('synthetic-access-token');
    expect(db.eq).toHaveBeenCalledWith('user_id', 'internal-user');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('grant_type=refresh_token');
  });
  it('handles absent integrations, refused exchanges and network failures', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch'); const { getGoogleAccessToken } = await import('../googleAuthService');
    db.maybeSingle.mockResolvedValue({ data: null, error: null }); expect(await getGoogleAccessToken('user')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
    db.maybeSingle.mockResolvedValue({ data: { refresh_token: 'synthetic' }, error: null });
    fetchMock.mockImplementation(async () => new Response('{}', { status: 403 })); expect(await getGoogleAccessToken('user')).toBeNull();
    fetchMock.mockRejectedValue(new Error('network')); expect(await getGoogleAccessToken('user')).toBeNull();
  });
});
