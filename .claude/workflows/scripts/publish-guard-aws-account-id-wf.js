export const meta = {
  name: 'publish-guard-aws-account-id',
  description: 'Fix lane for row 27d2a7a2 (publish-guard aws-account-id class — 10+ members ship internal-infra account ids in packed dist: browser 3, holdings 2, testers 4, knowledge 2, economy 2, consolidations 1, prompts 1, servers 1; measured at origin/main f1b21aad run 32489596554). Lane: reproduce the guard violations at CURRENT origin/main per member -> root-cause the account-id source per member -> smallest owned fix (parameterize/env-var or scrub; never weaken the guard) -> regression per member (pack + guard green) -> one Fable review -> base gate + merge -> complete row. recordings/todos pack failures are SEPARATE classes (macOS-only build; d175d558 lockfile) — out of scope.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the aws-account-id violations at CURRENT origin/main (pack + guard per member, literal); map each member to the source surface embedding the account id' },
    { title: 'Fix', detail: 'smallest owned root fix per member (parameterize/env-var or scrub; guard stays as-is); regression per member (red-before/green-after); changeset; NEW PR' },
    { title: 'Verify', detail: 'pack + publish-guard green per member (literal); member suites green; frozen install; CI per-check at head; diff gate (named members + changesets only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 27d2a7a2 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '27d2a7a2'
const MEMBERS = 'browser, holdings, testers, knowledge, economy, consolidations, prompts, servers'

const CONST = `
You are the publish-guard-aws-account-id fix lane (row ${ROW}; owner-authorized via the signal-to-task queue). Final text = machine-readable JSON.

Context (filed 2026-08-21 ~14:15Z from run 32489596554's publish-guard job at origin/main f1b21aad): the publish-guard blocks packed tarballs carrying internal-infra strings. Pattern aws-account-id hits in these members' dist files: apps/browser (3: dist/cli/index.js, dist/mcp/index.js, dist/storage.js), apps/holdings (2), apps/testers (4: dist/cli/index.js, dist/index.js, dist/mcp/index.js, dist/server/index.js), apps/knowledge (2: bin/knowledge.js, dist/index.js), apps/economy (2), apps/consolidations (1), apps/prompts (1: dist/server/index.js), apps/servers (1: dist/mcp/index.js). dist/ is gitignored and built at pack time, so the account id is embedded in SOURCE and compiled into the packed tarball. These members' publishes are blocked in publish-all's census until fixed. The recordings pack failure (macOS-only native build) and the todos pack failure (frozen-lockfile, d175d558 lineage) are SEPARATE classes — out of scope, do NOT touch them.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row); (b) no OTHER open PR fixes this class (gh pr list --repo hasna/apps --search 'aws-account-id in:title,body' OR the named members in:title,body — publish-guard/violation); (c) reproduce at CURRENT origin/main FIRST: pack each named member (npm pack --dry-run --json, per the publish-guard's own mechanism) and confirm the aws-account-id violations exist; if main no longer violates, record the evidence and STOP (complete by recovery).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/publish-guard-aws-account-id cut from CURRENT origin/main. NEW BRANCH fix/publish-guard-aws-account-id. PR-first; never push to main. Commits end with 'Agent: publish-guard-aws-account-id-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- FIX AT THE ROOT, NARROWLY: for EACH member, trace the account-id string from the packed dist back to its SOURCE surface (a constant, a config, an env-default, a template) and apply the smallest owned fix — parameterize it (read from env/config with the documented default) or scrub it from what ships. NEVER weaken, disable, or skip the publish-guard, NEVER commit a real account id, NEVER add the member to an ignore list. The fix must keep the member functional (the account id is still available where the code genuinely needs it, via its env/config surface). Add a regression PER MEMBER that fails before and passes after (pack the member and run the publish-guard's scan — literal red-before/green-after). Add a .changeset/publish-guard-aws-account-id.md patch changeset (one, naming all members). HARD SCOPE GATE: the PR diff MUST be limited to the named members (${MEMBERS}) + the changeset — any other app file is a self-inflicted NO_GO.
- VERIFY at the head (bounded): pack + guard-scan per member green (literal per-member lines); member suites green for the touched members (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling — classify EVERY failure against CURRENT origin/main state: main's own run must fail identically for a main-state residual (recordings/todos pack failures, contracts 0.13.3 standard-adherence, versioning-integrity); this-lane-caused failures MUST be green); diff gate (named members + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) red-before/green-after per member measured (literal), (b) root fix at the owning surface per member (parameterized/scrubbed, guard untouched, no committed account ids), (c) pack + guard green per member, (d) member suites green, (e) CI at the head green for this-lane reasons (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — publish-guard-aws-account-id @ <sha> — lens: internal-infra strings out of packed tarballs, reviewer publish-guard-aws-account-id-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: publish-guard-aws-account-id-land', record the merged sha, LIVE-VERIFY the pack + guard for the touched members at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open, row stays pending. The members publish via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values (the account id IS an internal-infra string — do not print it, do not commit it; reference it only as 'the account id' in evidence); no internal-infra strings in any output beyond the violation listing itself. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce at CURRENT origin/main: pack each named member and confirm the aws-account-id violations (literal per-member lines); trace each violation to its SOURCE surface. Return (JSON): { mainTip, violations: [{member, count, files: [string], sourceSurface}], outOfScope: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix per member at the owning surface (parameterize/env-var or scrub; guard untouched); regression PER MEMBER (red-before/green-after, literal); one changeset; HARD SCOPE GATE (${MEMBERS} + changeset only); NEW BRANCH fix/publish-guard-aws-account-id; canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, membersFixed: [string], regressionsAdded: [string], diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: pack + guard-scan per member green (literal per-member lines); touched-member suites green (literal counts); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; every failure classified vs CURRENT origin/main — main-state residuals named (recordings/todos pack, contracts standard-adherence, versioning-integrity), this-lane-caused MUST be green); diff gate (${MEMBERS} + changeset only); secrets scan clean. Return (JSON): { guardPerMember: [{member, rc, entries, violations}], suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before/green-after per member measured, (b) root fix at the owning surface per member (parameterized/scrubbed, guard untouched, no committed account ids), (c) pack + guard green per member (literal), (d) member suites green, (e) CI at the head green for this-lane reasons (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — publish-guard-aws-account-id @ <sha> — lens: internal-infra strings out of packed tarballs, reviewer publish-guard-aws-account-id-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: publish-guard-aws-account-id-land', record merged sha, LIVE-VERIFY pack + guard for the touched members at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveGuardMembers: [{member, rc}], rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, violations: { type: 'array' }, outOfScope: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'violations'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, membersFixed: { type: 'array' }, regressionsAdded: { type: 'array' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { guardPerMember: { type: 'array' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['guardPerMember', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveGuardMembers: { type: 'array' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'awsc-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.violations && investigate.violations.length > 0 ? await agent(FIX, { label: 'awsc-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'awsc-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'awsc-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or main no longer violates', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'awsc-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveGuardMembers: [], rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { violationCount: investigate.violations.length, members: investigate.violations.map(v => v.member) }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, membersFixed: fix.membersFixed }, verify: verify && { guardPerMember: verify.guardPerMember, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
