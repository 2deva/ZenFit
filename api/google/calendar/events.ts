import { verifyFirebaseToken } from '../../_lib/verifyFirebaseToken.js';
import { getGoogleAccessToken } from '../../_lib/googleAuthService.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

async function handleGet(req: any, res: any, userId: string) {
  const maxResults = parseInt((req.query.maxResults as string) || '10', 10);
  const range = (req.query.range as string) || 'week';

  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) {
    res.status(200).json({ connected: false, events: [] });
    return;
  }

  const now = new Date();
  const timeMin = now.toISOString();
  const end = new Date(now);
  if (range === 'today') {
    end.setHours(23, 59, 59, 999);
  } else {
    end.setDate(end.getDate() + 7);
  }
  const timeMax = end.toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  try {
    const resp = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (resp.status === 403) {
      console.warn('Calendar API 403 in backend: ensure Calendar API is enabled and scopes include calendar.');
      res.status(200).json({ connected: true, events: [] });
      return;
    }

    if (!resp.ok) {
      const body = await resp.text();
      console.error('Calendar GET failed:', resp.status, body);
      res.status(500).json({ connected: true, events: [] });
      return;
    }

    const data = (await resp.json()) as { items?: any[] };
    res.status(200).json({ connected: true, events: data.items || [] });
  } catch (err) {
    console.error('Calendar GET error:', err);
    res.status(500).json({ connected: true, events: [] });
  }
}

async function handlePost(req: any, res: any, userId: string) {
  const { title, description, startIso, durationMinutes } = (req.body || {}) as {
    title?: string;
    description?: string;
    startIso?: string;
    durationMinutes?: number;
  };

  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) {
    res.status(403).json({ connected: false });
    return;
  }

  const start = startIso ? new Date(startIso) : new Date();
  const end = new Date(start.getTime() + (durationMinutes ?? 30) * 60 * 1000);

  const body = {
    summary: title || 'Workout',
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  try {
    const resp = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (resp.status === 403) {
      console.warn('Calendar API 403 on create: ensure Calendar API is enabled and scopes include calendar.events.');
      res.status(403).json({ connected: false });
      return;
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Calendar POST failed:', resp.status, text);
      res.status(500).json({ connected: true });
      return;
    }

    const event = await resp.json();
    res.status(200).json({ connected: true, event });
  } catch (err) {
    console.error('Calendar POST error:', err);
    res.status(500).json({ connected: true });
  }
}

export default async function handler(req: any, res: any) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  const verified = await verifyFirebaseToken(idToken);
  if (!verified) {
    res.status(401).json({ error: 'Invalid Firebase token' });
    return;
  }

  if (req.method === 'GET') {
    await handleGet(req, res, verified.userId);
  } else if (req.method === 'POST') {
    await handlePost(req, res, verified.userId);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

