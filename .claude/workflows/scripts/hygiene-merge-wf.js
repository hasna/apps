export const meta = {
  name: 'hygiene-s2-merge',
  description: 'Merge continuation for the hygiene-successor PR hasna/apps#644 (row 529e2ee5): cycle-2 FINAL remediation landed at 4abc417bf (tests-only; ref-cache-l2 contract-based, computer suites fixed; 1148 pass/0 fail locally; both named conditions green) but CI was UNMEASURABLE — a GitHub Actions event drop specific to this PR (4 trigger attempts, zero runs; positive control: 5 runs for other branches in the same window). This lane: rebase #644 onto latest origin/main (re-push triggers CI), require ALL FIVE checks green at the new head (if the event drop persists, record it as the owning repair with evidence), Fable re-review, base gate, merge, complete 529e2ee5',
  phases: [
    { title: 'Rebase', detail: 'rebase hygiene-successor onto latest origin/main (CI trigger by push)' },
    { title: 'Verify', detail: 'CI 5/5 at the new head (event drop recorded as owning repair if persistent)' },
    { title: 'Review', detail: 'Fable re-review (successor final-cycle content)' },
    { title: 'Ship', detail: 'base gate, merge, complete 529e2ee5' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 644
const ROW = '529e2ee5-5d14-47e8-a994-14702fedb528'

const CONST = `
You are a lane of the hygiene-s2-merge workflow (2026-08-20) — the merge continuation for PR hasna/apps#${PR} (hygiene-successor, row ${ROW}). The successor's cycle-2 FINAL remediation landed at head 4abc417bf (tests-only, 3 files: ref-cache-l2 rewritten contract-based; computer suites fixed — 249 pass/0 fail/0 errors; combined 1148 pass/0 fail locally; both named resume conditions green; billing prepack rc=0). CI was UNMEASURABLE at that head: a GitHub Actions event drop specific to this PR — 4 trigger attempts (two pushes, two close/reopens) produced ZERO runs while 5 runs for other branches flowed in the same window (positive control clean; ci.yml shape unchanged; workflow active). The candidate content is verified locally with two-sided evidence; the missing gate is CI infrastructure. THIS LANE: rebase onto the LATEST origin/main (the push triggers CI), require ALL FIVE checks green at the new head, Fable re-review, base gate, merge, complete ${ROW}. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/hygiene-s2m-<n>; work on the PR's OWN branch (hygiene-successor — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: hygiene-s2m-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the merge already landed (state MERGED) or a rebase moved the head past 4abc417bf, verify and record; do not duplicate.
- REBASE ONLY: rebase onto the LATEST origin/main. The cycle-2 remediation (the 3 test files) must be byte-identical after the rebase; name any merge resolution and why. No scope creep; tests-only stays tests-only.
- CI TRIGGER: the push after the rebase is the trigger. If GitHub Actions STILL drops the event at the new head (poll runs?head_sha ~20 min, positive control), record it as the owning repair (hasna/actions or GitHub-side incident) with the evidence and set the resume condition — do NOT loop re-pushing.
- Verify: affected suites green at the new head (record counts: browser ref-cache-l2, computer, evals redaction, access secret-boundary, crawl webhooks+crawler), billing prepack exit 0, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named hygiene-s2m-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase onto the LATEST origin/main, prove the remediation intact (git diff 4abc417bf <new-head> -- apps/browser/src/lib/ref-cache-l2.test.ts apps/computer/test/ shows NO content change — or name what changed and why), affected suites green (record counts), billing prepack exit 0, frozen install rc=0, secrets scan, commit ('Agent: hygiene-s2m-<your-role>'), push --force-with-lease (the CI trigger).
Return (JSON): { newHead: string, diffSummary: string, remediationIntact: bool, suiteCounts: {passed, failed}, prepackOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}' and 'gh api repos/hasna/apps/actions/runs?head_sha=<new head>' (bounded, ~20 min). If a run exists: poll to terminal, require ALL FIVE checks green (record the per-check table; the known environmental playwright stall, if the ONLY failure, re-run once). If NO run exists after the bounded poll: record the event drop as the owning repair with the positive-control evidence, acceptanceMet=false with the exact resume condition — do NOT loop.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, eventDrop: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — the successor's final-cycle content at the new head. Review: (a) the candidate is tests-only and the remediation intact through the rebase, (b) both named resume conditions green (ref-cache-l2 contract-based two-branch; computer suites 249/0), (c) 5/5 CI green at the new head (or the event-drop record with its owning-repair evidence), (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — hygiene-s2m @ <sha> — lens: successor final-cycle content, reviewer hygiene-s2m-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: hygiene-s2m-ship'), record the merged sha, complete row ${ROW} with the evidence. If the event drop persisted: comment the owning-repair record + resume condition, leave in_progress. If NO_GO: comment findings + resume condition, leave in_progress — the lineage stops as an engineering blocker; record that.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, remediationIntact: { type: 'boolean' }, suiteCounts: { type: 'object' }, prepackOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, eventDrop: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'hygiene-s2m-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'hygiene-s2m-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'hygiene-s2m-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'hygiene-s2m-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
