// ============================================================================
// fix-deepsec — deep security audit + FIX lane for hasna/apps (public @hasna/*)
//
// PURPOSE: Phase 1 parallel scanners (3 agents) across args.paths (default
// 'apps/*'): dependencies (7-day min-release-age pin vs ~/.bunfig.toml excludes,
// audit-all suspicious packages) / secrets (tree + staged scan with detectors) /
// app-code security (OWASP Top 10 2025 + agentic: authn/authz, injection,
// supply chain). Phase 2 triage: P0/P1 (reachable, in-scope, material) vs
// P2/P3 (filed as todos follow-ups, never silent). Phase 3 fixer lane per
// P0/P1: regression-test-first fix in a task worktree, staged secrets scan,
// PR; independent default-model reviewer over ONLY the named defects (2-cycle
// cap; a third NO_GO stops the candidate and files the exact findings).
// Phase 4 verify: re-run the scan lanes; verdict table + residue.
// FAIL-CLOSED: a scanner that cannot run is REPORTED, never treated clean.
//
// [FACTS] RUNTIME (code.claude.com/docs/en/workflows): .js in
// .claude/workflows/, meta{name,description}, plain-JS top-level await,
// agent()/pipeline()/parallel()/phase()/log(), global args; no dynamic
// module loading (the runtime fails such scripts before the run starts);
// NO fs/shell in the script (agents do all I/O); up to 16
// concurrent agents; 1,000 agents TOTAL per run (prevents runaway loops —
// hence the hard MAX_PASSES bound below); agents inherit the SESSION MODEL
// unless the script overrides — NO model fields anywhere (owner
// requirement); runs resumable same session; saved workflow runs as
// /fix-deepsec.
//
// [FACTS] CONTINUITY (fleet-measured): "standing/infinite" behaviour =
// BOUNDED pass loop in-script (args.maxPasses, default 3, hard cap 10 — the
// 1,000-agent cap is why it is bounded) + idle handled INSIDE a census
// agent via bash sleep (min(idleMinutes*60, 300)s — the fleet's 300s floor;
// default idleMinutes 30 => 300s) then ONE re-check; the standing
// continuity comes from the COORDINATOR re-launching this workflow (the
// 10-min health loop). Never an unbounded literal loop that spawns agents.
//
// [FACTS] SAFETY (fleet-measured, required): a subagent that completes
// WITHOUT StructuredOutput makes agent() throw; an uncaught throw killed a
// whole infinite run (37 agents / 2.7 hours). Every agent() goes through
// safeAgent() below: catch -> log -> return null -> set agentFailed, which
// makes the NEXT pass's census sleep 300s first. A schema'd agent returning
// a non-object (prose) result is the SAME failure class and is treated
// identically.
//
// [FACTS] REPO LAWS (hasna/apps CLAUDE.md): worktree-only mutation at
// $HOME/.hasna/repos/worktrees/apps/<name>, branch from origin/main,
// PR-first, never push to main; public names only @hasna/<name> (4
// surfaces); no @hasna-internal / internal strings in published artifacts;
// commits end with one 'Agent: <registered-identity>' trailer (no
// Co-Authored-By); staged secrets scan before every commit/push; bun run
// check before PR.
//
// Scoped from args ONLY: repo (default ~/.hasna/repos/clones/hasna/apps),
// paths (default apps/*), idleMinutes (default 30), maxPasses (default 3),
// project (default hasna-apps). Malformed or missing explicit scope throws
// before any agent runs. Concurrency: 4-wide chunking (maxConcurrency 4) —
// the runtime allows 16; this lane is bound at 4 by design.
// ============================================================================

export const meta = {
  name: 'fix-deepsec',
  description: 'Fleet-authorized deep security audit + fix lane for hasna/apps: parallel dependency/secrets/app-code scanners (fail-closed), P0/P1 vs P2/P3 triage (P2/P3 filed as todos follow-ups, never silent), then per-P0/P1 regression-test-first fixer PRs re-reviewed by an independent default-model reviewer (2-cycle cap, third NO_GO stops and files) and a re-scan verdict table with residue; owner-authorized standing loop = bounded passes per run (args.maxPasses) with idle inside a census agent sleep min(idleMinutes,300)s plus coordinator relaunch (10-min health loop) for standing continuity.',
  phases: [
    { title: 'Census', detail: 'between passes: agentFailed => bash sleep 300 first; then sleep min(idleMinutes,300)s + one re-check for new commits / in-flight fix PRs' },
    { title: 'Scan', detail: '3 parallel scanners (dependencies / secrets / app-code security) across args.paths, fail-closed ran flags' },
    { title: 'Triage', detail: 'P0/P1 (reachable, in-scope, material) vs P2/P3 (one todos follow-up per finding, never silent, never deleted)' },
    { title: 'Fix', detail: 'per P0/P1: regression-test-first fix in a task worktree, staged secrets scan, PR; independent default-model re-review of ONLY the named defects, 2-cycle cap (third NO_GO stops + files the exact findings)' },
    { title: 'Verify', detail: 're-run the scan lanes; match findings at base; verdict table + residue; new P0/P1 on the final pass are filed, never silent' },
    { title: 'Record', detail: '#hasna-apps done post, memento, follow-up filings, fail-closed report when a scanner never ran' },
  ],
}

// ---------------------------------------------------------------------------
// args — scope comes from args only; invalid/missing explicit scope throws
// ---------------------------------------------------------------------------
const raw = typeof args === 'undefined' ? {} : (args ?? {})
const REPO = typeof raw.repo === 'string' && raw.repo.trim() ? raw.repo.trim() : (() => { throw new Error('no input: pass args.repo') })()
const PATHS = typeof raw.paths === 'string' && raw.paths.trim() ? raw.paths.trim() : 'apps/*'
const PROJECT = typeof raw.project === 'string' && raw.project.trim() ? raw.project.trim() : 'hasna-apps'
const IDLE_MINUTES = Number(raw.idleMinutes ?? 30)
const MAX_PASSES = Number(raw.maxPasses ?? 3)

if (typeof raw.paths === 'string' && raw.paths.trim() === '') {
  throw new Error('fix-deepsec: args.paths explicitly empty — pass a concrete scope (e.g. --paths apps/socializer); scanning nothing is not a run')
}
if (!/^[A-Za-z0-9/.*_-]+$/.test(PATHS)) {
  throw new Error('fix-deepsec: args.paths malformed (' + JSON.stringify(PATHS) + ') — expected a path glob like apps/* (letters, digits, /, *, ., _, - only)')
}
if (!PATHS.startsWith('apps/')) {
  throw new Error('fix-deepsec: args.paths must live under apps/ (found ' + JSON.stringify(PATHS) + ')')
}
if (!Number.isInteger(MAX_PASSES) || MAX_PASSES < 1 || MAX_PASSES > 10) {
  throw new Error('fix-deepsec: args.maxPasses must be an integer 1..10 (hard bound for the 1,000-agent cap); got ' + JSON.stringify(raw.maxPasses))
}
if (!Number.isFinite(IDLE_MINUTES) || IDLE_MINUTES < 1 || IDLE_MINUTES > 1440) {
  throw new Error('fix-deepsec: args.idleMinutes must be a number of minutes in 1..1440; got ' + JSON.stringify(raw.idleMinutes))
}
const IDLE_SLEEP_S = Math.min(IDLE_MINUTES * 60, 300)

// ---------------------------------------------------------------------------
// RECORDING V2 preamble (owner requirement) — interpolated into EVERY prompt
// ---------------------------------------------------------------------------
const RECORD = `Record while working (RECORDING V2, owner requirement):
(1) conversations: claim + post to #hasna-apps at start (create via 'conversations channel create hasna-apps' if missing), milestone after each phase, done at the end;
(2) todos: one task per work item (todos add --project ${PROJECT}), todos comment with evidence as you go, status start/complete only with proof (merged PR / verified live);
(3) mementos: mementos save key apps-<topic> on every non-obvious root cause/decision;
(4) knowledge: on durable doctrine, file a follow-up task 'KNOWLEDGE: <item>' for the knowledge lane (never silent add);
(5) skills: on a repeated procedure, file 'SKILL: <name>' follow-up;
(6) instructions: only when the workflow itself changes rules (then file 'INSTRUCTIONS: <config>').
Cloud env: for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done. NEVER print a credential value.`

const withRecord = (body) => RECORD + '\n\n' + body

// ---------------------------------------------------------------------------
// safeAgent (fleet-measured mandatory pattern) + censusPrompt
// ---------------------------------------------------------------------------
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
    return "NOTE: a previous pass's agent FAILED (prose instead of StructuredOutput, or another transient error). Sleep 300 (bash) FIRST, then run this census exactly as instructed — the lane is waiting out the transient condition.\n\n" + body
  }
  return body
}
// 4-wide concurrency over parallel() (measured stable fleet shape); pipeline()
// is likewise available per the runtime docs, but explicit chunking keeps the
// maxConcurrency bound literal rather than advisory.
const batch = async (items, fn, size = 4) => {
  const out = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    out.push(...(await parallel(chunk.map((item) => () => fn(item)))))
  }
  return out
}

// ---------------------------------------------------------------------------
// schemas (StructuredOutput contracts; a prose reply to a schema'd agent is a
// failure — safeAgent treats it as one)
// ---------------------------------------------------------------------------
const FINDING = {
  type: 'object',
  required: ['id', 'kind', 'path', 'title', 'severity', 'evidence', 'reachable', 'fixHint'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    kind: { enum: ['dependency', 'secrets', 'appcode'] },
    path: { type: 'string', maxLength: 200 },
    title: { type: 'string', maxLength: 200 },
    severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
    evidence: { type: 'string', maxLength: 500 },
    reachable: { type: 'boolean' },
    fixHint: { type: 'string', maxLength: 400 },
  },
}
const SCAN = {
  type: 'object',
  required: ['ran', 'scanned', 'findings'],
  properties: {
    ran: { type: 'boolean', description: 'true only if every mandated check actually executed; false + failure = this scanner did NOT run (fail-closed)' },
    failure: { type: 'string', maxLength: 400, description: 'exact error when ran=false' },
    scanned: { type: 'array', items: { type: 'string', maxLength: 200 } },
    findings: { type: 'array', items: FINDING },
    notes: { type: 'string', maxLength: 600 },
  },
}
const TRIAGE = {
  type: 'object',
  required: ['blockers', 'followups', 'summary'],
  properties: {
    blockers: { type: 'array', items: FINDING },
    followups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['findingId', 'taskId', 'filed', 'why'],
        properties: { findingId: { type: 'string' }, taskId: { type: 'string' }, filed: { type: 'boolean' }, why: { type: 'string', maxLength: 300 } },
      },
    },
    summary: { type: 'string', maxLength: 600 },
  },
}
const FIX = {
  type: 'object',
  required: ['findingId', 'branch', 'prNumber', 'headSha', 'changedPaths', 'secretsScan', 'testsLine', 'taskId'],
  properties: {
    findingId: { type: 'string' },
    branch: { type: 'string', maxLength: 120 },
    prNumber: { type: ['number', 'null'] },
    headSha: { type: ['string', 'null'] },
    changedPaths: { type: 'array', items: { type: 'string' } },
    secretsScan: { type: 'string', maxLength: 200, description: 'exact rc + bytesScanned line' },
    testsLine: { type: 'string', maxLength: 300 },
    taskId: { type: 'string', maxLength: 64 },
  },
}
const REVIEW = {
  type: 'object',
  required: ['verdict', 'defects', 'cyclesUsed', 'reviewedSha'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    defects: { type: 'array', items: { type: 'object', required: ['note', 'path'], properties: { note: { type: 'string', maxLength: 300 }, path: { type: 'string', maxLength: 200 } } } },
    cyclesUsed: { type: 'number', description: '1 = initial review; 2 = remediation cycle one; 3 = remediation cycle two (a NO_GO at 3 stops the candidate)' },
    reviewedSha: { type: 'string', maxLength: 64 },
  },
}
const CENSUS = {
  type: 'object',
  required: ['newWork', 'latestSha', 'newCommits', 'openFixBranches', 'waitedSec', 'reason'],
  properties: {
    newWork: { type: 'boolean' },
    latestSha: { type: ['string', 'null'] },
    newCommits: { type: 'number' },
    openFixBranches: { type: 'array', items: { type: 'string' } },
    waitedSec: { type: 'number' },
    reason: { type: 'string', maxLength: 300 },
  },
}
const RECORD_RESULT = {
  type: 'object',
  required: ['conversations', 'memento', 'filedTasks'],
  properties: {
    conversations: { type: 'string', maxLength: 200 },
    memento: { type: 'string', maxLength: 200 },
    filedTasks: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------------------
// prompt builders
// ---------------------------------------------------------------------------
const scanBase = (kind, pass, verify) => `You are the ${kind.toUpperCase()} scanner of fix-deepsec (deep security audit + fix lane for hasna/apps), ${verify ? 'VERIFY re-scan' : 'pass ' + pass + ' scan'}. Repo root: ${REPO}. Scope: ${PATHS}. Read from origin/main ONLY: git -C "${REPO}" fetch origin main -q, then git -C "${REPO}" show origin/main:<path> for every read (the local working tree may be stale). READ-ONLY — do not modify, create, or commit anything. Mandated checks must actually run; any check that cannot run makes the whole scanner ran=false with the exact failure — NEVER report a partial run as clean (fail-closed). Findings: evidence = the exact command + its output line (redacted of any credential value; no secret content in evidence ever), reachable = a real path from a shipped entry surface exists, severity per the P0..P3 rubric. Finish by calling StructuredOutput with the scan schema — a prose reply or a missing StructuredOutput fails the lane.`

const scanDepsPrompt = (pass, verify) => withRecord(scanBase('dependencies', pass, verify) + `
CHECKS (each mandatory):
1. 7-day pin vs excludes: read ~/.bunfig.toml — minimumReleaseAge=604800 must be present (never lower it) and minimumReleaseAgeExcludes (exact names only; scope wildcards NOT honoured). For EVERY dependency declared in every app package.json under ${PATHS} at origin/main that is NOT exempt per the CURRENT exclude list (@hasna/*, @hasnaxyz/*, @hasnastudio/*, @hasnatools/*, @hasnafamily/*, openai, @openai/*, @anthropic-ai/*, anthropic — verify against the file, never from memory): get the publish time (npm view <pkg> time --json) and flag any version published < 7 days ago whose exact name is absent from the excludes = PIN VIOLATION (P1).
2. Audit-all suspicious: per dependency flag typosquatting (name-resemblance to a known package), anonymous/unmaintained package, postinstall scripts, very-new-plus-unmaintained, known CVEs (run bun audit / npm audit against the lockfile — quote rc and advisory lines).
3. Lockfile drift: lockfile missing or out of sync with package.json (a package installed without a lockfile entry).
Report scanned = the app list actually inspected. Findings id pattern: dep-<app>-<n>.`)

const scanSecretsPrompt = (pass, verify) => withRecord(scanBase('secrets', pass, verify) + `
CHECKS (each mandatory):
1. Staged/diff scan: inside ${REPO} run 'secrets scan staged' (redirect stdout+stderr to files, never a pipe) — a clean result requires rc=0 AND bytesScanned > 0 (rc=0 with 0 bytes scanned is a vacuous pass; report it as ran=false with the exact line); quote the exact rc/bytesScanned/filesScanned line.
2. Tree scan with detectors: enumerate every credential-bearing file under ${PATHS} at origin/main (any extension — no extension allowlist; package.json scripts, .env fixtures, tests/fixtures, CI configs, README claims, private-key blocks, hardcoded literals) and run the secrets scan verb(s) the installed CLI exposes (per-file input scan, or a whole-tree scan path if one exists) with its detectors; a detector that cannot run is reported, never skipped.
3. Exact-hunk inspection: for EVERY detector hit open the exact hunk — a synthetic test token / placeholder / redacted fixture WITH evidence (fixture name + why it is synthetic) = NON-REAL (a P3 note under findings with the evidence); a live-looking credential or key material = real (P0 if reachable/exposed in shipped code, P1 otherwise). NEVER print a credential value into any finding, note, or pasted output — position-only (file:line + detector name).
Report scanned = the file list actually inspected. Findings id pattern: sec-<app-or-path>-<n>.`)

const scanAppcodePrompt = (pass, verify) => withRecord(scanBase('appcode', pass, verify) + `
CHECKS (evidence-backed only; a finding must name the vulnerable attribute + the reachable entry path):
For each app under ${PATHS} at origin/main, read the shipped entry surfaces — the serve/server entry (the package.json -serve bin and its server source), the CLI entry, the MCP/agent-tools entry, and web surfaces — then audit:
- authn/authz: state-changing route/handler without auth; org-scope or tenant-id taken from the caller instead of the token (IDOR); admin gate enforced only in the web UI; tokens in URLs/logs; default/weak auth config;
- injection: SQL via raw query/string building (drizzle sql + user input), command injection (child_process with interpolation), prototype pollution (unvalidated merge/extend), SSTI, XSS (unescaped user content into HTML), unsafe deserialize;
- SSRF: user-supplied URL fetched by the server;
- secrets handling: credentials printed to logs or surfaced through agent-tool/MCP output; tokens in source/comments;
- agentic: agent tools acting on untrusted input without scoping (reads outside their declarable scope), LLM output executed/eval'd or interpolated into a shell command, tool prompts without authz checks, credentials injected into agent context;
- supply chain in code: git/tarball dependencies, script-in-dependency, unpinned registries.
reachable = yes only when a shipped entry surface reaches the vulnerable path (name it). Findings id pattern: code-<app>-<n>.`)

const triagePrompt = (pass, findingsJson) => withRecord(`You are the TRIAGE phase of fix-deepsec, pass ${pass}. Repo: hasna/apps (public @hasna/*), root ${REPO}. You received the three scanners' findings as JSON below. Classify EVERY finding as:
- P0/P1 (BLOCKER, goes to the fixer lane) only when ALL hold: reachable from a shipped entry surface, in-scope of ${PATHS}, and material (security / data-integrity / breakage); P0 = exploitable without preconditions, P1 = reachable with a condition.
- P2/P3 => a FOLLOW-UP, never silent: for EACH one file exactly one todos row: FIRST dedupe by title-normalized search (todos list --project ${PROJECT} --limit 500 --json, redirect to a file, never pipe; match on 'SECURITY-FOLLOWUP:' + normalized title) — reuse an existing row (todos comment the new evidence; filed=true, taskId=its short id), otherwise todos add --project ${PROJECT} --p2|medium 'SECURITY-FOLLOWUP: <app> — <title>' then todos comment the id with the evidence (redacted — no credential values ever) and the finding id; filed=true + taskId=that short id. NEVER delete an existing row; NEVER invent an id (cite only a row you created or verified).
A finding whose scanner reported ran=false is NOT classified here — it is reported at the run level, fail-closed.
blockers = the P0/P1 findings exactly as received (id, kind, path, title, severity, evidence, reachable, fixHint) — do not rewrite evidence (truncate only).
Finish by calling StructuredOutput with the triage schema.

SCANNER FINDINGS (JSON): ${findingsJson}`)

const fixerPrompt = (finding, attempt, priorDefects) => withRecord(`You are the FIX lane for finding ${finding.id} (${finding.kind}), ${finding.path} — ${finding.title}, severity ${finding.severity}. Repo laws (hasna/apps CLAUDE.md): worktree-only mutation at $HOME/.hasna/repos/worktrees/apps/<worktree-name> cut from CURRENT origin/main (git -C "${REPO}" fetch origin main -q; git -C "${REPO}" worktree add "$HOME/.hasna/repos/worktrees/apps/<task-slug>" -b <branch> origin/main — never the shared checkout, never push to main); public names only @hasna/<name> (4 surfaces per app); no @hasna-internal / internal strings in published artifacts; commits end with the trailer line 'Agent: <registered-fleet-identity>' (exactly one; no Co-Authored-By); staged secrets scan before EVERY commit (secrets scan staged, redirect to a file, rc=0 AND bytesScanned>0 required); bun run check + affected tests before PR; PR vs main, one logical change, body ends with the Agent trailer.
STEPS:
1. todos: one task per finding (todos add --project ${PROJECT} 'SECURITY-FIX: <app> — <title>'; claim it).
2. WRITE THE FAILING REGRESSION TEST FIRST — reproduce this finding in code at the exact vulnerable path; confirm the test FAILS on the old code (paste the failing output line into testsLine evidence). Then fix the ROOT CAUSE (never the symptom, never a band-aid, no unrelated cleanup, no belt-and-suspenders).
3. Keep the diff to fix + test. Run the affected tests and bun run check (paste the green line).
4. Staged secrets scan clean, conventional commit (fix: <finding short id> — <one line>) with the Agent trailer, push the branch, open the PR vs main referencing the finding id. Do NOT merge, do NOT publish (publishing belongs to the publish lanes).
${attempt > 1 ? 'PRIOR REVIEW FINDINGS (fix ONLY these named defects and their direct regressions): ' + JSON.stringify(priorDefects) : 'No prior review findings — initial fix.'}
Finding evidence: ${finding.evidence}. Fix hint: ${finding.fixHint}
Finish by calling StructuredOutput with the fix schema (prNumber null when no PR could be opened, failure in testsLine/secretsScan).`)

const reviewerPrompt = (finding, fix, cycleNote) => withRecord(`You are the INDEPENDENT adversarial re-reviewer for finding ${finding.id} (${finding.path} — ${finding.title}). You did NOT author this fix; you run on the default model. Scope: review ONLY the named defect (this finding) and its DIRECT regressions at the EXACT PR head — fetch the branch, verify the sha into reviewedSha. NO whole-file/general/style re-audit; NO relitigating unchanged code or unchanged evidence.
CHECKS: (1) the regression test FAILS on the old code and PASSES on the new (run it both ways where feasible); (2) the change fixes the ROOT CAUSE per the finding's evidence — not a symptom/workaround; (3) diff scope = fix + test only; (4) no secrets or credential material anywhere in the diff; (5) the finding is REAL at base: reproduce the original vulnerable path against origin/main (paste the reproduction output line), then confirm it is CLOSED at head.${cycleNote}
Verdict: GO = no open P0/P1 within this named scope; NO_GO = concrete, evidence-backed, reachable P0/P1 defects ONLY (P2/P3 and optional hardening are non-blocking). Review target: PR #${fix.prNumber} @ ${fix.headSha}, changed ${(fix.changedPaths || []).join(', ')}. Fixer's regression line: ${fix.testsLine}
Finish by calling StructuredOutput with the review schema (cyclesUsed: 1 = initial review, 2 = remediation cycle one, 3 = remediation cycle two; a NO_GO at cyclesUsed 3 STOPS this candidate).`)

const censusAgentPrompt = (pass, lastSha, openBranches) => withRecord(`You are the CENSUS of fix-deepsec, pass ${pass}. Repo root: ${REPO} (hasna/apps). Known state: last observed origin/main sha = ${lastSha || 'none'}; fix PRs from this run so far = ${openBranches.length ? openBranches.join(', ') : 'none'}.
1. git -C "${REPO}" fetch origin main -q; resolve the current origin/main sha. newWork = the sha differs from lastSha (or lastSha is null) with commits under ${PATHS} (newCommits = count of new commits since lastSha when known, else 0).
2. In-flight fix PRs from this run: for each known branch run gh pr list --repo hasna/apps --head <branch> --state open (or GitHub search by title) — report which are still open (openFixBranches).
3. IF no new work AND no in-flight fix PRs: bash sleep ${IDLE_SLEEP_S} (the idle window), then RE-CHECK ONCE (re-fetch; new commits? open PRs?) and return the re-checked answer with waitedSec=${IDLE_SLEEP_S} and reason.
READ-ONLY. Finish by calling StructuredOutput with the census schema.`)

const verifyScan = async (passNo) => {
  const lanes = [
    ['dependencies', scanDepsPrompt(passNo, true)],
    ['secrets', scanSecretsPrompt(passNo, true)],
    ['appcode', scanAppcodePrompt(passNo, true)],
  ]
  const results = await pipeline(lanes, async ([kind, prompt]) => ({ kind, res: await safeAgent(prompt, { label: 'verify-' + kind, phase: 'Verify', schema: SCAN }) }))
  return results.filter(Boolean).map((r) => r.res).filter((r) => r !== null)
}

const recordPrompt = (summaryJson) => withRecord(`You are the RECORD + fail-closed gate phase of fix-deepsec. Post DONE to #hasna-apps: '[WF-DONE] fix-deepsec — <one line: passes, blockers fixed/stopped/residue, verdict>'; include the verdict rows (below) compactly and flag ANY scanner that never ran with the exact scanner failure line (fail-closed: never presented clean). Save mementos: mementos save key apps-fix-deepsec-<passes> '<two-sentence summary: what was found/fixed, what is residue/pending>' (a new key per run outcome — never overwrite an existing key). FILE follow-ups (todos add --project ${PROJECT}, one row each, comments carry evidence — never silent, never delete, dedupe by title search first):
- every STOPPED finding (third NO_GO): 'SECURITY-CANDIDATE-STOPPED: <app> — <title>' with the exact review findings;
- every RESIDUE finding (no GO PR): 'SECURITY-RESIDUE: <app> — <title>';
- every UNCLASSIFIED finding (triage agent failed): 'SECURITY-UNCLASSIFIED: <app> — <title>';
- any NEW P0/P1 found by the verify re-scan on the final pass: 'SECURITY-FINDING: <app> — <title> (new at verify, needs next run)'.
If the run surfaced a repeated procedure or durable doctrine, also file 'SKILL: <name>' / 'KNOWLEDGE: <item>' candidate rows (one sentence why). Never print a credential value anywhere.

RUN SUMMARY (JSON): ${summaryJson}

Finish by calling StructuredOutput with the record schema (conversations = the posted message id, memento = the key, filedTasks = the filed task short ids).`)

// ---------------------------------------------------------------------------
// run — bounded pass loop (see [FACTS] CONTINUITY)
// ---------------------------------------------------------------------------
let pass = 0
let lastSha = null
let endpoint = 'bounded-passes-exhausted'
let lastScanPassUnrun = false
const allBlockers = []
const laneOutcomes = []
const openFixBranches = []
const followupTaskIds = []
const unclassified = []
const unrunReasons = []
const keptFindings = {}
let newP01Final = []
const keyOf = (f) => (f.kind || '') + ':' + String(f.path || '').toLowerCase() + ':' + String(f.title || '').toLowerCase().trim()

for (pass = 1; pass <= MAX_PASSES; pass++) {
  if (pass > 1) {
    phase('Census')
    const census = await safeAgent(censusAgentPrompt(pass, lastSha, openFixBranches), { label: 'census-' + pass, phase: 'Census', schema: CENSUS })
    if (!census) {
      log('pass ' + pass + ': census agent failed (safeAgent) — agentFailed set, next pass census sleeps 300s first; continuing')
      continue
    }
    if (census.latestSha) lastSha = census.latestSha
    log('pass ' + pass + ' census: newWork=' + census.newWork + ' newCommits=' + census.newCommits + ' openFixPRs=' + census.openFixBranches.length + ' waitedSec=' + census.waitedSec + ' (' + census.reason + ')')
    if (!census.newWork && census.openFixBranches.length === 0) {
      endpoint = 'idle-coordinator-relaunch'
      log('pass ' + pass + ': idle after ' + (census.waitedSec || 0) + 's (no new commits, no in-flight fix PRs) — ending this run; standing continuity = coordinator re-launch (10-min health loop)')
      break
    }
  }

  phase('Scan')
  log('pass ' + pass + ' scan: ' + PATHS + ' @ ' + REPO)
  const scanResults = await batch(['dependencies', 'secrets', 'appcode'], async (kind) => {
    const prompt = kind === 'dependencies' ? scanDepsPrompt(pass, false) : kind === 'secrets' ? scanSecretsPrompt(pass, false) : scanAppcodePrompt(pass, false)
    return { kind, res: await safeAgent(prompt, { label: 'scan-' + kind, phase: 'Scan', schema: SCAN }) }
  })
  const byKind = {}
  lastScanPassUnrun = false
  for (const r of scanResults.filter(Boolean)) {
    const k = r.kind
    const rr = r.res
    if (!rr || rr.ran !== true) {
      lastScanPassUnrun = true
      const reason = rr && rr.failure ? rr.failure : 'agent failed (safeAgent) — treated as not run'
      unrunReasons.push(k + ': ' + reason)
      log('SCAN-UNRUN (' + k + '): ' + reason + '; fail-closed, never clean')
      byKind[k] = null
      continue
    }
    byKind[k] = rr
    log('scan ' + k + ': ran=true, ' + (rr.findings || []).length + ' findings, scanned=' + (rr.scanned || []).length + ' paths')
  }
  const ranKinds = Object.keys(byKind).filter((k) => byKind[k] !== null)
  if (ranKinds.length === 0) {
    log('pass ' + pass + ': ALL scanners failed to run this pass — no verdict possible (fail-closed); retrying next pass')
    continue
  }

  const allFindings = []
  for (const k of ranKinds) {
    for (const f of (byKind[k].findings || [])) {
      if (!f || typeof f.id !== 'string') continue
      allFindings.push({ ...f, kind: f.kind || k })
      keptFindings[keyOf(f)] = f
    }
  }
  log('pass ' + pass + ': ' + allFindings.length + ' raw findings from ' + ranKinds.length + ' scanners')

  phase('Triage')
  const triage = await safeAgent(triagePrompt(pass, JSON.stringify(allFindings, (k, v) => (k === 'evidence' && typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v))), { label: 'triage-' + pass, phase: 'Triage', schema: TRIAGE })
  if (!triage) {
    log('pass ' + pass + ': triage agent failed — findings kept as UNCLASSIFIED (never silent; filed by the record phase); fixer lanes skipped this pass')
    unclassified.push(...allFindings)
    continue
  }
  const blockers = triage.blockers || []
  for (const fup of triage.followups || []) followupTaskIds.push(fup.taskId)
  log('pass ' + pass + ' triage: ' + blockers.length + ' P0/P1 blockers, ' + (triage.followups || []).length + ' P2/P3 follow-ups filed')

  allBlockers.length = 0
  allBlockers.push(...blockers)
  for (const b of blockers) keptFindings[keyOf(b)] = b

  // Phase 3 — fixer lane per P0/P1, 4-wide, 2-cycle cap (a third NO_GO stops + files)
  phase('Fix')
  const runLane = async (finding) => {
    let candidate = await safeAgent(fixerPrompt(finding, 1, []), { label: 'fix-' + finding.id, phase: 'Fix', schema: FIX })
    if (!candidate || candidate.prNumber == null) {
      log('fix:' + finding.id + ': fixer failed / no PR opened — residue')
      return { finding, outcome: 'fixer-failed', detail: candidate ? JSON.stringify(candidate).slice(0, 300) : 'agent failed (safeAgent)' }
    }
    if (!openFixBranches.includes(candidate.branch)) openFixBranches.push(candidate.branch)
    let review = await safeAgent(reviewerPrompt(finding, candidate, ' This is the initial review.'), { label: 'rev-' + finding.id + '-1', phase: 'Fix', schema: REVIEW })
    let cycles = 1
    while (review && review.verdict === 'NO_GO' && cycles < 3) {
      const fixN = await safeAgent(fixerPrompt(finding, cycles + 1, review.defects || []), { label: 'fix-' + finding.id + '-r' + cycles, phase: 'Fix', schema: FIX })
      if (!fixN || fixN.prNumber == null) {
        log('fix:' + finding.id + ': remediation cycle ' + cycles + ' fixer failed — residue')
        return { finding, outcome: 'fixer-failed', cycle: cycles, detail: fixN ? JSON.stringify(fixN).slice(0, 300) : 'agent failed (safeAgent)' }
      }
      candidate = fixN
      cycles += 1
      const note = ' This is remediation cycle ' + (cycles - 1) + ' of 2: re-review ONLY the defects named in the prior NO_GO and their direct regressions.'
      review = await safeAgent(reviewerPrompt(finding, candidate, note), { label: 'rev-' + finding.id + '-' + cycles, phase: 'Fix', schema: REVIEW })
    }
    if (!review) {
      log('fix:' + finding.id + ': reviewer agent failed (safeAgent) — candidate NOT verified; residue')
      return { finding, outcome: 'reviewer-failed' }
    }
    if (review.verdict === 'NO_GO') {
      log('fix:' + finding.id + ': third NO_GO (cycles ' + cycles + ') — candidate STOPPED; exact findings filed by the record phase')
      return { finding, outcome: 'stopped', review }
    }
    log('fix:' + finding.id + ': GO at review ' + cycles + ' (PR #' + candidate.prNumber + ' @ ' + candidate.headSha + ')')
    return { finding, outcome: 'go', candidate, review }
  }

  let lanes = []
  if (blockers.length > 0) {
    lanes = await batch(blockers, (f) => runLane(f), 4)
  }
  laneOutcomes.push(...lanes)
  log('pass ' + pass + ' fix lanes: ' + lanes.filter((l) => l && l.outcome === 'go').length + ' GO, ' + lanes.filter((l) => l && l.outcome === 'stopped').length + ' stopped, ' + lanes.filter((l) => l && l.outcome !== 'go' && l.outcome !== 'stopped').length + ' failed/residue')

  // Phase 4 — verify: re-run the scan lanes; verdict table + residue
  phase('Verify')
  let verifyResults = []
  if (blockers.length > 0) {
    verifyResults = await verifyScan(pass)
    const verifyFindings = verifyResults.flatMap((r) => r.findings || [])
    newP01Final = [...new Map(verifyFindings.filter((f) => (f.severity === 'P0' || f.severity === 'P1') && !keptFindings[keyOf(f)]).map((f) => [keyOf(f), f])).values()]
    log('pass ' + pass + ' verify rescan: ' + verifyResults.length + '/3 lanes ran (fail-closed flags preserved), ' + newP01Final.length + ' new P0/P1 (caught by the next pass — filed by the record phase if this is the final pass)')
  } else {
    log('pass ' + pass + ' verify: no P0/P1 blockers this pass — no rescan needed (nothing to verify at head); verdict = clean for the scanned lanes')
  }

  for (const r of lanes) {
    if (!r) continue
    const k = keyOf(r.finding)
    const presentAtBase = verifyResults.length === 0 || verifyResults.some((rr) => (rr.findings || []).some((f) => keyOf(f) === k))
    r.status = r.outcome === 'go' ? (presentAtBase ? 'FIXED-PENDING-MERGE (PR GO at head)' : 'GO (no longer at base — already fixed upstream)') : r.outcome === 'stopped' ? 'STOPPED-3RD-NO_GO (exact findings filed)' : 'RESIDUE'
  }

  if (lanes.some((r) => r && r.outcome === 'go')) endpoint = 'fixed-prs-open'
}

// ---------------------------------------------------------------------------
// final record phase — then the fail-closed exit
// ---------------------------------------------------------------------------
phase('Record')
const verdictRows = []
for (const r of laneOutcomes.filter(Boolean)) {
  verdictRows.push({
    id: r.finding && r.finding.id,
    title: r.finding && r.finding.title,
    severity: r.finding && r.finding.severity,
    status: r.status || r.outcome,
    prNumber: r.candidate ? r.candidate.prNumber : null,
  })
}
const summary = {
  workflow: 'fix-deepsec',
  passes: pass,
  endpoint,
  pathScope: PATHS,
  repo: REPO,
  scannerUnrun: lastScanPassUnrun,
  unrunReasons,
  blockers: allBlockers.map((b) => ({ id: b.id, title: b.title, severity: b.severity })),
  verdict: verdictRows,
  residue: verdictRows.filter((v) => v.status === 'RESIDUE' || v.status === 'STOPPED-3RD-NO_GO').length,
  unclassified: unclassified.map((f) => ({ id: f.id, title: f.title, severity: f.severity })),
  newP01: newP01Final.map((f) => ({ id: f.id, title: f.title, severity: f.severity, path: f.path })),
  followupTaskIds: [...new Set(followupTaskIds)],
}
const record = await safeAgent(recordPrompt(JSON.stringify(summary)), { label: 'record-final', phase: 'Record', schema: RECORD_RESULT })

if (lastScanPassUnrun) {
  log('FAIL-CLOSED: the final scan pass had scanners that never ran (' + unrunReasons.join('; ') + ') — the run is NOT clean; nothing treated clean')
  endpoint = 'scan-incomplete'
  throw new Error('fix-deepsec: FAIL-CLOSED — scanners could not run on the final pass: ' + unrunReasons.join(' | '))
}

return {
  workflow: 'fix-deepsec',
  outcome: endpoint,
  passes: pass,
  scanned: PATHS,
  blockers: allBlockers.map((b) => ({ id: b.id, severity: b.severity, path: b.path, title: b.title })),
  verdict: verdictRows,
  followupTaskIds,
  record,
}
