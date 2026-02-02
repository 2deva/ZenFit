import crypto from 'crypto';
import { verifyFirebaseToken } from '../../_lib/verifyFirebaseToken.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;
const GOOGLE_OAUTH_STATE_SECRET = process.env.GOOGLE_OAUTH_STATE_SECRET;

interface StartBody {
  idToken?: string;
  provider?: 'calendar';
}

interface OAuthState {
  userId: string;
  provider: 'calendar';
  nonce: string;
  exp: number;
}

function signState(payload: OAuthState): string {
  if (!GOOGLE_OAUTH_STATE_SECRET) {
    throw new Error('GOOGLE_OAUTH_STATE_SECRET is not configured');
  }
  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', GOOGLE_OAUTH_STATE_SECRET);
  hmac.update(json);
  const signature = hmac.digest('hex');
  return Buffer.from(JSON.stringify({ p: payload, s: signature })).toString('base64url');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = (req.body || {}) as StartBody;
    const idToken = body.idToken;

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_OAUTH_REDIRECT_URI) {
      res.status(500).json({ error: 'Google OAuth environment variables are not configured' });
      return;
    }

    const verified = await verifyFirebaseToken(idToken);
    if (!verified) {
      console.error('[oauth/start] Token verification failed. Check server logs above for details.');
      res.status(401).json({ error: 'Invalid Firebase token or user not found in Supabase' });
      return;
    }

    const state: OAuthState = {
      userId: verified.userId,
      provider: 'calendar',
      nonce: crypto.randomBytes(16).toString('hex'),
      exp: Math.floor(Date.now() / 1000) + 10 * 60, // 10 minutes
    };

    const signedState = signState(state);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ].join(' '),
      state: signedState,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.status(200).json({ url });
  } catch (err) {
    console.error('oauth/start error:', err);
    res
      .status(500)
      .json({ error: 'Failed to initiate Google OAuth', text: "I'm having trouble connecting to Google. Please try again." });
  }
}

