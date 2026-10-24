# Database setup and data flows

These scripts target Supabase PostgreSQL with pgvector. Use an isolated test
project first. They are historical setup scripts, not a versioned migration
runner. Do not execute all files alphabetically against a production database.

## Setup order

1. `migration.sql`: base users, goals, sessions, streaks, memories, scheduled
   events, Google integration tokens and nudge feedback; enables pgvector.
2. `onboarding_state.sql`: onboarding state, user goal motivation and priority.
3. `workout_progress.sql`: cross-device in-progress workout state.
4. `message_sync_migration.sql`: cross-device messages.

`enable_rls.sql` and `fix_rls.sql` are alternative historical policy changes.
They conflict with each other and are not sequential feature migrations.
Review the authorization design before selecting or changing policies.
Repeated application of some setup scripts can fail on existing policy names;
the project currently has no verified migration idempotency guarantee.

Some current application payloads reference optional `goal_ids`, `message_context`
and `related_workout_id` columns that the historical scripts do not define.
Message storage retries without its optional columns; workout schema changes
need a reviewed migration for each deployment. Do not infer schema state from
application types alone.

## Data lineage

| Origin | Access module | Tables or destination |
| --- | --- | --- |
| Firebase sign-in/profile | `services/repositories/profiles.ts` | `users`, `user_goals` |
| Workout UI/local progress | `storageService.ts`, `persistenceService.ts`, `syncService.ts`, `repositories/workouts.ts` | localStorage queue, `workout_progress`, `workout_sessions`, `habit_streaks` |
| Conversation context | `repositories/memories.ts` | `user_memories`, `scheduled_events`; `match_memories` vector search |
| Chat history | `repositories/messages.ts` | `user_messages` |
| Inferred onboarding preferences | `repositories/onboarding.ts` | `user_onboarding_state` |
| Verified Calendar API requests | `api/_lib/verifyFirebaseToken.ts`, `googleAuthService.ts` | Firebase UID → `users.id` → `google_integrations` → Google Calendar |

Network boundary tests exercise mapping, user filters, conflict keys and existing
error returns using mocked Supabase responses. They do not prove SQL correctness
or row isolation on a live database.

## Authorization limitations

Several scripts create `USING (true)`/`WITH CHECK (true)` policies. Such policies
allow broad access through the anon client; application filters by `user_id`
do not provide database authorization. `enable_rls.sql` assumes Supabase Auth UUIDs,
while the app signs in through Firebase. Deployments need a verified identity
bridge or authenticated server data access plus matching restrictive policies.

The server service-role key bypasses RLS. Keep it server-side and verify caller
identity before selecting a user's records. Google refresh tokens are accessed
through server endpoints; never add a public policy to expose them. No production
database policy was applied by this repository change.
