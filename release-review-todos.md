[REVIEW] STATUS — @hasna/todos@0.16.0 — branch `release/todos-0.16.0`, PR #2055 (OPEN) — registry npmjs

# Current candidate (round 3, 2026-09-09)

- Package: `@hasna/todos@0.16.0` (`apps/todos/package.json` version 0.16.0).
- Release vehicle: PR #2055, `release/todos-0.16.0`, state OPEN.
  `gh pr view 2055 --json headRefOid,state,updatedAt` →
  `3e63609f96b054a4230f53d72e89514db71f9e03` / OPEN / `2026-09-09T02:07:35Z` (unchanged).
- PR head == `origin/release/todos-0.16.0` ==
  `3e63609f96b054a4230f53d72e89514db71f9e03` (`git ls-remote origin
  refs/heads/release/todos-0.16.0 refs/pull/2055/head` → the same SHA for both).
- Worktree HEAD (this record's parent) = `85e3a8287e9d2d82ccdafe87b97d5eec226b3e87`,
  **14 commits ahead** of the release vehicle and on no remote ref (this record's own commit
  adds one, so a re-derivation reads `15 0`):
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `14 0`;
  `git branch -r --contains HEAD` → empty; `gh run list --commit 85e3a8287…` → `[]`.
  None of the remediation is pushed and no CI run has ever seen the worktree tree; the
  CI-green evidence covers 3e63609f9 only.
- **The vehicle still carries the pre-remediation tree, measured this round:** at
  3e63609f9 the 18 `@hasna/todos` changesets are still PENDING (18/18, every one
  `"@hasna/todos": patch`) and `apps/todos/CHANGELOG.md` has no migration section —
  `git show 3e63609f9:apps/todos/CHANGELOG.md | grep -c 'Migrating from 0.15.52'` → `0`
  (at HEAD → `1`). `3e3c645cd`, the commit that consumes the 18 and writes the migration
  section, is NOT an ancestor of `origin/release/todos-0.16.0`
  (`git merge-base --is-ancestor 3e3c645cd origin/release/todos-0.16.0` → exit 1).
  Consequence for §1: a `changeset version` run on the vehicle today would cut a
  **0.15.53 patch** for breaking changes.
- Registry negative control: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → npm 404 (`tarball, folder, http url, or git
  url`). 0.16.0 is still publishable.
- Gate: CLOSED. Nothing published. No publish command has been run in any round.

## Round-3 lens verdicts (2026-09-09)

| Lens | Verdict | Why |
| --- | --- | --- |
| credential-path | NO_GO (40) | chain proven end to end on a HEAD build and on the packed tarball; blocked by a false README refusal claim (major) plus the vehicle mismatch |
| breaking-change | NO_GO (30) | the substance is documented and correct at worktree HEAD; the named vehicle ships every 0.16.0 breaking change undocumented, and a new minor (README "four things change" vs CHANGELOG "three things change") |
| test-green | NO_GO (67) | suite green at HEAD (4378 pass / 168 skip / 0 fail); CI green at the candidate merge commit `d0c454004`; neither covers the shipping tree |
| release | NO_GO (28) | artifact-level checks all pass (pack/version/license/deps/secrets/no-GO); PR not up to date, CI never ran on the shipped tree, publish mode hard-requires `HASNA_TODOS_EXPECTED_COMMIT` |

**Blocking (process, not a code defect — reported unresolved by this lane):** the worktree is
14 commits ahead of the PR head and no CI run has seen the shipped tree. Remedy is one push
of the worktree HEAD to `release/todos-0.16.0` (updates PR #2055 — never a second PR), a
rebase/merge onto `origin/main` so `check:frozen-locks` goes green on the branch, CI green on
that exact SHA, then re-run the lenses. Until then the release vehicle (3e63609f9) and the
reviewed tree disagree. The push is the orchestrator's action, not a file change, so fix-infra
cannot land it.

**Findings this round that live outside this lane** (reproduced, not fixed here; see
"Unresolved" below): the README blank-authority refusal claim
(`apps/todos/README.md:150-152`, major); the README/CHANGELOG migration-count mismatch
(`README.md:18` "four things change" vs `CHANGELOG.md:7` "three things change"); the
`docs/cli-help.md` off-by-one default column (75/121 vs the credentialed 76/122); and the
README tier-1 table still advertising `--api-key`/`--profile`. All four are
`apps/todos/**` documentation files owned by the fix-docs lane.

**Estate gate drift (re-measured this round; branch-local, NOT a CI blocker):** `bun run
check:frozen-locks` exits **1** on this branch —
`FROZEN-LOCK VIOLATIONS (1): - @hasna/skills (apps/skills): manifest 0.5.4 — behind
published @hasna/skills@0.5.5; land the bump on main before deploying`.
The drift is branch-local: `apps/skills/package.json` is `0.5.4` on this branch but already
`0.5.5` on `origin/main` (this branch is now 58 commits behind main:
`git rev-list --left-right --count origin/main...HEAD` → `58 16`; round 2 measured 56).
PR CI checks out the pull_request MERGE commit, where the manifest is `0.5.5` == published —
re-verified this round: `git merge-tree --write-tree HEAD origin/main` → tree
`705436ffa2cab32741030b06a15eee03c8909142`, whose `apps/skills/package.json` version is
`0.5.5` and whose `apps/todos/package.json` version is `0.16.0`. The gate's own `--self-test`
exits 0, so the branch-local red is real data, not a broken gate. The fix is a rebase onto
main — outside the fix-infra lane.

**Correction (round 2, retained):** the round-1 text of this section said `apps/skills` is
`0.5.4` on this branch **and** on `origin/main`, and that "a CI re-run at ANY sha is red". Both
are wrong: `origin/main` already carries `0.5.5`, and PR CI is green on the merge commit. The
only red is a direct branch-tree run of the gate, which is not what CI does.

## Round-2 lens verdicts (superseded by round 3)

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

# Release mechanics (lane fix-infra, rounds 1-3)

## 1. Bump class of the 18 `@hasna/todos` changesets

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
record and no unconsumed todos changeset exists **at worktree HEAD**.

**Round-3 re-measurement (2026-09-09) — the disposition above is HEAD-only.** At the named
release vehicle (`3e63609f9`) the 18 are NOT consumed: `grep -l '"@hasna/todos"'
<vehicle>/.changeset/*.md` → **18**, every one `"@hasna/todos": patch`; the consuming commit
`3e3c645cd` is not an ancestor of `origin/release/todos-0.16.0`. So on the vehicle a
`changeset version` run today would cut `0.15.53` (patch) for the breaking changes. The
"no further bump is owed" disposition is therefore conditional on the push: it holds only
once `85e3a8287` (or its successor) is on `release/todos-0.16.0`. This is the same
vehicle-mismatch blocker as the round-3 lens verdicts, not a second defect.

## 2. Changesets naming packages absent from the workspace — NOT REPRODUCED

**Round-3 independent re-measurement (fix-infra, 2026-09-09), third time, from scratch:**
the finding's figure of **6** files still matches no measured set, and the claim that such
files break `changeset version` **repo-wide** is still false. Measured this round with a
fresh census over every `.changeset/*.md` at three refs, resolving frontmatter keys against
the 45 workspace member names (`apps/*` + `apps/notes/server`):

| Ref | `.changeset/*.md` | unknown FRONTMATTER names | prose files naming a dead package |
| --- | --- | --- | --- |
| worktree HEAD `85e3a8287` | 119 | **0** | 22 |
| vehicle `3e63609f9` | 137 | **0** | 22 |
| `origin/main` | 145 | **0** | 22 |

`changeset version` re-run this round in a fresh replica (root `package.json` +
`.changeset` + every tracked `package.json`, the repo's own `@changesets/cli` 2.27.9):
→ **exit 0**, `🦋  All files have been updated. Review them and commit at your leisure`.
Negative control (one extra changeset whose frontmatter names `@hasna/does-not-exist`) →
**exit 1**, `🦋  error Error: Found changeset zz-probe-dead-pkg for package
@hasna/does-not-exist which is not in the workspace`. Second control (a changeset whose
BODY mentions `@hasna/paths` but whose frontmatter names a real member) → **exit 0**,
proving changesets resolves frontmatter only and prose cannot break it.

**The 6 dead-name files, listed (all 22 measured, none deleted):** the complete set of
changeset bodies carrying a name absent from the workspace, with the recommendation below.
`@hasna/paths` (20 files): `bridge-paths-resolver.md`, `computers-paths-resolver.md`,
`configs-paths-resolver.md`, `connectors-paths-resolver.md`,
`conversations-paths-resolver.md`, `dispatch-paths-resolver.md`,
`domains-paths-resolver.md`, `economy-paths-resolver.md`, `feedback-paths-resolver.md`,
`files-paths-resolver.md`, `hooks-paths-resolver.md`, `instructions-mcp-dbpath-resolver.md`,
`loops-paths-resolver.md`, `monitor-paths-resolver.md`, `orgs-paths-resolver.md`,
`releases-paths-resolver.md`, `repos-paths-resolver.md`, `snapshots-paths-resolver.md`,
`telephony-paths-resolver.md`, `workflows-paths-resolver.md`.
`@hasna/configs`: `configs-paths-resolver.md`. `@hasna/machines`:
`1603-dispatch-drop-machines.md`. `@hasna/mementos-sdk`: `1720-mementos-validate-fix.md`.
Registry status: `@hasna/paths` still publishes (`npm view @hasna/paths version` → `0.2.3`)
but was inlined out of the workspace (hasna/apps#1535); the other three are unpublished.
Every one of these references is in the changeset **body**, never the frontmatter, so none
of them can fail `changeset version`. The finding's "6 files … breaks `changeset version`
repo-wide" is therefore **not reproduced** at HEAD, at the vehicle or at `origin/main`.

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

**Round-3 re-verification (fix-infra, 2026-09-09) — still FIXED, re-measured from scratch:**
the regeneration grep (`grep -rhoE 'HASNA_TODOS_[A-Z0-9_]+' --include='*.ts' --include='*.tsx'
--include='*.js' --include='*.mjs' --include='*.json' apps/todos --exclude-dir=node_modules
--exclude-dir=dist | sort -u`) finds **51** names; `turbo.json` `tasks.test.env` lists
**51**; found-not-listed **0**, listed-not-found **0**. The `*.test.ts` subset is **46**
names, all 46 present. `turbo run test --filter=@hasna/todos --dry=json` → exit 0,
`envMode: strict`, `@hasna/todos#test` `environmentVariables.specified.env` = the 51
variables. Two-sided live probe re-run against a verbatim copy of this `turbo.json` plus a
probe member (turbo 2.5.4): real list → `PROBE=[probe-value] LOCAL=[1]
CORPUS=[probe-corpus]`; `tasks.test.env: []` → `PROBE=[] LOCAL=[] CORPUS=[]`. The list is
load-bearing, not cosmetic. No edit was needed this round.

**Residual (outside this finding's scope, recommend a follow-up):** the same strict-mode
filtering applies to the `TODOS_*` family the package also reads — **220** distinct
non-`HASNA_TODOS_` names (`grep -rhoE '\bTODOS_[A-Z0-9_]+' … apps/todos | sort -u`), with
`TODOS_DB_PATH` alone at **536** references. If the owner wants full local/CI parity, extend
the same `env` list (or add `"TODOS_*"`) — not changed here because the finding scopes the fix
to `HASNA_TODOS_*`.

## 4. This artifact's prior verdict — and the current status it must not be confused with

**Current status (round 3, 2026-09-09), stated truthfully:** this file's live verdict is
**NO_GO for `@hasna/todos@0.16.0` at the named vehicle `3e63609f9`** (see "Round-3 lens
verdicts"). The gate is **CLOSED**, nothing is published (`npm view @hasna/todos version` →
`0.15.52`; `@hasna/todos@0.16.0` → 404), and the blocking item is the vehicle mismatch:
worktree HEAD `85e3a8287` is 14 commits ahead of `origin/release/todos-0.16.0` and on no
remote ref. The 0.15.44 NO_GO below is **historical and superseded** — it is NOT a blocker
for 0.16.0, and it must not be read as the current verdict.

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

## Gates re-run in round 3 (exact output)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD
`85e3a8287e9d2d82ccdafe87b97d5eec226b3e87` (`bun` 1.3.14, `turbo` 2.5.4). Every line below
is this round's own output:

- `bun run test:versioning` → `22 pass / 1 skip / 0 fail`, 655 expect() calls,
  `Ran 23 tests across 5 files. [2.26s]`, exit 0 (includes the member-scoped
  pending-changeset assertion — §2).
- `bun run test:standard` → `152 pass / 0 fail`, 634 expect() calls,
  `Ran 152 tests across 22 files. [82.55s]`, exit 0 (includes `turbo-graph`, which parses
  the edited `turbo.json` and requires an acyclic build graph).
- `bun run check:names` → exit 0, `name conformance: 44 member packages, 0 violations, 0 ghost directories`.
- `bun run check:dep-direction` → exit 0, `dependency direction: 44 member packages, 0 private-scope dependencies`.
- `bun run check:secrets` → exit 0, `secrets scan (staged added lines): 0 findings, 0 added lines checked`.
- `bun run check:manifests` → exit 0, `[check-manifests] 33/44 publishable members conform (11 recorded exceptions); 0 refusal(s)`.
- `bun run check:deploy-lanes` → exit 0, `deploy-lanes: PASS — 5 root deploy workflow(s) checked, no undiscoverable deploy lanes`;
  `todos-deploy self-test: PASS (20 mutations rejected, 12 analyser controls, real workflow accepted)`;
  `todos-deploy: PASS — ci-gated trigger, gated source pin, target-pinned, scan-gated, digest-pinned, rollback-ready`.
- `bun run check:frozen-locks` → **exit 1** — `FROZEN-LOCK VIOLATIONS (1): - @hasna/skills
  (apps/skills): manifest 0.5.4 — behind published @hasna/skills@0.5.5; land the bump on
  main before deploying`. Branch-local (main already carries 0.5.5) and not a CI blocker —
  see "Estate gate drift" above.
- `changeset status` (real worktree) → exit 0 (`🦋  info Packages to be bumped at …`).
- `changeset version` (fresh replica, 119 changesets) → exit 0, `All files have been
  updated`; dead-frontmatter negative control → exit 1 with the `not in the workspace`
  error; prose-only dead-name control → exit 0 (§2).
- Dead-name census (§2): unknown frontmatter **0** of 119 (HEAD) / 137 (vehicle) / 145
  (`origin/main`); prose files naming a dead package **22** at all three refs.
- `HASNA_TODOS_*` census (§3): regenerated grep finds **51**; `turbo.json` lists **51**;
  found-not-listed **0**, listed-not-found **0**; `*.test.ts` subset **46/46** present.
- `turbo run test --filter=@hasna/todos --dry=json` → exit 0, `envMode: strict`,
  `@hasna/todos#test` specified env = the 51 variables.
- Two-sided live turbo probe against a verbatim copy of this `turbo.json` (turbo 2.5.4):
  real env list → `PROBE=[probe-value] LOCAL=[1] CORPUS=[probe-corpus]`; `tasks.test.env:
  []` → `PROBE=[] LOCAL=[] CORPUS=[]`. Load-bearing, not cosmetic (§3).
- Provenance this round: `git rev-parse HEAD` → `85e3a8287…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `14 0`;
  `git ls-remote origin refs/heads/release/todos-0.16.0 refs/pull/2055/head` → the same
  `3e63609f9…` for both; `gh pr view 2055 --json headRefOid,state,updatedAt` →
  `3e63609f9…` / OPEN / `2026-09-09T02:07:35Z`; `git merge-base --is-ancestor 3e3c645cd
  origin/release/todos-0.16.0` → exit 1.
- Registry controls: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → 404. `npm view @hasna/skills version` → `0.5.5`.
- NOT re-run here (not affected by this lane's files, owned by other lenses): the
  `apps/todos` `bun test` suite (test-green measured 4378 pass / 168 skip / 0 fail at HEAD),
  tarball/pack/provenance gates (release), hosted live-path behaviour (credential-path),
  `check:publish-guard`.

## Gates re-run in round 2 (exact output; superseded by the round-3 block above)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD (`bun` 1.3.14,
`turbo` 2.5.4). Every line below is that round's own output:

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

## 5. fix-infra round-3 disposition of the four assigned findings

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | 18 consumed changesets declared `patch` while carrying breaking changes | **RECORDED + re-measured.** All 18 re-verified `"@hasna/todos": patch` at `3e3c645cd^`; 0 remain at HEAD. Rule written into `.changeset/README.md`; §1 disposition holds **at HEAD** and is explicitly conditional on the push — at the vehicle the 18 are still pending, so `changeset version` there would cut a 0.15.53 patch. |
| 2 | 6 changeset files name packages absent from the workspace, breaking `changeset version` repo-wide | **NOT REPRODUCED (third measurement).** 0 unknown frontmatter names at 119/137/145 files (HEAD / vehicle / `origin/main`); `changeset version` exit 0; dead-frontmatter negative control exit 1; prose-only control exit 0. The 22 prose files are listed in full with a recommendation; nothing deleted. |
| 3 | `turbo.json` `tasks.test.env` must carry every `HASNA_TODOS_*` the tests read | **FIXED, re-verified, no edit needed this round** (§3): 51/51, 46/46 test-subset, `envMode: strict`, two-sided live probe. |
| 4 | release-review artifact on disk is a NO_GO for 0.15.44 | **UPDATED** — §4 now states the live verdict truthfully (NO_GO for 0.16.0 at vehicle `3e63609f9`, gate CLOSED, nothing published) and marks the 0.15.44 NO_GO historical; §4 also carries the round-3 candidate provenance. |

**Unresolved in this lane (needs a file or action outside it):**

1. **Push of the worktree HEAD to `release/todos-0.16.0`** (updates PR #2055) — the
   blocking item for breaking-change / test-green / release. An orchestrator action, not a
   file change. Worktree HEAD `85e3a8287` is 14 commits ahead and on no remote ref.
2. **`HASNA_TODOS_EXPECTED_COMMIT` is not exported by any release record** — publish mode
   hard-requires it (`src/lib/public-release-gate.ts:729`). The owner of the release run
   must export the pushed SHA. Outside this lane's files.
3. **Branch-local frozen-locks red** — fixed by a rebase onto main (`apps/skills` 0.5.4 →
   0.5.5); `apps/skills/**` is not in this lane. Re-measured this round: exit 1, one
   violation, branch 58 behind main, merge tree clean.
4. **Four round-3 documentation findings in `apps/todos/**` (fix-docs lane), reproduced by
   the lenses, NOT fixed here** — they are outside this lane's files:
   - MAJOR (credential-path): `apps/todos/README.md:150-152` claims a blank authority
     variable is a throw on all three surfaces; measured false — all three surfaces silently
     resolve the station04 Keychain credential.
   - MINOR (breaking-change): `apps/todos/README.md:18` says "four things change";
     `apps/todos/CHANGELOG.md:7` says "three things change" — the route-dependent help
     surface is the missing fourth.
   - MINOR (credential-path): `apps/todos/docs/cli-help.md` default row `75 / 121 / 24` is
     the uncredentialed posture; the credentialed default README step 1 reaches is
     `76 / 122`.
   - MINOR (credential-path): `apps/todos/README.md:102` still advertises `--api-key` /
     `--profile`, which the 0.16.0 changelog says the todos CLI does not expose.

# Historical — [REVIEW] NO_GO — @hasna/todos@0.15.44 @ f780567980d7cdba7eb79356c2f7b735de8adbab — registry npmjs

- P1 — `apps/todos/src/storage/postgres-adapter.ts:2847`: the Postgres sync adapter still compares `updated_at` as raw text. A newer space-form timestamp such as `2026-08-20 23:00:00` is lexically less than ISO cursor `2026-08-20T21:00:00Z`, so changed tasks are silently omitted; unparseable timestamps are also dropped.

- P1 — `apps/todos/src/cli/cloud-router.ts:3410`: the cloud changed-since/report path has the same raw lexical comparison. Cloud tasks with space-form timestamps newer than an ISO cursor are silently excluded from CLI summaries and activity reports.

- P1 — `apps/todos/src/task-subtree-transfer/postgres.ts:90-94`: `schemaReady` caches a rejected schema-sync promise without clearing it. A transient Postgres DDL/lock-timeout during `inspect`, `apply`, `readExact`, or `rollback` poisons that backend, causing every later operation to fail immediately until process restart.
