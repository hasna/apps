[REVIEW] GO|NO_GO — @hasna/todos@0.15.44 @ f780567980d7cdba7eb79356c2f7b735de8adbab — registry npmjs

Adversarially review the release candidate for @hasna/todos@0.15.44. Repo: hasna/apps (monorepo). Head: f780567980d7cdba7eb79356c2f7b735de8adbab (branch release-todos-0.15.44, PR #940, worktree is the checked-out copy). Registry target: npmjs public, scope @hasna. Last published version: 0.15.41 (npm registry). Versions 0.15.42 and 0.15.43 were versioned in-repo by "version wave 13" (#912) but never published.

You are the independent agent reviewer required by the npm release rule: your verdict binds the exact repo, commit sha, package name, version, and registry. Return GO only if the release candidate is safe to publish; return NO_GO only with concrete P0/P1 blocking findings.

Scope of the candidate diff (from ac5d8ade1, the 0.15.41 release merge, to head f78056798), restricted to apps/todos:
- 73f839e02 fix(todos): retry schema sync after transient failure instead of caching the rejection (incident 724661) (#933)
- 30165372b fix(todos): schema-ensure retries after transient DDL failures — no more poisoned-process 500s (724397) (#931)
- 1c859c232 fix: getTasksChangedSince compares the cursor via julianday, not raw TEXT (#887)
- 18072da29 fix: SQLite search path matches ANY tag, parity with list path (#871)
- 7249a65c5 fix(todos): cancelled deps no longer block the claim/start path (#860)
- version wave 13 (#912): package.json 0.15.43 bump + changelog; this candidate bumps to 0.15.44 (patch) via changeset todos-schema-ready-retry (schema-ensure retry for postgres adapter, pr-groups, task-manifest, project-registration backends)
- f78056798 release(todos): version 0.15.44 — the changeset application (package.json, CHANGELOG.md, .changeset consumed). Diff stat: 18 files, +425/-31.

Check, in order:
1. SECRETS: scan the full diff and the packed content (npm pack --dry-run equivalent: read the files that would ship) for credential values, tokens, or secrets in any encoding. Also internal-infra strings: *.hasna.xyz hostnames, arn:aws:* references, 12-digit AWS account ids, private IPs — anything the publish-guard blocks. Inspect the package.json files field / main / exports to confirm the tarball would contain the built dist the bins actually use.
2. VERSION BUMP: package.json version is 0.15.44, exactly one patch above 0.15.43 (the previous in-repo version) and above the last published 0.15.41; the changelog entry for 0.15.44 accurately describes only the changes since 0.15.43; the changeset was consumed (deleted from .changeset).
3. DIFF CORRECTNESS: read the actual diffs (git show <sha> for the fix commits; git diff ac5d8ade1..HEAD) in this worktree. Verify each fix does what its changelog claims, regression tests exist and are meaningful (not vacuous), no unrelated or risky refactors rode along, no dead code or debug output. Pay attention to: the schema-sync retry logic (is the cached rejection actually cleared on failure, and can retry loop or poison again?), the julianday cursor comparison (unparseable stamps kept, not dropped), the ANY-tag search path, the cancelled-deps claim path, and the local-sqlite changes.
4. DEPENDENCY-DRIVEN BUMPS: the changeset also bumped @hasna/browser 0.5.26, @hasna/projects 0.1.142, @hasna/testers 0.0.101, @hasna/economy 0.3.20 (dependency ranges on todos). Confirm these are pure version-range bumps with no code changes and that no published tarball would contain workspace:* references (check the four packages' package.json dependency edits).
5. REGRESSION RISK: run or inspect the test suite for the touched areas if feasible in a read-only way (you may read; do not mutate). At minimum confirm the new tests cover the failure modes claimed.

FIRST LINE of your verdict file exactly: [REVIEW] GO|NO_GO — @hasna/todos@0.15.44 @ f780567980d7cdba7eb79356c2f7b735de8adbab — registry npmjs

Then only concrete P0/P1 blocking findings, each with file:line and a failure scenario. No findings means GO. Do not pad with P2/P3 style nits.
