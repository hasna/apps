export const meta = {
  name: 'trailer-audit-fix',
  description: 'Fix the pre-push trailer audit (hasna-trailer-check.pl --audit): it scans the FULL rewrite range on rebase+force-push, blocking every force-push in internal-apps (21,556 commits / 6,736 pre-existing Co-authored-by trailers measured; #120 closed via delete+push workaround) — scope to the branch\'s own new commits, keep the Cursor-trailer ban fail-closed (task fe72d2f7, HIGH)',
  phases: [
    { title: 'Fix', detail: 'scope the audit range to commits not already on the remote ref' },
    { title: 'Verify', detail: 'two-sided: rebase+force-push with pre-existing trailers PASSES; new Cursor trailer FAILS' },
    { title: 'Propagate', detail: 'byte-identical deploy to station02/03' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task fe72d2f7 + #board' },
  ],
}

const TASK = 'fe72d2f7-dbee-4a0e-9281-8a6cb63e6357'

const CONST = `
You are a lane of the trailer-audit-fix workflow (2026-08-19, task ${TASK}, HIGH). REGRESSION in the no-cursor-coauthor pre-push hook (station01, installed 08-19; propagated from secret-gate-restore wf_12731d2e-504): hasna-trailer-check.pl --audit scans the range remote_sha..local_sha — on a REBASE+FORCE-PUSH that range is the ENTIRE rewritten history. Measured in hasna-internal/internal-apps: 21,556 commits, 6,736 with pre-existing Co-authored-by trailers (main history, incl. one Cursor trailer already on the remote) — the audit REFUSES the push. No sanctioned bypass. CONSEQUENCE (measured 08-19): the #120 fix lane could not force-push; delete+push-fresh CLOSED PR #120 and GitHub hard-refuses reopen (HTTP 422); the fix landed on successor PR #242. Internal-apps PR #161's earlier rebase+land also affected (workaround). Final text = machine-readable JSON.

THE FIX (smallest owned, keep the gate fail-closed):
1. INVESTIGATE: read /home/hasna/.config/hasna/git-hooks/no-cursor-coauthor/hasna-trailer-check.pl — find the --audit range construction and the refusal path. Record the exact lines.
2. FIX the range: the audit must cover ONLY the branch's OWN new commits — commits present in the local ref being pushed but NOT reachable from the remote ref being updated (for a force-push of a rebased branch: the branch's actual new commits; pre-existing main history is excluded). Preserve fail-closed: a genuinely NEW commit carrying a Co-authored-by trailer (the Cursor ban, the hook's purpose) must STILL refuse. Also handle the new-ref case (remote ref absent → all local commits are new) and the delete case (no audit).
3. Back up the changed file as .bak-trailer-audit-fix-<ts>. The hook dir is not a git repo (canonical-source gap 6cf915f7) — edit in place with backup.
4. Do NOT weaken anything else in the hook (the staged-credential scan and its fail-closed contract stay untouched).

VERIFY (two-sided, in a throwaway /tmp fixture, env-scrubbed):
(a) POSITIVE for the fix: a repo where a FORCE-PUSH rewrites commits whose trailers already exist on the remote — push must PASS (rc=0) and the audit must name the new-commit scope.
(b) NEGATIVE: a force-push introducing a NEW commit with a Co-authored-by trailer (synthetic, e.g. 'Co-authored-by: Cursor <noreply@cursor.sh>') — must REFUSE (rc!=0) naming the commit.
(c) Confirm the staged-credential scan still runs first and unchanged (quick arm: commit with synthetic credential still refused).
(d) Bounded: all arms <60s.
Run everything env-scrubbed (env -i PATH=/usr/bin:/bin), synthetic trailers only, capture to files, paste literal output lines.

PROPAGATE: copy the fixed hasna-trailer-check.pl byte-identical (sha256 compare) to station02 (/home/hasna/.config/hasna/git-hooks/no-cursor-coauthor) and station03 (/Users/hasna/.config/hasna/git-hooks/no-cursor-coauthor) via ssh BatchMode, backup each target as .bak-trailer-audit-fix-<ts>.

NO SECRETS: capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named trailer-fix-<your-role>.
`

const FIX = CONST + `
ROLE: fix lane. Execute per the CONST: investigate the --audit range, apply the smallest scoping fix (new-commits-only range; new-ref and delete cases handled), back up. Record the before/after range construction lines.
Return (JSON): { rangeBefore: string, rangeAfter: string, newRefHandled: bool, deleteHandled: bool, backup: string, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Run the two-sided probes per the CONST in a throwaway /tmp fixture: (a) force-push with pre-existing remote trailers PASSES, (b) force-push with a NEW synthetic Cursor trailer REFUSES, (c) staged-credential scan still fail-closed, (d) bounded time. Paste literal output lines per arm.
Return (JSON): { forcePushWithRemoteTrailers: {passed: bool, rc: number, output: string}, newCursorTrailer: {refused: bool, rc: number, output: string}, scanStillFailClosed: bool, allBounded: bool, evidence: string }
`

const PROPAGATE = CONST + `
ROLE: propagate lane. Copy the fixed hasna-trailer-check.pl to station02 + station03 (paths per the CONST), sha256-verify byte-identical to station01, backup each target. Record per machine: pre-sha, post-sha, backup path.
Return (JSON): { machines: [{name, preSha, postSha, backup}], allPropagated: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the range fix covers exactly the new-commit scope (pre-existing remote trailers pass, new Cursor trailers refuse — both measured), (b) new-ref/delete cases handled, (c) the credential scan is untouched and still fail-closed, (d) propagation byte-identical, (e) no secrets, (f) fixtures synthetic. Post '[REVIEW] <GO|NO_GO> — trailer-audit-fix @ <evidence> — lens: pre-push audit range scoping, reviewer trailer-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO: comment ${TASK} completed with the range fix, two-sided verify, propagation shas; complete the task; post to #board. If NO_GO: comment findings, leave in_progress.
Return (JSON): { taskState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { rangeBefore: { type: 'string' }, rangeAfter: { type: 'string' }, newRefHandled: { type: 'boolean' }, deleteHandled: { type: 'boolean' }, backup: { type: 'string' }, evidence: { type: 'string' } }, required: ['rangeAfter', 'newRefHandled', 'deleteHandled'] }
const VERIFY_SCHEMA = { type: 'object', properties: { forcePushWithRemoteTrailers: { type: 'object' }, newCursorTrailer: { type: 'object' }, scanStillFailClosed: { type: 'boolean' }, allBounded: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['forcePushWithRemoteTrailers', 'newCursorTrailer', 'scanStillFailClosed'] }
const PROP_SCHEMA = { type: 'object', properties: { machines: { type: 'array' }, allPropagated: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['allPropagated'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'trailer-fix-lane', phase: 'Fix', schema: FIX_SCHEMA })
log(`fix: rangeAfter=${fix && fix.rangeAfter ? fix.rangeAfter.slice(0, 80) : '?'}`)

phase('Verify')
let verify = null
if (fix && fix.rangeAfter) {
  verify = await agent(VERIFY, { label: 'trailer-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { forcePushWithRemoteTrailers: { passed: false }, newCursorTrailer: { refused: false }, scanStillFailClosed: false, evidence: 'fix did not land — verify skipped' }
}

phase('Propagate')
let prop = null
if (verify && verify.forcePushWithRemoteTrailers && verify.forcePushWithRemoteTrailers.passed && verify.newCursorTrailer && verify.newCursorTrailer.refused) {
  prop = await agent(PROPAGATE, { label: 'trailer-fix-propagate', phase: 'Propagate', schema: PROP_SCHEMA })
} else {
  prop = { machines: [], allPropagated: false, evidence: 'verify did not discriminate — propagation skipped' }
}

phase('Review')
let review = null
if (prop && prop.allPropagated) {
  review = await agent(REVIEW, { label: 'trailer-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix/verify/propagation did not complete', detail: JSON.stringify({ fix, verify, prop }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'trailer-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, propagate: prop, review, report }
