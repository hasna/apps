export const meta = {
  name: 'leak-scan',
  description: 'Standing OSS-leak audit lane (owner 2026-08-26, row 711bdab1): continuously checks EVERY public hasna repo for leaked internal information. Pass 1 Investigate phase calibrates the scan procedure (tooling, marker axes, budgets, positive controls) — the lane investigates how to scan properly before scanning. Then infinite sweeps: sweep 1 = full top-to-bottom scan of each repo (tree at HEAD + full history); later sweeps = only commits after each repo\'s persisted cursor. MAX 2 concurrent scan agents, each exactly 2 repos per pass. A completed sweep restarts from scratch (fresh dispatch from repo 1; cursors keep later sweeps delta-only). Resumable: state file ~/workspace/scratch/fabia/leak-scan/state.json (spec + cursors + lastSweep) read by Census every pass and written by Record; Workflow resumeFromRunId reuses completed agents. Findings: one todos row + one [LEAK-FOUND] commit comment per finding; evidence carries detector/marker + file:line ONLY, NEVER credential values. The lane never mutates any scanned repo and never opens/closes PRs.',
  phases: [
    { title: 'Investigate', detail: 'pass 1 only (or when the spec is missing from state): measure the installed scan tooling, define the marker axes, full/delta procedures, budgets and positive controls; return the operating spec' },
    { title: 'Census', detail: 'HOTFIX yield check first; read the state file; enumerate the public-repo population fresh (known-set control); queue 4 repos (2 agents x 2 repos) with per-repo mode full|delta and cursor' },
    { title: 'Scan', detail: '2 agents in parallel, each scanning exactly 2 repos per the spec (full top-to-bottom on first sweep, commits-after-cursor on later sweeps)' },
    { title: 'Record', detail: 'file todos rows + [LEAK-FOUND] commit comments (dedupe by existing marker), update the state file (cursors + lastSweep), one channel line' },
  ],
}

// --- safeAgent hardening (O15-00732) ---
// prose-guard + AGENT-FAILURE sleep banner, PR #1213
let agentFailed = false
const safeAgent = async (prompt, opts) => {
  try {
    const r = await agent(prompt, opts)
    if (opts && opts.schema && (typeof r !== 'object' || r === null)) {
      agentFailed = true
      const label = (opts && (opts.label || opts.phase)) || 'agent'
      log('AGENT-PROSE (' + label + '): schema requested but the agent returned a non-object result — treating as failure; next pass census sleeps 300s first')
      return null
    }
    return r
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

// Idle window (owner 2026-08-25, args-driven): args.idleMinutes in MINUTES,
// default 30. The census sleeps IDLE_SLEEP seconds then re-checks once —
// min(idleMinutes, 300) bounds the in-agent wait; the existing 300s is the floor
// (the standing idle wait, also the safeAgent failure-banner sleep).
const IDLE_MINUTES = Math.min(((args && args.idleMinutes) || 30), 300)
const IDLE_SLEEP = Math.min(Math.max(300, IDLE_MINUTES * 60), 1800)

// RECORDING V2 (owner requirement): every workflow agent records while working.
// Interpolated into every agent prompt below.
const RECORDING = `
RECORD WHILE WORKING (required, every workflow agent):
(1) conversations: claim/post to #hasna-apps at start (create via 'conversations channel create hasna-apps' if missing), milestone after each phase, done at the end; deploy lane additionally posts [DEPLOY INTENT] to git-deployments BEFORE and [DEPLOY-CONFIRM] in-thread AFTER with the 2-live-gate GO.
(2) todos: one task per work item (todos add --project hasna-apps), todos comment with evidence as you go, status start/complete only with proof (merged PR / verified live).
(3) mementos: mementos save key apps-<topic> on every non-obvious root cause/decision.
(4) knowledge: on durable doctrine, file a follow-up task 'KNOWLEDGE: <item>' for the knowledge lane (never silent add).
(5) skills: on a repeated procedure, file 'SKILL: <name>' follow-up.
(6) instructions: only when the workflow itself changes rules (then file 'INSTRUCTIONS: <config>').
Cloud env: for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done.
NEVER print a credential value.
`

// hasna/apps todos project id (args-driven, 2026-08-26): args.project overrides;
// the standing hasna/apps project id is the default. Every use below
// interpolates ${APPS} — no hardcoded id.
const APPS = (args && args.project) || '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

// Pass bound (fleet ground truth 2026-08-26): the standing 'infinite' lane runs a
// BOUNDED pass loop — MAX_PASSES hard cap per run (~5 agents per pass, so 40
// passes is well inside the runtime's 1,000-agent run cap, which stays the outer
// guard). The standing continuity between runs comes from the COORDINATOR
// re-launching this workflow, never an unbounded in-script loop; sweeps RESTART
// from repo 1 on the next fired run (cursors keep later sweeps delta-only).
// args.maxPasses overrides.
const MAX_PASSES = Math.min(500, Math.max(1, Number(args && args.maxPasses) || 40))

const STATE_FILE = '~/workspace/scratch/fabia/leak-scan/state.json'
const CLONE_ROOT = '~/workspace/scratch/fabia/leak-scan/clones'
// Known public OSS population, measured 2026-08-26 (positive control for the census read).
const KNOWN_POPULATION = ['hasna/apps', 'hasna-products/matematica', 'hasna-internal/dsh-TUI']
const ORGS = ['hasna', 'hasna-products', 'hasna-internal', 'hasnaxyz', 'hasnatools', 'hasnastudio', 'hasnafamily', 'hasnafoundation']

const SPEC = {
  type: 'object',
  properties: {
    tooling: { type: 'object', description: 'measured scan verbs: command, exit codes, redaction behavior' },
    markerAxes: { type: 'array', items: { type: 'string' }, description: 'the exact regex set for NON-credential internal markers + which secrets detectors cover credential shapes' },
    scanProcedure: {
      type: 'object',
      properties: {
        full: { type: 'string', description: 'exact commands for a top-to-bottom scan of one repo (tree + full history)' },
        delta: { type: 'string', description: 'exact commands for commits-after-cursor' },
      },
      required: ['full', 'delta'],
    },
    cloneStrategy: { type: 'string' },
    budgets: { type: 'object', description: 'per-repo max scan bytes/time, findings cap' },
    positiveControls: { type: 'array', items: { type: 'string' }, description: 'fixture gates: planted marker must be found; known-clean must pass; synthetic credential must exit 1 with redacted preview' },
    populationEnumeration: { type: 'string', description: 'the exact enumeration commands' },
    axesNotCovered: { type: 'array', items: { type: 'string' }, description: 'at least one dimension this scan cannot see (corpus-axes honesty)' },
  },
  required: ['tooling', 'markerAxes', 'scanProcedure', 'cloneStrategy', 'budgets', 'positiveControls', 'populationEnumeration', 'axesNotCovered'],
}

const CENSUS = {
  type: 'object',
  properties: {
    yielded: { type: 'boolean' },
    specPresent: { type: 'boolean' },
    spec: { type: ['object', 'null'], description: 'the operating spec read from the state file; null when absent' },
    sweep: { type: 'integer' },
    sweepStarted: { type: 'boolean' },
    population: { type: 'array', items: { type: 'string' } },
    populationComplete: { type: 'boolean' },
    reposTotal: { type: 'integer' },
    remainingThisSweep: { type: 'integer' },
    idle: { type: 'boolean' },
    queue: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          mode: { type: 'string', enum: ['full', 'delta'] },
          cursor: { type: ['string', 'null'] },
        },
        required: ['repo', 'mode', 'cursor'],
      },
    },
  },
  required: ['yielded', 'specPresent', 'spec', 'sweep', 'sweepStarted', 'population', 'populationComplete', 'reposTotal', 'remainingThisSweep', 'idle', 'queue'],
}

const SCAN_RESULT = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          mode: { type: 'string' },
          scannedCommits: { type: 'integer' },
          scannedFiles: { type: 'integer' },
          cursor: { type: ['string', 'null'], description: 'the new HEAD sha after fetch/scan; null when the repo scan failed' },
          failed: { type: 'boolean' },
          truncated: { type: 'boolean' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                commit: { type: ['string', 'null'] },
                file: { type: 'string' },
                line: { type: 'integer' },
                detector: { type: 'string' },
                marker: { type: ['string', 'null'] },
              },
              required: ['file', 'line', 'detector'],
            },
          },
          controls: {
            type: 'object',
            properties: {
              fixtureDetected: { type: 'boolean' },
              knownCleanPassed: { type: 'boolean' },
              syntheticCredentialBlocked: { type: 'boolean' },
            },
            required: ['fixtureDetected', 'knownCleanPassed', 'syntheticCredentialBlocked'],
          },
        },
        required: ['repo', 'mode', 'scannedCommits', 'scannedFiles', 'cursor', 'failed', 'truncated', 'findings', 'controls'],
      },
    },
  },
  required: ['results'],
}

const RECORD = {
  type: 'object',
  properties: {
    rowsFiled: { type: 'integer' },
    commentsPosted: { type: 'integer' },
    skippedDedup: { type: 'integer' },
    stateWritten: { type: 'boolean' },
    channelLine: { type: 'string' },
  },
  required: ['rowsFiled', 'commentsPosted', 'skippedDedup', 'stateWritten', 'channelLine'],
}

let pass = 0
let sweep = 1
let sweepSpec = null

for (pass = 1; pass <= MAX_PASSES; pass++) {
  phase('Census')
  const census = await safeAgent(censusPrompt(`${RECORDING}
Census for the leak-scan lane. PASS ${pass} of the bounded loop (max ${MAX_PASSES}), script sweep counter ${sweep}. PRIORITY YIELD CHECK FIRST: todos list --project ${APPS} --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-check once, return {yielded: true, specPresent: false, spec: null, sweep: ${sweep}, sweepStarted: false, population: [], populationComplete: false, reposTotal: 0, remainingThisSweep: 0, idle: false, queue: []} and do NOT probe GitHub while yielding.

1. READ THE STATE FILE (resume contract): if [ -f ${STATE_FILE} ] then cat it (it holds {spec, cursors, lastSweep}); else state is missing — this is a fresh start: full-scan mode for every repo. specPresent = (state.spec is a complete object). Return the state's spec object as the census field "spec" (null when there is no state or no spec).
2. ENUMERATE THE POPULATION fresh: for each org in [${ORGS.join(', ')}]: gh api "orgs/<org>/repos?per_page=100&type=public" --paginate --jq '.[].full_name' (redirect to a file, never pipe; 404/Not Found org → skip and record it absent). Population = union of all names. POSITIVE CONTROL: every name in the known set [${KNOWN_POPULATION.join(', ')}] MUST appear in the read — if any is missing, the read is INCOMPLETE: set populationComplete: false, queue: [] and do NOT scan (a capped read must never be presented as the population). New public repos not in the known set join the population with mode full (no cursor yet).
3. SWEEP BOOKKEEPING: the state's lastSweep {number, scannedRepos, complete} governs. If state.lastSweep.number == ${sweep} and NOT complete: continue the current sweep — queue = the first 4 repos of the population NOT in state.lastSweep.scannedRepos, remainingThisSweep = population size - scannedRepos size. Otherwise (no state, number mismatch, or complete): START A NEW SWEEP — sweepStarted: true, sweep = ${sweep} + 1 (or 1 when no state), queue = the first 4 repos of the population, remainingThisSweep = population size. Never claim a full-census result from a capped read.
4. MODES AND CURSORS: per queued repo, mode = state.cursors has the repo ? 'delta' : 'full'; cursor = state.cursors[repo] or null. IDLE CHECK: for each queued delta repo, compare its cursor to the remote HEAD — git ls-remote https://github.com/<repo>.git HEAD (redirect to a file; note the special case hasna-internal/dsh-TUI uses the same URL shape). If EVERY delta repo's remote HEAD equals its cursor (nothing new) AND lastSweep.complete: the fleet is clean — sleep ${IDLE_SLEEP} (bash — the args-driven idle window, ${IDLE_MINUTES} min default), re-check once, then return the final queue with idle: true.
5. QUEUE ORDER: population order (org list order, then repo name). Exactly 2 scan agents will each take 2 repos: the first 2 queue entries go to agent A, the next 2 to agent B — the queue length is capped at 4.

Return the census: yielded, specPresent, spec (the state's spec object, or null), sweep (the sweep you are working), sweepStarted, population (all names read), populationComplete, reposTotal, remainingThisSweep, idle, queue (each with repo, mode, cursor). Read-only: never open, close, comment, file, or clone anything in this phase.`), { label: 'leak-census:' + pass, phase: 'Census', schema: CENSUS, model: 'sonnet' })

  if (!census || !Array.isArray(census.queue)) {
    log(`pass ${pass}: census failed or malformed — re-checking next pass`)
    continue
  }
  if (census.yielded) {
    log(`pass ${pass}: HOTFIX yield — census slept and re-checked; retrying next pass`)
    continue
  }
  if (!census.populationComplete || census.queue.length === 0) {
    log(`pass ${pass}: population read incomplete (complete=${census.populationComplete}) or empty queue — re-checking next pass`)
    continue
  }
  if (census.spec) sweepSpec = census.spec
  if (census.sweep > sweep) {
    log(`sweep ${sweep} complete — next sweep starts from scratch (fresh dispatch from repo 1; cursors keep later sweeps delta-only)`)
    sweep = census.sweep
  } else {
    sweep = census.sweep
  }

  if (!census.specPresent) {
    phase('Investigate')
    const spec = await safeAgent(`${RECORDING}
You are the INVESTIGATE phase of the leak-scan lane (pass ${pass}; the operating spec is missing from ${STATE_FILE}). Determine how this lane scans "hasna internal information leaked into PUBLIC repos" — by MEASURING, never by asserting.

CONTEXT (binding rules):
- global-no-fleet-internal-skills-in-oss-repo (incident 2026-08-24: a fleet-internal skill session-inject-monitor was committed to the public OSS corpus at apps/skills/skills/). Its marker lists: exact private markers = @hasna-internal/* references, private hosts (*.hasna.xyz), ARNs, 12-digit AWS account ids, /home/hasna/... paths, concrete station names (station01..), session-injection commands, live session/worktree ids; compound pairs = internal channel names + secrets-CLI usage, ~/.hasna paths, fixed machine/session identity.
- Credential shapes covered by secrets detectors: npm_, ghp_/gho_, sk-ant, AKIA, AIza, xai-, api_key/token/secret assignments, private keys.
- Population (measured 2026-08-26): [${KNOWN_POPULATION.join(', ')}] — hasna/apps is a monorepo with ~92 member apps; matematica and dsh-TUI are small repos. The census enumerates fresh each pass over [${ORGS.join(', ')}].
- Installed scan tooling (probe each verb and paste the measured output): secrets scan workspace <path> --json (tree scan), secrets scan history <path> --json (git history scan), secrets scan input <file> --json (per-file; rc=0 clean, rc=1 finding, rc=2 COULD NOT SCAN — a refusal, never a clean pass), secrets scan staged, secrets security exposure --mode workspace|history. CONFIRM the previews are redacted (never a credential value in output).

DELIVER THE SPEC (return the object):
1. tooling: what each verb measured — commands, exit codes, redaction behavior, and which verbs cover credentials vs which need the supplementary marker pass.
2. markerAxes: the exact regex set for the NON-credential internal markers (derived from the rule lists above — e.g. @hasna-internal/, \\.hasna\\.xyz, arn:aws, 12-digit account ids, /home/hasna/, station\\d+, wks_[a-zA-Z0-9]+, internal channel names) + which secrets detectors cover the credential shapes. State the axis the scan does NOT cover (corpus-axes honesty): name ONE dimension (e.g. binary blobs, image bytes, renamed-file content, squashed-history, private forks) that this procedure cannot see.
3. scanProcedure.full: the exact commands for a top-to-bottom scan of ONE repo — clone strategy (prefer --filter=blob:none with on-demand blob fetch for history; measure), the tree scan (secrets scan workspace + marker regex pass over git ls-files), the full-history scan (secrets scan history + marker pass over git log -p --all diffs). Capture-path discipline: redirect outputs to files, never pipe large reads. Treat rc=2 as a refusal.
4. scanProcedure.delta: the exact commands for commits-after-cursor — reuse the scratch clone (git fetch origin, git log <cursor>..origin/HEAD), per-commit git show <sha> diffs redirected to files and scanned (secrets scan input + marker pass), plus scan the changed files at HEAD. The new cursor = the fetched HEAD sha.
5. cloneStrategy + scratch layout: clones live at ${CLONE_ROOT}/<org>-<name>/ (reused across sweeps — never cloned into any scanned repo, never into the hasna/apps checkout).
6. budgets: per-repo max scan bytes and wall time, and a findings cap per repo per pass (bounded output).
7. positiveControls (fixture gates): (a) a planted synthetic internal marker fixture must be DETECTED by the marker pass; (b) a known-clean file must PASS; (c) secrets scan input on a synthetic credential fixture must exit 1 with a redacted preview. Fixtures live in scratch (${STATE_FILE} sibling dir), never inside any scanned repo.
8. populationEnumeration: the exact enumeration commands from the census.
9. axesNotCovered: at least one dimension from step 2.

MEASURE FIRST: run the probe verbs on one repo (e.g. a small scratch clone of matematica, or secrets scan workspace on an existing local checkout) and paste the measured lines into tooling. Do not return a spec built from help text alone.`, { label: 'leak-investigate', phase: 'Investigate', schema: SPEC, model: 'opus' })
    if (!spec) {
      log(`pass ${pass}: investigate failed — retrying next pass`)
      continue
    }
    sweepSpec = spec
  }

  phase('Scan')
  const queueA = census.queue.slice(0, 2)
  const queueB = census.queue.slice(2, 4)
  const scanPrompt = (repos, passLabel) => `${RECORDING}
SCAN phase of the leak-scan lane, pass ${passLabel}. You are ONE of TWO parallel scan agents; you were assigned EXACTLY ${repos.length} repo(s): ${repos.map(r => r.repo + ' (' + r.mode + (r.cursor ? ', cursor ' + r.cursor.slice(0, 10) : ', no cursor') + ')').join('; ') || 'none'}. The other agent covers the rest of the queue. The lane's operating spec (from the Investigate phase):

${JSON.stringify(sweepSpec)}

EXECUTE PER THE SPEC — for EACH assigned repo:
1. CLONE/FETCH into ${CLONE_ROOT}/<org>-<name>/ (reuse the existing scratch clone: git fetch origin + checkout origin/HEAD; clone fresh only when absent). Never touch the shared hasna/apps checkout.
2. SCAN per the mode: full = the spec's scanProcedure.full (tree at HEAD + full history); delta = the spec's scanProcedure.delta (commits after the cursor). Capture-path discipline: redirect every large output to a file, never pipe. A scan verb that exits 2 = COULD NOT SCAN — record it as failed: true for that repo, never as clean.
3. POSITIVE CONTROLS each repo (the spec's fixtures): the planted marker fixture must be detected; a known-clean file must pass; a synthetic credential must exit 1 with a redacted preview. If a control fails, the scan result is suspect — record it in controls and keep the findings.
4. FINDINGS: for each hit, record {commit (the introducing commit sha when determinable, else null), file, line, detector (the secrets detector name or the marker class), marker (the matched marker class, never the matched value)}. EVIDENCE RULE — binding: NEVER paste a credential value, a matched marker value, or any secret into the findings or your output. The detector/marker name + file + line IS the evidence. If a scan output would carry values, the scan tool redacts them by default — never render a value to your transcript.
5. CURSOR: after scanning, cursor = the fetched/current origin HEAD sha (the next sweep resumes from here). If the repo scan failed (clone/fetch/scan error), cursor = null and failed: true — the repo stays unscanned this sweep and is re-queued next pass.
6. BOUND: respect the spec's budgets; if the findings cap is hit, set truncated: true and stop scanning that repo.

Return {results: [...]} — one entry per assigned repo (empty array when none assigned). Read-only: never open/close PRs, never mutate any scanned repo (clones in scratch are fine), never file rows or comments — the Record phase owns that.`

  const thunks = []
  if (queueA.length > 0) thunks.push(() => safeAgent(scanPrompt(queueA, pass), { label: 'leak-scan-a:' + pass, phase: 'Scan', schema: SCAN_RESULT, model: 'sonnet' }))
  if (queueB.length > 0) thunks.push(() => safeAgent(scanPrompt(queueB, pass), { label: 'leak-scan-b:' + pass, phase: 'Scan', schema: SCAN_RESULT, model: 'sonnet' }))
  const scans = thunks.length > 0 ? await parallel(thunks) : [null]
  const scanA = scans[0] || null
  const scanB = scans[1] || null
  const allResults = [(scanA && scanA.results) || [], (scanB && scanB.results) || []].flat()
  const failedRepos = allResults.filter((r) => r.failed).map((r) => r.repo)
  if (failedRepos.length > 0) log(`pass ${pass}: scan failed for ${failedRepos.join(', ')} — re-queued next pass`)

  phase('Record')
  const record = await safeAgent(`${RECORDING}
RECORD phase of the leak-scan lane, pass ${pass}, sweep ${sweep}. Census summary: population ${census.population.join(', ')} (${census.reposTotal} total, complete=${census.populationComplete}), queue this pass ${census.queue.map(q => q.repo + ':' + q.mode).join(', ')}, remainingThisSweep ${census.remainingThisSweep}, idle ${census.idle}. Scan results (successful repos only):

${JSON.stringify(allResults.filter((r) => !r.failed).map((r) => ({ repo: r.repo, mode: r.mode, scannedCommits: r.scannedCommits, scannedFiles: r.scannedFiles, cursor: r.cursor, truncated: r.truncated, findings: r.findings, controls: r.controls })))}

1. FINDINGS → ROWS + COMMENTS (dedupe first): for EACH finding, skip if an existing [LEAK-FOUND] comment already stands on that commit (gh api repos/<org>/<name>/commits/<sha>/comments) or an existing todos row whose title starts with "LEAK-FOUND: <repo>@<short-sha>" exists (PREFIX match — the separator after the sha can arrive in different forms across transport; never match byte-exact titles). Otherwise file EXACTLY ONE todos row in project ${APPS} titled "LEAK-FOUND: <repo>@<short-sha> | <detector>" (tags leak-scan,security; the separator is a pipe — never an em-dash, which transports inconsistently) whose body carries repo, commit sha, file:line, detector/marker, and the evidence rule — NEVER the matched value, NEVER a credential; the detector name + location IS the evidence. Then post ONE [LEAK-FOUND] commit comment via gh api repos/<org>/<name>/commits/<sha>/comments -f body="[LEAK-FOUND] <detector> @ <file>:<line> | <repo>@<short-sha>; row filed in hasna/todos (apps project)". Never post the matched value. NEVER delete, cancel, or update any todos row or comment — this lane files and comments ONLY. A duplicate is skipped and counted in skippedDedup, never removed. If you believe rows from an earlier pass are duplicates, leave them and note it in the channel line.
2. STATE FILE (resume contract): write ${STATE_FILE} atomically (mkdir -p, write to state.json.tmp, mv over) with {spec: ${JSON.stringify(sweepSpec)}, cursors: {<repo>: <new cursor for every successfully scanned repo>}, lastSweep: {number: ${sweep}, scannedRepos: <previous scannedRepos ∪ successful repos this pass>, complete: <(${census.remainingThisSweep} - successful repos this pass) == 0>}}. If a repo scan failed, its cursor stays at the old value and it is NOT added to scannedRepos. The spec object above is the actual operating spec (measured by Investigate or read from state) — write it verbatim.
3. ONE line to #apps: "leak-scan pass ${pass}: <repo>@<short-sha> <detector> @ <file>:<line> (n findings, m rows, k comments); sweep ${sweep} remaining <n>" — no ids without their meaning; one line even when clean ("leak-scan pass ${pass}: clean — 0 findings across <repos>; sweep ${sweep} remaining <n>").
4. Save ONE memento under leak-scan-pass-${pass}: the per-pass finding count and any new leak class discovered (one or two sentences; no values).

Return {rowsFiled, commentsPosted, skippedDedup, stateWritten, channelLine}.`, { label: 'leak-record:' + pass, phase: 'Record', schema: RECORD, model: 'sonnet' })

  const findingsTotal = allResults.reduce((n, r) => n + (r.findings ? r.findings.length : 0), 0)
  if (findingsTotal === 0) {
    log(`pass ${pass}: clean — ${allResults.length} repos scanned (${census.queue.length} queued), ${census.remainingThisSweep} remaining this sweep; idle=${census.idle}`)
  } else {
    log(`pass ${pass}: ${findingsTotal} findings (rows ${record ? record.rowsFiled : '?'}, comments ${record ? record.commentsPosted : '?'}, dedup ${record ? record.skippedDedup : '?'}, state ${record ? record.stateWritten : '?'})`)
  }
}
if (pass > MAX_PASSES) log(`MAX_PASSES reached (${MAX_PASSES}) — bounded run ends; the coordinator re-launches this workflow for standing continuity (cursors persist in ${STATE_FILE}, so the next run resumes delta-only)`)
