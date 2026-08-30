# Changelog

## 0.0.111

### Patch Changes

- 481e357: Fix the OpenAI-compatible runner path (canonical assistant-message shape for tool*calls, tool results emitted immediately after the tool_calls message they answer) and inject TEST*\* environment values into scenario prompts per the resolveCredential convention, so login-gated QA lanes can complete. Unblocks the alumia merge QA gate (todos 962c6907).
- Updated dependencies [6c1bc9d]
- Updated dependencies [8e7403f]
  - @hasna/browser@0.5.37
  - @hasna/events@0.1.18
  - @hasna/projects@1.0.5

## 0.0.110

### Patch Changes

- Fix OpenAI-compatible tool-call sequencing (canonical assistant-message shape, tool results emitted immediately after the tool_calls message they answer)
- Inject TEST\_\* environment values into scenario prompts per the resolveCredential convention

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0
  - @hasna/projects@^1.0.0
  - @hasna/browser@0.5.29

## 0.0.108

### Patch Changes

- 2b87a81: Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have.

## 0.0.107

### Patch Changes

- @hasna/projects@1.0.0

## 0.0.106

### Patch Changes

- @hasna/browser@0.5.29 (pin corrected from 0.5.31, which was never published — the version wave generated the pin from the workspace version; 0.5.29 is the registry latest and version 0.0.105 shipped with it)

## 0.0.105

### Patch Changes

- @hasna/browser@0.5.29 (pin corrected from 0.5.30, which was never published — the version wave generated the pin from the workspace version; 0.5.29 is the registry latest and the version 0.0.104 already shipped with)

## 0.0.104

### Patch Changes

- 462d1c4: fix: schedule creation binds `created_at`/`updated_at` to the actual creation time instead of the computed `next_run_at` (timestamp integrity, release-review P1 remediation for 0.0.100)
- 462d1c4: fix: CORS preflight mirrors the v1 surface — allows PATCH and the `x-api-key` header used by the SDK and dashboard clients
- d75c5bd: fix: require the API signing key — fail closed on `docker compose up` instead of defaulting to a committed secret (O15-00414)
- 462d1c4: chore: contract manifest `kitVersion` aligned to 0.13.4
- Updated dependencies [50473b8]
  - @hasna/projects@0.1.145
  - @hasna/browser@0.5.29

## 0.0.103

### Patch Changes

- @hasna/browser@0.5.28
- @hasna/projects@0.1.144

## 0.0.102

### Patch Changes

- @hasna/browser@0.5.27
- @hasna/projects@0.1.143

## 0.0.101

### Patch Changes

- @hasna/browser@0.5.26
- @hasna/projects@0.1.142

## 0.0.100

### Patch Changes

- a918f20: fix: army runner resolves the built dist/cli/index.js and falls back to dev source (bug 21969ee6)
- 4f71dc4: fix: persist next_run_at so the daemon fires and advances schedules (bug e16fb1b3)
- 45dcfe3: fix: hosted PATCH /v1/scenarios/:id persists the pass cache (bug ff19ac0f)
- 7a51ff9: fix: ApiStore.findStaleScenarios measures last run (any status), not last pass (bug 6dc878ef)
- 87a1d23: fix: signPayload emits real HMAC-SHA256, not a forgeable rolling hash (bug 36580bf2)
- 2c933a8: fix: run_for_diff passes caller baseRef as literal argv, never a shell string (bug 970bf61f)
- 166a154: fix: hosted personas listPersonas honors limit/offset on the pg path (bug e920ef6a)
- da762a0: fix: gate legacy /api/\* with API-key auth in cloud mode; loopback bind by default (bug edec8757)
- 933cbe9: fix: bake RDS global CA bundle so sslmode=require TLS to shared RDS verifies
- 5989eed: fix: pin @hasna/browser to published 0.5.16
- 4bc89b3: fix: Dockerfile no longer requires a nonexistent bun.lock
- @hasna/browser@0.5.25
  - @hasna/projects@0.1.141

## 0.0.99

### Patch Changes

- @hasna/browser@0.5.24
  - @hasna/projects@0.1.140

## 0.0.98

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex (v4/core/regexes.js), pg-types' binary-parser date offset, and the workspace @hasna/contracts bundle — plus one own-source nil-UUID literal in testers. Fixes: externalize zod/pg/@hasna/contracts in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), build testers' nil UUID at runtime, and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).
- Updated dependencies [554a5b9]
- Updated dependencies [2ea3b9a]
  - @hasna/contracts@0.13.4
  - @hasna/browser@0.5.23
  - @hasna/projects@0.1.138

## 0.0.97

### Patch Changes

- Updated dependencies [f1b21aa]
  - @hasna/browser@0.5.22

## 0.0.96

### Patch Changes

- @hasna/browser@0.5.21
- @hasna/projects@0.1.137

## 0.0.95

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.
  - @hasna/browser@0.5.20
  - @hasna/projects@0.1.136
  - @hasna/contracts@0.13.3

## 0.0.94

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2
  - @hasna/browser@0.5.19
  - @hasna/projects@0.1.135

## 0.0.93

### Patch Changes

- @hasna/browser@0.5.18
- @hasna/contracts@0.13.1

## 0.0.92

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
- Updated dependencies [0d4f749]
  - @hasna/contracts@0.13.0
  - @hasna/browser@0.5.17

## Unreleased

- ci: run frozen dependency installation, typechecking, builds, and tests on
  pull requests and pushes to `main`.

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
