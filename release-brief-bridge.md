[REVIEW] GO|NO_GO — @hasna/bridge@0.7.2 @ 4d6e8c272f3b5006b928c1ec520679a5587db8d6 — registry npmjs

You are the independent adversarial reviewer for an npm release candidate of the Hasna app @hasna/bridge. Per the fleet npm-release rule, you must return ONE verdict bound to the repository, exact commit SHA, package name and version, and registry target. You are a codewith exec review agent; you do NOT publish. Work read-only in the checkout at /home/hasna/.hasna/repos/worktrees/apps/release-bridge (repo hasna/apps monorepo).

CANDIDATE
- Package: @hasna/bridge
- Version: 0.7.2 (repo apps/bridge/package.json "version": "0.7.2")
- Registry current (negative control measured before review): 0.7.1 — 0.7.2 is NOT yet published
- Head: 4d6e8c272f3b5006b928c1ec520679a5587db8d6 (origin/main of hasna/apps)
- Bins: bridge (dist/cli/index.js), bridge-mcp (dist/mcp/index.js)
- Registry target: npmjs (public, @hasna scope)

COMMITS IN THIS RELEASE (since the 0.7.1 content baseline d03e71c01; git log --oneline d03e71c01..HEAD -- apps/bridge):
1. 01a749c40 fix(bridge): sync apps/bridge with hasna/bridge main (#14-#17) — live-owner daemon lock protection (breakAbandonedDaemonLock now checks pidAlive(owner.pid) before age expiry), daemon stop/serve --timeout-ms becomes an override of a config-derived stop grace, doctor exit codes hardened, regression tests (daemon-lifecycle, daemon-stop-grace, serve-preflight)
2. 86184f14f fix(bridge): canonical data root ~/.hasna/bridge — homeDir() falls back to os.homedir() instead of process.cwd(), postinstall uses os.homedir(); new tests/paths.test.ts
3. 501154dbc chore(bridge): display name "Hasna Bridge" (open- prefix retired)
4. 268ac3f7f fix(bridge): align hasna.contract.json to current contracts kit 0.11.1 (mode removed, backend: sqlite, postgresql naming, contracts scripts bumped)
5. ff340cc40 Version Packages (#670) — version bump 0.7.0 -> 0.7.2 + CHANGELOG entry (0.7.1 was skipped in the monorepo; the registry already carries 0.7.1 from the org repo)

REVIEW SCOPE (do all, concretely):
A. SECRETS / INTERNAL-INFRA STRINGS in the packed content: inspect src/ for any credential patterns, tokens, private URLs (*.hasna.xyz, ARNs, AWS account ids), .env-shaped values, or personal keys that would ship in the tarball. Check the files list in package.json (dist, docs, examples, LICENSE, README.md) and the postinstall script. grep the whole apps/bridge tree.
B. CHANGELOG ACCURACY: does CHANGELOG.md 0.7.2 entry truthfully describe the changes since the registry's 0.7.1? Nothing missing that a consumer would need to know; nothing overstated.
C. VERSION BUMP CORRECTNESS: package.json 0.7.2 is consistent with the changelog; bins unchanged; files/exports valid; dist is NOT committed (built at prepack) — confirm no stale committed dist.
D. REGRESSION RISK: read src/lib/daemon.ts lock/stop-grace changes and src/lib/paths.ts homeDir change for behavioral regressions; confirm tests cover the changed paths; note the --timeout-ms default change (was "5000" default, now undefined = derived grace) and its compatibility impact on existing invocations.
E. REPO LAWS: hasna/apps AGENTS.md requirements for members (name conformance, manifests, publish-guard) as they apply to this release candidate.

OUTPUT FORMAT (first line exactly as above, then):
- Verdict line 1 MUST be exactly: [REVIEW] GO|NO_GO — @hasna/bridge@0.7.2 @ 4d6e8c272f3b5006b928c1ec520679a5587db8d6 — registry npmjs
- Then list ONLY concrete P0/P1 blocking findings (each: file, line, evidence, why it blocks the release) — or state "No P0/P1 blocking findings." if none.
- P2/P3 observations may follow, marked non-blocking.
- State what you did not check.

Do not remediate. Do not publish. Return the verdict file to stdout.
