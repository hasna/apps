export const meta = {
  name: 'wave670-merge',
  description: 'Merge continuation for wave PR hasna/apps#670 (Version Packages, release/version-wave) — open 2h48m (> 45-min merge bound), CONFLICTING vs moved main. THIS lane: rebase release/version-wave onto the LATEST origin/main, drop the contracts 0.11.1->0.11.2 entry (duplicates the merged split release #672 per coordination note issuecomment-5350376398), re-run changeset version for the remaining pool, CI 5/5 with precondition-held classes documented (machines #673 + contracts publish are in flight), Fable review, base gate, merge, [SHIP-READY] -> publish-all ships the 40 bumps',
  phases: [
    { title: 'Rebase', detail: 'rebase release/version-wave onto latest main; drop contracts duplicate entry' },
    { title: 'Verify', detail: 'CI at new head; precondition-held classes documented, not waived' },
    { title: 'Review', detail: 'Fable adversarial review of the wave candidate' },
    { title: 'Ship', detail: 'preconditions (contracts 0.11.2 published + machines #673 merged), base gate, merge, [SHIP-READY]' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 670

const CONST = `
You are a lane of the wave670-merge workflow (2026-08-20) — the merge continuation for wave PR hasna/apps#${PR} 'Version Packages' (branch release/version-wave, 40 package bumps from the 62-changeset pool, label ship-latest; sole owner is the ship-latest workflow — NO second wave may be opened). The wave has been open since 00:51Z (> 45-min merge bound) and is CONFLICTING: its base a20dcf98f predates origin/main 14115e3dc -> b1ebdadb, and its contracts 0.11.1->0.11.2 entry DUPLICATES the already-merged split release hasna/apps#672 (release(contracts) 0.11.2, merged 45399cf1b). Final text = machine-readable JSON.

The named remediation (from the f12/f13/f14 census residues + coordination note issuecomment-5350376398 on PR #${PR}): (1) rebase release/version-wave onto the LATEST origin/main (b1ebdadb); (2) DROP the contracts 0.11.1->0.11.2 bump from the wave (revert the contracts package.json/CHANGELOG/hasna.contract.json entries + the @hasna/secrets 0.3.1 dependency line if it was wave-caused — the split release #672 already landed contracts 0.11.2 on main); (3) re-run changeset version for the remaining pool so the wave's versions are consistent at the new head; (4) CI 5/5 at the new head with the known precondition-held classes DOCUMENTED (not waived): the machines workspace-member dist class (#673, wave-mr2-r1 lane in flight — publish guard green at its fix head, build+test red) and the contracts workspace-member prepare class (clears once @hasna/contracts@0.11.2 publishes — publish-all lane in flight); (5) Fable review, base gate, merge, [SHIP-READY] on git-publishing (publish-all is the ONLY publisher — this lane never publishes).

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave670m-<n>; work on the PR's OWN branch (release/version-wave — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: wave670m-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments and state — if the wave already merged, or a rebase moved the head past 5ab39253 with the contracts entry dropped, verify and record; do not duplicate.
- REBASE + DROP ONLY: the contracts duplicate entry removal and the version-wave consistency regen. No other version changes, no scope creep.
- Verify: 'bun install --frozen-lockfile' rc=0 at the new head, versioning suite green, the per-check CI table with precondition-held classes named and linked to their in-flight lanes, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named wave670m-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase release/version-wave onto the LATEST origin/main, drop the contracts duplicate entry (verify: contracts package.json back to 0.11.1 in the wave, since 0.11.2 is on main via #672 — OR confirm the rebase resolution removed it), re-run changeset version for the remaining pool, prove the wave diff is version-only (no stray source changes), frozen install rc=0, secrets scan, commit ('Agent: wave670m-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, contractsDropped: bool, versionOnly: bool, frozenInstallOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min), record the per-check table. Classify each failure: frozen-install / versioning failures are BLOCKING (remediate); the machines workspace-member class and contracts workspace-member prepare class are PRECONDITION-held — check whether hasna/apps#673 merged (gh pr view 673 --json state) and whether @hasna/contracts 0.11.2 is published (npm view @hasna/contracts version); report which preconditions remain with their in-flight lane references. acceptanceMet=true only when the ONLY remaining failures are precondition-held classes with live lanes (documented, not waived).
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, machinesMerged: bool, contractsPublished: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the wave at the new head: (a) version-only diff (no stray source changes), (b) the contracts duplicate entry dropped, (c) CI per the verify classification (blocking classes gone; precondition-held classes named with in-flight lane references), (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave670-merge @ <sha> — lens: wave merge candidate, reviewer wave670m-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: re-check the PRECONDITIONS (hasna/apps#673 merged — TRUE, merged aa0941490 — AND the contracts publish lane reached a terminal state: npm view @hasna/contracts version != 0.11.1. The 0.11.2 pin is RETIRED 2026-08-20: the publish-all lane publishes the #678 candidate after its release review GO, and #678's truthful bump is 0.12.0 — the exact published version is whatever the release lane lands; the precondition is that the registry moved past the stale 0.11.1, not a pinned number). If both hold: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: wave670m-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — 40 bumps; publish-all next pass ships (repos 0.1.50, contracts 0.12.0 via #678, catalog patch, emails 1.3.17, test-guard 0.0.1)' on git-publishing. If preconditions are missing: comment the exact remaining gates + resume condition, leave open. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, preconditionsMet: bool, missingPreconditions: [string], shipReadyPosted: bool, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, contractsDropped: { type: 'boolean' }, versionOnly: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary', 'contractsDropped'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, machinesMerged: { type: 'boolean' }, contractsPublished: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, preconditionsMet: { type: 'boolean' }, missingPreconditions: { type: 'array' }, shipReadyPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'wave670m-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'wave670m-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave670m-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave670m-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
