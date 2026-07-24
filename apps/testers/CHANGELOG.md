# Changelog

## 0.0.90

- chore(release): reconcile `main` with the published npm line.
  Prior to this release `main` (HEAD `83ce58c`, package.json `0.0.82`) was a strict
  ancestor of the published tag `npm/testers/v0.0.89` (commit `7490dfe`) — 14 commits
  behind, 0 ahead. The deployed `0.0.89` code (Store refactor + `/v1` routes for
  agents/environments/schedules/flows/api-checks/auth-presets/workflows/golden/scan-issues,
  scenario bulk-import + count endpoint, percent-decode of `/v1` path segments, and
  cloud short-id resolution fixes) was not present on `main`. This was a clean
  fast-forward (no main-only commits to re-apply); the published history is now the
  base of `main`. Version bumped `0.0.89` → `0.0.90` so the reconciled line sits above
  the published npm latest.
