import { describe, expect, it, vi } from 'vitest';
import { isPublicSupabaseKey, createFirebaseAccessTokenProvider } from '../supabaseAuth';
const key = (role: string) => `header.${btoa(JSON.stringify({ role }))}.signature`;
describe('Supabase client credential boundaries', () => {
  it('accepts public keys and rejects privileged or malformed keys', () => {
    expect(isPublicSupabaseKey('sb_publishable_example')).toBe(true);
    expect(isPublicSupabaseKey(key('anon'))).toBe(true);
    for (const value of [key('service_role'), 'sb_secret_example', '', undefined, 'bad-token']) expect(isPublicSupabaseKey(value)).toBe(false);
  });
  it('does not invent a token for signed-out users', async () => {
    expect(await createFirebaseAccessTokenProvider(async () => null)()).toBeNull();
  });
  it('returns the current Firebase token with an authenticated role', async () => {
    const getIdTokenResult = vi.fn().mockResolvedValue({ token: 'verified-token', claims: { role: 'authenticated' } });
    expect(await createFirebaseAccessTokenProvider(async () => ({ getIdTokenResult }))()).toBe('verified-token');
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
  });
  it('refreshes missing claims once and rejects users without the required role', async () => {
    const getIdTokenResult = vi.fn().mockResolvedValue({ token: 'no-role', claims: {} });
    await expect(createFirebaseAccessTokenProvider(async () => ({ getIdTokenResult }))()).rejects.toThrow('authenticated role');
    expect(getIdTokenResult).toHaveBeenCalledTimes(2); expect(getIdTokenResult).toHaveBeenLastCalledWith(true);
  });
});
