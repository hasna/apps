export const meta = {
  name: 'task-drain-batch5',
  description: 'Task-drain batch 5 (2026-08-19): three unowned rows — (1) eca5b6da NOTES-FIX 2 cloud-only (macOS Swift bridge -> hosted HTTP store), (2) 5a859b24+5196a7e2 accounts storage-mode env hard-crash (one deduped lane), (3) b4652d93 station02 missing authenticated claude profile for fable consults. Per-lane TDD, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'three lanes: notes cloud-only bridge; accounts crash; station02 claude profile' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Report', detail: 'merge GO PRs, complete rows by evidence, #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the task-drain-batch5 workflow (2026-08-19, owner-authorized every-10-min task drain in ${MONOREPO}). Three unowned rows are done here, one lane each, PR-first. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain5-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: drain5-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check the row's comments + open PRs touching the surface; if a fix already landed or is being worked, verify and record — do not duplicate. The accounts-internal-move workflow (bdb1c431) is relocating the accounts app — compose with it (work in the CURRENT tree; if the app moves mid-lane, follow the move and record).
- TDD FIRST where testable: the failing regression before the fix (red proven), then the smallest owned repair. No band-aids.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the rows + PRs, posts to #board, mementos. English. Lineage 'conversations agents register' named drain5-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const LANE_NOTES = CONST + `
ROLE: fix lane for row eca5b6da (NOTES-FIX 2: cloud-only storage — the macOS app notes must live in the hosted path). The TS side already landed the hosted store (PR 287: client/transport.mjs HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY fail-closed, client/http-store.mjs, server/pg-migrations.ts); the macOS Swift bridge (Sources/HasnaNotesApp/main.swift NotesBridge ~L321-546) still reads/writes ONLY the on-disk MarkdownStore (~/.hasna/notes/notes/*.md). OWED: route the macOS app host through the hosted HTTP store — resolve the API URL + key (fail closed — URL without key must not fall back to local), replace MarkdownStore load/save/archive/trash/restore/delete/settings/labels with HTTP-store calls, remove the local-files source-of-truth path; no cross-machine/local sync. TDD the transport resolution + a store verb against a stub. Suite green, secrets scan, commit ('Agent: drain5-<your-role>'), push, PR referencing eca5b6da.
Return (JSON): { prNumber: number|null, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const LANE_ACCOUNTS_CRASH = CONST + `
ROLE: fix lane for rows 5a859b24 + 5196a7e2 (BUG: @hasna/accounts — HASNA_ACCOUNTS_STORAGE_MODE=cloud env hard-crashes EVERY CLI call; both rows are the same defect — one lane, one PR referencing both). OWED: reproduce the crash (red proven — record the literal), find the crash site (the storage-mode env path — per the no-modes doctrine the retired env must be handled: either rejected with a clear message or ignored; a hard crash on ANY CLI call is the defect), smallest owned fix, TDD regression, accounts suite green, secrets scan, commit ('Agent: drain5-<your-role>'), push, PR referencing both rows.
Return (JSON): { prNumber: number|null, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const LANE_PROFILE = CONST + `
ROLE: fix lane for row b4652d93 (BUG: @hasna/accounts — no authenticated claude profile on station02 for claude-fable-5 headless consults, blocks ask-fable). OWED: on station02, enumerate the claude profiles (accounts list --tool claude), find which are authenticated + healthy (usage health, not revoked), pick one eligible for claude-fable-5 consults, switch/auth it, and PROVE a headless fable consult works from station02 (record the literal). If auth cannot be completed from here (interactive OAuth), record the exact missing step + resume condition. Per the multiple-profiles rule: record the fix on the profile description (usable + why). PR only if a code/config change is owed (e.g. a default-selection bug); otherwise record and complete the row by evidence.
Return (JSON): { prNumber: number|null, diffSummary: string, profileFixed: bool, consultProof: string, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PRs ({PRS}): (a) each regression FAILED before the fix (red proven), (b) smallest owned repair, (c) suites green or failures recorded with owners, (d) secrets clean, (e) PR-first, (f) the accounts crash fix honors the no-modes doctrine (no crash, clear handling), (g) the notes lane removed the local source-of-truth path (no silent local fallback). Post '[REVIEW] <GO|NO_GO> — drain5 <item> @ <sha> — lens: task-drain batch 5, reviewer drain5-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: drain5-ship'), complete the rows with the fix + merged sha. NO_GO: comment findings + resume condition, leave in_progress. The profile lane completes by evidence even without a PR. Post one #board line per outcome.
Return (JSON): { rows: [{rowId, prNumber, verdict, merged, mergedSha, rowState}], residue: [string] }
`

const LANE_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, profileFixed: { type: 'boolean' }, consultProof: { type: 'string' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['rows'] }

phase('Fix')
const [lNotes, lCrash, lProfile] = await parallel([
  () => agent(LANE_NOTES, { label: 'drain5-notes', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_ACCOUNTS_CRASH, { label: 'drain5-accounts-crash', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_PROFILE, { label: 'drain5-profile', phase: 'Fix', schema: LANE_SCHEMA }),
])
const prs = [lNotes, lCrash, lProfile].filter(Boolean).map(l => ({ number: l.prNumber, diff: l.diffSummary })).filter(p => p.number)
log(`fix lanes: ${prs.map(p => '#' + p.prNumber).join(', ') || 'none opened'}`)

phase('Review')
let review = null
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'drain5-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'drain5-report', phase: 'Report', schema: REPORT_SCHEMA })

return { notes: lNotes, crash: lCrash, profile: lProfile, review, report }
