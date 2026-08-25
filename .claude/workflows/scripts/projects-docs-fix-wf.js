export const meta = {
  name: 'projects-docs-fix',
  description: 'Fix hasna/projects docs drift: README + cloud-storage-readiness-contract document storage push/pull/sync verbs that no longer exist; replace with the API flip docs. PR-first, Fable review, merge.',
  phases: [
    { title: 'Fix', detail: 'docs-only PR: README Storage Sync section + readiness contract' },
    { title: 'Review', detail: 'Fable review of the docs PR' },
    { title: 'Merge', detail: 'merge on GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '189f7bbf-4156-4425-b2bc-1738c03e3193'

const CONST = `
You are a lane of the projects-docs-fix workflow (task ${TASK}). hasna/projects already has cloud sync via the hosted API flip (HASNA_PROJECTS_API_URL + HASNA_PROJECTS_API_KEY; HASNA_PROJECTS_STORAGE_MODE=cloud, with deprecated aliases self_hosted/remote/hybrid mapping to cloud). The README "Storage Sync" section (lines ~291-365) and docs/cloud-storage-readiness-contract.md still document 'projects storage status|push|pull|sync' verbs that DO NOT EXIST in 0.1.132 (measured: zero hits in the 96-line projects --help). Replace the old sync-verbs documentation with the flip model. Final text = machine-readable JSON.

Non-negotiable rules:
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktree ~/.hasna/repos/worktrees/apps/projects-docs-189f7bbf from origin/main. Never push to main. Merge ONLY via gh pr merge --squash --body-file <file whose LAST line is 'Agent: projects-docs-fix'>.
- IDEMPOTENCY CHECK FIRST: if a docs PR for this task already exists (gh pr list --repo hasna/apps --search 'projects docs' --state open), extend/use it, don't duplicate.
- No secrets; no internal-infra strings in artifacts. Staged secrets scan before commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comment on ${TASK}, post to #board. English. Lineage identity 'conversations agents register' named projects-docs-fix.
- Docs-only change: no source code, no behavior, no version bump, no changeset needed. Verifiable: grep the PR diff for the old verbs — zero occurrences outside CHANGELOG (historical records keep their wording).
`

const FIX = CONST + `
ROLE: docs fixer (Sonnet). In the worktree:
1. Rewrite the README "Storage Sync" section (~lines 291-365): document that the client reads/writes the hosted API when HASNA_PROJECTS_API_URL + HASNA_PROJECTS_API_KEY are set (storage mode flip, HASNA_PROJECTS_STORAGE_MODE=cloud or deprecated aliases), the local SQLite registry (~/.hasna/projects/projects.db, HASNA_PROJECTS_DB_PATH) is the fallback, misconfiguration is fail-closed, and the server runs on HASNA_PROJECTS_DATABASE_URL (PostgreSQL) with API-key auth (projects:read/projects:write). Remove the storage status|push|pull|sync verb documentation.
2. Update docs/cloud-storage-readiness-contract.md the same way.
3. Commit (conventional message, 'Agent: projects-docs-fix' trailer LAST line), push, open the PR. Verify: grep the PR diff for 'storage push|storage pull|storage sync|storage status' — zero outside CHANGELOG*.md.
Return (JSON): { pr: {number, headSha, changedFiles: [string]}, oldVerbsRemaining: number }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the docs PR {PR} (number + headSha). Verify: (a) the flip model is documented accurately against the measured client behavior (client.ts resolveTransport: cloud selected by HASNA_PROJECTS_STORAGE_MODE=cloud or joint API_URL+API_KEY presence; fail-closed on misconfiguration); (b) no old storage push|pull|sync verb documentation remains outside CHANGELOG; (c) docs-only (no source change, no version bump); (d) secrets clean. Post the verdict as a PR comment '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: projects docs drift, reviewer projects-docs-review'.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head unchanged (gh pr view --json headRefOid == reviewed sha); merge via gh pr merge --squash --body-file <file ending 'Agent: projects-docs-fix'>; record merged sha.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const FIX_SCHEMA = { type: 'object', properties: { pr: { type: 'object' }, oldVerbsRemaining: { type: 'integer' } }, required: ['pr'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }

phase('Fix')
const fix = await agent(FIX, { label: 'projects-docs-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' })
const pr = (fix && fix.pr) ? { number: fix.pr.number, headSha: fix.pr.headSha } : null

phase('Review')
let review = null
if (pr) review = await agent(REVIEW.replace('{PR}', JSON.stringify(pr)), { label: 'projects-docs-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Merge')
let merge = null
if (review) {
  const go = (review.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'projects-docs-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
}

return { fix, review, merge }
