import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use a loosely typed admin client to avoid coupling types between frontend and API.
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  if (!supabaseAdmin) {
    console.warn('Supabase admin client not configured; cannot refresh Google access token.');
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('google_integrations')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching google_integrations:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    const refreshToken = (data as { refresh_token?: string }).refresh_token;
    if (!refreshToken) {
      return null;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.warn('Google OAuth is not configured; cannot refresh access token.');
      return null;
    }

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn('Failed to refresh Google access token:', res.status, body);
      return null;
    }

    const json = (await res.json()) as { access_token?: string };
    return json.access_token || null;
  } catch (err) {
    console.error('getGoogleAccessToken error:', err);
    return null;
  }
}

