export const meta = {
  name: 'test-guard-rearm-fix',
  description: 'Fix lane for row 7112181b (BUG: @hasna/test-guard — station01 bun wrapper clobber RECURS, 3rd occurrence 2026-08-21; sentinel FAILs 06:40Z/08:00Z/11:40Z; incidents 719953, 720561): reinstallers overwrite /home/hasna/.bun/bin/bun and bun-real; manual reinstall per README each time. Lane: IDEMPOTENCY CHECK FIRST -> investigate the clobber source -> smallest owned root fix (auto-rearm guard or installer pinning) in apps/test-guard -> regression -> suite + live probe -> one Fable review -> base gate + merge -> activate + live-verify on station01 -> complete the row.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; identify what clobbers the wrapper (bun upgrade / reinstallers / install paths); read apps/test-guard + /home/hasna/.hasna/test-guard source of truth; name the durable fix surface' },
    { title: 'Fix', detail: 'smallest owned root fix in apps/test-guard (auto-rearm guard on marker/sentinel detection, or installer pinning); regression test; changeset' },
    { title: 'Verify', detail: 'apps/test-guard suite green (literal counts); wrapper probe serves pinned bun 1.3.14 (sha 37141662ebed915a); sentinel functional probe passes; guard rearms on a simulated clobber (temp-dir copy, never the live path); CI per-check at head; diff gate; secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + activate on station01 (atomic mv-over-held-inode, preserve current working wrapper) + live-verify + complete row 7112181b' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '7112181b'
const WRAPPER = '/home/hasna/.bun/bin/bun'
const BUN_REAL = '/home/hasna/.bun/bin/bun-real'
const GUARD_HOME = '/home/hasna/.hasna/test-guard'
const PINNED_BUN = '1.3.14'
const PINNED_SHA = '37141662ebed915a'

const CONST = `
You are the test-guard-rearm-fix lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21, 3rd occurrence; incidents 719953, 720561): the hasna-test-guard wrapper at ${WRAPPER} (bash wrapper, marker line 'hasna-test-guard wrapper', source ${GUARD_HOME}/bun-wrapper.sh, REAL target ${BUN_REAL}) is CLOBBERED by reinstallers — both ${WRAPPER} and ${BUN_REAL} get overwritten — and the sentinel-cron (${GUARD_HOME}/sentinel-cron.log) FAILed at 06:40Z/08:00Z/11:40Z. Each occurrence is repaired manually (reinstall wrapper from ${GUARD_HOME}/bun-wrapper.sh + restore pinned bun ${PINNED_BUN} sha ${PINNED_SHA} via atomic mv-over-held-inode). The owning package is apps/test-guard in the hasna/apps monorepo. The durable fix is an auto-rearm on sentinel/marker detection, or installer pinning — the lane decides the smallest owned root fix after investigating the actual clobber source.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row, no open PR fixing the test-guard clobber class — check gh pr list --repo hasna/apps --search 'test-guard in:title,body' and 'bun wrapper in:title,body'); (b) read the CURRENT machine state: does ${WRAPPER} still carry the marker line, and does '${WRAPPER} --version' serve ${PINNED_BUN}? If a durable fix already exists (open PR, guard script present and working, sentinel green for a full window), record the evidence and STOP (the lane is complete by recovery). Do NOT re-dispatch if the wrapper is currently healthy AND the fix exists.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/test-guard-7112181b cut from CURRENT origin/main. NEW BRANCH fix/test-guard-auto-rearm. PR-first; never push to main. Commits end with 'Agent: test-guard-rearm-fix-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- ROOT CAUSE, NARROWLY: read apps/test-guard source + ${GUARD_HOME}/bun-wrapper.sh + README.md + sentinel.sh; investigate WHAT clobbers the wrapper (bun upgrade through the wrapper updating bun-real per design? a bun reinstaller script? bun install -g? a package postinstall? the release-age quarantine interplay?). Name the exact clobber source with evidence before designing the fix. The fix surface is apps/test-guard code + its shipped guard/installer machinery (a rearm guard invoked by sentinel detection or a scheduled check, or installer pinning that prevents the overwrite). HARD SCOPE GATE: the PR diff MUST be limited to apps/test-guard (+ changeset + any test fixtures) — any other app file is a self-inflicted NO_GO. Do NOT weaken the guard (slot semaphore, fail-closed exit 75, cgroup limits), do NOT disable or soften the sentinel, do NOT touch the release-age quarantine.
- MACHINE ACTIVATION IS PART OF THE FIX, TESTED SAFELY: the guard's rearm path must be live-tested on a COPY first (temp dir with a fake ${WRAPPER}/bun-real pair; simulate the clobber; prove the guard restores marker + pinned version; never run the simulated clobber on the live path). The final activation on station01 applies atomically (cp bun-wrapper.sh -> temp, chmod +x, mv -f over the held inode) and PRESERVES the currently-working wrapper if the activation would break it — verify '${WRAPPER} --version' == ${PINNED_BUN} and the marker line present AFTER activation, and the sentinel functional probe passes (canary through the wrapper, cgroup limits, acquired log line). Never leave the box with a broken bun.
- VERIFY: apps/test-guard suite green at the head (literal passed/failed counts); the rearm regression test passes (simulated clobber -> guard restores, literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling; test-guard reason green; other named lane residuals recorded with classification); diff gate (apps/test-guard + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) root cause NAMED with evidence (not guessed), (b) fix at the owning surface (auto-rearm or pinning — no manual-reinstall README patch as the fix), (c) regression proves the rearm fires on marker-absent (literal), (d) suite + CI green for the test-guard reason, (e) machine activation safe + sentinel functional probe passing (or the exact named blocker), (f) diff gate within scope, (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-rearm-fix @ <sha> — lens: wrapper clobber root fix, reviewer test-guard-rearm-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-rearm-fix-land', record the merged sha, ACTIVATE + LIVE-VERIFY on station01 (wrapper marker + version + sentinel functional probe), complete row ${ROW} with evidence (merged sha, clobber source, fix surface, activation result). The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Read apps/test-guard source + ${GUARD_HOME} (bun-wrapper.sh, README.md, sentinel.sh, guard.log, sentinel-cron.log) and the shell history of the clobber windows; identify WHAT overwrites ${WRAPPER} and ${BUN_REAL} (name the exact reinstaller/upgrade path with evidence — commands, timestamps, mtimes); classify the failure surface (upgrade-through-wrapper updating bun-real per design, or an external reinstaller clobbering both); name the durable fix (auto-rearm guard vs installer pinning) and the files it touches in apps/test-guard. Return (JSON): { rowState, wrapperHealthy, wrapperMarker, wrapperVersion, clobberSource, clobberEvidence, fixSurface, filesToChange: [string], regressionShape, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: implement the smallest owned root fix in apps/test-guard (auto-rearm guard wired to sentinel/marker detection, or installer pinning that prevents the overwrite — per the investigate finding); add the regression test (simulated clobber on a temp-dir copy -> guard restores marker + pinned version); changeset; HARD SCOPE GATE (apps/test-guard + changeset only); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, clobberSource, fixSurface, regressionRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: apps/test-guard suite green (literal counts); rearm regression passes on a temp-dir copy (literal); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; test-guard reason green; other named lane residuals classified); diff gate (apps/test-guard + changeset only); secrets scan clean. Do NOT activate on the live path (Land owns activation). Return (JSON): { suiteCounts: {passed, failed}, regressionRc, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) root cause NAMED with evidence, (b) fix at the owning surface (auto-rearm or pinning — not a README patch), (c) regression proves rearm on marker-absent (literal), (d) suite + CI green for the test-guard reason (or the exact named non-this-lane residual), (e) machine-activation plan safe (temp-copy test first, atomic activation, never a broken live bun), (f) diff gate within scope, (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-rearm-fix @ <sha> — lens: wrapper clobber root fix, reviewer test-guard-rearm-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-rearm-fix-land', record merged sha, ACTIVATE on station01 (atomic mv-over-held-inode preserving the current working wrapper; verify marker + '${WRAPPER} --version' == ${PINNED_BUN} + sentinel functional probe passes), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, wrapperMarkerPresent, wrapperVersion, sentinelProbeRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, wrapperHealthy: { type: 'boolean' }, wrapperMarker: { type: 'boolean' }, wrapperVersion: { type: 'string' }, clobberSource: { type: 'string' }, clobberEvidence: { type: 'string' }, fixSurface: { type: 'string' }, filesToChange: { type: 'array' }, regressionShape: { type: 'string' }, notChecked: { type: 'array' } }, required: ['rowState', 'wrapperHealthy', 'clobberSource', 'fixSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, clobberSource: { type: 'string' }, fixSurface: { type: 'string' }, regressionRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suiteCounts: { type: 'object' }, regressionRc: { type: 'number' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['suiteCounts', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, wrapperMarkerPresent: { type: 'boolean' }, wrapperVersion: { type: 'string' }, sentinelProbeRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'test-guard-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.rowState === 'pending' ? await agent(FIX, { label: 'test-guard-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'test-guard-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'test-guard-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the lane is complete by recovery', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'test-guard-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, wrapperMarkerPresent: null, wrapperVersion: null, sentinelProbeRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { rowState: investigate.rowState, wrapperHealthy: investigate.wrapperHealthy, clobberSource: investigate.clobberSource, fixSurface: investigate.fixSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, regressionRc: fix.regressionRc }, verify: verify && { suiteCounts: verify.suiteCounts, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
