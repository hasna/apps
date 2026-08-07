# Worklog

## 2026-08-07 — Full project registration substrate

Task: `1dd3ec2d-b544-4b59-85a1-4a9289640db9`

Branch: `1dd3ec2d-full-registration`

Validated base: `origin/main` at `cdda07f` (includes `@hasna/projects@0.1.99` and PR #72 doctor/API-location fix)

Candidate scope:

- Add `projects register-full`, accepting one bounded JSON request on stdin.
- Keep the default CLI fail-closed before database or filesystem mutation until every dependent authority exposes the required contract.
- Add an injectable Projects SDK operation for conditional creation across Projects, Conversations, Todos project plus exact-ID task list, Mementos, integrations, `GOALS.md`, and the final project marker.
- Bind each operation to an immutable manifest containing authority route, package version, authority ID, tenant ID, corpus ID, capabilities, dependency graph, and opaque target-path digest.
- Record immutable forward, exact-readback, inverse, inverse-readback, and terminal receipts with bounded exact lookup.
- Bind every inverse request selector and idempotency key to the accepted receipt's exact stable target ID; the compensation regression rejects a forward workspace selector on the inverse path.
- Reconcile mutation-response disconnects through the authority’s exact terminal lookup; report `split_state` when the terminal outcome cannot be resolved.
- Compensate only resources proven to have been created by the attempt. Local cleanup requires the exact project state plus the attempt-created directory inode and an empty directory; foreign content or drift refuses cleanup.
- Preserve legacy project creation and cleanup behavior by default. Full registration suppresses creation/deletion events only because its immutable receipt ledger is the authoritative audit record.

Dependency tasks required before the default CLI may perform live registration:

- Todos conditional project and exact project-ID task-list API: `317026ea-dc10-422e-af51-206a4ec885f9`
- Mementos conditional project API: `7e6a213c-ae3d-420c-a512-94abd1164df8`
- Conversations conditional channel API: `983c734e-6602-4286-98c5-9c2e6f6d741a`

Validation:

- `bun run typecheck` — `rc=0`
- `bun test src/lib/project-registration.test.ts src/cli/index.test.ts` — `61 pass`, `0 fail`, `873` expectations
- `bun test` — `388 pass`, `3 skip`, `0 fail`, `2647` expectations across `41` files
- `bun run build` — `rc=0`
- `bun run contracts:conformance` — `rc=0`
- `git diff --check` — `rc=0`
- `shield review` — raw output: `Critical: 10 High: 0 Medium: 0 Low: 0 Info: 0`; every finding is on an unchanged pre-existing line outside this candidate’s staged hunks, and none is a secrets finding. The staged-scope defect is queued as shield task `d0bb42cb-27a2-42f0-96e4-afcc59f3147e`.
- Canonical worktree check — `canonical_path=yes`; no `/_factory_src/` component
- Isolated real CLI acceptance — `rc=1 db_exists=no target_exists=no path_leaked=no`; response named all three dependency task IDs and returned a complete, untruncated bounded envelope

Current decision:

- **GO** for the Projects-owned, feature-gated registration substrate and its rollback/receipt contract.
- **NO_GO** for live default CLI registration until all three dependent APIs ship and the unavailable adapters are replaced with compliant package-owned adapters.
