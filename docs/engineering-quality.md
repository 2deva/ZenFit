# Engineering quality and evaluation

`npm run check` runs TypeScript, ESLint, the regression suite with coverage gates,
and the production build. CI repeats this on Node 22/24, audits dependencies,
starts Compose services, and runs the isolated walkthrough in Chromium.

## Evidence and scope

The regression suite covers session generation, cue planning/scheduling, live
connection lifecycle and transcript routing, account-scoped chat storage, token
refresh races, offline retries, timer controls, Calendar errors, model fallbacks,
audio resources, and database mapping. Hosted network boundaries are mocked.
A separate PGlite suite runs real PostgreSQL migrations, constraints, vector
search and ownership policies with synthetic identities. It does not verify
Firebase signatures or hosted service settings.

The measured production coverage scope includes services, hooks, utilities, APIs, components,
contexts and Firebase/Supabase configuration, including untested files. Global
minimums are 50% lines/statements/functions and 38% branches. Cue planners,
scheduler and validation have higher gates. Exact counts and percentages are in
CI coverage artifacts; tests are not a claim that every workflow is verified.

The [credential-free evaluation](evaluation.md) uses production algorithms and
an isolated local database. Its browser test checks offline replay, identity
isolation, timer controls and voice intent, and rejects external requests.

## Structure and behavior

- `services/guidance/*` plans activity cues; the scheduler owns pending timeouts.
- `services/repositories/*` groups profile, workout, memory, message and onboarding
  data access while preserving the public service facade.
- `services/sync/SyncQueue.ts` separates durable queuing from the Supabase
  transport. Failed writes remain retryable; deduplication includes identity.
- `services/activityModel.ts` defines shared phases; `useActivityPersistence.ts`
  isolates persistence from the clock's transitions and event delivery.
- `services/context/*` separates movement, schedule and psychological context.
  Missing or simulated fitness data is not represented as measured history.
- Live audio resources release before asynchronous logging. Cancelled attempts,
  rejected SDK promises and old connection events cannot revive a closed session.
- Message storage is scoped to account identity and preserves unsynced local
  messages when cloud history arrives. Tool updates use the same persistence owner.
- Calendar outages stay distinct from verified empty calendars. Async model
  failures reach chat fallback handling.

## Deployment and handover

The [database guide](../supabase/README.md) documents the Firebase identity bridge,
versioned SQL, preflight data checks and coordinated client/policy rollout. Those
production settings have not been applied or verified by repository tests.

The current Gemini Live client still uses a browser API key; short-lived tokens
or server mediation remain work for a production deployment. Optional tracing
requires server configuration. External exercise images come from
[yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db); review the
upstream terms and asset provenance separately from ownership of application code.
This update does not change the project's licensing or grant transfer rights.

The main Live hook, guidance executor and some UI files remain large. Additional
integration coverage should precede further extraction. Several legacy payloads
still use `any` and null/false fallback results. The production bundle is about
1.9 MB before compression; the existing Vite size warning remains visible.
Further work should prioritize real failure cases and keep the coverage gates.
