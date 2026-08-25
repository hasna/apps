export const meta = {
  name: 'github-issues-to-todos',
  description: 'Standing lane (owner 2026-08-25): every hour, deterministically enumerate open GitHub issues on hasna/apps and file any not already tracked as todos rows in project 3bbc22e0. DETERMINISTIC BY CONSTRUCTION: the agent executes a fixed procedure — gh api enumeration -> exact-match dedupe (title prefix GH#<n>: or the issue URL in comments) -> todos add with the issue\'s own fields. No model judgment in the decision; the output is a pure function of the input. Infinite session-scoped loop; idle wait ~1h inside the census; yields to hotfix-drain.',
  phases: [
    { title: 'Census', detail: 'deterministic: open issues vs existing rows, exact-match dedupe; sleep ~1h when nothing new' },
    { title: 'File', detail: 'todos add per new issue (GH#<n>: title, body + labels + URL, tag github-issue), post #apps' },
  ],
}

const REPO = 'hasna/apps'
const APPS_PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const CHANNEL = 'apps'

const CONST = `
You are a phase of the github-issues-to-todos workflow (owner 2026-08-25). Mission: every hour, enumerate open GitHub issues on ${REPO} and file each NOT already tracked as a todos row in project ${APPS_PROJECT}. DETERMINISTIC: you execute a fixed procedure; the result is a pure function of the input. NEVER decide by judgement — only by the exact-match rules below. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- No secrets: never print/capture/commit credential values. gh api only (authenticated internally) — never curl with a token.
- Record as you go: posts to #${CHANNEL}. English. Distinguish measured vs inferred; state what you did not check.
- NEVER run bash -x / set -x (trace mode) — the shell profile sources ~/.hasna/cloud/*.env and trace echoes credential lines into the transcript.
- PRIORITY YIELD: if any UNOWNED row in project ${APPS_PROJECT} has a title starting with "HOTFIX:", the hotfix-drain lane owns the priority class — sleep 3600 (bash), re-check once, return {yielded: true, hotfixCount: N, newIssues: []}. Do NOT file while yielding.
`

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['newIssues', 'openCount'],
  properties: {
    newIssues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['number', 'title', 'body', 'labels', 'url'],
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          body: { type: ['string', 'null'] },
          labels: { type: 'array', items: { type: 'string' } },
          url: { type: 'string' },
        },
      },
    },
    openCount: { type: 'integer' },
    yielded: { type: 'boolean' },
    hotfixCount: { type: 'integer' },
  },
}
const FILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filed', 'taskIds'],
  properties: {
    filed: { type: 'integer' },
    taskIds: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
  },
}

// --- safeAgent hardening (O15-00732) ---
// A subagent that completes WITHOUT calling StructuredOutput (prose reply) makes
// agent() throw; an uncaught throw kills the whole infinite run (measured
// 2026-08-25: wf_b4894f28-d61 died after 37 agents / 2.7h). safeAgent catches,
// logs, and returns null so the pass continues through the existing null-guards;
// the failure flag makes the NEXT pass's census instruct a 300s bash sleep
// before re-dispatching (the established idle-wait primitive) — a transient
// agent failure pauses the lane instead of killing it or hot-looping.
let agentFailed = false
const safeAgent = async (prompt, opts) => {
  try {
    return await agent(prompt, opts)
  } catch (err) {
    agentFailed = true
    const label = (opts && (opts.label || opts.phase)) || 'agent'
    log('AGENT-FAILURE (' + label + '): ' + (err && err.message ? err.message : String(err)) + ' — continuing; next pass census sleeps 300s first')
    return null
  }
}
const censusPrompt = (body) => {
  if (agentFailed) {
    agentFailed = false
    return "NOTE: a previous pass's agent FAILED (a subagent returned prose instead of StructuredOutput, or another transient error). Sleep 300 (bash) FIRST, then run this census exactly as instructed — the lane is waiting out the transient condition.\n\n" + body
  }
  return body
}
// --- /safeAgent ---

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> file -> sleep ~1h
// when idle -> re-census, forever. The idle wait lives INSIDE the census agent
// (bash sleep 3600 + re-check). Stop = owner stops the run or the session ends.
let pass = 0
for (;;) {
  pass++
phase('Census')
const census = await safeAgent(censusPrompt(`${CONST}
ROLE: census (execute the deterministic procedure — no judgement). PASS ${pass} of the infinite loop.

PRIORITY YIELD CHECK FIRST: todos list --project ${APPS_PROJECT} --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", sleep 3600 (bash), re-check once, return {yielded: true, hotfixCount: N, newIssues: []}.

STEP 1 — ENUMERATE (deterministic read): gh api repos/${REPO}/issues --paginate --jq '[.[] | select(.pull_request == null) | select(.state == "open") | {number, title, body, labels: [.labels[].name], url: .html_url}]' (redirect to a file, never pipe). Issues only — pull requests excluded by the .pull_request == null filter. Record openCount = the array length (a complete paginated read; if the file parses short, note the bound).

STEP 2 — DEDUPE (exact match only): todos list --project ${APPS_PROJECT} --status pending --json AND --status in_progress --json AND --status completed --json (redirect each to a file). An issue is ALREADY TRACKED (skip) when EITHER holds:
(a) a row's title starts with "GH#<number>:" (exact issue number);
(b) any row's comments contain the issue's html_url (exact URL string).
No fuzzy matching, no similarity, no "clearly the same" — only (a) or (b).

STEP 3 — NEW: every open issue that is NOT already tracked by (a) or (b) is newIssues, sorted by number ASC. cap: file at most 20 per pass (the bound; the rest file next pass).

STEP 4 — IDLE WAIT: if newIssues is empty, sleep 3600 (bash — one hour), re-run steps 1-3 once, and return the RE-CHECK result. NEVER return an empty newIssues without the sleep+re-check having run.

Return {newIssues: [{number, title, body, labels, url}], openCount, yielded, hotfixCount}.`, { label: 'issues-census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' }))

const newIssues = (census && census.newIssues) || []
if (census && census.yielded) {
  log('issues-to-todos pass ' + pass + ': YIELDED to hotfix-drain (' + (census.hotfixCount || 0) + ' HOTFIX: row(s)) — waited 1h inside the census, re-checking next pass')
  continue
}
if (newIssues.length === 0) {
  log('issues-to-todos pass ' + pass + ': ' + (census ? census.openCount : 0) + ' open issues, none new — the census waited 1h and re-checked; re-checking next pass')
  continue
}

phase('File')
const filed = await safeAgent(`${CONST}
ROLE: file (execute — create the rows). New issues to file: ${JSON.stringify(newIssues)}.
For EACH issue (deterministic mapping, no judgement): todos add in project ${APPS_PROJECT}:
- title: "GH#<number>: <issue title>" (the EXACT prefix form the census dedupes on);
- description: the issue body (first 2000 chars) + a line "labels: <comma-joined>" + "source: <html_url>";
- tags: github-issue.
After filing, re-run the dedupe check for ONE sample (todos list --project ${APPS_PROJECT} --status pending --json; confirm the GH#<n>: title exists) — a filed row must be findable by the census's own rule (a). Post one line to #${CHANNEL}: "issues-to-todos: filed ${newIssues.length} — GH#<n>, GH#<n>...". Return {filed, taskIds, skipped}.`, { label: 'issues-file:' + pass, phase: 'File', schema: FILE_SCHEMA, model: 'sonnet' })
log('issues-to-todos pass ' + pass + ': filed ' + (filed ? filed.filed : 0) + ' new issue(s), ' + (census ? census.openCount : 0) + ' open total — next pass re-censuses in ~1h')
}
