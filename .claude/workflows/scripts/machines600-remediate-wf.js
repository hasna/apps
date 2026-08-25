export const meta = {
  name: 'machines600-remediate',
  description: 'Remediation cycle 1 for hasna/apps#600 (machines 0.2.28 release split, machines-split NO_GO): the station template floors the @hasna/machines bun global at 0.2.27 and its own test asserts minVersion === packageVersion. Fix: bump apps/machines/templates/station/template.json minVersion + lesson text to 0.2.28; re-verify; Fable re-review (cycle 1); merge; publish-all ships 0.2.28; wave rebase handoff',
  phases: [
    { title: 'Remediate', detail: 'template floor 0.2.27 -> 0.2.28 + lesson text, machines suite green, push' },
    { title: 'Verify', detail: 'CI affected-build green at the new head (environmental Playwright flake routed around)' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped to the floor defect)' },
    { title: 'Ship', detail: 'merge GO, handoff to publish-all (ships machines 0.2.28) + wave rebase' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 600

const CONST = `
You are a lane of the machines600-remediate workflow (2026-08-19). PR hasna/apps#${PR} (release/machines-0.2.28, the machines-only release split, head 0a056bd1) got machines-split-review NO_GO with ONE P1: apps/machines/templates/station/template.json floors the @hasna/machines bun global minVersion at 0.2.27, and apps/machines/test/station-template.test.ts asserts minVersion === packageVersion — so the bump to packageVersion 0.2.28 breaks exactly one test (raw assertion diff pasted on PR #${PR} comment 5344595660). Remediation: bump the template floor and its lesson text to 0.2.28, push to release/machines-0.2.28; same reviewer re-verifies ONLY this defect. Note: CI attempts 1-2 failed environmentally at 'Install playwright chromium' (apt azure.archive.ubuntu.com unreachable) — a repo-wide flake, not PR-caused; attempt 3 ran the real suite. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/machines600-r1-<n>; work on the PR's OWN branch (release/machines-0.2.28 — never guess). PR-first; never push to main. Commits end with 'Agent: machines600-r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the floor remediation already landed (head moved past 0a056bd1), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: template.json minVersion 0.2.27 -> 0.2.28 plus the entry's lesson text (the release-floor convention the 0.2.27 release itself followed). Do NOT change package.json, CHANGELOG, or any other file. The failing test IS the regression (red at head, recorded) — the fix makes it green.
- Verify: 'bun test' apps/machines suite green (record counts incl. station-template.test.ts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named machines600-r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the one-defect floor fix on the PR branch, machines suite green (record counts), frozen install rc=0, secrets scan, commit ('Agent: machines600-r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, suiteCounts: {passed, failed}, frozenInstallOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run the failed build+test job (gh run rerun), poll bounded (max 15 min), require 'build + test (affected)' GREEN at the new head (record the per-check table). If the run fails at 'Install playwright chromium' (the known environmental flake), re-run once and record; if it fails for a real reason, record the exact failure. Re-verify 'bun test' machines suite green at the new head.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, suiteGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 on the SAME PR, scoped to the named floor defect and its direct regressions. Review: (a) the remediation is the template floor ONLY (package.json/CHANGELOG untouched), (b) station-template.test.ts green at the new head, (c) CI affected-build green, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — machines600-r1 @ <sha> — lens: cycle-1 floor remediation, reviewer machines600-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: machines600-r1-ship'), record the merged sha, and record the handoff: publish-all's next hourly census ships @hasna/machines@0.2.28 (registry check 'npm view @hasna/machines version' == 0.2.28 — do NOT publish outside publish-all); the wave rebase happens after 0.2.28 is on the registry (ship-latest owns the current wave #602; the superseded #595 closes per its own lane). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, handoff: string, taskState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, frozenInstallOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, suiteGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, handoff: { type: 'string' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'machines600-r1-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'machines600-r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'machines600-r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'machines600-r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
