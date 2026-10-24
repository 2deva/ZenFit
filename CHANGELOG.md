# Changelog

## Unreleased

- Track the npm lockfile, tests and environment template; require Node 22.12+.
- Add lint, coverage gates, GitHub Actions checks, weekly dependency updates,
  a development Docker Compose environment and a devcontainer.
- Add regression tests for workout generation/rendering, input validation,
  calendar requests, PCM audio, guidance timing and data-access behavior.
- Separate cue planners and data-access domains behind existing public APIs;
  extract Live audio resource handling from the session hook.
- Correct conditional workout hooks, invalid timer handling, PCM view offsets,
  retained fired cues and paused restored cue progression.
- Update vulnerable test dependencies and override the vulnerable transitive
  gRPC version; remove the private Opik key substitution from the frontend build.
- Document setup, data lineage, coverage scope and existing authorization gaps.
