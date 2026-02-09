/**
 * Vercel Cron: Daily nudge checker.
 * Runs daily to find users who missed workouts and creates calendar events.
 * Schedule: 0 6 * * * (6 AM UTC daily)
 */

import { createClient } from '@supabase/supabase-js';
import { getGoogleAccessToken } from '../_lib/googleAuthService';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://zenfit.vercel.app';
const RETURN_WORKOUT_PARAM = 'start=return-workout';

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const PREFERRED_HOUR: Record<string, number> = { morning: 7, afternoon: 13, evening: 18 };

interface NudgeConfig {
    title: string;
    durationMinutes: number;
    description: string;
}

function getNudgeConfigForDays(daysMissed: number): NudgeConfig | null {
    if (daysMissed >= 1 && daysMissed <= 2) {
        return {
            title: 'Zenfit: 10-min return workout',
            durationMinutes: 10,
            description: "Gentle return session - you've got this."
        };
    }
    if (daysMissed >= 3 && daysMissed <= 7) {
        return {
            title: 'Zenfit: 5-min stretch & breathe',
            durationMinutes: 5,
            description: 'Just 5 minutes of stretching and breathing.'
        };
    }
    if (daysMissed > 7) {
        return {
            title: 'Zenfit: Quick check-in',
            durationMinutes: 3,
            description: "Open the app and say hi — that's all."
        };
    }
    return null;
}

async function createGoogleCalendarEvent(
    accessToken: string,
    summary: string,
    start: Date,
    durationMinutes: number,
    description: string
): Promise<{ id: string } | null> {
    const endTime = new Date(start.getTime() + durationMinutes * 60 * 1000);

    const event = {
        summary,
        description,
        start: { dateTime: start.toISOString(), timeZone: 'UTC' },
        end: { dateTime: endTime.toISOString(), timeZone: 'UTC' },
    };

    try {
        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        });

        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export const config = { maxDuration: 60 };

export default async function handler(
    req: { method?: string; headers?: Record<string, string | undefined> },
    res: { status: (n: number) => { json: (o: unknown) => unknown } }
) {
    // Verify cron secret to prevent unauthorized access
    if (CRON_SECRET && req.headers?.['authorization'] !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabaseAdmin) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    const today = new Date().toISOString().split('T')[0];
    let nudgedCount = 0;
    let skippedCount = 0;

    try {
        // Get users with Google calendar connected
        const { data: integrations } = await supabaseAdmin
            .from('google_integrations')
            .select('user_id')
            .not('refresh_token', 'is', null);

        if (!integrations?.length) {
            return res.status(200).json({ message: 'No users with calendar connected', nudged: 0 });
        }

        for (const integration of integrations) {
            const userId = integration.user_id;

            try {
                // Check if already nudged today (using scheduled_events table)
                const { data: existingNudge } = await supabaseAdmin
                    .from('scheduled_events')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('event_type', 'nudge')
                    .gte('scheduled_at', today)
                    .limit(1);

                if (existingNudge?.length) {
                    skippedCount++;
                    continue;
                }

                // Get recent workouts
                const { data: workouts } = await supabaseAdmin
                    .from('workout_sessions')
                    .select('created_at, completed')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(14);

                // Check if worked out today
                if (workouts?.some(w => w.completed && w.created_at?.startsWith(today))) {
                    skippedCount++;
                    continue;
                }

                // Find last completed workout
                const lastCompleted = workouts?.find(w => w.completed);
                if (!lastCompleted) {
                    skippedCount++;
                    continue;
                }

                const lastDate = lastCompleted.created_at?.split('T')[0];
                if (!lastDate) {
                    skippedCount++;
                    continue;
                }

                const daysMissed = Math.floor(
                    (new Date(today).getTime() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000)
                );

                const nudgeConfig = getNudgeConfigForDays(daysMissed);
                if (!nudgeConfig) {
                    skippedCount++;
                    continue;
                }

                // Get user's preferred time
                const { data: onboarding } = await supabaseAdmin
                    .from('user_onboarding_state')
                    .select('preferredWorkoutTime')
                    .eq('user_id', userId)
                    .maybeSingle();

                const hour = PREFERRED_HOUR[(onboarding?.preferredWorkoutTime || 'evening').toLowerCase()] ?? 18;

                const start = new Date();
                start.setUTCHours(hour, 0, 0, 0);
                if (start <= new Date()) {
                    start.setDate(start.getDate() + 1);
                }

                // Get fresh access token
                const accessToken = await getGoogleAccessToken(userId);
                if (!accessToken) {
                    skippedCount++;
                    continue;
                }

                // Create calendar event with deep link
                const deepLink = `${APP_URL}?${RETURN_WORKOUT_PARAM}`;
                const descriptionWithLink = `${nudgeConfig.description}\n\nStart: ${deepLink}`;

                const created = await createGoogleCalendarEvent(
                    accessToken,
                    nudgeConfig.title,
                    start,
                    nudgeConfig.durationMinutes,
                    descriptionWithLink
                );

                if (created) {
                    // Record in scheduled_events
                    await supabaseAdmin.from('scheduled_events').insert({
                        user_id: userId,
                        event_type: 'nudge',
                        title: nudgeConfig.title,
                        scheduled_at: start.toISOString(),
                        google_event_id: created.id,
                    });
                    nudgedCount++;
                } else {
                    skippedCount++;
                }
            } catch (e) {
                console.warn(`Nudge failed for user ${userId}:`, e);
                skippedCount++;
            }
        }

        return res.status(200).json({
            message: 'Daily nudge check complete',
            nudged: nudgedCount,
            skipped: skippedCount,
        });
    } catch (err) {
        console.error('Daily nudge cron error:', err);
        return res.status(500).json({ error: 'Cron failed' });
    }
}
