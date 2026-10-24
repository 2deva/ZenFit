/** Key classification is a configuration check, not JWT signature verification. */
export function isPublicSupabaseKey(key: string | undefined): boolean {
  if (!key) return false;
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'anon';
  } catch { return false; }
}
interface FirebaseTokenUser {
  getIdTokenResult: (forceRefresh?: boolean) => Promise<{ token: string; claims: Record<string, unknown> }>;
}
export function createFirebaseAccessTokenProvider(getUser: () => Promise<FirebaseTokenUser | null>) {
  return async (): Promise<string | null> => {
    const user = await getUser(); if (!user) return null;
    let token = await user.getIdTokenResult(false);
    if (token.claims.role !== 'authenticated') token = await user.getIdTokenResult(true);
    if (token.claims.role !== 'authenticated') throw new Error('Firebase user needs the authenticated role claim for Supabase access');
    return token.token;
  };
}
