# Changelog

## 0.0.91

- fix(security): run repo-native Playwright tests without a shell. `runPlaywright`
  previously built one command string and ran it through `execSync`, so a spec
  filename or `--extra` argument containing shell metacharacters (`;`, `` ` ``, `$()`,
  `#`, …) was interpreted by the shell — a command-injection path on repo-native
  runs. It now spawns the resolved binary via `spawnSync(command, argv, { shell: false })`,
  passing spec files and extra args as literal argv entries. Also fixes spec status:
  `determineSpecStatus` no longer reports "passed" when Playwright exits non-zero just
  because the parsed JSON tests looked green — a non-zero exit is now a real failure.
  Adds a hermetic regression suite (`src/lib/repo-executor.test.ts`) covering malicious
  `--extra`/spec filenames on both the library and CLI paths and the non-zero-exit case.

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
