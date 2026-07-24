# Changelog

## 0.0.91

- fix(security): run repo-native Playwright specs without a shell.
  `runPlaywright` previously built one shell string (`execSync(\`${cmd} ${args}\`)`)
  from the resolved Playwright command plus spec file paths and caller-supplied
  extra args. Spec filenames and extra args can be influenced by repo contents, so
  a crafted filename such as `a.spec.ts; touch pwned #.spec.ts` was interpreted by
  the shell — a command-injection vector. Now uses `spawnSync(command, argv, { shell: false })`
  with argv passed as an array, so metacharacters can never be re-parsed. Exit status
  is propagated from `result.status` (null on spawn error/timeout → `error`). Adds
  `repo-executor.test.ts` proving malicious spec filenames and extra args do not
  execute and that a nonzero Playwright exit is reported as a failure. Scoped to the
  injection fix only — the `0.0.89` Store refactor (`db/*` → `store/*`) is preserved.

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
