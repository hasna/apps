[REVIEW] STATUS — @hasna/todos@0.16.0 — branch `release/todos-0.16.0`, PR #2055 (OPEN) — registry npmjs

# Current candidate (round 2, 2026-09-09)

- Package: `@hasna/todos@0.16.0` (`apps/todos/package.json` version 0.16.0).
- Release vehicle: PR #2055, `release/todos-0.16.0`, state OPEN.
- PR head == `origin/release/todos-0.16.0` == `3e63609f96b054a4230f53d72e89514db71f9e03`
  (`gh pr view 2055 --json headRefOid`; `git ls-remote origin release/todos-0.16.0`).
- Worktree HEAD moves as sibling lanes commit in this shared worktree. The fix commits sit
  on top of the PR head and **none is pushed**. Re-derive after any sibling commit:
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `12 0` at this
  record's parent (worktree HEAD `b599859622a648d12f003fa2d4d5ec1ade1e8538`; this record's
  own commit adds one). The CI-green evidence covers 3e63609f9 only — no CI run has ever
  seen the worktree tree.
- Registry negative control: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → E404 (unpublished). 0.16.0 is still publishable.
- Gate: CLOSED. Nothing published. No publish command has been run in any round.

## Round-2 lens verdicts (2026-09-09)

| Lens | Verdict | Why |
| --- | --- | --- |
| credential-path | GO (95) | resolver chain demonstrated end to end on a build from HEAD and on the packed tarball; retired tiers never read; fail-closed with no value leakage |
| breaking-change | NO_GO (25) | the substance is fixed at worktree HEAD; the release VEHICLE is not — the named candidate (3e63609f9) carries none of the remediation |
| test-green | NO_GO (65) | suite green twice (4378 pass / 168 skip / 0 fail at worktree HEAD `b59985962`); the NO_GO is provenance plus the unreproducible gates job |
| release | NO_GO (30) | PR not up to date with the branch; CI has never seen the shipped tree; publish mode hard-requires `HASNA_TODOS_EXPECTED_COMMIT` |

**Blocking (process, not a code defect — reported unresolved by this lane):** the worktree is
ahead of the PR head and no CI run has seen the shipped tree. Remedy is one push of the
worktree HEAD to `release/todos-0.16.0` (updates PR #2055 — never a second PR), wait for the
CI checks on that exact SHA, re-run the lenses at the pushed SHA. Until then the release
vehicle (3e63609f9) and the reviewed tree disagree. The push is the orchestrator's action,
not a file change, so fix-infra cannot land it.

**Estate gate drift (measured this round; branch-local, NOT a CI blocker):** `bun run
check:frozen-locks` exits **1** on this branch —
`@hasna/skills (apps/skills): manifest 0.5.4 — behind published @hasna/skills@0.5.5`.
The drift is branch-local: `apps/skills/package.json` is `0.5.4` on this branch but already
`0.5.5` on `origin/main` (this branch is 56 commits behind main). PR CI checks out the
pull_request MERGE commit, where the manifest is `0.5.5` == published — verified this round:
`git merge-tree --write-tree HEAD origin/main` → tree `d606e8b885a33a378110dc5eb7acc0cbea883e88`,
whose `apps/skills/package.json` version is `0.5.5` and whose `apps/todos/package.json`
version is `0.16.0`. The gate's own `--self-test` exits 0, so the branch-local red is real
data, not a broken gate. The fix is a rebase onto main — outside the fix-infra lane.

**Correction (this round):** the round-1 text of this section said `apps/skills` is `0.5.4`
on this branch **and** on `origin/main`, and that "a CI re-run at ANY sha is red". Both are
wrong: `origin/main` already carries `0.5.5`, and PR CI is green on the merge commit. The
only red is a direct branch-tree run of the gate, which is not what CI does.

## Round-1 lens verdicts (superseded by round 2)

| Lens | Verdict | Why |
| --- | --- | --- |
| credential-path | GO (96) | resolver chain demonstrated end-to-end; retired tiers not read; fail-closed |
| breaking-change | NO_GO (55) | remediation docs exist only in the unpushed commits; at the PR head the pass-1 blocking documentation findings stand |
| test-green | NO_GO (72) | suite is green (4377 pass / 0 fail, measured at worktree HEAD `48ee38b2d`); the NO_GO is provenance — the worktree commits are unpushed and no CI run has seen them |
| release | NO_GO (30) | PR not up to date with the branch; tarball lacks `dist/release-provenance.json` until the prepublish path runs |

# Release mechanics (lane fix-infra, rounds 1-2)

## 1. Bump class of the 18 consumed `@hasna/todos` changesets

The 18 changesets deleted by `3e3c645cd` were all declared `"@hasna/todos": patch`
while several carry breaking changes (CLI `plans`/`task-lists`/`templates` → authenticated
shared API; the `@hasna/contracts` 1.0.2 client resolver; local SQLite no longer the
default). Files: `1720-todos-public-gate-delete-alignment`, `todos-api-only-lists-cli`,
`todos-api-only-plans-cli`, `todos-atomic-project-migration`,
`todos-contracts-1.0.2-client-resolver`, `todos-ledger-migration-safety`,
`todos-machine-help-authorization`, `todos-machine-migration-authority`,
`todos-plan-link-committed-receipt`, `todos-portable-sqlite-backups`,
`todos-release-capture-completion`, `todos-shared-machine-registry`,
`todos-shared-plan-workflow`, `todos-shared-project-registry`,
`todos-shared-task-coordination`, `todos-shared-task-list-workflow`,
`todos-shared-task-queries`, `todos-shared-template-cli`.

**Disposition: 0.16.0 covers the breaking class; no further bump is owed.**

- 0.16.0 is a MINOR, and for a 0.x package minor IS the breaking class — the 0.16.0
  changelog itself marks the `LocalApiConfig`/`getLocalApiConfig` removal
  "(breaking, hence minor)".
- The 18 were hand-consumed into the already-cut 0.16.0 section: `3e3c645cd` deletes them
  and edits `CHANGELOG.md` while `apps/todos/package.json` stays `0.16.0` on both sides.
  They were NOT allowed to run through `changeset version` at 0.15.52, which — declared
  `patch` — would have produced a 0.15.53 patch bump for breaking changes.
- All 18 are present in the 0.16.0 section (verified 18/18 by distinctive-phrase mapping;
  the section also carries a `### Migrating from 0.15.52` block).
- No `@hasna/todos` changeset remains pending at HEAD (`grep -l '"@hasna/todos"' .changeset/*.md` → 0).

**Rule for the next bump:** a breaking change to a 0.x member must be declared `minor`
at authoring time, never `patch`; a `patch` declaration is what the tooling would mis-bump.
No action is required for 0.16.0 because the breaking content is already in the 0.16.0
record and no unconsumed todos changeset exists.

## 2. Changesets naming packages absent from the workspace — NOT REPRODUCED

**Round-2 independent re-measurement (fix-infra, 2026-09-09), not taken on trust from
round 1:** the finding's figure of **6** files matches no measured set. A frontmatter parse
over every changeset at all three refs — 119 files at worktree HEAD, 136 at the PR head,
144 at `origin/main` — resolves **0** package names that are not workspace members (45
members). `changeset version` in a fresh replica (root `package.json` + `.changeset` + all
45 member manifests, the repo's own `@changesets/cli` 2.27.9) → **exit 0**, `All files have
been updated`; the one-file negative control naming `@hasna/does-not-exist` → **exit 1**,
`Found changeset zz-probe-dead-pkg for package @hasna/does-not-exist which is not in the
workspace`. The only dead-name drift is prose (22 files, below), which changesets never
parses. Nothing here breaks `changeset version` repo-wide.

The claim that changeset files naming non-existent workspace packages break
`changeset version` repo-wide does **not** reproduce at this HEAD, at the PR head, or at
`origin/main`:

- `changeset version` in a faithful replica (root `package.json` + `.changeset` + every
  `apps/*/package.json`, run with the repo's own `@changesets/cli` 2.27.9) → **exit 0**,
  "All files have been updated. Review them and commit at your leisure".
- `./node_modules/.bin/changeset status` → **exit 0**.
- Negative control (same replica + one changeset naming `@hasna/does-not-exist`) →
  **exit 1**, `error Error: Found changeset zz-probe-dead-pkg for package
  @hasna/does-not-exist which is not in the workspace` — the probe can fire, so the
  exit-0 result is not vacuous.
- Every package named in changeset **frontmatter** is a workspace member at all three
  refs: 0 unknown across 118 files (HEAD), 136 (PR head), 147 (`origin/main`).
- The in-repo gate that would catch a dead frontmatter name already exists and is green:
  `test/versioning` "pending changesets are non-empty, member-scoped, and release-backed"
  (`test/versioning/versioning.test.ts:155`) asserts `membersByName.has(packageName)` for
  every frontmatter entry — `bun run test:versioning` → `22 pass / 1 skip / 0 fail`, exit 0.
- The finding's figure (**6 files**) matches no frontmatter set at any of the three refs:
  the measured unknown-frontmatter count is **0** at HEAD, the PR head and `origin/main`
  (see the bullet above). The only dead-name drift is prose, below.

**Adjacent real drift (prose only, cannot break changesets):** **22** pre-existing changeset
bodies carry **23** references to four packages that no longer exist in the workspace —
`@hasna/paths` (20 files: `bridge-`, `computers-`, `configs-`, `connectors-`,
`conversations-`, `dispatch-`, `domains-`, `economy-`, `feedback-`, `files-`, `hooks-`,
`loops-`, `monitor-`, `orgs-`, `releases-`, `repos-`, `snapshots-`, `telephony-`,
`workflows-paths-resolver.md`, plus `instructions-mcp-dbpath-resolver.md`),
`@hasna/configs` (`configs-paths-resolver.md`), `@hasna/machines`
(`1603-dispatch-drop-machines.md`), `@hasna/mementos-sdk`
(`1720-mementos-validate-fix.md`). Changesets parses frontmatter, not prose.
Registry status of the four: `@hasna/paths` still publishes (`npm view @hasna/paths version`
→ `0.2.3`) but was inlined out of the workspace (hasna/apps#1535); the other three are
unpublished (`npm view` → E404).

**Recommendation — do not delete another app's release note:**
1. Leave the 22 files in place; they are each package's release record.
2. Have each owning member rewrite the stale reference in its next changeset
   (`@hasna/paths` → the inlined resolver now shipped in that package).
3. If a machine gate is wanted, extend the existing `test/versioning` "pending changesets
   are non-empty, member-scoped" test with a frontmatter-name-resolves-to-a-workspace-member
   assertion — that check is red only on real frontmatter drift, never on prose.

## 3. `turbo.json` `tasks.test.env`

**Fixed.** `tasks.test.env` now lists all **51** `HASNA_TODOS_*` variables `apps/todos`
reads (src, scripts, `*.test.ts`; the tests spawn the built CLI/MCP/server, which inherit
exactly this set). `env: []` was filtering every one of them out of the task.

Evidence (turbo 2.5.4, the pinned version):
- Scratch workspace: `env: []` → the child prints `undefined`; `env: ["HASNA_TODOS_API_KEY"]`
  → prints the value; `env: ["HASNA_TODOS_*"]` → prints the value (wildcards are supported;
  the list is explicit so a reader sees which variables the member reads).
- Live probe against **this** `turbo.json`: with the `HASNA_TODOS_API_KEY` variable set to a
  non-secret probe string in the parent environment, `turbo run test --filter=@hasna/todos`
  printed that same string from inside the task (`@hasna/todos:test: <probe string>`) —
  the variable reaches the task.
- `turbo run test --filter=@hasna/todos --dry=json` → `envMode: strict`,
  `@hasna/todos#test` specified env = the 51 variables.
- `turbo.json` regenerated-list command is recorded in the file's `//` note.

Two-sided re-verification this round (turbo 2.5.4, a scratch workspace holding a verbatim
copy of this `turbo.json` plus one member whose `test` script prints the variables):
`HASNA_TODOS_API_KEY=… HASNA_TODOS_LOCAL=1 HASNA_TODOS_CORPUS_ID=… turbo run test
--filter=@hasna/todos` → `PROBE=[…] LOCAL=[1] CORPUS=[…]`; the same probe against a copy with
`tasks.test.env: []` → `PROBE=[undefined] LOCAL=[undefined] CORPUS=[undefined]`. The list is
therefore load-bearing, not cosmetic.

**Residual (outside this finding's scope, recommend a follow-up):** the same strict-mode
filtering applies to the `TODOS_*` family the package also reads — **220** distinct
non-`HASNA_TODOS_` names (`grep -rhoE '\bTODOS_[A-Z0-9_]+' … apps/todos | sort -u`), with
`TODOS_DB_PATH` alone at **536** references. If the owner wants full local/CI parity, extend
the same `env` list (or add `"TODOS_*"`) — not changed here because the finding scopes the fix
to `HASNA_TODOS_*`.

## 4. This artifact's prior verdict

The previous content of this file was a NO_GO for `@hasna/todos@0.15.44` @
`f780567980d7cdba7eb79356c2f7b735de8adbab`. That verdict is **historical and superseded**
by the 0.16.0 candidate above; it is NOT a blocker for 0.16.0. Disposition of its three P1s
at the candidate (verify-p1, pass 1): all three fixed with passing regression tests —
`postgres-adapter.ts` compares instants via `changedSinceStampNewer` /
`todos_try_timestamptz(...)::timestamptz`, `cloud-router.ts` routes through the same helper,
and `task-subtree-transfer/postgres.ts` clears `schemaReady` in the catch. Caveat carried
forward: the two Postgres paths are exercised by a unit suite, not against a live Postgres
(every `*.pg.test.ts` is skipped without one — 168 skips in CI and locally alike). Original
text retained below verbatim for provenance.

## Gates re-run this round (exact output)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD (`bun` 1.3.14,
`turbo` 2.5.4). Every line below is this round's own output:

- `bun run test:versioning` → `22 pass / 1 skip / 0 fail`, 655 expect() calls,
  `Ran 23 tests across 5 files. [1.67s]`, exit 0 (includes the member-scoped
  pending-changeset assertion — §2).
- `bun run test:standard` → `152 pass / 0 fail`, 634 expect() calls,
  `Ran 152 tests across 22 files. [68.29s]`, exit 0 (includes `turbo-graph`, which parses
  the edited `turbo.json` and requires an acyclic build graph).
- `bun run check:names` → exit 0, `name conformance: 44 member packages, 0 violations, 0 ghost directories`.
- `bun run check:manifests` → exit 0, `[check-manifests] 33/44 publishable members conform (11 recorded exceptions); 0 refusal(s)`.
- `bun run check:secrets` → exit 0, `secrets scan (staged added lines): 0 findings, 0 added lines checked`.
- `bun run check:dep-direction` → exit 0, `dependency direction: 44 member packages, 0 private-scope dependencies`.
- `bun run check:deploy-lanes` → exit 0, `deploy-lanes: PASS — 5 root deploy workflow(s) checked, no undiscoverable deploy lanes`;
  `todos-deploy self-test: PASS (20 mutations rejected, 12 analyser controls, real workflow accepted)`;
  `todos-deploy: PASS — ci-gated trigger, gated source pin, target-pinned, scan-gated, digest-pinned, rollback-ready`.
- `bun run check:frozen-locks` → **exit 1** — `FROZEN-LOCK VIOLATIONS (1): @hasna/skills
  (apps/skills): manifest 0.5.4 — behind published @hasna/skills@0.5.5; land the bump on
  main before deploying`. Branch-local (main already carries 0.5.5) and not a CI blocker —
  see "Estate gate drift" above. `check-frozen-locks.ts --self-test` → exit 0
  (`self-test PASS — positive controls clean; negative controls 1-6 + …`), so the gate is
  healthy and the red is real data.
- `changeset status` (real worktree) → exit 0; `changeset version` (fresh replica, 119
  changesets) → exit 0, `All files have been updated`; dead-frontmatter negative control →
  exit 1 with the `not in the workspace` error (see §2). Frontmatter dead-name census: 0
  unknown of 119 files at HEAD, 136 at the PR head, 144 at `origin/main`.
- `turbo run test --filter=@hasna/todos --dry=json` → exit 0, `envMode: strict`,
  `@hasna/todos#test` `environmentVariables.specified.env` = the 51 variables (§3).
- Two-sided live turbo probe against a verbatim copy of this `turbo.json` (turbo 2.5.4):
  with the real env list → `PROBE=[probe-value] LOCAL=[1] CORPUS=[probe-corpus]`; with
  `tasks.test.env: []` → `PROBE=[] LOCAL=[] CORPUS=[]`. The list is load-bearing, not
  cosmetic (§3).
- `HASNA_TODOS_*` census: the regenerated grep finds **51** names; `turbo.json` lists
  **51**; found-not-listed **0**, listed-not-found **0** (§3).
- `bun run check:publish-guard` → **not completed in this round** (per-member `npm pack
  --dry-run` over 44 members; the round-1 run scanned several members clean with 0
  internal-infra strings and no violation). Independent of this lane's files — none of
  `turbo.json`, `.changeset/README.md` or this file ships in any tarball (the todos payload
  is `LICENSE`, `README.md`, `package.json`, `postinstall.js`, `dist/**`).
- NOT re-run here (not affected by this lane's files, owned by other lenses): the
  `apps/todos` `bun test` suite (test-green), tarball/pack/provenance gates (release),
  hosted live-path behaviour (credential-path).

**Superseded:** the earlier round-1 line recorded `check:frozen-locks` → exit 0 and then
"exit 1 at ANY sha". The current, re-derived value is: exit 1 on a direct branch-tree run,
green in PR CI (merge commit). See the correction above.

## 5. fix-infra round-2 disposition of the four assigned findings

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | 18 consumed changesets declared `patch` while carrying breaking changes | **RECORDED.** All 18 re-verified `"@hasna/todos": patch` (`git show 3e3c645cd^:<file>`); 0 `@hasna/todos` changesets remain. Rule written into `.changeset/README.md`; disposition in §1 — 0.16.0 is the minor that IS the 0.x breaking class, so no further bump is owed. |
| 2 | 6 changeset files name packages absent from the workspace, breaking `changeset version` repo-wide | **NOT REPRODUCED** (§2, re-measured this round: 0 unknown frontmatter refs at 3 refs; `changeset version` exit 0; negative control exit 1). Real prose-only drift listed with a recommendation; nothing deleted. |
| 3 | `turbo.json` `tasks.test.env` must carry every `HASNA_TODOS_*` the tests read | **FIXED and re-verified** (§3): 51/51, `envMode: strict`, two-sided live probe. |
| 4 | release-review artifact on disk is a NO_GO for 0.15.44 | **UPDATED** — current candidate recorded truthfully above (round-2 verdicts, gate CLOSED, nothing published); the 0.15.44 NO_GO is retained as historical with its three P1s marked fixed. |

**Unresolved in this lane (needs a file or action outside it):**

1. **Push of the worktree HEAD to `release/todos-0.16.0`** (updates PR #2055) — the
   blocking item for breaking-change / test-green / release. An orchestrator action, not a
   file change.
2. **`HASNA_TODOS_EXPECTED_COMMIT` is not exported by any release record** — publish mode
   hard-requires it (`src/lib/public-release-gate.ts:733`). The owner of the release run
   must export the pushed SHA. Outside this lane's files.
3. **Branch-local frozen-locks red** — fixed by a rebase onto main (`apps/skills` 0.5.4 →
   0.5.5); `apps/skills/**` is not in this lane.
4. **Two undocumented-but-additive surface changes** found by round-2 lenses (the
   route-dependent `--help` command list, and the `storage status` `warnings` field) need a
   CHANGELOG bullet in `apps/todos/CHANGELOG.md` — outside this lane (fix-docs).

# Historical — [REVIEW] NO_GO — @hasna/todos@0.15.44 @ f780567980d7cdba7eb79356c2f7b735de8adbab — registry npmjs

- P1 — `apps/todos/src/storage/postgres-adapter.ts:2847`: the Postgres sync adapter still compares `updated_at` as raw text. A newer space-form timestamp such as `2026-08-20 23:00:00` is lexically less than ISO cursor `2026-08-20T21:00:00Z`, so changed tasks are silently omitted; unparseable timestamps are also dropped.

- P1 — `apps/todos/src/cli/cloud-router.ts:3410`: the cloud changed-since/report path has the same raw lexical comparison. Cloud tasks with space-form timestamps newer than an ISO cursor are silently excluded from CLI summaries and activity reports.

- P1 — `apps/todos/src/task-subtree-transfer/postgres.ts:90-94`: `schemaReady` caches a rejected schema-sync promise without clearing it. A transient Postgres DDL/lock-timeout during `inspect`, `apply`, `readExact`, or `rollback` poisons that backend, causing every later operation to fail immediately until process restart.
