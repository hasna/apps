export const meta = {
  name: 'simland-followups',
  description: 'Post-land follow-ups for the unified session-inject-monitor (land merged 760bac1, hydrated): (1) bc04c622 — one-line A3 EXIT-trap fix (restore_cursors || true; rm -rf LOCKDIR in one trap; P2 from the land review, measured leak 1 /tmp/sim-gate.* per invocation); (2) 38044860 — mirror the unified skill into hasna/apps canonical skills corpus (apps/skills/skills/session-inject-monitor); (3) b90fd37b — re-run fleet-resources operator sync/hydrate so sync-manifest.json + hydration manifests carry session-inject-monitor. PR-first, Fable review, merge, complete the three rows',
  phases: [
    { title: 'Fix', detail: 'three lanes: trap fix; apps-corpus mirror; operator-sync re-run' },
    { title: 'Verify', detail: 'per-PR CI + the trap fix two-sided probe (no leak, cleanup still runs)' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Ship', detail: 'merge GO PRs, complete rows, #board' },
  ],
}

const FR = '/home/hasna/workspace/repos/hasna-internal/fleet-resources'
const APPS = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the simland-followups workflow (2026-08-19, task-drain dispatch). The unified session-inject-monitor landed (fleet-resources PR #16 3d3a88b + A3 PR #17 merged 760bac1, hydrated on both stations). Three post-land rows are done here. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- Repos are READ/context only. Sync first (git -C <repo> pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/<repo>/simfollow-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: simfollow-<your-role>' (the ONLY attribution line). NOTE: the @hasna/repos CLI is bricked on station01 (FK-verification crash, tracked 2fe6eb05/a17dc669, wave = live lane) — use git worktree directly per the worktree rule when the CLI verb fails, and record it.
- IDEMPOTENCY CHECK FIRST: check each row's comments + open PRs — if the follow-up already landed, verify and record; do not duplicate.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the rows, posts to #board. English. Lineage 'conversations agents register' named simfollow-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const LANE_TRAP = CONST + `
ROLE: fix lane for row bc04c622 (P2 from the land review, measured: pre-A3 gate leaks 0 /tmp/sim-gate.* dirs, A3 gate leaks exactly 1 per invocation — contents bounded non-secret: cursor.snapshot, manifest.json, summary.txt, inject.out/err, reader-*.out/err; accumulates unbounded at monitor firing rates). OWED in ${FR} resources/station01 + resources/station02 skill trees (per-station duplication): the A3 change added 'trap 'restore_cursors || true' EXIT' which REPLACED the gate's earlier 'trap 'rm -rf "$LOCKDIR"' EXIT' (same signal, second registration wins). Fix is one line — combine both in a single trap: 'trap 'restore_cursors || true; rm -rf "$LOCKDIR"' EXIT'. TDD: the harness proves the A3 contract still holds (fixture1 restores, control advances) AND the LOCKDIR cleanup still runs (no leaked dir after an invocation; the regression harness may assert the leak). Per-station parity (diff -r station01 vs station02). Secrets scan, commit ('Agent: simfollow-<your-role>'), push, PR referencing bc04c622.
Return (JSON): { prNumber: number, diffSummary: string, a3StillHolds: string, noLeak: string, parityOk: bool, secretsClean: bool, evidence: string }
`

const LANE_CORPUS = CONST + `
ROLE: fix lane for row 38044860: mirror the unified session-inject-monitor into ${APPS} canonical skills corpus (apps/skills/skills/session-inject-monitor). OWED: the canonical corpus gets the same portable set (SKILL.md + scripts/ + references/, NO .hasna-skills.json) from the merged fleet-resources state (760bac1 trees — station01 and station02 sets are byte-identical), registered per the apps/skills corpus conventions (check the corpus's own README/registry for how members are registered — follow the existing member pattern; do NOT invent a parallel registration). Suite/checks green (the corpus's check verb), secrets scan, commit ('Agent: simfollow-<your-role>'), push, PR referencing 38044860.
Return (JSON): { prNumber: number, diffSummary: string, corpusCheck: string, secretsClean: bool, evidence: string }
`

const LANE_SYNC = CONST + `
ROLE: fix lane for row b90fd37b: re-run the fleet-resources operator sync/hydrate so sync-manifest.json and the hydration manifests carry session-inject-monitor. OWED: find the operator sync verb/script the repo ships (the repo is a snapshot/mirror; operator-run hydrate — the sync machinery that maintains sync-manifest.json + hydration manifests), run it, verify session-inject-monitor now appears in both manifests (literal), commit the manifest updates ('Agent: simfollow-<your-role>'), push, PR referencing b90fd37b. If the sync is an out-of-repo operator step, record the verb + its output as the evidence and complete the row without a PR.
Return (JSON): { prNumber: number|null, diffSummary: string, manifestCarries: string, syncOutput: string, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI per PR ({PRS}) — 'gh pr checks', re-run failed jobs, poll bounded (max 15 min each), green at the new heads (record per-check tables; fleet-resources has NO CI — complete enumeration, record). The trap-fix PR's two-sided probes must be re-run at the new head (A3 contract + no leak).
Return (JSON): { prs: [{number, checks: [{name, status, conclusion}], green: bool, acceptanceMet: bool, resumeCondition: string|null}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PRs ({PRS}): (a) trap fix is the one-line combine (A3 contract holds + no leak, two-sided probes), (b) corpus mirror follows the existing member pattern (no parallel registration), (c) sync manifests carry session-inject-monitor, (d) suites green, secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — simfollow <PR> @ <sha> — lens: session-inject follow-ups, reviewer simfollow-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max per PR.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: simfollow-ship'), complete its row with the evidence. NO_GO: comment findings + resume condition, leave in_progress. Post one #board line per outcome.
Return (JSON): { rows: [{rowId, prNumber, verdict, merged, mergedSha, rowState}], residue: [string] }
`

const LANE_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, a3StillHolds: { type: 'string' }, noLeak: { type: 'string' }, parityOk: { type: 'boolean' }, corpusCheck: { type: 'string' }, manifestCarries: { type: 'string' }, syncOutput: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['rows'] }

phase('Fix')
const [lTrap, lCorpus, lSync] = await parallel([
  () => agent(LANE_TRAP, { label: 'simfollow-trap', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_CORPUS, { label: 'simfollow-corpus', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_SYNC, { label: 'simfollow-sync', phase: 'Fix', schema: LANE_SCHEMA }),
])
const prs = [lTrap, lCorpus, lSync].filter(Boolean).map(l => ({ number: l.prNumber, diff: l.diffSummary })).filter(p => p.number)
log(`fix lanes: ${prs.map(p => '#' + p.prNumber).join(', ') || 'none opened'}`)

phase('Verify')
let verify = null
if (prs.length) {
  verify = await agent(VERIFY.replace('{PRS}', JSON.stringify(prs.map(p => p.number))), { label: 'simfollow-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { prs: [] }
}

phase('Review')
let review = null
if (verify && verify.prs && verify.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(verify.prs)), { label: 'simfollow-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'simfollow-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { trap: lTrap, corpus: lCorpus, sync: lSync, verify, review, ship }
