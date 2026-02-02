import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_OAUTH_STATE_SECRET = process.env.GOOGLE_OAUTH_STATE_SECRET;
const APP_REDIRECT_AFTER_OAUTH = process.env.APP_REDIRECT_AFTER_OAUTH || '/';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

interface OAuthState {
  userId: string;
  provider: 'calendar';
  nonce: string;
  exp: number;
}

interface SignedStatePayload {
  p: OAuthState;
  s: string;
}

function verifyState(signed: string | undefined | null): OAuthState | null {
  if (!signed || !GOOGLE_OAUTH_STATE_SECRET) return null;
  try {
    const decoded = Buffer.from(signed, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as SignedStatePayload;
    const json = JSON.stringify(parsed.p);
    const hmac = crypto.createHmac('sha256', GOOGLE_OAUTH_STATE_SECRET);
    hmac.update(json);
    const expected = hmac.digest('hex');
    if (parsed.s !== expected) return null;
    if (parsed.p.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.p;
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    const redirectUrl = new URL(APP_REDIRECT_AFTER_OAUTH, process.env.APP_BASE_URL || 'https://zenfit-sage.vercel.app');
    redirectUrl.searchParams.set('calendar', 'error');
    redirectUrl.searchParams.set('reason', error);
    res.writeHead(302, { Location: redirectUrl.toString() }).end();
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(500).send('Google OAuth is not configured');
    return;
  }

  if (!supabaseAdmin) {
    res.status(500).send('Supabase admin client not configured');
    return;
  }

  const decodedState = verifyState(state);
  if (!decodedState) {
    res.status(400).send('Invalid or expired state');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const bodyText = await tokenRes.text();
      console.error('OAuth token exchange failed:', tokenRes.status, bodyText);
      res.status(500).send('Failed to exchange authorization code');
      return;
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      token_type?: string;
    };

    const refreshToken = tokenJson.refresh_token;
    const scope = tokenJson.scope || null;

    if (!refreshToken) {
      console.warn('No refresh_token returned from Google; user may have already granted access.');
    }

    // Upsert google_integrations row
    const { error: upsertError } = await supabaseAdmin
      .from('google_integrations')
      .upsert(
        {
          user_id: decodedState.userId,
          refresh_token: refreshToken || '',
          scope,
          calendar_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (upsertError) {
      console.error('Error saving google_integrations:', upsertError);
      res.status(500).send('Failed to save Google integration');
      return;
    }

    const redirectBase = process.env.APP_BASE_URL || 'https://zenfit-sage.vercel.app';
    const redirectUrl = new URL(APP_REDIRECT_AFTER_OAUTH, redirectBase);
    redirectUrl.searchParams.set('calendar', 'connected');

    res.writeHead(302, { Location: redirectUrl.toString() }).end();
  } catch (err) {
    console.error('oauth/callback error:', err);
    res.status(500).send('OAuth callback failed');
  }
}

