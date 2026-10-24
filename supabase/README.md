# Database setup, evaluation and authorization

The schema targets Supabase PostgreSQL with pgvector. Run `npm run test:db` or
`npm run demo` for an isolated, credential-free evaluation. See
[the walkthrough](../docs/evaluation.md).

## Migration sequence

The checksummed, transactional evaluation runner is `scripts/db/migrations.ts`:

| Version | Purpose |
| --- | --- |
| `0001_baseline` | Historical base schema, onboarding, workout progress and message sync scripts |
| `0002_application_metadata` | Goal links, message context/thread columns, message uniqueness, nonnegative duration/index constraints |
| `0003_firebase_authorization` | Trusted Firebase project check, ownership RLS and server-only OAuth tokens |

The runner records versions/checksums in `private.schema_migrations`. Repeating it
is a no-op; editing an applied migration fails with a checksum error. Add a new
migration for future schema changes. Pending migrations apply in one transaction.
The historical setup scripts also tolerate repeated policy creation.

`enable_rls.sql` and `fix_rls.sql` are historical alternatives. Do not run them
after the versioned sequence: they would replace the reviewed authorization rules.
The runner targets local PGlite; it is not a command for upgrading a hosted project.

## Hosted rollout prerequisites

Production settings have not been inspected or changed. Stage this sequence on
an isolated Supabase project before scheduling a production rollout:

1. Back up the existing schema/data and inspect applied policies, users and
   constraints. Resolve invalid negative values or duplicate message IDs before
   adding constraints; the migrations do not silently delete customer records.
2. Register the Firebase project in Supabase Third-Party Auth. Assign the
   `role: authenticated` Firebase custom claim using trusted Firebase Admin code.
   Refresh user ID tokens after setting claims. Follow the
   [official Firebase integration guide](https://supabase.com/docs/guides/auth/third-party/firebase-auth).
3. Apply the baseline only on a fresh schema. For an existing deployment, compare
   its schema to the baseline and apply the incremental metadata/authorization
   scripts through the deployment's reviewed migration process.
4. Set the trusted project from an administrative SQL connection:

   ```sql
   INSERT INTO private.app_settings(key,value)
   VALUES ('firebase_project_id','YOUR_FIREBASE_PROJECT_ID')
   ON CONFLICT (key) DO UPDATE SET value=excluded.value;
   ```

   The authorization migration fails closed until this value is configured.
5. Enable `VITE_SUPABASE_AUTH_MODE=firebase` and provide a public publishable or
   anon key. The client supplies refreshed Firebase ID tokens to Supabase and
   refuses missing `authenticated` role claims. It rejects secret/service-role
   keys in the frontend configuration. Server service-role credentials stay in
   server-only environment variables.
6. Test real Alice/Bob accounts: each can create/read/update/delete its own
   records; cross-user reads/writes and anonymous access fail. Verify Calendar
   endpoints still access OAuth tokens server-side and browser clients cannot.
7. Roll out the client and policies together with a documented rollback plan.
   Disabling Firebase mode does not make old permissive policies safe.

## Authorization model and test scope

`users.firebase_uid` maps a verified Firebase subject to the application's UUID.
Profile policies require the matching subject. Child records require the owning
profile. A restrictive policy also requires the configured Firebase issuer and
audience. `google_integrations` grants neither anonymous nor authenticated client
access; backend service-role code must verify callers before accessing tokens.

Local PostgreSQL tests exercise repeated migrations, own-profile/goals reads,
cross-user writes, profile impersonation, foreign-project rejection, anonymous
access, token-table denial, progress upserts and constraints. The local `auth.jwt`
helper reads synthetic claims; it does not verify signatures or reproduce the
Supabase gateway. Hosted integration verification remains required.

## Data lineage

| Origin | Access module | Destination |
| --- | --- | --- |
| Firebase profile | `repositories/profiles.ts` | `users`, `user_goals` |
| Workout/progress | `repositories/workouts.ts`, sync queue | `workout_sessions`, `workout_progress`, `habit_streaks` |
| Conversation memories | `repositories/memories.ts` | `user_memories`, vector search |
| Chat | `repositories/messages.ts`, account-scoped local history | `user_messages` |
| Preferences | `repositories/onboarding.ts` | `user_onboarding_state` |
| Calendar requests | Firebase verification and Google auth server helpers | `users` → `google_integrations` → Google Calendar |
