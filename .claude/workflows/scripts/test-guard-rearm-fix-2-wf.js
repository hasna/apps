export const meta = {
  name: 'test-guard-rearm-fix-2',
  description: 'Successor fix lane for row 7112181b (BUG: @hasna/test-guard — station01 bun wrapper clobber RECURS, 3rd occurrence 2026-08-21; incidents 719953, 720561). The investigate phase of wf_e9dd63c0-71d COMPLETED and named the root cause (curl installer per apps/knowledge/scripts/check-bun-version.mjs:71 writes $BUN_INSTALL/bin/bun unconditionally, replacing the wrapper; bun-real drift 1.3.14->1.4.0 via bun upgrade re-arms the pin check — the 11:40Z recurrence) and the fix surface (sentinel REARMS instead of alerting only, fail-closed). The original run died after phase 1 (fix never launched; resume replays the terminal envelope). This successor CONSUMES the recorded investigation and executes Fix -> Verify -> one Fable review -> base gate + merge -> activate + live-verify on station01 -> complete the row. Same review lineage, same row, one driver.',
  phases: [
    { title: 'Fix', detail: 'idempotency check; implement the sentinel auto-rearm (restore wrapper atomically + re-pin bun-real 1.3.14 sha 37141662ebed915a) in apps/test-guard; regression (simulated clobber on a temp-dir copy -> guard restores); changeset' },
    { title: 'Verify', detail: 'apps/test-guard suite green (literal counts); rearm regression passes (literal); sentinel functional probe passes; CI per-check at head; diff gate (apps/test-guard + changeset only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + activate on station01 (atomic, preserve working wrapper) + live-verify + complete row 7112181b' },
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
You are the test-guard-rearm-fix-2 successor lane (row ${ROW}; owner-authorized via the task-drain queue; successor of wf_e9dd63c0-71d whose investigate COMPLETED — do NOT re-investigate the root cause, it is recorded). Final text = machine-readable JSON.

RECORDED ROOT CAUSE (investigate phase of wf_e9dd63c0-71d, 2026-08-21 — treat as given, verify only what you need): PRIMARY clobber source = the official bun curl installer pinned to the CI version (\`curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14\`) run on station01 by hasna/apps lanes that need the CI-pinned bun. The installer writes \$BUN_INSTALL/bin/bun (= ${WRAPPER}) unconditionally, replacing the hasna-test-guard wrapper with a real bun ELF. The command is prescribed verbatim by apps/knowledge/scripts/check-bun-version.mjs:71 whenever the running bun != pinned 1.3.14. CONTRIBUTORY = \`bun upgrade\` through the wrapper updates bun-real 1.3.14->1.4.0 and PRESERVES the wrapper (measured sandbox experiment + repair 720565); once bun-real is 1.4.0, any pinned-1.3.14 lane hits check-bun-version, follows its prescribed curl installer, and clobbers the wrapper — the 11:40Z recurrence. NOT bun upgrade clobbering the wrapper, NOT bun install -g, NOT fleet scripts, NOT crontab.

RECORDED FIX SURFACE (same investigate, treat as given): apps/test-guard auto-rearm guard. The sentinel already detects the clobber every 20 min (marker-absent / integrity-mismatch); the durable fix is for it to REARM instead of only alerting: (a) atomically restore the wrapper from the package source (cp to .new, chmod +x, mv -f over the held inode — wrapper inode is not held by a running process; bunx symlinks point at the path, not the inode, so they keep working), and (b) re-pin bun-real to ${PINNED_BUN} sha ${PINNED_SHA} via mv-over-held-inode (running suites keep their old inode), sourcing the pinned binary from a package-managed store or a sha-verified download; then (c) re-verify marker + version + the existing end-to-end canary probe (rc=0, '1 pass', exact cgroup limits, 'acquired ... argv=test' log line) before declaring success; fail-closed: if rearm cannot produce a verified wrapper + pinned bun-real, keep the alert path. Installer pinning of the external lane is NOT the fix surface (apps/knowledge/scripts/check-bun-version.mjs lives outside apps/test-guard; the hard scope gate limits this PR to apps/test-guard — the guard heals the host regardless of which lane runs the installer).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is still pending and unowned (no in_progress fixer row, no open PR fixing the test-guard clobber/auto-rearm class — gh pr list --repo hasna/apps --search 'test-guard in:title,body'); (b) current machine state: ${WRAPPER} marker present and '${WRAPPER} --version' == ${PINNED_BUN}? If a durable auto-rearm fix already exists (open PR, guard wired, sentinel green for a full window), record the evidence and STOP (the lane is complete by recovery). The recorded root-cause finding itself is NOT the fix — a finding alone leaves the row pending.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/test-guard-rearm-fix cut from CURRENT origin/main. NEW BRANCH fix/test-guard-auto-rearm. PR-first; never push to main. Commits end with 'Agent: test-guard-rearm-fix-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- FIX NARROWLY per the recorded fix surface: wire the sentinel's rearm path in apps/test-guard (restore wrapper atomically + re-pin bun-real to ${PINNED_BUN} sha ${PINNED_SHA} from a package-managed store or sha-verified download, fail-closed on unverified rearm); add the regression test (simulated clobber on a temp-dir COPY of the bin dir -> the guard restores marker + pinned version; never run the simulated clobber on the live path); changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/test-guard (+ changeset + test fixtures) — apps/knowledge/scripts/check-bun-version.mjs and any other app file are OUT OF SCOPE (self-inflicted NO_GO). Do NOT weaken the guard (slot semaphore, fail-closed exit 75, cgroup limits), do NOT soften the sentinel, do NOT touch the release-age quarantine.
- VERIFY: apps/test-guard suite green at the head (literal passed/failed counts); rearm regression passes on a temp-dir copy (literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling; test-guard reason green; other named lane residuals recorded with classification); diff gate (apps/test-guard + changeset only); secrets scan clean. Do NOT activate on the live path (Land owns activation).
- REVIEW (one Fable adversarial reviewer): (a) rearm implemented per the recorded fix surface (atomic restore + sha-verified re-pin, fail-closed), (b) regression proves rearm on marker-absent (literal), (c) suite + CI green for the test-guard reason (or the exact named non-this-lane residual), (d) machine-activation plan safe (temp-copy test first, atomic activation, never a broken live bun), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-rearm-fix @ <sha> — lens: wrapper clobber root fix, reviewer test-guard-rearm-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-rearm-fix-land', record the merged sha, ACTIVATE + LIVE-VERIFY on station01 (wrapper marker + '${WRAPPER} --version' == ${PINNED_BUN} + sentinel functional probe passes — canary rc=0, '1 pass', cgroup limits, 'acquired ... argv=test' log line), complete row ${ROW} with evidence (merged sha, fix surface, activation result). The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Implement the sentinel auto-rearm per the recorded fix surface in apps/test-guard; add the regression (simulated clobber on a temp-dir COPY -> guard restores marker + pinned version, literal); changeset; HARD SCOPE GATE (apps/test-guard + changeset only); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, fixImplemented, regressionRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: apps/test-guard suite green (literal counts); rearm regression passes on a temp-dir copy (literal); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; test-guard reason green; other named lane residuals classified); diff gate (apps/test-guard + changeset only); secrets scan clean. Do NOT activate on the live path (Land owns activation). Return (JSON): { suiteCounts: {passed, failed}, regressionRc, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) rearm implemented per the recorded fix surface (atomic restore + sha-verified re-pin, fail-closed — not a README patch), (b) regression proves rearm on marker-absent (literal), (c) suite + CI green for the test-guard reason (or the exact named non-this-lane residual), (d) machine-activation plan safe (temp-copy test first, atomic activation, never a broken live bun), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-rearm-fix @ <sha> — lens: wrapper clobber root fix, reviewer test-guard-rearm-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-rearm-fix-land', record merged sha, ACTIVATE on station01 (atomic mv-over-held-inode preserving the current working wrapper; verify marker + '${WRAPPER} --version' == ${PINNED_BUN} + sentinel functional probe passes), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, wrapperMarkerPresent, wrapperVersion, sentinelProbeRc, rowState, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, fixImplemented: { type: 'string' }, regressionRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suiteCounts: { type: 'object' }, regressionRc: { type: 'number' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['suiteCounts', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, wrapperMarkerPresent: { type: 'boolean' }, wrapperVersion: { type: 'string' }, sentinelProbeRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'test-guard2-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'test-guard2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'test-guard2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'test-guard2-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, wrapperMarkerPresent: null, wrapperVersion: null, sentinelProbeRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, regressionRc: fix.regressionRc }, verify: verify && { suiteCounts: verify.suiteCounts, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
