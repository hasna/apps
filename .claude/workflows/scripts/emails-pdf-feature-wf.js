export const meta = {
  name: 'emails-pdf-feature',
  description: 'Feature build for row 16bb48b6 (task-drain dispatch 2026-08-20): emails CLI — render/save an email (body) to PDF locally. Investigate (design contract: verb surface, render path, PDF library choice, no external services) -> Fix (TDD, PR) -> Verify (CI) -> Fable Review -> Ship (merge, complete row)',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + design contract (local PDF render/save; no external service)' },
    { title: 'Fix', detail: 'failing tests first, implement in worktree, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row 16bb48b6 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '16bb48b6-c8c6-4f04-a9d4-538c1a95da5a'

const CONST = `
You are a lane of the emails-pdf-feature workflow (task-drain dispatch 2026-08-20, row ${ROW}). Mission: add a package-owned emails CLI capability that renders/saves an email (body) to PDF LOCALLY — no external service, no cloud API. The verb follows the existing CLI surface (emails inbox read -> email-to-PDF). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/emails-pdf-<n> from origin/main. NEW BRANCH feat/emails-pdf; PR-first; never push to main. Commits end with 'Agent: emails-pdf-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR or shipped implementation of an email-to-PDF verb (gh pr list --repo hasna/apps --search 'emails pdf in:title,body' and 'pdf in:title,body', and grep the emails CLI surface for a pdf/render verb). If a live implementation or PR exists, verify and record; do NOT duplicate.
- The scope is apps/emails ONLY. The feature lives in the package-owned abstraction (CLI verb + the store/SDK surface it needs), NOT a hand-rolled script. Local rendering only: the PDF is produced on the machine (a bundled pure-JS PDF library is acceptable; no external rendering service, no headless browser unless already a dependency).
- TDD: failing tests first (red), smallest owned implementation (green). Do NOT weaken tests.
- Verify: the emails app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (minor — new feature per pre-1.0 convention).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named emails-pdf-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then produce the DESIGN CONTRACT: read apps/emails — the CLI verb surface (inbox read/list verbs, where a render/pdf verb belongs following the existing naming), the message body representation (html vs text, attachments), and the library landscape (a pure-JS PDF library already in the dependency tree or a minimal addition — measure what is available; no external service). Define: the verb signature and flags (e.g. 'emails inbox pdf <id> [--out <path>]' or a render verb), the body fallback (html -> text), the output contract (PDF file written locally, verifiable header), the test files. Name the files to change and the tests to create. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingVerb: string|null, decision: string }, contract: { verb: string, flags: [string], library: string, bodyHandling: string, outputContract: string, files: [string], testFiles: [string] }, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the design contract ({CONTRACT}): (1) write the failing tests first (the verb renders an email body to a local PDF with a verifiable header; html/text fallback; output path handling — red); (2) implement the smallest owned change in apps/emails (the CLI verb per the contract); (3) full emails suite green (literal counts), frozen install rc=0, secrets scan, changeset (minor), commit ('Agent: emails-pdf-<your-role>'), push, open the PR referencing row ${ROW} and the contract.

RE-ENTRY (resume wf_8a820f02-8ad, run 3, 2026-08-20): REBASE-RE-ENTRY. PR #686 is at d823bd0a1 with 5/5 CI green + [REVIEW] GO on record, but the base-movement gate FAILED: origin/main moved 1400cb8e -> ca7acc86d after the PR last synchronized (merge-tree tree deeecb25 != reviewed head tree f9bd966f, 18 main-side files: apps/conversations, apps/loops, apps/secrets, 2 changesets; NONE of the PR's own 9 files). REBASE feat/emails-pdf onto origin/main ca7acc86d (resolve any conflicts — they are main-side only), push, and return the new head sha. After the rebase <merge-ref>^{tree} == <head>^{tree} must hold.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.

RE-ENTRY (resume wf_8a820f02-8ad, run 3): REBASE-RE-ENTRY — re-verify at the NEW head after the rebase push (previous run had 5/5 green at d823bd0a1; the rebase must not regress any check). acceptanceMet=true only when all five checks are green at the new head (head_sha == the rebased head, confirmed via gh api).
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the verb renders locally per the contract (red-before/green-after measured, verifiable PDF header), (b) no external rendering service, (c) the implementation is the smallest owned change, (d) no test weakening, (e) scope is apps/emails only, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — emails-pdf-feature @ <sha> — lens: local email-to-PDF verb, reviewer emails-pdf-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.

RE-ENTRY (resume wf_8a820f02-8ad, run 3): REBASE-RE-ENTRY — review at the NEW head after the rebase (the rebase was main-side-only; verify the PR's own diff is unchanged and the merge-tree equality holds); post a FRESH verdict at the new head sha. A cached GO from d823bd0a1 does not cover the rebased head.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: emails-pdf-ship'), record the merged sha, complete row ${ROW} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open.

RE-ENTRY (resume wf_8a820f02-8ad, run 3): REBASE-RE-ENTRY ship — the run-2 ship correctly held on the base-movement gate (main moved 1400cb8e -> ca7acc86d after PR #686 last synchronized). Merge only if the rebase pushed a new head, verify reports 5/5 green at THAT head, and review returned a FRESH GO at that head. Base-movement gate: run git merge-tree against CURRENT origin/main — after the rebase <merge-ref>^{tree} == <head>^{tree} must hold. Then squash-merge with --body-file ending 'Agent: emails-pdf-ship', record the merged sha, complete row 16bb48b6 with the evidence.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, contract: { type: 'object' }, evidence: { type: 'string' } }, required: ['idempotency', 'contract'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'emails-pdf-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CONTRACT}', JSON.stringify(investigate.contract)), { label: 'emails-pdf-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'emails-pdf-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'emails-pdf-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'emails-pdf-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
