# Engineering quality

This update improves reproducible installs, regression tests, automated checks,
setup documentation, selected architecture boundaries and dependency health.

## Verification

`npm run check` runs TypeScript, ESLint, regression tests with coverage gates,
and the Vite production build. `npm audit --audit-level=high` checks dependencies.
CI repeats checks on Node 22 and 24 and tests Compose startup. Container checks
use empty configuration and do not verify hosted integrations.

The initial suite has 161 tests across 10 files. Whole-source line coverage is
approximately 18%; untested files remain in the denominator. Core cue planners
have about 97% line coverage. The scheduler has 100% coverage. Exact reports are
produced in `coverage/` and attached to CI runs. Global gates protect the current
baseline; selected core modules have 50–100% gates. These are not a claim of 50%
coverage across the app.

Tests cover duration resolution, builder sessions, mindful phase budgets, workout
rerenders/empty input, validation of generated UI data, authenticated Calendar
request boundaries, PCM encoding/view offsets, microphone resource cleanup,
cancelled/paused cues, and data mapping and failure contracts. Hosted APIs are
mocked in tests, including database and Calendar calls.

## Structure

- `services/guidance/*` plans cues by activity. `voiceGuidanceService.ts` retains
  the public API. `guidanceScheduler.ts` owns pending cue timeouts.
- `services/repositories/*` groups profile, workout, memory, message and onboarding
  database operations. `supabaseService.ts` retains the public API and existing
  return-value contracts.
- `hooks/useLiveSessionAudio.ts` owns microphone/playback resources. The main
  Live hook still coordinates the protocol, tools and guidance.
- `utils/goalType.ts` keeps goal normalization independent of database clients.
  Pure session generation no longer loads the complete user context service.

## Remaining work

1. Expand behavioral coverage of Live connection/reconnection, auth, sync replay,
   Timer interactions and server chat. Increase global coverage gates as this lands.
2. Split the remaining large Live hook and guidance executor with integration
   coverage. Several other existing files still exceed 500 lines.
3. Replace remaining `any` payloads and use explicit data-access error results.
   The repository refactor intentionally preserves existing null/false/empty
   fallback contracts so callers do not change behavior unexpectedly.
4. Address the permissive database policies described in `supabase/README.md`.
   Browser-provided user IDs do not establish authorization. Production database
   settings were not inspected or changed by this code-only update.
5. Move Gemini Live authentication to short-lived tokens/server mediation before
   treating Gemini keys as private. The current frontend still uses a browser key.
6. Test database migrations on an isolated Supabase instance. Compose currently
   uses configured hosted services; it is not a complete offline backend stack.
7. Profile and split the large production JavaScript bundle. Vite currently warns
   about its size; no bundle-size warning has been suppressed.

Further maintenance work should pair behavior changes with regression tests and
raise coverage gates as additional paths are tested. Contributor history and
sustained maintenance require ongoing project work.
