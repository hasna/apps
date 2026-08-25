export const meta = {
  name: 'conversations-channel-merge',
  description: 'Feature build for the Conversations channel merge operation (row 6df777e6, task-drain dispatch 2026-08-20): a package-owned atomic merge of messages/memberships/subscriptions/pins/threads/read-state/project-linkage/audit provenance from a source channel into a destination channel, then archive/alias the source without losing stable message IDs. Phases: Investigate (plan-first contract) -> Fix (TDD, PR) -> Verify (CI) -> Fable Review -> Ship (merge, complete row)',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + design contract (plan-first; reject ambiguous or active-write collisions)' },
    { title: 'Fix', detail: 'failing tests first, implement in worktree, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row 6df777e6 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '6df777e6-5136-4f1b-889b-3c73d68e4fef'

const CONST = `
You are a lane of the conversations-channel-merge workflow (task-drain dispatch 2026-08-20, row ${ROW}). Mission: implement the package-owned Conversations channel merge operation in the hasna/apps monorepo: an ATOMIC operation that moves messages, memberships, subscriptions, pins, threads/replies, read state, project linkage, and audit provenance from a source channel into a destination channel, then archives or aliases the source WITHOUT losing stable message IDs. The operation must PLAN FIRST (dry-run/plan mode), reject ambiguous or active-write collisions, and produce an idempotent receipt. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/channel-merge-<n> from origin/main. NEW BRANCH feat/channel-merge; PR-first; never push to main. Commits end with 'Agent: channel-merge-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR or shipped implementation of a channel-merge verb (gh pr list --repo hasna/apps --search 'channel merge in:title,body', and grep the conversations app's CLI surface for a merge/move verb — 'conversations --help' surfaces, src/ verbs). If a live implementation or PR exists, verify and record; do NOT duplicate.
- The scope is apps/conversations ONLY (the package-owned CLI/SDK surface). No other app. The merge operation must live in the package-owned abstraction (CLI verb + SDK), not a hand-rolled script.
- TDD: failing tests first (red), smallest owned implementation (green). Do NOT weaken tests.
- Verify: the conversations app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (minor — new feature per pre-1.0 convention).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named channel-merge-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then produce the DESIGN CONTRACT: read apps/conversations — the store/schema layer (channel, message, membership, subscription, pin, thread/reply, read-state, project-linkage, audit tables or equivalents), the CLI verb surface (where a merge verb belongs, following the existing verb naming), the SDK export surface (./sdk), and the plan-first precedent if one exists. Define: the merge verb signature and flags (--source, --destination, --dry-run, --archive-source), the collision rules (reject ambiguous destination state, active-write contention — the advisory-lock pattern), the stable-ID preservation rule (message IDs must not change; source archived/aliased not deleted), the audit provenance record, and the receipt shape. Name the files to change and the test files to create.
Return (JSON): { idempotency: { existingPr: string|null, existingVerb: string|null, decision: string }, contract: { verb: string, flags: [string], collisionRules: [string], idStability: string, archiveBehavior: string, files: [string], testFiles: [string] }, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the design contract ({CONTRACT}): (1) write the failing tests first (the merge contract: atomicity, stable message IDs, collision rejection, dry-run plan mode, archive-not-delete, audit receipt) — red; (2) implement the smallest owned change in apps/conversations (the CLI verb + SDK surface per the contract); (3) full conversations suite green (literal counts), frozen install rc=0, secrets scan, changeset (minor), commit ('Agent: channel-merge-<your-role>'), push, open the PR referencing row ${ROW} and the contract.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the merge contract is implemented as designed (atomicity, stable IDs, collision rejection, plan-first, archive-not-delete, audit receipt), (b) TDD red-before/green-after measured, (c) no test weakening, (d) scope is apps/conversations only, (e) 5/5 CI green, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — conversations-channel-merge @ <sha> — lens: channel merge feature, reviewer channel-merge-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: channel-merge-ship'), record the merged sha, complete row ${ROW} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, contract: { type: 'object' }, evidence: { type: 'string' } }, required: ['idempotency', 'contract'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'channel-merge-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CONTRACT}', JSON.stringify(investigate.contract)), { label: 'channel-merge-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'channel-merge-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'channel-merge-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'channel-merge-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
