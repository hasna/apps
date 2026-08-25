export const meta = {
  name: 'naming-merge-gap',
  description: "Merge the 37 GO-d naming display-name PRs that the lineage merge phases missed (gap found 2026-08-18); #329/#370 stay open pending owner decisions",
  phases: [
    { title: 'Merge', detail: '4-wide lanes: verify [REVIEW] GO at head, base-movement gate, merge with attribution' },
    { title: 'Report', detail: 'final drain count + holds' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '6d824d44-8047-4121-ace6-dc5bd1cc7819'
const PRS = [368, 367, 366, 361, 360, 358, 357, 356, 355, 353, 351, 350, 347, 343, 342, 341, 337, 336, 333, 332, 330, 323, 322, 317, 314, 313, 311, 310, 308, 306, 305, 304, 303, 300, 297, 291, 289]

const CONST = `
You are a lane of the naming-merge-gap workflow (task ${TASK}). The naming lineage merged 33 of its PRs but a gap was found 2026-08-18: 37 display-name PRs ('Hasna <Name>', open- prefix retired) were reviewed GO by the naming workflow at their heads and never merged. Your job: verify each GO verdict at the CURRENT head, run the base-movement gate, and merge. PRs 329 (router) and 370 (markdown) are EXCLUDED — they stay open pending owner decisions (router 'open-router' alias; markdown OMP spec name); never touch them. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Never push to main. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: naming-merge-gap'>.
- IDEMPOTENCY CHECK FIRST: skip any PR already MERGED (gh pr view --json state).
- VERIFY BEFORE MERGE — each PR must have: (a) a '[REVIEW] GO' PR comment pinned at the CURRENT head sha (grep the PR comments for '[REVIEW] GO' AND the current headRefOid); (b) merge-tree equality at CURRENT origin/main: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE" — EQUAL, or if it differs verify the delta is disjoint from the app's own files (main moved with other apps' changes) and record it; (c) secrets clean (redirect the PR diff to a file + 'secrets scan input' rc 0). If (a) fails — no GO at head — HOLD the PR (comment + report), do not merge.
- No secrets: never print/capture/commit credential values. No internal-infra strings. Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named naming-merge-gap.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). Your PRs: {BATCH} (numbers). For EACH: IDEMPOTENCY CHECK FIRST; VERIFY (a)(b)(c) per CONST; then gh pr merge <n> --squash --body-file <file ending 'Agent: naming-merge-gap'>; record the merged sha. HOLD (no merge) when: no GO at head, merge-tree differs with own-files delta, or secrets finding. Comment the hold reason on the PR.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: merged count + shas, held PRs with reasons, the final open count on hasna/apps (gh pr list --state open --json number | length). Comment on ${TASK}, post to #board. Note #329/#370 remain open pending owner decisions.
Return (JSON): { prs: [{number, state, mergedSha}], held: [string], openCount: number }
`

const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, held: { type: 'array' }, openCount: { type: 'integer' } }, required: ['openCount'] }

const BATCHES = []
for (let i = 0; i < PRS.length; i += 4) BATCHES.push(PRS.slice(i, i + 4))

phase('Merge')
const mergeResults = await parallel(BATCHES.map((b, i) => () =>
  agent(MERGE.replace('{BATCH}', JSON.stringify(b)), { label: `gap-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' }),
))
const merged = mergeResults.filter(Boolean).flatMap(r => r.prs || [])
log(`merged: ${merged.filter(p => p.merged).length} of ${merged.length}`)

phase('Report')
const report = await agent(REPORT, { label: 'gap-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { merges: mergeResults.filter(Boolean), report }
