[REVIEW] NO_GO — @hasna/bridge@0.7.2 @ 4d6e8c272f3b5006b928c1ec520679a5587db8d6 — registry npmjs

- P1 — `apps/bridge/src/lib/daemon.ts:223-235`: stale-lock recovery returns `false` whenever the recorded PID is alive, before applying the 120-second age expiry. If a crashed bridge process’s PID is later recycled by an unrelated process, the stale lock becomes permanently unbreakable; `daemon start`, `stop`, and `restart` then fail with “already running” until manual lock removal. The existing tests cover a dead PID and a genuinely live owner (`tests/daemon-lifecycle.test.ts:169-224`), but not a recycled PID with unrelated process identity. This blocks reliable daemon lifecycle recovery.

P2/P3 non-blocking observations:

- `apps/bridge/CHANGELOG.md:3-8` omits the display-name change (`501154dbc`) and contracts-kit alignment (`268ac3f7f`), while duplicating the stop-grace and lock changes already described under 0.7.1. The 0.7.2 entry is incomplete relative to the candidate’s release commits.
- `apps/bridge/src/cli/index.ts:849-884` changes omitted `--timeout-ms` from a 5-second default to config-derived grace, potentially waiting up to 10 minutes. Explicit timeout arguments remain compatible; targeted grace tests passed.
- `apps/bridge/src/lib/daemon.ts:142-143` still falls back to `process.cwd()` for launchd/systemd paths when `HOME` is unset, while `paths.ts:10-15` now falls back to `os.homedir()`. This creates an edge-case path inconsistency.
- Static scans found no credential patterns, private `*.hasna.xyz` URLs, ARNs, AWS account IDs, private-key markers, or `.env` files in the Bridge tree or generated `dist`. The README uses `[REDACTED_SECRET]` only.
- Package metadata is internally aligned: version `0.7.2`, unchanged `bridge`/`bridge-mcp` bins, matching contract manifest bins, valid root export paths, and `0` tracked `dist` files.
- Passing checks: typecheck, path tests, targeted stop-grace tests, `git diff --check`, name conformance (`76 member packages, 0 violations, 0 ghost directories`), and staged secrets scan (`0 findings`).

Not checked:

- The published 0.7.1 tarball and registry changelog comparison; `npm view` timed out.
- Full `npm pack`/prepack artifact validation, contracts validation, root publish-guard, and full integration tests; the read-only environment produced `EROFS`/`EPERM` failures.
- Publishing.