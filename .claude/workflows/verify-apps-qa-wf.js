// .claude/workflows/verify-apps-qa.js
// ============================================================================
// RUNTIME CAPS [RUNTIME] (code.claude.com/docs/en/workflows, verified 2026-08-26):
// dynamic workflow = plain .js with meta{name,description}; body is top-level
// await; agent()/pipeline()/parallel()/phase()/log(); args is global; NO
// import() (fails pre-run); NO fs/shell from the script (subagents do the work);
// up to 16 concurrent agents; 1,000 agents TOTAL per run (this is what makes a
// literal infinite loop unbounded); agents inherit the SESSION model unless the
// script overrides — this file sets NO model fields anywhere (owner requirement:
// default model); runs resumable within the session; saved runs run as /<name>.
//
// CONTINUITY MODEL [CONTINUITY] (owner-authorized STANDING behaviour, measured
// fleet standard): 'infinite' = a BOUNDED pass loop inside the script (hard
// bound maxPasses per run, because of the 1,000-agent cap) + idle handled INSIDE
// the census agent (bash sleep of min(idleMinutes, 300s) then a re-check once)
// + standing continuity from the COORDINATOR re-launching this workflow (the
// 10-min health loop). NEVER a literal while(true) that spawns unbounded agents.
// Standalone invocation (no args.qa) = the standing lane; args.qa=true = one
// integrable pass (the task/pr drains invoke this same lane as their QA phase).
//
// SAFETY PATTERN [SAFETY] (measured fleet requirement): a subagent completing
// WITHOUT StructuredOutput makes agent() throw; an uncaught throw killed a whole
// infinite run (wf_b4894f28-d61 — 37 agents / 2.7h). Every agent() goes through
// safeAgent(): catch -> log -> return null -> set agentFailed -> the NEXT pass's
// census instructs a bash sleep of idleSeconds FIRST before re-dispatching (the
// established idle-wait primitive) — a transient agent failure pauses the lane
// instead of killing it or hot-looping.
//
// [FACTS] this file depends on (verified 2026-08-26):
// - testers CLI: testers run <url> --json --output <file>, testers quick-qa,
//   testers repo prepare . / testers repo run . (repo-native), testers doctor,
//   testers project list (cloud env required: ~/.hasna/cloud/todos|conversations|
//   mementos|knowledge.env — the RECORD preamble sources them).
// - E2B box (credential-zero): hasna/sandboxes (sandboxes create, sandboxes exec
//   <id>, sandboxes files sync <id> <localDir> <remoteDir>, sandboxes logs
//   <id> --json, sandboxes show <id>) or infinity env run (per-run; egress
//   stays fenced to the broker; tools.policy=infinity-agent). NO host credentials
//   into the box — no AWS keys, no vault tokens, no npm tokens, no env var
//   carrying a credential. Box egress is never opened or bypassed.
// - rsync into the box: rsync -az --delete from the TASK WORKTREE
//   (args.worktree) — NEVER the shared checkout (hasna/apps PR-first law:
//   worktrees only at $HOME/.hasna/repos/worktrees/apps/<name>).
// - Spend cap: args.budgetCents default 250 — the lane hard-stops at the cap
//   (script-level sum of the agents' reported spend, plus the prep agent
//   refuses to launch a box when the cap is already reached).
// - RECORDING V2 (owner requirement): interpolated into EVERY agent prompt.
// - Repo laws: hasna/apps publishes @hasna/<name> only; no @hasna-internal and
//   no internal strings in published artifacts; no secrets in the tree;
//   commits end with 'Agent: <name>'; bun run check before PR — none of this
//   lane does commits, but the box needs no private-registry credentials
//   because the apps' dependencies are public; if an app needs a private
//   dependency, the lane records itself blocked rather than leaking a token.
// ============================================================================
export const meta = {
  name: 'verify-apps-qa',
  description: 'QA lane for hasna/apps apps (owner-authorized STANDING lane): prep resolves the testers target via the testers CLI and launches a credential-zero E2B box (hasna/sandboxes, or infinity env run — egress stays on the broker) with the task worktree rsynced in (rsync -az --delete, never the shared checkout); run executes the app\'s own test suites plus testers browser/repo QA inside the box with raw outputs captured to files; verdict is PASS/FAIL per suite keyed on the artifacts (logs, exit codes, screenshots) and a failing lane carries the exact failure and what was tried; record posts to #hasna-apps, comments/completes the QA row, files a deduped BUG task on failure, saves mementos; integrable as one phase (args.qa true — the task/pr drains invoke this same lane) with a hard spend cap (args.budgetCents default 250, stop at cap), while standing runs are a BOUNDED pass loop (args.maxPasses default 3, hard bound from the 1,000-agent cap) with idle handled inside the census agent (bash sleep of min(idleMinutes, 300s) plus one re-check) and continuity from the coordinator relaunching on the 10-min health loop — never a literal unbounded loop.',
  phases: [
    { title: 'Census' },
    { title: 'Prep' },
    { title: 'Run' },
    { title: 'Verdict' },
    { title: 'Record' },
  ],
}

// ---- scope comes entirely from args; every environment-specific value is injected at runtime ----
// Standing mode derives app per QA row; integrable invocation always needs it.
if (!args.worktree) throw new Error('no input: pass worktree (the task worktree to sync) via args');
if (args.qa === true && !args.app) throw new Error('no input: pass app (the apps/<app> under test) via args');
const worktree = String(args.worktree).replace(/\/+$/, '');
const app = String(args.app || '');
const repo = args.repo || 'hasna/apps';
const integrable = args.qa === true;
const budgetCents = Math.max(1, Math.min(Number(args.budgetCents) || 250, 10000));
const maxPasses = Math.max(1, Math.min(Number(args.maxPasses) || 3, 20));
const idleSeconds = Math.min((Math.max(0, Number(args.idleMinutes) || 30)) * 60, 300);
const maxConcurrent = Math.max(1, Math.min(Number(args.maxConcurrent) || 1, 16));
const agentName = (args.agent || args.agentName || '');
const agentClause = agentName ? ('post with --from ' + agentName) : 'post with your registered agent identity --from <name>';
const rowsArg = Array.isArray(args.rows) ? args.rows.filter((r) => r && r.app) : [];
const CLAIM_TAG = 'verify-apps-qa claim';
const ARTIFACT_DIR = '~/workspace/scratch/verify-apps-qa/' + (app || '<app>');

// ---- RECORDING V2 preamble (owner requirement; interpolated into EVERY agent prompt) ----
const RECORD = 'RECORDING V2 — do this WHILE working, never batched at the end:\n'
  + '(1) CONVERSATIONS: at start claim/post to #hasna-apps (create it if missing: conversations channel create hasna-apps) — ' + agentClause + '; post one milestone after each phase; post done at the end.\n'
  + '(2) TODOS: one task per work item (todos add --project hasna-apps); todos comment with evidence as you go; a status completes ONLY with proof (merged PR / verified live artifact).\n'
  + '(3) MEMENTOS: mementos save on every non-obvious root cause or decision, key apps-<topic>.\n'
  + '(4) KNOWLEDGE: on durable doctrine, file a follow-up task "KNOWLEDGE: <item>" for the knowledge lane — never silently add to knowledge.\n'
  + '(5) SKILLS: on a repeated procedure, file "SKILL: <name>" follow-up.\n'
  + '(6) INSTRUCTIONS: only when the workflow itself changes rules — then file "INSTRUCTIONS: <config>".\n'
  + 'CLOUD ENV (source before any CLI call that reads the cloud): for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done\n'
  + 'NEVER print a credential value. Consume with secrets exec <key> --as VAR -- <cmd>; prove presence with secrets get <key> --check (length + sha256 only).';

// ---- safeAgent hardening (fleet pattern, O15-00732 / wf_b4894f28-d61 lesson) ----
// A subagent that completes WITHOUT StructuredOutput makes agent() throw; an
// uncaught throw killed a whole infinite run. safeAgent catches, logs, and
// returns null so the lane continues through the null-guards; the failure flag
// makes the NEXT pass's census instruct a bash sleep FIRST before re-dispatching.
let agentFailed = false;
const safeAgent = async (prompt, opts) => {
  try {
    const r = await agent(prompt, opts);
    // A prose reply can come back as the agent's RAW RESULT (a string) instead
    // of the schema'd object (measured 2026-08-26: a survey agent completed with
    // prose and the run crashed on a property access). When a schema was
    // requested, a non-object result is the SAME failure class as the throw —
    // treat it as one so the existing null-guards hold.
    if (opts && opts.schema && (typeof r !== 'object' || r === null)) {
      agentFailed = true;
      const label = (opts && (opts.label || opts.phase)) || 'agent';
      log('AGENT-PROSE (' + label + '): schema requested but the agent returned a non-object result — treating as failure; next pass census sleeps ' + idleSeconds + 's first');
      return null;
    }
    return r;
  } catch (err) {
    agentFailed = true;
    const label = (opts && (opts.label || opts.phase)) || 'agent';
    log('AGENT-FAILURE (' + label + '): ' + (err && err.message ? err.message : String(err)) + ' — continuing; next pass census sleeps ' + idleSeconds + 's first');
    return null;
  }
};
const censusPreamble = () => {
  if (agentFailed) {
    agentFailed = false;
    return 'NOTE: a previous pass\'s agent FAILED (a subagent returned prose instead of StructuredOutput, or another transient error). Sleep ' + idleSeconds + ' (bash) FIRST, then run this census exactly as instructed — the lane is waiting out the transient condition.\n\n';
  }
  return '';
};
// --- /safeAgent ---

// ---- JSON schemas (fail-closed: a missing field or wrong type is a rejection, never a pass) ----
const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['candidates', 'queueSize', 'blocked'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'shortId', 'app', 'title', 'worktree'],
        properties: {
          id: { type: 'string' },
          shortId: { type: 'string' },
          app: { type: 'string' },
          title: { type: 'string' },
          worktree: { type: 'string' },
        },
      },
    },
    queueSize: { type: 'integer' },
    blocked: { type: 'array', items: { type: 'string' } },
  },
};

const PREP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['done', 'boxId', 'boxKind', 'testersReady', 'appDir', 'suites', 'syncTarget', 'spendCents', 'evidence'],
  properties: {
    done: { type: 'boolean' },
    boxId: { type: 'string' },
    boxKind: { type: 'string', enum: ['sandboxes', 'infinity'] },
    testersReady: { type: 'boolean' },
    appDir: { type: 'string' },
    suites: { type: 'array', items: { type: 'string' } },
    syncTarget: { type: 'string' },
    spendCents: { type: 'number' },
    evidence: { type: 'string' },
  },
};

const RUN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['done', 'lanes', 'artifacts', 'spendCents', 'evidence'],
  properties: {
    done: { type: 'boolean' },
    lanes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['suite', 'command', 'outcome', 'evidence'],
        properties: {
          suite: { type: 'string' },
          command: { type: 'string' },
          outcome: { type: 'string', enum: ['pass', 'fail', 'error'] },
          evidence: { type: 'string' },
        },
      },
    },
    artifacts: { type: 'array', items: { type: 'string' } },
    spendCents: { type: 'number' },
    evidence: { type: 'string' },
  },
};

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'perSuite', 'failures', 'evidence'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    perSuite: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['suite', 'pass', 'evidence'],
        properties: {
          suite: { type: 'string' },
          pass: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
    failures: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
};

const RECORD_DONE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['posted', 'channelPostId', 'rowComment', 'rowCompleted'],
  properties: {
    posted: { type: 'boolean' },
    channelPostId: { type: 'string' },
    rowComment: { type: 'string' },
    rowCompleted: { type: 'boolean' },
  },
};

const RECORD_FOLLOWUP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['bugTaskId', 'mementoKey', 'evidence'],
  properties: {
    bugTaskId: { type: 'string' },
    mementoKey: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
};

// ---- prompts — the RECORD preamble is interpolated into EVERY agent ----
function censusBody(pass) {
  return censusPreamble() + 'Census the verify-apps-qa queue (todos project hasna-apps, rows todo work item class "QA: <app> — <one-line scope>"). PASS ' + pass + ' of the bounded pass loop — re-census each pass; candidates executed earlier in this run carry claims or terminal markers and are excluded.\n\n'
    + '1. todos list --project hasna-apps --status pending --json (redirect to a file, never pipe). Select rows whose title starts with "QA:" (the lane\'s candidate contract: any drain or pr lane files "QA: <app> — <scope>" when a QA pass is owed).\n'
    + '2. Filter to UNOWNED rows (no assigned_to). Exclude rows whose comments already record "QA PASSED", "QA FAILED ROUTED", or "DUPLICATE of" (terminal markers).\n'
    + '3. Per candidate, parse app = the first token after "QA:" (the apps/<app> directory name). The app dir must exist in the task worktree (git -C ' + worktree + ' ls-tree --name-only origin/main apps/ | grep -x apps/<app> or ls ' + worktree + '/apps) — if the worktree does not carry this app, record the row in blocked (wrong worktree) and exclude it.\n'
    + '4. Dedupe against live fixers and live claims: exclude any row whose comments carry "' + CLAIM_TAG + '" with a timestamp younger than 90 minutes (another verify-apps-qa instance is executing it — never duplicate); comments carrying it older than 90 minutes are STALE claims (the instance died) and the row is a candidate again.\n'
    + '5. IF THE QUEUE IS EMPTY: sleep ' + idleSeconds + ' (bash), re-run the census steps once, and return the RE-CHECK result — the lane waits inside the census between passes. NEVER return an empty result without the sleep + re-check having run.\n'
    + 'CLOUD ENV first per the preamble. Return candidates (max 3, oldest first), queueSize (remaining unowned QA: rows), blocked (excluded rows with reasons). NEVER return a candidate whose app is missing from the worktree.';
}

function prepPrompt(row) {
  return 'PREP phase for the QA pass of hasna/apps app "' + row.app + '" (repo ' + repo + ', task worktree ' + worktree + '). This is a credential-zero lane — prepare the target and the box, launch nothing else, DO NOT run the suites yet.\n\n'
    + '1. TESTERS: run testers doctor; provision the target — testers repo prepare . inside the app dir for repo-native scenarios, and discover the app\'s serve contract (HOST=0.0.0.0 + PORT, /health /ready /version) from apps/' + row.app + ' (package.json bins/scripts, Dockerfile, docs) so the browser-QA URL can be served later. testersReady = the testers CLI is configured and the target is provisioned (a missing provider key is recorded as a lane note, not a pass).\n'
    + '2. SUITES MANIFEST: read apps/' + row.app + '/package.json (scripts) and the test layout (tests/, src/**/*.test.ts, e2e/); name the suites this app owns and the exact invocation for each (bun test, bun run test, a targeted test file list) — record them in suites[]; do NOT run anything.\n'
    + '3. BOX (credential-zero): launch the E2B box — prefer hasna/sandboxes (sandboxes create; later phases connect via sandboxes exec <boxId>; sandboxes files sync <id> <localDir> /app is the sanctioned file transfer) OR infinity env run (per-run; the run later re-syncs idempotently; egress stays fenced to the broker, tools.policy=infinity-agent; never open or bypass egress). The box receives NO host credentials — no AWS keys, no vault tokens, no npm tokens, no env var carrying a credential (the box may reach only the public registry and the broker). If the app needs a PRIVATE dependency, do NOT put credentials in the box: record done=false with the exact missing piece (a private dep) instead — never leak.\n'
    + '4. BUDGET GATE: before launching, read the current box/run spend from the observable surface (sandboxes show/logs --json, infinity usage/run receipts — metadata only, never secrets). If the spend is already at or above the cap of ' + budgetCents + ' cents: do NOT launch — done=false, evidence "budget cap ' + budgetCents + ' cents already reached (spend <x>) — no box launched".\n'
    + '5. SYNC: rsync -az --delete ' + worktree + '/apps/' + row.app + '/ <box-target>/apps/' + row.app + '/ INTO the box — the source is EXACTLY the task worktree, NEVER the shared checkout (hasna/apps PR-first law). When the box exposes sandboxes files, that package-owned sync is the sanctioned equivalent (fast archive upload). syncTarget = the box-side app dir.\n'
    + 'Return: done (true only when the box is launched, the worktree is synced in, and the app dir is present inside), boxId, boxKind (sandboxes|infinity), testersReady, appDir (box-side absolute), suites[], syncTarget, spendCents (the box spend accounted so far), evidence (raw lines: box id, sync command, suite manifest, spend).';
}

function runPrompt(row, prep) {
  return 'RUN phase — execute the QA suite at the prepared box (boxId ' + prep.boxId + ', kind ' + prep.boxKind + ', appDir ' + prep.appDir + '). Start each line by capturing raw output TO FILES; never report a run from memory.\n\n'
    + '1. Enter the box (sandboxes exec <boxId> ... — the box is credential-zero: bun install with the public registry only; npm/https workers reach nothing else; never write a credential into the box, never echo an env var carrying one; kill any leftover preview processes you started).\n'
    + '2. APP SUITES: for EVERY suite in the manifest ' + JSON.stringify(prep.suites) + ', run the real command (cd <appDir>; <invocation>) and tee the raw output to a file: sandboxes exec <id> bash -c "cd <appDir> && <invocation> 2>&1 | tee /tmp/logs/<suite>.log". Record per suite the exact command, the exit code, and outcome (pass = exit 0 AND the suite\'s success markers in the log; fail = exit non-zero or expected-marker absence; error = the suite did not run or the box failed).\n'
    + '3. TESTERS QA (browser flows where applicable): provision and run inside the box — testers doctor; for a web app, serve the app from <appDir> (HOST=0.0.0.0, PORT from the serve contract), then testers run http://localhost:<port> --json --output /tmp/testers-<app>.json and/or testers quick-qa <url> --json; for repo-native scenarios testers repo prepare . then testers repo run .; capture the screenshots the browser driver produces. A non-web app records the browser lane as error with reason "no browser surface" — never as pass. If testers is unconfigured (no provider key), record the lane as error with the exact reason — do not fabricate a run.\n'
    + '4. ARTIFACTS: copy the key evidence host-side to ' + ARTIFACT_DIR + '/ (mkdir -p; the raw logs, the testers JSON output, the screenshots, per-run exit codes) and return the absolute host-side paths in artifacts[] — the verdict phase reads only these. Include the screenshots path whenever the browser flow ran.\n'
    + '5. BUDGET: while running, track the box spend (the observable surface). When the spend reaches or exceeds the cap of ' + budgetCents + ' cents: stop ALL remaining lanes now, done=true, and record in evidence "budget cap ' + budgetCents + ' cents reached at <suite> — lanes stopped at cap"; a lane stopped by cap is outcome error with that exact sentence.\n'
    + '6. done = true only when every started lane reached a terminal outcome AND no lane was abandoned. A missing raw-output file for a suite is error, never pass. Clean up: kill preview processes; the box stays alive (teardown is the verifier/record concern — the box is REUSED by the verdict phase for artifact reads, so do NOT destroy it here).\n'
    + 'Return: done, lanes[] ({suite, command, outcome: pass|fail|error, evidence: the exact raw line/exit}), artifacts[] (absolute host-side paths), spendCents (total box spend accounted), evidence (one raw line per lane).';
}

function verdictPrompt(row, run) {
  return 'VERDICT phase — decide PASS/FAIL per suite KEYED ON THE ARTIFACTS (read them; never infer from descriptions): ' + JSON.stringify((run.artifacts || []).join(' | ')) + ', in ' + ARTIFACT_DIR + '.\n\n'
    + '1. Read each raw artifact (the logs, the testers JSON, the screenshots, the exit codes). A suite passes ONLY when the artifact evidence shows it actually completed: exit 0 AND the expected success markers at the exact app ' + row.app + '; a browser lane passes ONLY when the screenshots + JSON show the flows executed against the served app. Anything else — fail, error, missing artifact, empty log, ambiguous evidence, a cap-stop lane — is FAIL for that lane.\n'
    + '2. verdict = PASS only when EVERY lane passed; otherwise FAIL.\n'
    + '3. A failing lane returns the EXACT failure and what was tried — perSuite must carry it in evidence, and failures[] carries one concrete statement per failed lane: "<suite>: <exact failure lines>; tried: <commands run and what was tried>". Never paraphrase a raw line without pasting it.\n'
    + 'Quote the load-bearing raw lines (exit codes, the failing assertion, the browser JSON status) in evidence. NEVER report secrets or credential values — redact anything token-like before quoting.';
}

function recordDonePrompt(row, verdict, run) {
  const rowClause = row.id
    ? '2. Comment the QA row ' + row.id + ' with the terminal marker and evidence: "' + (verdict.verdict === 'PASS' ? 'QA PASSED — <one-line evidence, artifacts + spend>' : 'QA FAILED ROUTED — <one line naming the BUG follow-up task once filed (or "BUG-FILING-PENDING" if the follow-up agent has not returned)>.') + '"\n'
      + '3. Complete the row (todos complete ' + row.id + ') — the proof IS the artifact-keyed verdict (logs, exit codes, screenshots read in the VERDICT phase); on FAIL the row still completes with the verdict, because the failure is durable in the comments and the BUG follow-up (mirrors the gate-row NO_GO-ROUTED convention — the row is not a pass, it is a routed record).'
    : '2. NO TODOS ROW for this invocation (the lane was called directly, not through a "QA:" row) — skip the row comment and the complete; the record lives in the #hasna-apps post after this one plus the BUG follow-up on FAIL.';
  return 'RECORD (done) phase for ' + row.app + ' — verdict ' + verdict.verdict + '. Post the terminal state; never a silent partial pass.\n\n'
    + '1. Post to #hasna-apps — ' + agentClause + ': "verify-apps-qa ' + row.app + ': ' + verdict.verdict + ' — lanes: <per-suite pass/fail> (artifacts ' + (run.artifacts || []).length + '; spend ' + (run.spendCents || 0) + 'c)" — ' + (verdict.verdict === 'FAIL' ? 'carrying the exact failures (no raw payloads beyond the failure lines, no credentials).' : 'plus the artifact pointer.') + ' Capture the message id (channelPostId).\n'
    + rowClause
    + '\nReturn: posted, channelPostId, rowComment, rowCompleted (true only when the row exists and its state actually shows completed — for a rowless invocation, rowCompleted=true with evidence "no row — direct call").';
}

function recordFollowupPrompt(row, verdict) {
  const fail = verdict.verdict === 'FAIL';
  return 'RECORD (follow-up) phase for ' + row.app + ' — verdict ' + verdict.verdict + (fail ? '; file ONE deduped BUG task with the evidence.' : '; no bug work, record the pass learning only.') + '\n\n'
    + (fail
      ? '1. DEDUPE FIRST: todos list --project hasna-apps --status pending --limit 500 --json AND --status in_progress (redirect to a file, never pipe) plus gh pr list --repo ' + repo + ' --state open — a BUG row/PR for this exact defect class may already exist (match by app + symptom, never by invented id). REUSE it (add the evidence as a comment) if it exists; otherwise file ONE row: todos add "BUG: @hasna/<app> — <symptom>" --project hasna-apps, description carrying the exact failing artifact lines (logs/exit/screenshot paths from the verdict), the task id, and "QA lane verify-apps-qa". Cite only the real id; NEVER a fabricated task id.\n'
      : '1. No bug task on PASS — skip the BUG dedupe/file entirely.')
    + '\n2. MEMENTOS: mementos save apps-verify-' + row.app + ' "<two-sentence summary: verdict, the lane shape, any non-obvious root cause learned>".\n'
    + '3. FOLLOW-UPS (per RECORDING V2, file — never silently do): on a durable doctrine learned, file "KNOWLEDGE: <item>"; on a repeated procedure worth a skill, file "SKILL: <name>"; only if the workflow itself changes rules, file "INSTRUCTIONS: <config>". A first-time one-off selects none and says so in evidence.\n'
    + 'Never put credentials or raw private payloads in any task description. Return: bugTaskId (the real id, or "" on PASS / when reusing), mementoKey, followups[] (the follow-up task titles filed, or []), evidence.';
}

// ---- the QA chain for one candidate: Prep -> Run -> Verdict -> Record (fail-closed at per-suite level) ----
const qaChain = async (row) => {
  phase('Prep');
  const prep = await safeAgent(RECORD + '\n\n' + prepPrompt(row), {
    label: 'prep:' + row.app + '-' + row.shortId, phase: 'Prep', schema: PREP_SCHEMA,
  });
  if (!prep) return { row, status: 'failed', why: 'prep subagent returned no result (transient agent failure)' };
  if (prep.done !== true) return { row, status: 'failed', why: (prep.evidence || 'prep did not complete') };
  log('prep ' + row.app + ': box=' + prep.boxId + ' kind=' + prep.boxKind + ' suites=' + (prep.suites || []).length + ' testers=' + prep.testersReady + ' spend=' + prep.spendCents);

  phase('Run');
  const run = await safeAgent(RECORD + '\n\n' + runPrompt(row, prep), {
    label: 'run:' + row.app + '-' + row.shortId, phase: 'Run', schema: RUN_SCHEMA,
  });
  if (!run) return { row, status: 'failed', why: 'run subagent returned no result (transient agent failure)' };
  log('run ' + row.app + ': lanes=' + (run.lanes || []).length + ' artifacts=' + (run.artifacts || []).length + ' spend=' + run.spendCents);

  phase('Verdict');
  const verdict = await safeAgent(RECORD + '\n\n' + verdictPrompt(row, run), {
    label: 'verdict:' + row.app + '-' + row.shortId, phase: 'Verdict', schema: VERDICT_SCHEMA,
  });
  if (!verdict) return { row, status: 'failed', why: 'verdict subagent returned no result (transient agent failure)' };
  log('verdict ' + row.app + ': ' + verdict.verdict + ' lanes=' + (verdict.perSuite || []).length + ' failures=' + (verdict.failures || []).length);

  phase('Record');
  const [recordDone, recordFollowup] = await parallel([
    () => safeAgent(RECORD + '\n\n' + recordDonePrompt(row, verdict, run), {
      label: 'record-done:' + row.app + '-' + row.shortId, phase: 'Record', schema: RECORD_DONE_SCHEMA,
    }),
    () => safeAgent(RECORD + '\n\n' + recordFollowupPrompt(row, verdict), {
      label: 'record-followup:' + row.app + '-' + row.shortId, phase: 'Record', schema: RECORD_FOLLOWUP_SCHEMA,
    }),
  ]);
  if (recordFollowup && recordFollowup.bugTaskId && recordDone && recordDone.rowComment && recordDone.rowComment.indexOf('BUG-FILING-PENDING') !== -1) {
    // The follow-up filed the BUG task while the done-phase comment was written — update the row comment
    // with the real id so the terminal marker is exact (idempotent append, no re-write of history).
    const fix = await safeAgent(RECORD + '\n\n' + 'RECORD (fixup): the BUG follow-up for ' + row.app + ' is task ' + recordFollowup.bugTaskId + '. Comment row ' + row.id + ' with: "QA FAILED ROUTED — routed to BUG ' + recordFollowup.bugTaskId + '" and DO NOT change any other row state, DO NOT re-post to #hasna-apps. Return {commented: true}.', {
      label: 'record-fixup:' + row.app, phase: 'Record', schema: { type: 'object', additionalProperties: false, required: ['commented'], properties: { commented: { type: 'boolean' } } },
    });
    log('record fixup ' + row.app + ': ' + (fix ? 'comment updated with BUG ' + recordFollowup.bugTaskId : 'fixup agent failed — row comment may still say BUG-FILING-PENDING'));
  }
  log('record ' + row.app + ': posted=' + (recordDone ? recordDone.posted : false) + ' bug=' + (recordFollowup ? recordFollowup.bugTaskId : 'n/a') + ' memento=' + (recordFollowup ? recordFollowup.mementoKey : 'n/a'));
  return { row, status: verdict.verdict === 'PASS' ? 'pass' : 'fail', verdict, run, prep, recordDone, recordFollowup };
};

// ---- run ----
const results = [];
const failures = [];
let totalSpend = 0;
let status = 'queue-empty';
let pass = 0;

if (!integrable) {
  // STANDING lane: bounded pass loop (hard bound maxPasses per run) + idle inside
  // the census agent + coordinator re-launch. A FAIL stops the run (fail-closed,
  // spend-safe): the record phase already wrote the durable FAIL record first.
  for (pass = 1; pass <= maxPasses; pass++) {
    phase('Census');
    const census = await safeAgent(RECORD + '\n\n' + censusBody(pass), {
      label: 'census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA,
    });
    const candidates = (census && Array.isArray(census.candidates)) ? census.candidates : [];
    if (!census || candidates.length === 0) {
      log('verify-apps-qa: pass ' + pass + ' queue empty (' + (census ? census.queueSize : '?') + ' left, ' + ((census && census.blocked) || []).length + ' blocked) — the census waited and re-checked; next pass re-censuses (bounded maxPasses=' + maxPasses + ', continuity = coordinator relaunch)');
      continue;
    }
    const batch = candidates.slice(0, maxConcurrent);
    phase('Run');
    const passResults = await pipeline(batch.map((row) => () => qaChain(row)), { maxConcurrency: maxConcurrent });
    results.push(...passResults.filter(Boolean));
    for (const r of passResults) {
      if (!r) continue;
      totalSpend += (r.run && r.run.spendCents) || 0;
      if (r.status === 'fail') failures.push({ row: r.row.app, short: r.row.shortId, why: (r.verdict && r.verdict.failures) || r.why });
    }
    log('verify-apps-qa: pass ' + pass + ' done — ' + passResults.filter((r) => r && r.status === 'pass').length + ' pass, ' + failures.length + ' fail (cumulative spend ~' + totalSpend + 'c of ' + budgetCents + 'c)');
    if (failures.length > 0) {
      status = 'failed';
      break;
    }
    if (totalSpend >= budgetCents) {
      status = 'budget-hit';
      log('verify-apps-qa: budget cap ' + budgetCents + 'c reached (spend ' + totalSpend + 'c) — stopping the run at the cap');
      break;
    }
  }
} else {
  // INTEGRABLE phase (args.qa === true): the task/pr drains invoke this same lane
  // as their QA phase — one pass, one candidate, the verdict object is the return
  // contract so the calling drain can consume it.
  phase('Census');
  const row = rowsArg[0] || { id: '', shortId: 'qa-call', app: app, title: 'QA: ' + app, worktree: worktree };
  const r = await qaChain(row);
  results.push(r);
  totalSpend = (r.run && r.run.spendCents) || 0;
  if (r && r.status === 'fail') { failures.push({ row: r.row.app, short: r.row.shortId, why: (r.verdict && r.verdict.failures) || r.why }); }
  status = r && r.status === 'fail' ? 'failed' : (r && r.status === 'pass' ? 'passed' : 'blocked');
  if (totalSpend >= budgetCents && status === 'passed') status = 'budget-hit';
  log('verify-apps-qa integrable: ' + status + ' spend=' + totalSpend + 'c');
}

const summary = status === 'failed'
  ? 'QA FAILED — ' + JSON.stringify(failures.map((f) => f.row + ': ' + JSON.stringify(f.why)))
  : (status === 'budget-hit'
      ? 'QA RUN STOPPED AT BUDGET CAP — spend ' + totalSpend + 'c of ' + budgetCents + 'c'
      : (status === 'passed'
          ? 'QA PASS — ' + results.length + ' candidate(s) verified, spend ' + totalSpend + 'c'
          : 'QA queue empty after ' + pass + ' pass(es) (idle waited inside the census; standing continuity = coordinator relaunch) — spend ' + totalSpend + 'c'));
log('verify-apps-qa complete: status=' + status + ' candidates=' + results.length + ' spend=' + totalSpend + 'c summary=' + summary);

// FAIL-CLOSED: the lane RETURNS its verdict/result object for the caller
// (the integrable drain consumes it; the standing coordinator reads it on the
// next pass) — and a failed run also throws with the exact failures, so the run
// itself exits failed and is never mistaken for a silent partial pass.
if (status === 'failed') {
  throw new Error('QA LANE FAILED: ' + JSON.stringify(failures) + ' | post/done evidence: ' + JSON.stringify(results.map((r) => ({ app: r.row.app, recordDone: r.recordDone ? r.recordDone.channelPostId : null, bug: r.recordFollowup ? r.recordFollowup.bugTaskId : null }))));
}

return {
  meta: { name: meta.name },
  app, repo, worktree, integrable, budgetCents, maxPasses, maxConcurrent, idleSeconds,
  status, spendCents: totalSpend,
  passCount: pass,
  results: results.map((r) => ({
    app: r.row.app, shortId: r.row.shortId, status: r.status,
    verdict: r.verdict ? r.verdict.verdict : null,
    failures: r.verdict ? r.verdict.failures : (r.why ? [r.why] : []),
    artifacts: r.run ? r.run.artifacts : [],
    spendCents: r.run ? r.run.spendCents : 0,
    channelPostId: r.recordDone ? r.recordDone.channelPostId : null,
    bugTaskId: r.recordFollowup ? r.recordFollowup.bugTaskId : null,
  })),
  failures,
  summary,
};
