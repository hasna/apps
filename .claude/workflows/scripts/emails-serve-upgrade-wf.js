export const meta = {
  name: 'emails-serve-upgrade',
  description: 'Owner ask (2026-08-19): make sure hasna/emails has the priority inbox. CLI side done (1.3.16 installed, priority folder present, verified in tarball). Measured gap: the hosted emails-serve ignores the /v1/messages ?folder= filter ("predates server-side folder listing — upgrade the emails-serve deployment"), so `emails inbox list --folder priority` fails after 10000 rows. This lane: investigate the serve deployment surface, upgrade emails-serve to the current monorepo main build, LIVE-VERIFY the priority folder returns rows, record the rollback path',
  phases: [
    { title: 'Investigate', detail: 'how emails-serve is built + deployed (Dockerfile/ECS/task def/CI deploy); current deployed version vs main' },
    { title: 'Deploy', detail: 'build current serve, deploy to the hosted service, record the exact deploy verb + output' },
    { title: 'Verify', detail: 'LIVE: emails inbox list --folder priority returns rows; unread/starred regression; rollback path recorded' },
    { title: 'Report', detail: 'record evidence, #board, owner note' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the emails-serve-upgrade workflow (2026-08-19, owner ask: priority inbox for hasna/emails). The CLI side is done (1.3.16 installed on station01; the priority folder is present in the CLI — 'CLI_MAILBOXES = ["inbox","priority",...]' verified in the published tarball). The measured gap: the hosted emails-serve (emails.hasna.xyz /v1) ignores the GET /v1/messages ?folder= filter — the CLI reports: "This server ignored the GET /v1/messages ?folder= filter (it predates server-side folder listing) — upgrade the emails-serve deployment", so 'emails inbox list --folder priority' scanned 10000 rows over 200 requests without completing (rc=1). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). If a file mutation is owed (e.g. a deploy manifest fix), it happens in a task worktree ~/.hasna/repos/worktrees/apps/emailsrv-<n> from origin/main, PR-first, commits end 'Agent: emailsrv-<your-role>'.
- IDEMPOTENCY CHECK FIRST: check for an in-flight emails-serve deploy or a deploy PR (gh pr list --search "emails-serve|emails serve deploy"); the T12 hosted-instance lane (row eacf9f19) may own part of this surface — if it does, record the overlap and do NOT duplicate; verify the server state (does ?folder= work now?) before deploying.
- THE DEPLOY: build the current emails-serve from main, deploy to the hosted service through the repo's OWN deploy machinery (apps/emails/deploy/ — Dockerfile, ECS task def, CI workflow, or the documented deploy script — never hand-roll a parallel deploy path). Record the exact deploy verb + literal output. If the deploy needs credentials, consume them via 'secrets exec <key> --as VAR -- <cmd>' (name the consumer's config surface) — never print/capture values.
- VERIFY (live): 'emails inbox list --folder priority --limit 5 --json' returns rows (literal); '--folder unread' and '--folder inbox' still work (regression); record the rollback path (prior task-def/image + the exact restore command).
- No secrets: never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: posts to #board, a memento on the deploy surface. English. Lineage 'conversations agents register' named emailsrv-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane. Per the CONST: find the emails-serve deploy machinery (build + deploy path, current deployed version/task-def vs main), and state whether an in-flight deploy lane exists (T12 overlap). Return the deploy plan with exact commands.
Return (JSON): { plan: {buildCmd, deployCmd, target, rollback}, deployedVersion: string, mainVersion: string, overlap: string|null, evidence: string }
`

const DEPLOY = CONST + `
ROLE: deploy lane. Per the CONST + the plan ({PLAN}): build the current emails-serve from main, deploy through the repo's own machinery (record the exact verb + literal output, incl. the new task-def/image id). If a file mutation is owed for the deploy, do it PR-first. Do NOT publish any npm package.
Return (JSON): { buildOk: bool, deployOk: bool, deployedImage: string, diffSummary: string|null, prNumber: number|null, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: LIVE probes against the hosted service after the deploy — priority folder returns rows (literal), unread + inbox still work (regression, literal), the folder-filter server behavior is now honored (the CLI no longer reports the ignored-filter error), rollback path recorded. If the deploy did not complete, record the exact gate + resume condition.
Return (JSON): { priorityOk: bool, regressionOk: bool, ignoredFilterGone: bool, rollbackPath: string, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REPORT = CONST + `
ROLE: report. Per the CONST: post the outcome to #board (one line), complete the task by evidence, state for the owner what the priority inbox now does and what it needs (server-side priority classification rules, if any, are a separate follow-up).
Return (JSON): { boardPosted: bool, summary: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { plan: { type: 'object' }, deployedVersion: { type: 'string' }, mainVersion: { type: 'string' }, overlap: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['plan'] }
const DEPLOY_SCHEMA = { type: 'object', properties: { buildOk: { type: 'boolean' }, deployOk: { type: 'boolean' }, deployedImage: { type: 'string' }, diffSummary: { type: ['string', 'null'] }, prNumber: { type: ['number', 'null'] }, evidence: { type: 'string' } }, required: ['buildOk', 'deployOk'] }
const VERIFY_SCHEMA = { type: 'object', properties: { priorityOk: { type: 'boolean' }, regressionOk: { type: 'boolean' }, ignoredFilterGone: { type: 'boolean' }, rollbackPath: { type: 'string' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REPORT_SCHEMA = { type: 'object', properties: { boardPosted: { type: 'boolean' }, summary: { type: 'string' }, residue: { type: 'array' } }, required: ['summary'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'emailsrv-investigate', phase: 'Investigate', schema: INV_SCHEMA })

phase('Deploy')
let deploy = null
if (investigate && investigate.plan) {
  deploy = await agent(DEPLOY.replace('{PLAN}', JSON.stringify(investigate.plan)), { label: 'emailsrv-deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA })
} else {
  deploy = { buildOk: false, deployOk: false }
}

phase('Verify')
let verify = null
if (deploy && deploy.deployOk) {
  verify = await agent(VERIFY, { label: 'emailsrv-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'deploy did not complete: ' + JSON.stringify({ investigate, deploy }) }
}

phase('Report')
const report = await agent(REPORT, { label: 'emailsrv-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, deploy, verify, report }
