import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIREBASE_API_KEY =
  process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;

// Server-side Supabase client using service role key (bypasses RLS for secure backend access)
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

export interface VerifiedUser {
  userId: string;
}

interface FirebaseLookupResponse {
  users?: { localId?: string }[];
}

/**
 * Verify a Firebase ID token using Firebase's Identity Toolkit API and map to Supabase user_id.
 * Returns null if the token is invalid or the user cannot be resolved.
 */
export async function verifyFirebaseToken(
  idToken: string | undefined | null
): Promise<VerifiedUser | null> {
  if (!idToken) {
    console.warn('[verifyFirebaseToken] No idToken provided');
    return null;
  }

  if (!FIREBASE_API_KEY) {
    console.error(
      '[verifyFirebaseToken] FIREBASE_API_KEY / VITE_FIREBASE_API_KEY not configured; cannot verify token.'
    );
    return null;
  }

  try {
    // Use Firebase Identity Toolkit to validate the Firebase ID token.
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        FIREBASE_API_KEY
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error(
        `[verifyFirebaseToken] Firebase accounts:lookup failed: ${res.status} ${errorText}`
      );
      return null;
    }

    const data = (await res.json()) as FirebaseLookupResponse;
    const firebaseUid = data.users?.[0]?.localId;
    if (!firebaseUid) {
      console.warn(
        '[verifyFirebaseToken] No localId (firebase UID) returned from Firebase accounts:lookup'
      );
      return null;
    }

    if (!supabaseAdmin) {
      console.error(
        '[verifyFirebaseToken] Supabase admin client not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      );
      return null;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle();

    if (error) {
      console.error('[verifyFirebaseToken] Supabase query error:', error);
      return null;
    }

    if (!user) {
      console.warn(
        `[verifyFirebaseToken] No user found in Supabase with firebase_uid: ${firebaseUid}`
      );
      return null;
    }

    console.log(
      `[verifyFirebaseToken] Successfully verified user: ${
        (user as { id: string }).id
      }`
    );
    return { userId: (user as { id: string }).id };
  } catch (err) {
    console.error('[verifyFirebaseToken] Exception:', err);
    return null;
  }
}

