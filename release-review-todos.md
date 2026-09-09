[REVIEW] STATUS — @hasna/todos@0.16.0 — branch `release/todos-0.16.0`, PR #2055 (OPEN) — registry npmjs

# Current candidate (round 6, 2026-09-09) — worktree HEAD `0a615957b` (UNPUSHED, 4 ahead of the PR head); CI RED at the PR head `8648bb0d88`; the package FAILS its own release gate at HEAD

- Package: `@hasna/todos@0.16.0` (`apps/todos/package.json` version 0.16.0).
- Release vehicle: PR #2055, `release/todos-0.16.0`, state OPEN, `mergeStateStatus` UNSTABLE.
  `gh pr view 2055 --json headRefOid,state,mergeStateStatus` →
  `8648bb0d88ba26dc39c55c3fdb26a0d2e9f82693` / OPEN / `UNSTABLE`.
- **Worktree HEAD is NOT the PR head.** `git rev-parse HEAD` →
  `0a615957b6a991249f6b8db1199daf41e898fda2`;
  `git ls-remote origin refs/heads/release/todos-0.16.0` → `8648bb0d88…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `4	0`.
  The four commits are unpushed and on no remote ref:
  `0a615957b fix(todos): typed zero-arg refusals, per-code API remedies, ship docs, gate runs suite`,
  `f12fd42ac fix(infra): record the round-5 candidate truthfully…`,
  `4ee5a7be9 fix(todos): return typed, actionable MCP refusals instead of UNKNOWN_ERROR`,
  `2b27306db fix(infra): record the round-4 candidate status (pushed HEAD, CI red)`.
  `gh run list --commit 0a615957b6a991249f6b8db1199daf41e898fda2` → `[]` (no CI run exists
  at the worktree HEAD or at any of the four commits). The round-5 block below is
  superseded: it asserts HEAD `4ee5a7be9` and `2	0`.
- **CI at the PR head `8648bb0d88` is RED.** `gh run list --commit 8648bb0d88…` →
  `ci` run `34348350710` `conclusion=failure`, `recordings-linux` run `34348350676`
  `success`. `gh pr checks 2055` → `build + test (affected)  fail  22m34s`; the other five
  checks pass. **`@hasna/todos:test` did not run there** (re-measured this round): in the
  12,209-line failed-job log (`gh run view 34348350710 --log-failed`),
  `grep -c 'todos:test'` → `0`, `grep -c 'todos#test'` → `0`, `grep -c 'todos:build'` → `1`;
  turbo aborted on `Failed: @hasna/knowledge#test` (`Tasks: 59 successful, 68 total`). The
  only green `ci` run on this branch (`34293796916`) is at the ancestor `3e63609f9`. **The
  task premise "CI IS GREEN at the current HEAD 8648bb0d88" is FALSE** and is recorded here
  as false.
- **NEW BLOCKING FINDING (round 6, release lens): the package FAILS its own release gate at
  the worktree HEAD, so `npm publish` would abort at `prepublishOnly`.** Measured in a
  clean detached worktree at the exact HEAD (`git worktree add --detach … 0a615957b`;
  `git status --porcelain` → 0): `bun run verify:release` → **exit 1**, `18`
  `package-files-extra` failure lines over **6** paths — `CHANGELOG.md`,
  `docs/PLAN_API.md`, `docs/TASK_LIST_API.md`, `docs/TEMPLATE_API.md`,
  `docs/TASK_QUERY_API.md`, `docs/native-storage.md`. Cause: commit `0a615957b` added those
  six paths to `apps/todos/package.json` `files[]` without extending the hardcoded allowlist
  at `apps/todos/src/lib/public-release-gate.ts:388`
  (`const allowedFiles = ["dist", "postinstall.js", "LICENSE", "README.md"];`), enforced at
  `:390`. Publish mode is not exempt (`scripts/verify-public-release.ts:118` calls
  `validateRootPackageMetadata` outside the `if (authority.mode === "publish")` block).
  **This is outside this lane (`apps/todos/**`); an in-flight, uncommitted fix was present
  in the shared worktree when measured (8 modified `apps/todos/**` files at 16:31, including
  `src/lib/public-release-gate.ts`), but it is NOT in HEAD and is not counted here.**
- **Doc-vs-behaviour contradiction on the shipped surface (release lens, MAJOR):** the
  committed `apps/todos/README.md:80` still says "the npm tarball ships this README and
  `dist/` only, so read those files from the repo", while `package.json` `files[]` now packs
  `CHANGELOG.md` and the five docs. Also `apps/todos/**` — outside this lane.
- **The CI failure is deterministic and outside this branch.** Reproduced:
  `cd apps/knowledge && bun test tests/project-panel.test.ts` → `4 pass / 2 fail`,
  `Expected: "ready" / Received: "stale"` at `apps/knowledge/tests/project-panel.test.ts:381`.
  `apps/knowledge/**` is untouched by this branch, so a re-run does not clear it.
- Registry negative control: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → npm 404. 0.16.0 is still publishable.
- **This record's own commit.** Every measurement in the round-6 block is taken at the
  measured candidate `0a615957b`; this record is committed as its child (the fix-infra
  round-6 commit), so `git rev-parse HEAD` when reading this file is one commit past the
  measured candidate. The record deliberately names the measured SHA, not its own.
- Gate: **CLOSED**. Nothing published. No publish command has been run in any round.

## Round-6 lens verdicts (2026-09-09)

| Lens | Verdict | Why |
| --- | --- | --- |
| breaking-change | NO_GO (20) | break inventory documented and behaviour-verified (166 CLI commands and 361 MCP tools set-identical to 0.15.52; default-posture census matches the docs exactly); NO_GO is provenance — the tree that would publish is 4 commits past the PR head with no CI, and the shipped README contradicts the shipped tarball |
| test-green | NO_GO (38) | local suite GREEN at worktree HEAD (4387 pass / 168 skip / 0 fail; 4555 tests / 378 files; exit 0); the required `build + test (affected)` check is FAILURE at the PR head and never ran `@hasna/todos:test` |
| credential-path | NO_GO (34) | credential chain demonstrated end to end on the shipped artifact (Keychain tier, zero-config hosted read, fail-closed, no leak); NO_GO rests on the same red-CI/unpushed precondition |
| release | NO_GO (6) | artifact surface clean (version/license/deps/secrets) **but the package fails its own `verify:release` gate at HEAD with 6 `package-files-extra` paths**, CI is red at the named candidate, and the released suite never ran there |

**Blocking items for the owner (round 6):** (1) fix or exclude the deterministic
`apps/knowledge` date-triggered fixture so the affected sweep can reach `@hasna/todos:test`;
(2) extend the release gate's allowlist for the six newly packed paths (or revert the
`files[]` addition) and cover the real manifest in a test; (3) correct `apps/todos/README.md`
to name what the tarball actually ships; (4) push `0a615957b..HEAD` to
`release/todos-0.16.0` (updates PR #2055 — never a second PR) and obtain a green
`build + test (affected)` at the new SHA that actually executes `@hasna/todos:test`.

# Superseded round-5 record (2026-09-09) — worktree HEAD `4ee5a7be9` (UNPUSHED, 2 ahead of the PR head); CI RED at the PR head `8648bb0d88`

- Package: `@hasna/todos@0.16.0` (`apps/todos/package.json` version 0.16.0).
- Release vehicle: PR #2055, `release/todos-0.16.0`, state OPEN, `mergeStateStatus` UNSTABLE.
  `gh pr view 2055 --json headRefOid,state,mergeStateStatus` →
  `8648bb0d88ba26dc39c55c3fdb26a0d2e9f82693` / OPEN / `UNSTABLE`.
- **Worktree HEAD is NOT the PR head.** `git rev-parse HEAD` →
  `4ee5a7be958e83c461810a617d8eb02a88f6e0ef`;
  `git rev-parse origin/release/todos-0.16.0` and
  `git ls-remote origin refs/heads/release/todos-0.16.0` → `8648bb0d88…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `2	0`.
  The two commits are unpushed and on no remote ref:
  `4ee5a7be9 fix(todos): return typed, actionable MCP refusals instead of UNKNOWN_ERROR`
  and `2b27306db fix(infra): record the round-4 candidate status (pushed HEAD, CI red)`.
  The round-1 breaking-change MAJOR (89 of 125 zero-argument MCP tools answering opaque
  `UNKNOWN_ERROR`) is fixed **only in the unpushed commit**; the PR head still ships the
  opaque posture. The round-4 block below is superseded: it asserts
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `0 0`, which is
  now `2	0`.
- **CI at the PR head `8648bb0d88` is RED.** `gh run list --commit 8648bb0d88…` →
  `ci` run `34348350710` `conclusion=failure`, `recordings-linux` run `34348350676`
  `success`. `gh pr checks 2055` → `build + test (affected)  fail  22m34s`; the other five
  checks pass. **`@hasna/todos:test` did not run there**: in the 12,209-line failed-job log
  (`gh run view 34348350710 --log-failed`), `grep -c 'todos:test'` → `0`,
  `grep -c 'todos#test'` → `0`, `grep -c 'todos:build'` → `1`; turbo aborted on
  `Failed: @hasna/knowledge#test` (`Tasks: 59 successful, 68 total`). The only green `ci`
  run on this branch (`34293796916`) is at the ancestor `3e63609f9`. **The task premise
  "CI IS GREEN at the current HEAD 8648bb0d88" is FALSE** and is recorded here as false.
- **The CI failure is deterministic and outside this branch.** Reproduced here:
  `cd apps/knowledge && bun test tests/project-panel.test.ts` → `4 pass / 2 fail`,
  `Expected: "ready" / Received: "stale"` at `apps/knowledge/tests/project-panel.test.ts:381`.
  `apps/knowledge/**` is untouched by this branch, so a re-run does not clear it.
- Registry negative control: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → npm 404. 0.16.0 is still publishable.
- Gate: **CLOSED**. Nothing published. No publish command has been run in any round.

## Round-5 lens verdicts (2026-09-09)

| Lens | Verdict | Why |
| --- | --- | --- |
| breaking-change | NO_GO (30) | pass-1 documentation findings FIXED and re-measured at worktree HEAD (0 opaque of 125 zero-arg tools); NO_GO is provenance — the fix is unpushed and the PR head is CI-red |
| test-green | NO_GO (38) | local suite GREEN at worktree HEAD (4383 pass / 168 skip / 0 fail; 4551 tests / 377 files; exit 0); the required `build + test (affected)` check is FAILURE at the PR head and never ran `@hasna/todos:test` |
| credential-path | NO_GO (32) | credential chain demonstrated end to end at worktree HEAD and from the installed tarball; NO_GO rests on the same red-CI/unpushed precondition |
| release | NO_GO (12) | artifact checks all pass (pack/version/license/deps/secrets/no-GO); CI red at the release HEAD, the released suite never ran there, and the PR head is 2 commits behind the worktree |

**Blocking (process, not a code defect, outside this lane):** push `4ee5a7be9` +
`2b27306db` to `release/todos-0.16.0` (updates PR #2055 — never a second PR), repair or
exclude the `apps/knowledge` date-triggered fixture, then obtain a green
`build + test (affected)` at the new SHA that actually executes `@hasna/todos:test`.

# Superseded round-4 record (2026-09-09) — PUSHED HEAD `8648bb0d88`; CI RED

- Package: `@hasna/todos@0.16.0` (`apps/todos/package.json` version 0.16.0).
- Release vehicle: PR #2055, `release/todos-0.16.0`, state OPEN.
  `gh pr view 2055 --json headRefOid,state,updatedAt,mergeStateStatus` →
  `8648bb0d88ba26dc39c55c3fdb26a0d2e9f82693` / OPEN / `2026-09-09T11:58:07Z` / `UNSTABLE`.
- Worktree HEAD = `8648bb0d88ba26dc39c55c3fdb26a0d2e9f82693` = PR head =
  `origin/release/todos-0.16.0`; the round-3 vehicle mismatch is **RESOLVED** —
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `0 0`.
  The remediation is pushed: the 18 consumed changesets and the
  `### Migrating from 0.15.52` block are on the release ref, and `0` `@hasna/todos`
  changesets remain pending (`grep -l '"@hasna/todos"' .changeset/*.md` → 0).
  **[SUPERSEDED IN ROUND 5 — this is no longer true of the worktree.]** Re-measured
  2026-09-09 round 5: `git rev-parse HEAD` → `4ee5a7be9…`,
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `2	0`. The
  divergence is back (two unpushed commits, one of which is the round-1 MCP fix), so
  "worktree HEAD = PR head" holds only for the round-4 snapshot, not for the tree that
  would be packed now. The pushed-ref facts in this block (the push of `3e3c645cd`'s
  consumption, `0` pending todos changesets) remain true of `8648bb0d88`.
- **CI at this exact SHA is RED, not green.** `gh run list --commit 8648bb0d88…` →
  `ci` run `34348350710` `conclusion=failure` (22m38s) and `recordings-linux` run
  `34348350676` `success`. `gh pr checks 2055` → `build + test (affected)  fail  22m34s`
  (`…/runs/34348350710/job/102455217175`); the other four jobs pass.
  - Failing job `102455217175`: `Failed: @hasna/knowledge#test` —
    `knowledge project panel provider > falls back to the legacy inventory path when
    the project is not registered` (expected `ready`, received `stale`): a date-triggered
    fixture in `apps/knowledge/tests/project-panel.test.ts`, an app this branch never
    touches (`git diff --stat <merge-base>..HEAD -- apps/knowledge` → empty). It is
    deterministic, so a re-run does not clear it.
  - **`@hasna/todos:test` did NOT run in that job.** The full 14,374-line job log
    (`gh run view --job=102455217175 --log`) contains `0` occurrences of `todos:test`
    and only `@hasna/todos:build` (×2); turbo aborted on the knowledge failure
    (`--continue` defaults to `never`). Turbo summary: `Tasks: 59 successful, 68 total` /
    `Cached: 43 cached, 68 total`. The release package's own suite therefore has **no CI
    evidence at the released SHA**.
  - **The round's task premise ("CI IS GREEN at the current HEAD 8648bb0d88") is FALSE**
    and is recorded here as false. The only green `ci` run on this branch
    (`34293796916`) is at the ancestor `3e63609f9`.
- Registry negative control: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → npm 404. 0.16.0 is still publishable.
- Gate: **CLOSED**. Nothing published. No publish command has been run in any round.

## Round-4 lens verdicts (2026-09-09)

| Lens | Verdict | Why |
| --- | --- | --- |
| breaking-change | NO_GO (55) | pass-1 blocking documentation findings FIXED and behaviour-verified at HEAD; held down by the red CI at the released SHA and the documented-but-major opaque MCP default posture (89 of 125 zero-arg tools) |
| test-green | NO_GO (77) | local suite GREEN at HEAD (4379 pass / 168 skip / 0 fail; 4547 tests / 377 files; exit 0); the required `build + test (affected)` check is FAILURE at the same SHA and never ran `@hasna/todos:test` |
| credential-path | NO_GO (40) | credential chain demonstrated end to end at HEAD and from the installed tarball; NO_GO rests on the same red-CI precondition |
| release | NO_GO (18) | artifact checks all pass (pack/version/license/deps/secrets/no-GO); CI red at the release HEAD and the released suite never ran there |

**Blocking item (process, not a code defect, outside this lane):** a green
`build + test (affected)` at `8648bb0d88` that actually executes `@hasna/todos:test`.
The failing task is `@hasna/knowledge#test` in `apps/knowledge/**`, which this branch does
not modify; the remedy is to repair that unrelated date-triggered fixture (or exclude
`knowledge` from the affected sweep) and re-run CI at this SHA. The local 4379/0/168 run
already covers the product changes.

**Superseded round-3 record (kept for provenance):** the round-3 candidate block below
described HEAD `85e3a8287` as 14 commits ahead of the vehicle and unpushed. That mismatch is
now resolved by the push (see the `0 0` above); the round-3 lens verdicts are superseded by
the round-4 table.

## Round-3 lens verdicts (2026-09-09) — superseded by round 4

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

# Release mechanics (lane fix-infra, rounds 1-6)

## 1. Bump class of the 18 `@hasna/todos` changesets

**Round-6 independent re-measurement (fix-infra, 2026-09-09), sixth time, at worktree HEAD
`0a615957b`:** unchanged. `git show 3e3c645cd^:<file>` frontmatter for each of the 18
deleted `.changeset/*.md` → **18/18 `"@hasna/todos": patch`** (measured this round:
`for f in $(git show --name-only --format= 3e3c645cd -- .changeset | grep '\.md$'); do git
show 3e3c645cd^:"$f" | … | grep '@hasna/todos'; done | sort | uniq -c` → `18 "@hasna/todos":
patch`). `grep -l '"@hasna/todos"' .changeset/*.md` → **0** pending todos changesets at the
worktree HEAD. Disposition unchanged: **0.16.0 (a minor) covers the breaking class; no
further bump is owed**, and the authoring rule is written into `.changeset/README.md`
(updated this round to state the round-6 divergence). `bunx changeset status` → exit 0;
`@hasna/todos` appears only in the dependent-bump list (it depends on `@hasna/contracts`,
which is major-bumped), not as a package with its own pending changeset.

**Round-5 independent re-measurement (fix-infra, 2026-09-09), fifth time, from the git
objects themselves:** `git show --name-only --format= 3e3c645cd` → the 18
`.changeset/todos-*.md` / `1720-todos-public-gate-delete-alignment.md` deletions;
`git show 3e3c645cd^:<file>` frontmatter for each → **18/18 `"@hasna/todos": patch`**
(none `minor`, none `major`). Consumption is committed at the pushed PR head `8648bb0d88`
(`git merge-base --is-ancestor 3e3c645cd origin/release/todos-0.16.0` → exit 0); `0`
`@hasna/todos` changesets remain pending (`grep -l '"@hasna/todos"' .changeset/*.md` → 0).
Every distinctive word (length ≥ 6) of each of the 18 bodies resolves inside the
`awk '/^## 0.16.0/,/^## 0.15.52/'` section — 18/18 files at **100 % word coverage**
(33/33, 16/16, 16/16, 13/13, 23/23, 12/12, 11/11, 16/16, 13/13, 13/13, 14/14, 17/17,
20/20, 18/18, 24/24, 13/13, 18/18, 14/14). The section carries `### Migrating from
0.15.52` and **5** `**Breaking` markers. Disposition unchanged: **0.16.0 (a minor) covers
the breaking class; no further bump is owed**, and the authoring rule (`minor`, never
`patch`, for a consumer-breaking change to a 0.x member) is written into
`.changeset/README.md`.

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

**Round-4 confirmation (fix-infra, 2026-09-09) — the disposition is now UNCONDITIONAL.**
The round-3 caveat ("conditional on the push") is discharged: the consuming commit
`3e3c645cd` IS now an ancestor of the released ref
(`git merge-base --is-ancestor 3e3c645cd origin/release/todos-0.16.0` → exit 0),
worktree HEAD `8648bb0d88` == `origin/release/todos-0.16.0` == PR #2055 head, and
`grep -l '"@hasna/todos"' .changeset/*.md` → **0** pending todos changesets. All 18
consumed changesets map 18/18 to entries in the 0.16.0 changelog section
(introducing commits `5a20d230a`, `17b09fae3`, `b29183485`, `aa503b7a4`, `3e63609f9`,
`3655d23f5`, `bc5a45ce1` ×4, `206296587`, `fca2fae5d`, `fa16b463a`, `4941cff8a`,
`e2217600b`, `07b43db1b`, `5b2a8d857` — each hash present in
`awk '/^## 0.16.0/,/^## 0.15.52/' apps/todos/CHANGELOG.md`), and the section carries a
`### Migrating from 0.15.52` block plus 5 `**Breaking for local-SQLite users**` markers.
So **0.16.0 (a minor) covers the breaking class; no further bump is owed**, and a
`changeset version` run at the released ref no longer cuts a 0.15.53 patch for it. The rule
for the next bump stands and is written into `.changeset/README.md`: a consumer-breaking
change to a 0.x member is declared `minor` at authoring time, never `patch`.

## 2. Changesets naming packages absent from the workspace — NOT REPRODUCED

**Round-6 independent re-measurement (fix-infra, 2026-09-09), sixth time, at worktree HEAD
`0a615957b`:** still **NOT REPRODUCED**. Frontmatter census over all **118**
`.changeset/*.md` against the **45** workspace member names (`apps/*` + `apps/notes/server`)
→ **0** names that are not members. Prose census → **22** files carrying **25** mentions of
four absent packages: `@hasna/paths` (20 files), `@hasna/configs`
(`configs-paths-resolver.md`), `@hasna/machines` (`1603-dispatch-drop-machines.md`, ×3),
`@hasna/mementos-sdk` (`1720-mementos-validate-fix.md`). `changeset version` in a fresh
replica (root `package.json` + `.changeset` + all 45 tracked member manifests, the repo's
own `@changesets/cli` 2.27.9) → **exit 0**, `🦋  All files have been updated. Review them and
commit at your leisure`; dead-frontmatter negative control (one added changeset naming
`@hasna/does-not-exist`) → **exit 1**, `🦋  error Error: Found changeset zz-probe-dead-pkg
for package @hasna/does-not-exist which is not in the workspace` — the probe fires, so the
exit-0 result is not vacuous. The finding's figure of **6** files matches no measured set at
this HEAD either; the 22 prose files are listed with a recommendation and **none deleted**.
Nothing in `.changeset/**` was deleted or rewritten this round.

**Round-5 independent re-measurement (fix-infra, 2026-09-09), fifth time, at the worktree
HEAD `4ee5a7be9`:** still **NOT REPRODUCED**. Frontmatter census over all 118
`.changeset/*.md` (plus `README.md`) against the 45 workspace member names (`apps/*` +
`apps/notes/server`) → **0** names that are not members, at the worktree HEAD **and** at the
PR head `8648bb0d88` (`git archive 8648bb0d88 .changeset` → 119 files, 0 unknown). Prose
census → **23** references across **22** files to four packages absent from the workspace
(`@hasna/paths` 20 files, `@hasna/configs`, `@hasna/machines`, `@hasna/mementos-sdk`).
`changeset version` in a fresh replica (root `package.json` + `.changeset` + every tracked
`apps/*/package.json` + `apps/notes/server`, the repo's own `@changesets/cli` 2.27.9) →
**exit 0**, `🦋  All files have been updated. Review them and commit at your leisure`;
dead-frontmatter negative control (one added changeset naming `@hasna/does-not-exist`) →
**exit 1**, `🦋  error Error: Found changeset zz-probe-dead-pkg for package
@hasna/does-not-exist which is not in the workspace`. The probe fires, so the exit-0 result
is not vacuous. The finding's figure of **6** files still matches no measured set; the
22 prose files are listed below with a recommendation and **none was deleted**.

**Round-4 re-measurement (fix-infra, 2026-09-09), fourth time, at the released HEAD
`8648bb0d88`:** the finding is still **NOT REPRODUCED**. Census over the 118
`.changeset/*.md` files (plus `README.md`) at HEAD: **0** frontmatter entries name a package
that is not a workspace member (43 `apps/*` members + `apps/notes/server` = `notes-server`);
**22** changeset bodies name a package absent from the workspace (`@hasna/paths` 20 files,
`@hasna/configs`, `@hasna/machines`, `@hasna/mementos-sdk`); `changeset version` in a fresh
replica → **exit 0** (`🦋  All files have been updated. Review them and commit at your
leisure`); dead-frontmatter negative control → **exit 1** (`… which is not in the
workspace`); prose-only control → **exit 0**. `npx changeset status` → **exit 0**.

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

**Round-6 independent re-verification (fix-infra, 2026-09-09), no edit needed:** the
regeneration grep (`grep -rhoE 'HASNA_TODOS_[A-Z0-9_]+' --include='*.ts' --include='*.tsx'
--include='*.js' --include='*.mjs' --include='*.json' apps/todos --exclude-dir=node_modules
--exclude-dir=dist | sort -u`) finds **51** names; `turbo.json` `tasks.test.env` lists
**51**; found-not-listed **0**, listed-not-found **0**. No dynamic construction
(`HASNA_TODOS_${…}`), computed key, or `startsWith("HASNA_TODOS_")` read exists in
`apps/todos` (the only prefix-shaped string is `hasna.contract.json`'s
`"envPrefix": "HASNA_TODOS_"`; the sole `startsWith` is `TODOS_` in
`src/lib/environment-snapshots.ts:224`). dist-side `.js` census adds **0** names not in the
source list. `bunx turbo run test --filter=@hasna/todos --dry=json` → **exit 0**,
`envMode: strict`, `@hasna/todos#test` specified env = **51** (includes
`HASNA_TODOS_API_KEY`, `HASNA_TODOS_LOCAL`). Two-sided live probe re-run this round against
a **verbatim copy of this `turbo.json`** plus a probe member (turbo 2.5.4, `--force`): with
the three `HASNA_TODOS_*` names set to non-secret probe strings (`probe-string`, `1`,
`probe-corpus` respectively) the task printed `PROBE=[probe-string] LOCAL=[1]
CORPUS=[probe-corpus]`; with the vars unset
it printed `PROBE=[undefined] LOCAL=[undefined] CORPUS=[undefined]`; with the same vars set
against a copy whose `tasks.test.env` is `[]` it printed `PROBE=[undefined] LOCAL=[undefined]
CORPUS=[undefined]`. The list is load-bearing, not cosmetic. `TODOS_TEST_PG_URL` set in the
parent still prints `[undefined]` (alias family filtered — residual below).

**Round-5 independent re-verification (fix-infra, 2026-09-09), no edit needed:** the
regeneration grep over **all** file types
(`grep -rhoE 'HASNA_TODOS_[A-Z0-9_]+' apps/todos --exclude-dir=node_modules --exclude-dir=dist | sort -u`,
not just the `*.ts/*.js/*.json` subset) finds **51** names; `turbo.json` `tasks.test.env`
lists **51**; found-not-listed **0**, listed-not-found **0**; the `*.test.ts` subset is
**46/46**. No dynamic construction (`HASNA_TODOS_${…}`, a prefix constant, or a computed
key) exists anywhere in `apps/todos` — the only non-name match is the `//` note's own
`HASNA_TODOS_*` wildcard text, and the sole prefix-shaped string is
`hasna.contract.json`'s `"envPrefix": "HASNA_TODOS_"`. `bunx turbo run test
--filter=@hasna/todos --dry=json` → exit 0, `envMode: strict`, `@hasna/todos#test`
specified env = **51**. Two-sided live probe re-run this round against a **verbatim copy of
this `turbo.json`** plus a probe member (turbo 2.5.4, `--force`): with the three
`HASNA_TODOS_*` names set to non-secret probe strings in the parent environment, the task
printed all three values back (`[probe string]`, `[1]`, `[probe corpus]`); with the same
vars unset the task printed `[] [] []`. The list is load-bearing, not cosmetic.

**Round-4 re-verification (fix-infra, 2026-09-09), no edit needed:** the regeneration grep
finds **51** `HASNA_TODOS_*` names; `turbo.json` `tasks.test.env` lists **51**;
found-not-listed **0**, listed-not-found **0**; the `*.test.ts` subset is **46/46**;
`bunx turbo run test --filter=@hasna/todos --dry=json` → exit 0, `envMode: strict`,
`@hasna/todos#test` specified env = 51 (incl. `HASNA_TODOS_API_KEY`, `HASNA_TODOS_LOCAL`).
The fix landed in the branch at `f700da072` and is in the released tree.

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

**Residual (outside this finding's scope, recommend a follow-up — re-measured round 5):** the
same strict-mode filtering applies to the `TODOS_*` alias family the package also reads
(`hasna.contract.json`: `"aliasEnvPrefix": "TODOS_"`). Measured this round as the names
actually read from the environment — `grep -rhoE '(process\.env(\.|\[")|env\()"?TODOS_[A-Z0-9_]+'`
over `apps/todos` → **42** alias names. Live probe proof (verbatim copy of this `turbo.json`):
with `TODOS_API_URL` and `TODOS_TEST_PG_URL` set in the parent environment,
`turbo run test` printed `ALIAS_TODOS_API_URL=[] ALIAS_TODOS_TEST_PG_URL=[]` — strict mode
filters them, exactly as it filters an undeclared `HASNA_TODOS_*`. Consequence: the
Postgres-gated suites keyed on `TODOS_TEST_PG_URL` (13 `*.pg.test.ts` files use
`process.env.TODOS_TEST_PG_URL ? test : test.skip`) and the `TODOS_RACE_DB` /
`TODOS_RACE_INPUT` lanes can never be enabled through `turbo run test` — they are reachable
only by invoking `bun test` directly, which is how the files' own comments document them.
For the routing aliases the filtering is the SAFE direction (`test/setup.ts` deliberately
blanks `TODOS_API_URL` / `TODOS_API_KEY` / `TODOS_DATABASE_URL` at preload). Not changed
here: the finding scopes the fix to `HASNA_TODOS_*`, and adding 42 ambient alias names to
the allowlist would widen the test task's inherited environment — a hermeticity decision
for the owner, not a fix-infra edit. Recommendation: if parity is wanted, add the four
test-gate names (`TODOS_TEST_PG_URL`, `TODOS_RACE_DB`, `TODOS_RACE_INPUT`,
`TODOS_EXPECTED_VERSION`) rather than the whole alias family, or use `passThroughEnv`.

## 4. This artifact's prior verdict — and the current status it must not be confused with

**Current status (round 6, 2026-09-09), stated truthfully:** this file's live verdict is
**NO_GO for `@hasna/todos@0.16.0`**, and it is now NO_GO for a product reason as well as the
process reasons. At the pushed PR head `8648bb0d88` the required `ci` check is a FAILURE and
`@hasna/todos:test` never ran there; the worktree that would be packed (`0a615957b`) is
**4 commits ahead of the PR head and unpushed**, so no CI run covers it; and the package
**fails its own release gate at that HEAD** — `bun run verify:release` in a clean detached
worktree at `0a615957b` → **exit 1** with **18** `package-files-extra` lines over **6** paths
(`CHANGELOG.md` + the five `docs/*.md`), because the allowlist at
`apps/todos/src/lib/public-release-gate.ts:388` was not extended when `package.json`
`files[]` grew. The gate is **CLOSED** and nothing is published (`npm view @hasna/todos
version` → `0.15.52`; `@hasna/todos@0.16.0` → 404). The round-5 status below is superseded:
it names HEAD `4ee5a7be9` (`2	0`) and records neither the 4-commit divergence nor the
release-gate failure. The 0.15.44 NO_GO further down remains **historical and superseded** —
it is NOT a blocker for 0.16.0, and it must not be read as the current verdict.

**Superseded round-5 status (2026-09-09), kept for provenance:** this file's live verdict is
**NO_GO for `@hasna/todos@0.16.0`** — at the pushed PR head `8648bb0d88` the required `ci`
check is a FAILURE and `@hasna/todos:test` never ran there, while the worktree that would be
packed (`4ee5a7be9`) is **2 commits ahead of the PR head and unpushed**, so no CI run covers
it. The gate is **CLOSED** and nothing is published (`npm view @hasna/todos version` →
`0.15.52`; `@hasna/todos@0.16.0` → 404). The round-4 claim that the worktree equals the PR
head (`0 0`) no longer holds: re-measured `2	0`. The 0.15.44 NO_GO below is **historical and
superseded** — it is NOT a blocker for 0.16.0, and it must not be read as the current
verdict. (Superseded round-4 text, kept for provenance: the round-4 verdict was NO_GO for
`0.16.0` at the pushed candidate `8648bb0d88` with the worktree equal to the PR head.)

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

## Gates re-run in round 6 (exact output)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD
`0a615957b6a991249f6b8db1199daf41e898fda2` (`bun` 1.3.14, `turbo` 2.5.4). Every line below
is this round's own output.

- `bun run test:versioning` → **exit 0**, `22 pass / 1 skip / 0 fail`, 655 expect() calls,
  `Ran 23 tests across 5 files. [1047.00ms]` (includes the member-scoped pending-changeset
  assertion — §2).
- `bun run test:standard` → **exit 0**, `152 pass / 0 fail`, `Ran 152 tests across 22 files.
  [108.72s]` (includes `turbo-graph`, which parses `turbo.json`).
- `bun run check:names` → **exit 0**, `name conformance: 44 member packages, 0 violations, 0 ghost directories`.
- `bun run check:dep-direction` → **exit 0**, `dependency direction: 44 member packages, 0 private-scope dependencies`.
- `bun run check:secrets` → **exit 0**, `secrets scan (staged added lines): 0 findings, 0 added lines checked`.
- `bun run check:manifests` → **exit 0**, `[check-manifests] 33/44 publishable members conform (11 recorded exceptions); 0 refusal(s)`.
- `bun run check:frozen-locks` → **exit 1**, branch-local `@hasna/skills` manifest behind the
  published version (unchanged from rounds 3-5; `apps/skills/**` outside this lane; fixed by
  a rebase onto main).
- `bun run check:deploy-lanes` → **exit 0**, `deploy-lanes: PASS — 5 root deploy workflow(s)
  checked, no undiscoverable deploy lanes`; `todos-deploy self-test: PASS (20 mutations
  rejected, 12 analyser controls, real workflow accepted)`; `todos-deploy: PASS — ci-gated
  trigger, gated source pin, target-pinned, scan-gated, digest-pinned, rollback-ready`.
- `bun run check:publish-guard` → **exit 1 on this host**; the `todos` line is
  `publish guard: todos — 783 tarball entries, 781 contents scanned, 0 internal-infra
  strings, 2 binary/oversize/absent skipped`. The non-zero exit is NOT a `todos` finding.
  The first failing member measured is **`apps/contacts`**:
  `PUBLISH-GUARD FAILED in …/apps/contacts: package.json declares .d.ts type paths (types
  field or exports.*.types) and the tarball packs built JS but 0 .d.ts`. Local state:
  `find apps/contacts/dist -name '*.d.ts' | wc -l` → `0`, `*.js` → `5`, while
  `package.json` declares `types: dist/index.d.ts`; `git status --porcelain apps/contacts`
  → empty, so the member's own tracked tree is untouched by this branch. NOT reproduced in
  CI: the `publish guard (no internal-infra strings in tarballs)` job PASSES at
  `8648bb0d88` (`gh pr checks 2055`), so this is a local build-state artefact of the shared
  worktree (contacts' declarations not built here), not a `todos` or branch defect.
  Recorded as measured; the failing member is outside this lane.
- `bunx changeset status` (real worktree) → **exit 0**; `@hasna/todos` appears only in the
  dependent-bump list (it depends on major-bumped `@hasna/contracts`), not as a package with
  its own pending changeset.
- `changeset version` (fresh replica: root `package.json` + `.changeset` + all 45 tracked
  member manifests, the repo's own `@changesets/cli` 2.27.9) → **exit 0**,
  `🦋  All files have been updated. Review them and commit at your leisure`; dead-frontmatter
  negative control → **exit 1**, `🦋  error Error: Found changeset zz-probe-dead-pkg for
  package @hasna/does-not-exist which is not in the workspace` (§2).
- Dead-name census (§2): unknown **frontmatter** names **0** of 118 changesets at the
  worktree HEAD; **22** changeset bodies (**25** mentions) name a package absent from the
  workspace (`@hasna/paths` 20 files, `@hasna/configs`, `@hasna/machines`, `@hasna/mementos-sdk`)
  — prose only, never parsed; nothing deleted.
- `HASNA_TODOS_*` census (§3): the all-file-types regeneration grep finds **51**;
  `turbo.json` `tasks.test.env` lists **51**; found-not-listed **0**, listed-not-found **0**;
  dist-side `.js` census adds **0**; no dynamic construction.
- `bunx turbo run test --filter=@hasna/todos --dry=json` → **exit 0**, `envMode: strict`,
  `@hasna/todos#test` specified env = **51** (incl. `HASNA_TODOS_API_KEY`, `HASNA_TODOS_LOCAL`).
- Two-sided live turbo probe (verbatim copy of this `turbo.json` + a probe member, turbo
  2.5.4, `--force`): vars set → `PROBE=[probe-string] LOCAL=[1] CORPUS=[probe-corpus]
  ALIAS_TODOS_TEST_PG_URL=[undefined]`; vars unset → all `[undefined]`; vars set against a
  copy with `tasks.test.env: []` → all `[undefined]`. Load-bearing.
- 18-changeset bump-class re-measurement (§1): `git show 3e3c645cd^:<file>` frontmatter →
  **18/18 `patch`**; `0` todos changesets pending at HEAD.
- **Release gate at HEAD (§4, NEW BLOCKING):** in a clean detached worktree at `0a615957b`
  (`git worktree add --detach`; `git status --porcelain` → 0 entries),
  `cd apps/todos && bun run verify:release` → **exit 1**, `18` `package-files-extra` lines
  over 6 paths (`CHANGELOG.md`, `docs/PLAN_API.md`, `docs/TASK_LIST_API.md`,
  `docs/TEMPLATE_API.md`, `docs/TASK_QUERY_API.md`, `docs/native-storage.md`).
- Provenance: `git rev-parse HEAD` → `0a615957b…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `4	0`;
  `git ls-remote origin refs/heads/release/todos-0.16.0` → `8648bb0d88…`;
  `gh pr view 2055 --json headRefOid,state,mergeStateStatus` → `8648bb0d88…` / OPEN / `UNSTABLE`.
- CI: `gh run list --commit 0a615957b…` → `[]` (no run at HEAD);
  `gh run list --commit 8648bb0d88…` → `ci` `34348350710` **failure**,
  `recordings-linux` `34348350676` success; `gh run view 34348350710 --log-failed`
  (12,209 lines) → `grep -c 'todos:test'` **0**, `grep -c 'todos#test'` **0**,
  `grep -c 'todos:build'` **1**, `Failed: @hasna/knowledge#test`,
  `Tasks: 59 successful, 68 total`; `gh pr checks 2055` →
  `build + test (affected)  fail  22m34s`, five other checks pass.
- Registry controls: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → npm 404.
- NOT re-run here (not affected by this lane's files, owned by other lenses): the
  `apps/todos` `bun test` suite (test-green measured 4387 pass / 168 skip / 0 fail at
  worktree HEAD), tarball/pack/provenance gates (release), hosted live-path behaviour
  (credential-path).

**Concurrent-lane note (round 6):** the shared worktree carried **8 modified
`apps/todos/**` files** during this round (mtimes 16:31: `CHANGELOG.md`, `README.md`,
`src/cli/cli-qol.test.ts`, `src/cli/commands/config-serve-commands.ts`, `src/lib/config.test.ts`,
`src/lib/config.ts`, `src/lib/public-release-gate.test.ts`, `src/lib/public-release-gate.ts`)
— an in-flight, uncommitted sibling lane addressing the release-gate allowlist and the
README contradiction. Those edits are **not in HEAD** and are excluded from every measurement
above (the release gate was measured in a detached worktree at the pinned SHA). This lane
committed only its own files.

## Gates re-run in round 5 (exact output)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD
`4ee5a7be958e83c461810a617d8eb02a88f6e0ef` (`bun` 1.3.14, `turbo` 2.5.4). Every line below
is this round's own output:

- `bun run test:versioning` → **exit 0**, `22 pass / 1 skip / 0 fail`, 655 expect() calls,
  `Ran 23 tests across 5 files. [1073.00ms]` (includes the member-scoped pending-changeset
  assertion — §2).
- `bun run test:standard` → **exit 0**, `152 pass / 0 fail`, 634 expect() calls,
  `Ran 152 tests across 22 files. [52.97s]` (includes `turbo-graph`, which parses
  `turbo.json`).
- `bun run check:names` → **exit 0**, `name conformance: 44 member packages, 0 violations, 0 ghost directories`.
- `bun run check:dep-direction` → **exit 0**, `dependency direction: 44 member packages, 0 private-scope dependencies`.
- `bun run check:secrets` → **exit 0**, `secrets scan (staged added lines): 0 findings, 0 added lines checked`.
- `bun run check:manifests` → **exit 0**, `[check-manifests] 33/44 publishable members conform (11 recorded exceptions); 0 refusal(s)`.
- `bun run check:frozen-locks` → **exit 1**, `FROZEN-LOCK VIOLATIONS (1): - @hasna/skills
  (apps/skills): manifest 0.5.4 — behind published @hasna/skills@0.5.6; land the bump on
  main before deploying`. Branch-local (main carries the published version) and not a CI
  blocker — see "Estate gate drift". **Round-5 drift update:** the published version moved
  from `0.5.5` (round 4) to `0.5.6`, so the branch-local red now names `0.5.6`.
- `bunx changeset status` (real worktree) → **exit 0** (`🦋  info Packages to be bumped at
  patch: …`).
- `changeset version` (fresh replica: root `package.json` + `.changeset` + every tracked
  member manifest, the repo's own `@changesets/cli` 2.27.9) → **exit 0**,
  `🦋  All files have been updated. Review them and commit at your leisure`; dead-frontmatter
  negative control → **exit 1**, `🦋  error Error: Found changeset zz-probe-dead-pkg for
  package @hasna/does-not-exist which is not in the workspace` (§2).
- Dead-name census (§2): unknown **frontmatter** names **0** of 118 changesets at the
  worktree HEAD and **0** of 119 at the PR head `8648bb0d88`; **22** changeset bodies (23
  references) name a package absent from the workspace (`@hasna/paths` 20 files,
  `@hasna/configs`, `@hasna/machines`, `@hasna/mementos-sdk`) — prose only, never parsed.
- `HASNA_TODOS_*` census (§3): the all-file-types regeneration grep finds **51**;
  `turbo.json` `tasks.test.env` lists **51**; found-not-listed **0**, listed-not-found **0**;
  `*.test.ts` subset **46/46**.
- `bunx turbo run test --filter=@hasna/todos --dry=json` → **exit 0**, `envMode: strict`,
  `@hasna/todos#test` `environmentVariables.specified.env` = **51** entries including
  `HASNA_TODOS_API_KEY` and `HASNA_TODOS_LOCAL`.
- Two-sided live turbo probe (verbatim copy of this `turbo.json` + a probe member, turbo
  2.5.4): with the three `HASNA_TODOS_*` names set to non-secret probe strings the task
  printed all three back (`[probe string]`, `[1]`, `[probe corpus]`); with the vars unset it
  printed `[] [] []`; alias names `TODOS_API_URL` / `TODOS_TEST_PG_URL` set in the parent →
  `[]` (filtered — §3 residual).
- 18-changeset bump-class re-measurement (§1): `git show 3e3c645cd^:<file>` frontmatter →
  **18/18 `patch`**; 18/18 map into the 0.16.0 section at 100 % word coverage; `0` todos
  changesets pending; `git merge-base --is-ancestor 3e3c645cd origin/release/todos-0.16.0`
  → exit 0.
- Provenance: `git rev-parse HEAD` → `4ee5a7be9…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `2	0`;
  `git ls-remote origin refs/heads/release/todos-0.16.0` → `8648bb0d88…`;
  `gh pr view 2055 --json headRefOid,state,mergeStateStatus` → `8648bb0d88…` / OPEN /
  UNSTABLE.
- CI: `gh run list --commit 8648bb0d88…` → `ci` `34348350710` **failure**,
  `recordings-linux` `34348350676` success; `gh run view 34348350710 --log-failed`
  (12,209 lines) → `grep -c 'todos:test'` **0**, `grep -c 'todos#test'` **0**,
  `grep -c 'todos:build'` **1**, `Failed: @hasna/knowledge#test`,
  `Tasks: 59 successful, 68 total`, `Cached: 43 cached, 68 total`; `gh pr checks 2055` →
  `build + test (affected)  fail  22m34s`, five other checks pass.
- Knowledge date bomb reproduced locally (outside this lane):
  `cd apps/knowledge && bun test tests/project-panel.test.ts` → `4 pass / 2 fail`,
  `Expected: "ready" / Received: "stale"` at `tests/project-panel.test.ts:381`.
- Registry controls: `npm view @hasna/todos version` → `0.15.52`; `dist-tags` →
  `{"latest":"0.15.52"}`; `npm view @hasna/todos@0.16.0 version` → npm 404.
- NOT re-run here (not affected by this lane's files, owned by other lenses): the
  `apps/todos` `bun test` suite (test-green measured 4383 pass / 168 skip / 0 fail at
  worktree HEAD), tarball/pack/provenance gates (release), hosted live-path behaviour
  (credential-path), `check:publish-guard`.

## 5c. fix-infra round-6 disposition of the four assigned findings (current)

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | 18 consumed changesets declared `patch` while carrying breaking changes | **RECORDED; 0.16.0 covers the class.** Sixth re-measurement at `0a615957b`: 18/18 `"@hasna/todos": patch` from the git objects at `3e3c645cd^`; `0` todos changesets pending; `changeset status` exit 0; the authoring rule (`minor`, never `patch`, for a consumer-breaking change to a 0.x member) is in `.changeset/README.md` and updated this round with the round-6 divergence. §1. |
| 2 | 6 changeset files name packages absent from the workspace, breaking `changeset version` repo-wide | **NOT REPRODUCED (sixth measurement).** `0` unknown frontmatter names of 118 changesets at HEAD; `changeset version` exit 0; dead-frontmatter negative control exit 1; the 22 prose files (25 mentions) are listed with a recommendation and **none deleted**. §2. |
| 3 | `turbo.json` `tasks.test.env` must carry every `HASNA_TODOS_*` the tests read | **FIXED (landed at `f700da072`); re-verified, no edit needed** (§3): 51/51 across all file types, dist adds 0, no dynamic construction, `envMode: strict`, dry-run lists 51, two-sided live probe load-bearing in both directions. |
| 4 | release-review artifact on disk is a NO_GO for 0.15.44 | **UPDATED — now states the round-6 candidate truthfully.** New current block: worktree HEAD `0a615957b` is 4 commits ahead of the PR head `8648bb0d88` and unpushed; no CI run at HEAD; the `ci` run at the PR head is a FAILURE that never ran `@hasna/todos:test`; the package **fails its own `verify:release` gate at HEAD** (18 `package-files-extra` over 6 paths); the shipped README contradicts the shipped tarball; gate CLOSED; nothing published; round-6 lens verdicts and gates. The round-5 block is marked superseded; the 0.15.44 NO_GO stays historical. §4. |

**Unresolved in this lane (needs a file or action outside it) — round 6:**

1. **The release gate fails at HEAD — `apps/todos/src/lib/public-release-gate.ts` is outside
   this lane.** Extend the allowlist at `:388` for the six newly packed paths (or revert the
   `files[]` addition) and cover the real manifest in `public-release-gate.test.ts`. An
   uncommitted sibling-lane fix was in the shared worktree at measurement time; it is not in
   HEAD.
2. **`apps/todos/README.md:80` contradicts the shipped tarball** ("ships this README and
   `dist/` only" while `files[]` packs `CHANGELOG.md` + five docs) — `apps/todos/**`, outside
   this lane.
3. **Push `0a615957b..HEAD` to `release/todos-0.16.0`.** Until then the PR head lacks the
   round-1..round-6 fixes and no CI run covers the tree that would be packed. An
   orchestrator action, not a file change.
4. **A green `build + test (affected)` that executes `@hasna/todos:test`.** The failing task
   is `@hasna/knowledge#test` (`apps/knowledge/tests/project-panel.test.ts`, date-triggered
   fixture, `expected "ready" / received "stale"`, reproduced 4 pass / 2 fail);
   `apps/knowledge/**` is untouched by this branch and outside this lane. Deterministic — a
   re-run does not clear it.
5. **CI aborts before `@hasna/todos:test` (`turbo run test --affected` has no `--continue`).**
   `.github/workflows/ci.yml` is in this lane, but adding `--continue` would NOT reopen the
   gate (the `ci` job would still fail on `@hasna/knowledge#test`); it would only guarantee
   the release package's own suite runs and is visible. Deliberately NOT changed
   unilaterally: it alters the shared gate semantics for all 44 members, an owner decision.
6. **`HASNA_TODOS_EXPECTED_COMMIT` is not exported by any release record** — publish mode
   hard-requires it (`apps/todos/scripts/verify-public-release.ts`). Outside this lane.
7. **Branch-local frozen-locks red** (`apps/skills` behind the published version) — fixed by
   a rebase onto main; `apps/skills/**` outside this lane.
8. **PR #2055 body is stale** — it asserts a green CI run and a 775-file tarball for a
   different commit; the PR body is a GitHub object, not a file in this lane.
9. **`check:publish-guard` exits 1 locally while the CI publish-guard job passes at
   `8648bb0d88`.** The `todos` tarball is clean (0 internal-infra strings in 783 entries);
   the first failing member is `apps/contacts` (declares `types: dist/index.d.ts` but its
   local `dist/` holds 0 `.d.ts`), whose tracked tree is untouched by this branch —
   `apps/contacts/**` is outside this lane. Not a `todos` finding.
10. **The pushed copy of this artifact remains stale until the push.** Everything in the
    round-6 block is on the worktree only; at `8648bb0d88` the committed artifact still
    names the round-5 vehicle.

## 5. fix-infra round-5 disposition of the four assigned findings (superseded by §5c)

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | 18 consumed changesets declared `patch` while carrying breaking changes | **RECORDED; 0.16.0 covers the class.** 18/18 re-verified `patch` from the git objects at `3e3c645cd^`; 18/18 map into the 0.16.0 section at 100 % word coverage; `0` todos changesets pending; the section carries `### Migrating from 0.15.52` + 5 `**Breaking` markers; the authoring rule is in `.changeset/README.md`. §1. |
| 2 | 6 changeset files name packages absent from the workspace, breaking `changeset version` repo-wide | **NOT REPRODUCED (fifth measurement).** `0` unknown frontmatter names at the worktree HEAD and at the PR head; `changeset version` exit 0; dead-frontmatter negative control exit 1; the 22 prose files are listed with a recommendation and **none deleted**. §2. |
| 3 | `turbo.json` `tasks.test.env` must carry every `HASNA_TODOS_*` the tests read | **FIXED (landed at `f700da072`); re-verified, no edit needed** (§3): 51/51 across all file types, 46/46 test subset, no dynamic construction, `envMode: strict`, dry-run lists 51, two-sided live probe passes. |
| 4 | release-review artifact on disk is a NO_GO for 0.15.44 | **UPDATED — now states the round-5 candidate truthfully.** New "Current candidate (round 5)" block: worktree HEAD `4ee5a7be9` is 2 commits ahead of the PR head `8648bb0d88` and unpushed; the `ci` run at the PR head is a FAILURE and never ran `@hasna/todos:test`; the round-1 MCP fix exists only in the unpushed commit; gate CLOSED; nothing published; round-5 lens verdicts. The round-4 block is marked superseded and its `0 0` divergence claim is corrected inline; the 0.15.44 NO_GO is marked historical. §4. |

**Unresolved in this lane (needs a file or action outside it) — round 5:**

1. **Push `4ee5a7be9` + `2b27306db` to `release/todos-0.16.0`.** Until then the PR head
   (`8648bb0d88`) lacks the round-1 MCP fix and no CI run covers the tree that would be
   packed. An orchestrator action, not a file change.
2. **A green `build + test (affected)` that executes `@hasna/todos:test`.** The failing task
   is `@hasna/knowledge#test` (`apps/knowledge/tests/project-panel.test.ts`, date-triggered
   fixture, `expected "ready" / received "stale"`, reproduced 4 pass / 2 fail here);
   `apps/knowledge/**` is untouched by this branch and outside this lane. Deterministic — a
   re-run does not clear it.
3. **CI aborts before `@hasna/todos:test` (`turbo run test --affected` has no `--continue`).**
   `.github/workflows/ci.yml` is in this lane, but adding `--continue` would NOT reopen the
   gate (the `ci` job would still fail on `@hasna/knowledge#test`); it would only guarantee
   the release package's own suite runs and is visible. Deliberately NOT changed
   unilaterally: it alters the shared gate semantics for all 44 members, which is an owner
   decision. Recommendation: either repair the knowledge fixture (preferred) or add
   `--continue` so one red member cannot hide the rest.
4. **`HASNA_TODOS_EXPECTED_COMMIT` is not exported by any release record** — publish mode
   hard-requires it (`apps/todos/scripts/verify-public-release.ts`). The owner of the release
   run must export the released SHA. Outside this lane's files.
5. **`prepublishOnly` runs no test** (`apps/todos/package.json`:
   `bun run scripts/verify-public-release.ts --mode=publish`, no `bun test`) — a publish
   ships the suite unrun. `apps/todos/package.json` is outside this lane.
6. **Branch-local frozen-locks red** — fixed by a rebase onto main (`apps/skills` 0.5.4 vs
   published `0.5.6`); `apps/skills/**` is not in this lane. Re-measured this round: exit 1,
   one violation.
7. **PR #2055 body is stale** — it asserts "It is green on CI for this exact head commit"
   and a 775-file tarball, while `gh pr checks 2055` shows `build + test (affected) fail` at
   `headRefOid` `8648bb0d88`. The PR body is a GitHub object, not a file in this lane; the
   push that updates the branch should refresh it.
8. **The pushed copy of this artifact remains stale until that push.** Everything in this
   round-5 block is on the worktree only; at `8648bb0d88` the committed artifact still names
   the round-3 vehicle and records neither the red run nor the MCP fix.

## Gates re-run in round 4 (exact output; superseded by the round-5 block above)

Re-run 2026-09-09 by fix-infra from the repo root at worktree HEAD
`8648bb0d88ba26dc39c55c3fdb26a0d2e9f82693` (`bun` 1.3.14, `turbo` 2.5.4). Every line below
is this round's own output:

- `bun run test:versioning` → **exit 0**, `22 pass / 1 skip / 0 fail`, 655 expect() calls,
  `Ran 23 tests across 5 files. [1050.00ms]` (includes the member-scoped pending-changeset
  assertion — §2).
- `bun run test:standard` → **exit 0**, `152 pass / 0 fail`, 634 expect() calls,
  `Ran 152 tests across 22 files. [45.97s]` (includes `turbo-graph`, which parses
  `turbo.json`).
- `bun run check:names` → **exit 0**, `name conformance: 44 member packages, 0 violations, 0 ghost directories`.
- `bun run check:dep-direction` → **exit 0**, `dependency direction: 44 member packages, 0 private-scope dependencies`.
- `bun run check:secrets` → **exit 0**, `secrets scan (staged added lines): 0 findings, 0 added lines checked`.
- `bun run check:manifests` → **exit 0**, `[check-manifests] 33/44 publishable members conform (11 recorded exceptions); 0 refusal(s)`.
- `bun run check:deploy-lanes` → **exit 0**, `deploy-lanes: PASS — 5 root deploy workflow(s) checked, no undiscoverable deploy lanes`;
  `todos-deploy self-test: PASS (20 mutations rejected, 12 analyser controls, real workflow accepted)`;
  `todos-deploy: PASS — ci-gated trigger, gated source pin, target-pinned, scan-gated, digest-pinned, rollback-ready`.
- `bun run check:frozen-locks` → **exit 1**, `FROZEN-LOCK VIOLATIONS (1): - @hasna/skills
  (apps/skills): manifest 0.5.4 — behind published @hasna/skills@0.5.5; land the bump on
  main before deploying`. Branch-local (main already carries 0.5.5) and not a CI blocker —
  green in PR CI's merge tree; see "Estate gate drift".
- `npx changeset status` (real worktree) → **exit 0**.
- `changeset version` (fresh replica of root `package.json` + `.changeset` + every member
  manifest, the repo's own `@changesets/cli`) → **exit 0**, `🦋  All files have been
  updated. Review them and commit at your leisure`. Negative control (one extra changeset
  whose frontmatter names `@hasna/does-not-exist`) → **exit 1**, `🦋  error Error: Found
  changeset zz-probe-dead-pkg for package @hasna/does-not-exist which is not in the
  workspace` — the probe can fire, so the exit-0 result is not vacuous (§2).
- Dead-name census (§2): unknown **frontmatter** names **0** of 118 changesets at HEAD;
  **22** changeset bodies name a package absent from the workspace (`@hasna/paths` 20 files,
  `@hasna/configs`, `@hasna/machines`, `@hasna/mementos-sdk`) — prose only, never parsed.
- `HASNA_TODOS_*` census (§3): the regeneration grep finds **51**; `turbo.json`
  `tasks.test.env` lists **51**; found-not-listed **0**, listed-not-found **0**;
  `*.test.ts` subset **46/46** present.
- `bunx turbo run test --filter=@hasna/todos --dry=json` → **exit 0**, `envMode: strict`,
  `@hasna/todos#test` `environmentVariables.specified.env` = **51** entries including
  `HASNA_TODOS_API_KEY` and `HASNA_TODOS_LOCAL`.
- Provenance: `git rev-parse HEAD` → `8648bb0d88…`;
  `git rev-list --left-right --count HEAD...origin/release/todos-0.16.0` → `0 0`;
  `gh pr view 2055 --json headRefOid,state,mergeStateStatus` →
  `8648bb0d88…` / OPEN / UNSTABLE.
- CI: `gh run list --commit 8648bb0d88…` → `ci` `34348350710` failure,
  `recordings-linux` `34348350676` success; `gh run view --job=102455217175 --log` (14,374
  lines) → `0` `todos:test`, `2` `@hasna/todos:build`, `Failed: @hasna/knowledge#test`,
  `Tasks: 59 successful, 68 total`.
- Registry controls: `npm view @hasna/todos version` → `0.15.52`;
  `npm view @hasna/todos@0.16.0 version` → 404.
- NOT re-run here (not affected by this lane's files, owned by other lenses): the
  `apps/todos` `bun test` suite (test-green measured 4379 pass / 168 skip / 0 fail),
  tarball/pack/provenance gates (release), hosted live-path behaviour (credential-path),
  `check:publish-guard`.

## Gates re-run in round 3 (exact output; superseded by the round-4 block above)

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

## 5a. fix-infra round-4 disposition of the four assigned findings (superseded by §5)

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | 18 consumed changesets declared `patch` while carrying breaking changes | **RECORDED; 0.16.0 covers the class, now unconditionally.** 18/18 map to entries in the 0.16.0 changelog section; `0` todos changesets pending at the released HEAD; the section carries `### Migrating from 0.15.52` and 5 `**Breaking for local-SQLite users**` markers. Rule written into `.changeset/README.md`. §1. |
| 2 | 6 changeset files name packages absent from the workspace, breaking `changeset version` repo-wide | **NOT REPRODUCED (fourth measurement).** `0` unknown frontmatter names across 118 changesets at HEAD; `changeset version` exit 0; dead-frontmatter negative control exit 1; prose-only control exit 0. The 22 prose files are listed with a recommendation; nothing deleted. §2. |
| 3 | `turbo.json` `tasks.test.env` must carry every `HASNA_TODOS_*` the tests read | **FIXED (landed in the branch at `f700da072`); re-verified, no edit needed this round** (§3): 51/51, 46/46 test-subset, `envMode: strict`, dry-run lists 51. |
| 4 | release-review artifact on disk is a NO_GO for 0.15.44 | **UPDATED.** New round-4 "Current candidate" block records the pushed HEAD `8648bb0d88`, the RED `ci` run `34348350710` (and that `@hasna/todos:test` never ran there), the CLOSED gate, nothing published, and the round-4 lens verdicts; the 0.15.44 NO_GO is marked historical. §4. |

**Unresolved in this lane (needs a file or action outside it) — round 4 (superseded by the
round-5 list in §5):**

1. **A green CI at `8648bb0d88` that executes `@hasna/todos:test`.** The failing task is
   `@hasna/knowledge#test` in `apps/knowledge/tests/project-panel.test.ts` (a date-triggered
   fixture, `expected "ready" / received "stale"`); `apps/knowledge/**` is untouched by this
   branch and is not in this lane. Deterministic — a re-run does not clear it.
2. **`HASNA_TODOS_EXPECTED_COMMIT` is not exported by any release record** — publish mode
   hard-requires it (`src/lib/public-release-gate.ts:729`). The owner of the release run
   must export the released SHA. Outside this lane's files.
3. **Branch-local frozen-locks red** — fixed by a rebase onto main (`apps/skills` 0.5.4 →
   0.5.5); `apps/skills/**` is not in this lane. Re-measured this round: exit 1, one
   violation.
4. **Round-3 documentation findings in `apps/todos/**` (fix-docs lane)** — see the
   round-3 list below; reproduced by the lenses, NOT fixed here.

## 5b. fix-infra round-3 disposition of the four assigned findings (superseded by §5a)

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
