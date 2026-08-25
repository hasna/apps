export const meta = {
  name: 'stale-pr-drain',
  description: 'Drain the 8 stale open PRs (217/220/234/241/242/248/252/256) from yesterday\'s pr-zero wave: verdict check, base-movement gate, merge or close-with-cause',
  phases: [
    { title: 'Drain', detail: 'per-PR: verdict at head, merge-tree gate, merge on GO; hold/close with recorded cause otherwise' },
    { title: 'Report', detail: 'final drain count + open residue' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '9ef14d65'
const PRS = [217, 220, 234, 241, 242, 248, 252, 256]

const CONST = `
You are a lane of the stale-pr-drain workflow (task ${TASK}, pr-zero lineage). Eight PRs from yesterday's pr-zero wave remain open with no active lane: 217, 220, 234, 241, 242, 248, 252, 256. For each: read its review verdicts and comments, check its current state, and either merge (GO at head + gates) or record the exact hold/close cause (no cause-less closures — every close names the reason: superseded/duplicate/wrong-target/terminated with a successor pointer). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Never push to main. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: stale-drain'>. NEVER close a PR without a comment naming the cause.
- IDEMPOTENCY CHECK FIRST: skip any PR already MERGED.
- VERIFY BEFORE MERGE: (a) a '[REVIEW] GO' comment pinned at the CURRENT head sha, or a recorded verdict on the linked task row; (b) merge-tree equality at CURRENT origin/main (TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" — EQUAL, or the delta is disjoint from the PR's own files); (c) secrets scan on the diff (redirect + 'secrets scan input' rc 0; findings on REMOVED lines only = document and proceed; findings on landing content = HOLD).
- No secrets: never print/capture/commit credential values. No internal-infra strings. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named stale-drain.
`

const DRAIN = CONST + `
ROLE: drain lane (Sonnet). Your PRs: {BATCH} (numbers). For EACH: IDEMPOTENCY CHECK FIRST; VERIFY per CONST; merge on GO. No GO at head / merge-tree own-files delta / secrets finding on landing content: HOLD with a comment naming the exact cause. A PR whose premise is already satisfied on main (the change landed via another PR): close with a comment naming the absorbing PR (done-by-others).
Return (JSON): { prs: [{number, action: 'merged'|'held'|'closed-done-by-others', mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: merged count + shas, held/closed with causes, the open count on hasna/apps after this pass. Comment on ${TASK}, post to #board.
Return (JSON): { prs: [{number, action, mergedSha, reason}], openCount: number }
`

const DRAIN_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, openCount: { type: 'integer' } }, required: ['openCount'] }

const BATCHES = []
for (let i = 0; i < PRS.length; i += 4) BATCHES.push(PRS.slice(i, i + 4))

phase('Drain')
const drainResults = await parallel(BATCHES.map((b, i) => () =>
  agent(DRAIN.replace('{BATCH}', JSON.stringify(b)), { label: `stale-drain-${i + 1}`, phase: 'Drain', schema: DRAIN_SCHEMA, model: 'sonnet' }),
))
const drained = drainResults.filter(Boolean).flatMap(r => r.prs || [])
log(`drain: ${drained.filter(p => p.action === 'merged').length} merged, ${drained.filter(p => p.action !== 'merged').length} held/closed`)

phase('Report')
const report = await agent(REPORT, { label: 'stale-drain-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { drains: drainResults.filter(Boolean), report }
