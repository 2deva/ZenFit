# Contributing

Use Node 22.12+ and `npm ci`. Copy `.env.example` to `.env.local` only if you need
interactive sign-in or external services. Tests and production builds do not
need credentials. Never commit real keys, tokens, recordings, or user data.

Keep each behavior change and its regression tests in one focused commit or PR.
Keep mechanical formatting and unrelated refactors separate. Do not manufacture
historical commits or split an unchanged test suite into artificial activity.
For refactors, preserve the public API and test the observable behavior.

Before opening a PR, run:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

Describe the user-visible behavior, reason for the change, checks performed, and
any external service assumptions. Explain any coverage change; do not lower gates
to hide a failure. Tests must not contact paid APIs or production databases.

The lint baseline enforces hook ordering and recommended JavaScript/TypeScript
checks. Existing `any` payloads and unused declarations remain allowed; replace
them with concrete types as their domain is changed. Keep new modules focused.

Update `package-lock.json` when dependencies change. Vitest and its coverage
provider must use compatible versions. The gRPC override in `package.json`
patches the Firebase transitive dependency; review it when Firebase updates.
