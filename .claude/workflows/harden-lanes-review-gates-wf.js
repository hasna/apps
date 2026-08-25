export const meta = {
  name: 'harden-lanes-review-gates',
  description: 'Temporary hardening lane (owner-directed 2026-08-25, not durable): update every publish/deploy-capable workflow in this local .claude/workflows store so the release and deploy steps carry TWO independent adversarial agent gates that live-verify the published package (every command, run live, non-destructive) and the deployed service (every route, live, non-destructive) — both gates must return GO before the lane may confirm. Strengthens the graphs of the durable lanes.',
  phases: [
    { title: 'Census', detail: 'enumerate .claude/workflows lanes, classify publish-capable / deploy-capable / already-gated / not-applicable' },
    { title: 'Update', detail: 'insert the 2-agent live gates into each publish/deploy-capable lane (parallel editors, <=4 per step)' },
    { title: 'Verify', detail: 'node --check each edited lane, confirm both gate agents + both-GO requirement present, repo gates rc=0' },
    { title: 'Report', detail: 'per-lane table to #apps + mementos' },
  ],
}

const REPO = '/home/hasna/.hasna/repos/clones/hasna/apps'
const WORKFLOWS = REPO + '/.claude/workflows'
const SCRIPTS = WORKFLOWS + '/scripts'
const APPS_PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const CHANNEL = 'apps'

const CONST = `
You are a phase of the harden-lanes-review-gates workflow (owner-directed 2026-08-25, temporary). Mission: every publish/deploy-capable workflow in the local store (${WORKFLOWS} and ${SCRIPTS}) gains TWO independent adversarial agent gates: (a) PUBLISH GATE — 2 agents live-verify the PUBLISHED package, running EVERY command of it live (every bin, every non-destructive verb — actual commands, actual outputs, per-command GO/NO_GO with evidence; NEVER by writing test scripts; NON-DESTRUCTIVE only — read/validate/help/version/dry-run forms, never mutations); (b) DEPLOY GATE — the same 2-agent shape live-verifies the DEPLOYED service (every route: /health /ready /version 200 + identity + version match, one business read) non-destructively. BOTH gates must return GO before the lane may post its confirm; any NO_GO -> the lane records release/deploy as UNVERIFIED, files a todos task with the evidence, and never confirms. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The store files are the target; edit them in place (owner-directed temporary hardening of this local store). Never touch anything outside ${WORKFLOWS}.
- No secrets: never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Gates before any commit: staged secrets scan rc=0 with real bytes; bun tooling/ci/check-secrets.ts --base origin/main rc=0.
- Record as you go: comments on the todos row, posts to #${CHANNEL}. English. Distinguish measured vs inferred; state what you did not check.
- NEVER run bash -x / set -x (trace mode) — the shell profile sources ~/.hasna/cloud/*.env and trace echoes credential lines into the transcript.
- The inserted gates go BEFORE the lane's confirm step: after publish's two-sided verify, before [PUBLISH-CONFIRM]; after deploy's live test, before [DEPLOY-CONFIRM]. The gate is 2 agents in parallel (parallel([...2 agents...])), each returning {verdict: GO|NO_GO, perCommand: [{command, verdict, evidence}], failures}; the lane proceeds only when BOTH verdicts are GO.
`

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lanes'],
  properties: {
    lanes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'class'],
        properties: {
          file: { type: 'string' },
          class: { enum: ['publish', 'deploy', 'both', 'already-gated', 'not-applicable'] },
          reason: { type: 'string' },
          packageNames: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
const UPDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['file', 'updated', 'gates'],
  properties: {
    file: { type: 'string' },
    updated: { type: 'boolean' },
    gates: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['files', 'allClean'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'syntaxOk', 'gatesPresent', 'bothGoRequired'],
        properties: {
          file: { type: 'string' },
          syntaxOk: { type: 'boolean' },
          gatesPresent: { type: 'boolean' },
          bothGoRequired: { type: 'boolean' },
        },
      },
    },
    allClean: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

phase('Census')
const census = await agent(`${CONST}
ROLE: census (Opus). Enumerate every *.js workflow in ${WORKFLOWS} (flat) and ${SCRIPTS} (scripts/). For EACH file classify:
- publish — the lane publishes a package (contains 'npm publish' or 'PUBLISH INTENT' or the npmrc pairing form); record packageNames.
- deploy — the lane deploys a service (contains 'oss-fleet-prod' or 'update-service' or 'DEPLOY INTENT'); record packageNames (the deployed package(s)).
- both — publish AND deploy in one lane.
- already-gated — already contains an independent live-verification gate with GO/NO_GO agents (e.g. build-and-ship-workflows-app-wf.js has a 4-agent panel).
- not-applicable — a pure drain/review lane with no publish or deploy step (pr-drain, task-drain, fix-lane, stale-*), or a non-lane file (README, plan md).
Read each file's meta.description + grep for the markers (redirect to files, never pipe). Return {lanes}.`, { label: 'census-gates', phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' })
if (!census || !census.lanes) return { status: 'census-failed', lanes: [] }
const targets = census.lanes.filter(l => l.class === 'publish' || l.class === 'deploy' || l.class === 'both')
log('census: ' + census.lanes.length + ' lanes, ' + targets.length + ' need gates')

phase('Update')
const updates = []
for (let i = 0; i < targets.length; i += 4) {
  const batch = targets.slice(i, i + 4)
  const results = await parallel(batch.map((t) => () =>
    agent(`${CONST}
ROLE: update lane ${t.file} (class ${t.class}). Insert the review gates into ${t.file} IN PLACE (owner-directed temporary hardening of the local store).
PUBLISH GATE (if the lane publishes, class publish/both): after the publish step's two-sided verify and BEFORE the [PUBLISH-CONFIRM] post, insert:
  const publishGates = await parallel([
    () => agent(\`LIVE GATE 1 OF 2 (publish): you verify the PUBLISHED package @hasna/<pkg>@<v> by RUNNING its commands live — every bin, every non-destructive verb (--version, --help, validate, read, list, dry-run forms) — actual commands, actual outputs, per-command {command, verdict: GO|NO_GO, evidence}. NEVER write test scripts; run the real commands. NON-DESTRUCTIVE only. Return {verdict, perCommand, failures}.\`, { label: 'publish-gate-1', schema: { type: 'object', additionalProperties: false, required: ['verdict', 'perCommand'], properties: { verdict: { enum: ['GO', 'NO_GO'] }, perCommand: { type: 'array', items: { type: 'object' } }, failures: { type: 'array', items: { type: 'string' } } } } }),
    () => agent(\`LIVE GATE 2 OF 2 (publish): same task as gate 1, independently — run the published package's commands live, non-destructive, per-command GO/NO_GO with evidence. Return {verdict, perCommand, failures}.\`, { label: 'publish-gate-2', schema: { type: 'object', additionalProperties: false, required: ['verdict', 'perCommand'], properties: { verdict: { enum: ['GO', 'NO_GO'] }, perCommand: { type: 'array', items: { type: 'object' } }, failures: { type: 'array', items: { type: 'string' } } } } }),
  ])
  const publishAllGo = publishGates.filter(Boolean).every(g => g && g.verdict === 'GO')
  if (!publishAllGo) { file a todos task 'RELEASE UNVERIFIED: <pkg>@<v> — live gate NO_GO' with the gate evidence; post the NO_GO to #${CHANNEL}; NEVER post [PUBLISH-CONFIRM]. }
DEPLOY GATE (if the lane deploys, class deploy/both): after the deploy step's live test and BEFORE the [DEPLOY-CONFIRM] post, insert the same 2-agent parallel shape (labels deploy-gate-1/deploy-gate-2) verifying the DEPLOYED service live and non-destructively: every route (/health /ready /version 200 + identity + version match, one business read); both GO required, else file 'DEPLOY UNVERIFIED: <service>@<v>' and never confirm.
Preserve every existing instruction; add the gates, do not delete anything. Keep the schema shapes valid. Return {file, updated, gates: [string], failures}.`, { label: 'update:' + t.file, phase: 'Update', schema: UPDATE_SCHEMA, model: 'opus' }),
  ))
  updates.push(...results.filter(Boolean))
  log('update batch ' + (i / 4 + 1) + ' done: ' + results.filter(Boolean).map(r => r.file + ' ' + (r.updated ? 'OK' : 'FAIL')).join('; '))
}

phase('Verify')
const verify = await agent(`${CONST}
ROLE: verify (Opus). For EVERY edited file (${JSON.stringify(updates)}): node --check <file> (redirect, read rc); confirm the file contains TWO gate agent calls (labels publish-gate-1/2 or deploy-gate-1/2) AND the both-GO requirement (every(g => g.verdict === 'GO') or equivalent). Then run the repo gates: bun tooling/ci/check-secrets.ts --base origin/main (rc=0) and bun tooling/ci/check-names.ts (rc=0) — redirect to files, read $? directly. Return {files: [{file, syntaxOk, gatesPresent, bothGoRequired}], allClean, failures}.`, { label: 'verify-gates', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })

phase('Report')
const report = await agent(`${CONST}
ROLE: report. Post to #${CHANNEL} the hardening run: per-lane table (file, gates inserted: publish/deploy, both-GO required, syntax+repo gates status), the not-applicable lanes (no publish/deploy step — unchanged), and any lane that was already-gated. Save a memento: 'harden-lanes-review-gates-2026-08-25' '<one-line summary>'. Return {posted: true, table: [string]}.`, { label: 'report-gates', phase: 'Report' })

return { status: 'hardening-complete', census: census.lanes, updated: updates.filter(Boolean), verify, report }
