import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Server-side Supabase client using service role key (bypasses RLS for secure backend access)
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

export interface VerifiedUser {
  userId: string;
}

interface TokenInfoResponse {
  sub?: string;
  aud?: string;
  exp?: string;
  iss?: string;
  [key: string]: any;
}

/**
 * Verify a Firebase ID token using Google's tokeninfo endpoint and map to Supabase user_id.
 * Returns null if the token is invalid or the user cannot be resolved.
 */
export async function verifyFirebaseToken(idToken: string | undefined | null): Promise<VerifiedUser | null> {
  if (!idToken) return null;

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as TokenInfoResponse;
    const firebaseUid = data.sub;
    if (!firebaseUid) return null;

    if (!supabaseAdmin) {
      console.warn('Supabase admin client not configured; cannot map Firebase UID to user.');
      return null;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle();

    if (error) {
      console.error('Error looking up user by firebase_uid:', error);
      return null;
    }

    if (!user) return null;

    return { userId: (user as { id: string }).id };
  } catch (err) {
    console.warn('verifyFirebaseToken failed:', err);
    return null;
  }
}

