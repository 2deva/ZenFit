# Reproducible local evaluation

From a fresh checkout with Node 22.12+:

```bash
npm ci
npm run demo
```

Open http://127.0.0.1:5174/evaluation.html. No `.env` file, account, API key,
paid service, or hosted database is required. The demo starts an ephemeral PGlite
PostgreSQL instance with pgvector, runs the checked-in migrations, and inserts
synthetic Alice/Bob fixtures. Its API listens on loopback by default. Restarting
it resets the database; local browser storage persists until cleared.

## Five-minute walkthrough

1. Go offline and complete an exercise. The visible completion changes locally;
   the persisted sync queue grows, while stored database progress stays unchanged.
2. Go online and sync. The queue drains only after the PostgreSQL write succeeds.
3. Switch to Bob, then Alice. The database applies row policies for each fixture
   identity. Each sees their own progress.
4. Start the five-second reset, pause it, wait, and resume. The production
   activity clock completes once and does not consume paused time.
5. Enter `go back`, `go faster`, or `stop workout` in the command input. The
   production intent parser distinguishes the actions and shows confirmation.

The harness imports the production session generator, activity hook, voice parser,
and transport-independent sync queue. This is a focused evaluation surface, not
a replacement for the main application or a simulation of live AI quality.

## Automated checks

```bash
npm run check
npm run test:db
npx playwright install --with-deps chromium
npm run test:e2e
```

The browser test repeats queue replay, identity switching, timer pause/resume,
and intent parsing, and fails if the evaluation makes external network requests.
CI installs Chromium and runs it on every push/PR. Database tests exercise real
PostgreSQL constraints, migration checksums and RLS, rather than mocking query
results. Coverage reports include untested production modules.

For Docker without credentials:

```bash
docker compose --profile evaluation up --build --wait evaluation
# http://127.0.0.1:5174/evaluation.html
docker compose --profile evaluation down
```

This service is independent of the hosted-integration `web`/`api` services.

## Boundaries

Fixture identities are explicitly selectable and their JWT claims are injected
locally. They do not verify Firebase signatures. Supabase Third-Party Auth must
verify real tokens before production RLS is useful. The demo does not call
Gemini, Firebase, Google Calendar, Opik, or hosted Supabase, and does not prove
those deployments are configured correctly. Never deploy the fixture API as a
production authenticated backend. Use the [database rollout guide](../supabase/README.md)
for integration prerequisites.
