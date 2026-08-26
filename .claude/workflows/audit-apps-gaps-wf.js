// ============================================================================
// .claude/workflows/audit-apps-gaps.js
// audit-apps-gaps — whole-repo standards audit for hasna/apps -> hasna/todos.
//
// RUNTIME CAPS AND CONTINUITY MODEL (pinned in the dispatch brief; wording only,
// no dates — re-verify against the brief on every revision):
//   - Dynamic workflow = plain JS, top-level await, `args` global. NO import();
//     NO fs/shell in the script — subagents do the real work (shells and tools
//     live inside agent prompts). Saved workflows run as /<name>; runs are
//     resumable within the same session.
//   - Agent caps: up to 16 concurrent agents; 1,000 agents TOTAL per run (the
//     cap that prevents runaway loops). Agents inherit the SESSION model — this
//     file sets NO model field anywhere, deliberately (owner requirement).
//   - Continuity model ("infinite" standing behaviour, fleet measured):
//     a BOUNDED pass loop in-script (MAX_PASSES hard bound per run —
//     args.maxPasses, default 1, clamped at 10, because of the 1,000-agent cap),
//     plus idle handled INSIDE a census agent via bash sleep
//     (min(args.idleMinutes, 300)s) and one re-check. TRUE standing continuity
//     comes from the COORDINATOR re-launching this workflow on the 10-minute
//     health loop. There is NEVER a literal while(true) that spawns unbounded
//     agents.
//   - SAFETY PATTERN (fleet measured, REQUIRED): every agent() goes through
//     safeAgent() — catch, log, return null, set the failure count; the NEXT
//     pass sleeps 300 first. An uncaught agent() throw previously killed an
//     entire infinite run (wf_b4894f28-d61, 37 agents / 2.7h).
//   - FAIL-CLOSED: a partial scan never passes. Every pass states "scanned X of
//     N apps"; after the final pass the script throws when that final pass had
//     subagent failures or scanned != population. Bounds also fail closed:
//     MAX_APPS_PER_PASS = 100 (3N+2 agents per pass, and the 1,000-agent cap
//     must stay reachable); a census that cannot determine the population
//     throws immediately.
//
// [FACTS THE FILE DEPENDS ON]
//   - args.repoPath is REQUIRED (path of the hasna/apps checkout). Every path in
//     the prompts below is interpolated from args — nothing hardcoded.
//   - Repo laws (hasna/apps CLAUDE.md): each @hasna/<name> package ships four
//     surfaces (CLI bin, MCP bin, -serve bin, ./sdk), public names only, no
//     internal strings in published artifacts, no @hasna-internal anywhere, and
//     a passed `bun run check` before merge. This workflow is READ-ONLY inside
//     the repo — it writes only to hasna/todos and #hasna-apps.
//   - Recording V2 (owner requirement, EVERY workflow, EVERY agent prompt) is
//     interpolated into EVERY agent prompt via the RECORD const below: it binds
//     conversations/todos/mementos/knowledge/skills/instructions plus the cloud
//     env sourcing, and forbids printing any credential value.
//   - Taxonomy: basename and meta.name match the closed-verb regex
//     ^(audit|fix|generate|migrate|monitor|research|review|triage|verify)-[a-z0-9]+(-[a-z0-9]+)*$
//     (verb-first; legacy object-first fleet files are not precedents). The
//     deploy companion file is an owner-named exception kept under its own name.
//   - Todos lane: NEVER delete or cancel tasks, NEVER duplicate (title-normalized
//     search first), only add + comment EVIDENCE for confirmed gaps.
// ============================================================================

export const meta = {
  name: 'audit-apps-gaps',
  description:
    'Audit hasna/apps standards compliance per apps/<name> — 4 surfaces (CLI bin, MCP bin, -serve bin, ./sdk), @hasna/<name> public-only, no internal strings, manifest conformance, tests presence, README 2-mode, sqlite+postgres dual storage gate, bun run check — and file evidence-backed hasna/todos tasks for confirmed gaps; owner-authorized standing use: the coordinator re-launches this workflow from the 10-minute health loop, passes are bounded (default 1), idle is handled by an agent-side sleep + once re-check, fail-closed on bounds.',
};

// ----------------------------------------------------------------------------
// Recording V2 preamble — interpolated into EVERY agent prompt (owner
// requirement). Does not contain `${` sequences; safe inside a template literal.
// ----------------------------------------------------------------------------
const RECORD = `
RECORD WHILE WORKING (Recording V2 — mandatory for every agent of this workflow):
(1) conversations: claim/post to #hasna-apps at start (create it with 'conversations channel create hasna-apps' if missing), a milestone after each phase, and done at the end; the deploy lane additionally posts [DEPLOY INTENT] to git-deployments BEFORE and [DEPLOY-CONFIRM] in-thread AFTER with the 2-live-gate GO.
(2) todos: one task per work item (todos add --project hasna-apps --priority <priority>); todos comment with EVIDENCE as you go; set status start/complete ONLY with proof (merged PR / verified live).
(3) mementos: mementos save key apps-<topic> on every non-obvious root cause or decision.
(4) knowledge: on durable doctrine, file a follow-up task 'KNOWLEDGE: <item>' for the knowledge lane (never a silent add).
(5) skills: on a repeated procedure, file a 'SKILL: <name>' follow-up.
(6) instructions: only when the workflow itself changes rules (then file 'INSTRUCTIONS: <config>').
Cloud env: for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done
NEVER print a credential value.`;

const AT = ['Bash', 'Read', 'Grep'];

const repoPath = args.repoPath;
if (!repoPath || typeof repoPath !== 'string' || repoPath.length === 0) {
  throw new Error(
    'missing required arg: repoPath (absolute path of the hasna/apps checkout)'
  );
}
const appsRel = args.appsRel ?? 'apps';
const appName = args.appName ?? null;
const maxConcurrency = Math.min(
  Math.max(Number(args.maxConcurrency ?? 8) || 1, 1),
  16
);
const MAX_PASSES = Math.min(
  Math.max(Number(args.maxPasses ?? 1) || 1, 1),
  10
);
const MAX_APPS_PER_PASS = 100;
const idleMinutes = Math.max(Number(args.idleMinutes ?? 30) || 30, 1);
const idleSleepSeconds = Math.min(idleMinutes * 60, 300); // fleet cap 300s

log(
  `[audit-apps-gaps] start: repo=${repoPath} appsRel=${appsRel} appName=${
    appName ?? '(all)'
  } concurrency=${maxConcurrency} maxPasses=${MAX_PASSES} idleMinutes=${idleMinutes}`
);

// ----------------------------------------------------------------------------
// safeAgent — REQUIRED safety pattern. Catches, logs, returns null, counts the
// failure; the next pass sleeps 300 before retrying.
// ----------------------------------------------------------------------------
let failureCount = 0;
async function safeAgent(cfg) {
  try {
    return await agent(cfg);
  } catch (err) {
    failureCount += 1;
    log(
      `[audit-apps-gaps] subagent failed: ${String(
        (err && err.message) || err
      )}`
    );
    return null;
  }
}

function withRecord(promptText) {
  return `${promptText}\n${RECORD}`;
}

// ----------------------------------------------------------------------------
// Parsing helpers — a subagent result that cannot be parsed counts as a failure
// (fail-closed: no parse = no scan of that app).
// ----------------------------------------------------------------------------
function parseObj(text, label) {
  if (text == null || String(text).trim() === '') {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: empty result for ${label}`);
    return null;
  }
  const s = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: no JSON object for ${label}`);
    return null;
  }
  try {
    return JSON.parse(m[0]);
  } catch (err) {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: bad JSON for ${label}: ${String(err)}`);
    return null;
  }
}

function parseArr(text, label) {
  if (text == null || String(text).trim() === '') {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: empty result for ${label}`);
    return null;
  }
  const s = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '');
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: no JSON array for ${label}`);
    return null;
  }
  try {
    const v = JSON.parse(m[0]);
    if (!Array.isArray(v)) {
      throw new Error('not an array');
    }
    return v.filter(
      (n) =>
        typeof n === 'string' && n.length > 0 && n.length <= 80
    );
  } catch (err) {
    failureCount += 1;
    log(`[audit-apps-gaps] parse: bad array for ${label}: ${String(err)}`);
    return null;
  }
}

function appSlug(app) {
  return String(app)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ----------------------------------------------------------------------------
// Agent prompt builders.
// ----------------------------------------------------------------------------
function censusPrompt() {
  const scope =
    appName != null
      ? `Scope: ONLY the app "${appName}". Confirm the dir "${repoPath}/${appsRel}/${appName}" exists and has a package.json; if yes return ["${appName}"], if no return [].`
      : `Run: ls -1 "${repoPath}/${appsRel}" — for every entry that is a directory, confirm it contains a package.json (test -f "${repoPath}/${appsRel}/<dir>/package.json"). Exclude: node_modules, dot-directories (leading dot), dist, coverage, fixtures, templates.`;
  return `CENSUS AGENT — hasna/apps standards audit.
Repo root: ${repoPath}. Apps dir: ${repoPath}/${appsRel}.
${scope}
Return EXACTLY one line of JSON: a JSON array of the app base-directory names that are real apps. If none, return []. No prose before or after.`;
}

function inventoryPrompt(app) {
  const d = `${repoPath}/${appsRel}/${app}`;
  return `INVENTORY AGENT — app "${app}" (hasna/apps standards audit).
App dir: ${d}. READ-ONLY: no writes, no tasks, no posts — observe and report only.
Method (run these, never guess):
- read "${d}/package.json": record "name"; the keys of "bin"; the keys of "exports"; the keys of "scripts".
- list the app dir (ls -1a "${d}") for the declared manifest (hasna.app.yaml / *.manifest.* / contracts/* — check "${repoPath}/AGENTS.md" or "${d}/AGENTS.md" for the manifest name used in this repo) and for README.*.
- tests presence: a test dir (test|tests) or *.test.ts files anywhere under "${d}" (Glob/Grep/find, excluding node_modules).
- README 2-mode: read the README. It must document BOTH product stories (user-hosted and Hasna SaaS) AND the server data-backend switch (sqlite default + postgresql via HASNA_<NAME>_DATABASE_URL). Classify: "2-mode" | "partial" | "missing" | "unknown". Also note whether it uses deployment-mode enum vocabulary (local|self_hosted|cloud|hybrid as a MODE value) — that is a defect to report under storage.
- storage check: read the server storage module. It MUST default to sqlite and support postgresql via the env URL; STRICTLY no mode enums / mode branching; the client must never open Postgres directly (no client-side PostgresStore — client connects to the server's HTTP API only). Classify: "dual" | "mono" | "unknown".
Return EXACTLY one JSON line, no prose:
{"app":"${app}","dirExists":<bool>,"pkgName":<string|null>,"binKeys":<string|null, comma-joined>,"exportKeys":<string|null>,"scriptKeys":<string|null>,"hasManifest":<bool|null>,"manifestPath":<string|null>,"tests":<bool|null>,"readmeExists":<bool|null>,"readmeModes":"2-mode|partial|missing|unknown","storageCheck":"dual|mono|unknown","notes":<string|null>}
Any check you could NOT read/run = null / "unknown" — never a guess.`;
}

function verdictPrompt(app, inventoryText, appSlugVal) {
  const d = `${repoPath}/${appsRel}/${app}`;
  return `VERDICT AGENT — app "${app}" (hasna/apps standards audit).
App dir: ${d}. Repo root: ${repoPath}. READ-ONLY audit: DO NOT fix, edit, create tasks, or post anything.
INVENTORY (from the survey; may contain null/"unknown" fields):
${inventoryText}
TASK: decide CONFIRMED gaps only, each with real evidence. A gap is confirmed ONLY when you personally read the file or ran the command; your evidence must name the file:line or the exact output line. Checks you cannot run/read go to "unverified" — NEVER into "gaps".
CHECKLIST (repo laws in ${repoPath}/CLAUDE.md):
1. Four surfaces (kind: surface): package.json "bin" must declare the CLI bin, an MCP bin (e.g. <name>-mcp), and a -serve bin; "exports" must expose "./sdk". A missing surface is a gap only when verified absent from the actual package.json.
2. Public-only naming (kind: name): "name" MUST be "@hasna/<app>"; anything else (especially "@hasna-internal") is a gap.
3. No internal strings (kind: internal-string): grep -rniE 'hasna\\.xyz|arn:aws:|@hasna-internal|[0-9]{12}' ${d} — exclude node_modules, dist, .git, coverage, .next. Any hit in source/config/artifact paths = gap (quote the line as evidence).
4. Manifest + conformance (kind: manifest): the app must declare the approved manifest (per inventory/manifestPath) AND the package name must match the directory (kebab-case) per the repo's name-conformance gate. Missing/undec lared manifest or a name that cannot fit @hasna/<dir-name> = gap.
5. Tests (kind: tests): for a shipped package (not a fixture/dev tool), no tests at all = gap (confirm by reading the tree, not by guessing).
6. README 2-mode (kind: readme): confirm inventory readmeModes is "missing" or "partial" yourself — README must cover BOTH product stories and the sqlite|postgresql switch; missing/partial = gap.
7. Storage dual gate (kind: storage): inventory storageCheck "mono" = gap (sqlite-only or postgres-only, mode-enum branching/vocabulary, or a client-side PostgresStore).
8. bun run check (kind: check): run 'bun run check' inside ${d} (fall back to "${repoPath}" only if the app has no check script; never retry more than twice). A REAL gate failure (CI error line, not missing-deps/timeout/env) = gap; quote the exact last error lines. Timeout/env failure = "unverified", not a gap.
Rule for evidence: evidence < 30 chars of specificity = it is not evidence; leave the check in "unverified".
ID format: "AUDIT-${appSlugVal}-<KIND-UPPERCASE>" where KIND is one of: SURFACE | NAME | INTERNAL-STRING | MANIFEST | TESTS | README | STORAGE | CHECK.
priority: high for name/internal-string; medium for surface/manifest/check; low for tests/readme/storage.
Return EXACTLY one JSON line, no prose:
{"app":"${app}","gaps":[{"id":"AUDIT-${appSlugVal}-<KIND>","kind":"surface|name|internal-string|manifest|tests|readme|storage|check","summary":"<one sentence>","evidence":"<file:line or exact command output line>","priority":"high|medium|low"}],"unverified":["<check not runnable, with the reason>"],"clean":<bool>}`;
}

function taskPrompt(app, verdictText, repoPathForTask) {
  return `TASK-LANE AGENT — app "${app}" (hasna/apps audit -> hasna/todos).
VERDICT JSON (confirmed gaps only):
${verdictText}
Binding rules:
- Create/update hasna/todos tasks ONLY for "gaps" in the verdict; NEVER for "unverified"; NEVER delete, cancel, close, or complete any existing task.
- For each gap, in order:
  1. Title: "apps/${app}: <gap.kind> — <gap.summary>" (one gap = one task; keep the title short and specific).
  2. DEDUPE FIRST (title-normalized search): normalize the candidate title (lowercase, collapse whitespace, strip punctuation). Read open tasks with: todos list --project hasna-apps --json (bounded; if the project does not exist, create it once: todos projects --add "${repoPathForTask}" --name hasna-apps, then re-read). Also try: todos search "<title>" if the CLI has that verb (treat a verb error as non-fatal). If an OPEN task (pending/in_progress) has the SAME normalized title -> DO NOT create: append evidence with: todos comment <existing-id> "EVIDENCE (AUDIT): <gap.evidence> — finding <gap.id>" and count it as updated.
  3. Else create: todos add "apps/${app}: <gap.kind> — <gap.summary>" --project hasna-apps --priority <gap.priority> then todos comment <new-id> "EVIDENCE (AUDIT): <gap.evidence> — finding <gap.id>".
- NEVER create a duplicate; a create/comment failure is recorded verbatim in "errors" and never retried in a loop.
- Before any todos call, source the cloud env per the RECORD block below.
Return EXACTLY one JSON line, no prose:
{"app":"${app}","created":["<task-id>"],"updated":["<task-id>"],"duplicatesSkipped":<n>,"errors":["<exact cli error>"]}`;
}

function summaryPrompt(appsList, verdictLines, taskLines, scannedCount) {
  return `SUMMARY AGENT — hasna/apps standards audit.
Repo: ${repoPath}. Population: ${appsList.length} apps; final scan state: scanned ${scannedCount} of ${appsList.length} (fail-closed state — report it verbatim).
Per-app results (data; do NOT re-audit):
${verdictLines}
Task lanes:
${taskLines}
1. Compose the final summary in a plain register (no drama, no superlatives, one thing per paragraph): totals (apps scanned, confirmed gaps, tasks created/updated), the worst offenders, one line per app with its finding ids, and the exact next actions (the tasks created/updated in the hasna-apps project). Note any scanned != population mismatch in the summary.
2. POST it: ensure the channel exists ('conversations channel create hasna-apps' — an "already exists" error is fine), then: conversations send hasna-apps "<summary body, max 60 lines>" (source the cloud env first per RECORD).
3. Record per RECORD: a memento (key apps-<topic>) for any non-obvious root cause; file 'KNOWLEDGE: <item>' / 'SKILL: <name>' follow-up tasks when durable doctrine or a repeated procedure emerged.
Return the summary text as your final message (the exact text you posted).`;
}

// ----------------------------------------------------------------------------
// Idle handling: fleet pattern — the idle sleep happens INSIDE a census agent
// (bash sleep, min(idleMinutes,300)) followed by ONE re-check; standing
// continuity itself belongs to the coordinator relaunching this workflow.
// ----------------------------------------------------------------------------
async function idleHandle(seenApps, passLabel) {
  const seen = JSON.stringify(seenApps);
  const out = await safeAgent({
    prompt: withRecord(`IDLE-HANDLING AGENT — hasna/apps audit (standing mode).
1. Run: sleep ${idleSleepSeconds}   (fleet cap 300s; idleMinutes=${idleMinutes}).
2. Then re-check ONCE: list "${repoPath}/${appsRel}" again; for each directory with a package.json, compare against the previously seen set: ${seen}. Also note whether the repo HEAD changed (git -C "${repoPath}" rev-parse HEAD).
Return EXACTLY one JSON line, no prose: {"slept":true,"newApps":["<app names NOT in the seen set>"],"headChanged":<bool|null>}`),
    tools: AT,
  });
  const parsed = out ? parseObj(out, `idle-${passLabel}`) : null;
  if (parsed && parsed.slept === true) {
    log(
      `[audit-apps-gaps] idle re-check (${passLabel}) done; newApps: ${
        Array.isArray(parsed.newApps) && parsed.newApps.length > 0
          ? parsed.newApps.join(', ')
          : '(none)'
      }`
    );
  }
}

// ----------------------------------------------------------------------------
// Bounded pass loop. One pass = census -> inventory -> verdict -> tasks ->
// summary, all fan-outs bounded to maxConcurrency (<= 16, runtime cap).
// ----------------------------------------------------------------------------
let lastScanned = 0;
let lastPopulation = 0;
let lastPassFailures = 0;
let finalSummary = null;

for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
  const passStartFailures = failureCount;
  log(
    `[audit-apps-gaps] pass ${pass}/${MAX_PASSES} begins (cumulative failures: ${failureCount})`
  );

  // SAFETY: after any failure in the previous pass, the next pass sleeps 300
  // first (fleet pattern) — via an agent, because the script has no shell.
  if (lastPassFailures > 0) {
    log(`[audit-apps-gaps] pass ${pass}: sleeping 300 first (prior failure)`);
    await safeAgent({
      prompt: withRecord(
        `PASS-SLEEP AGENT. Run: sleep 300 — then reply with EXACTLY {"slept":true} (one line, no prose). Do nothing else.`
      ),
      tools: ['Bash'],
    });
  }

  // Phase: census (bounded, 1 agent) — the population is what all bounds key on.
  const apps = await phase(`pass-${pass}-census`, async () => {
    const censusOut = await safeAgent({
      prompt: withRecord(censusPrompt()),
      tools: AT,
    });
    if (censusOut == null) {
      throw new Error(
        `fail-closed: census agent failed; app population unknown (pass ${pass})`
      );
    }
    const list = parseArr(censusOut, `census-${pass}`);
    if (list == null) {
      throw new Error(
        `fail-closed: census output unparseable; app population unknown (pass ${pass})`
      );
    }
    return [...new Set(list)].sort();
  });

  if (!apps) {
    throw new Error(`fail-closed: census phase failed; app population unknown (pass ${pass})`);
  }
  lastPopulation = apps.length;
  lastScanned = 0;

  if (apps.length === 0) {
    // IDLE PATH: nothing to audit this pass.
    log(
      `[audit-apps-gaps] pass ${pass}: no app directories under ${repoPath}/${appsRel}`
    );
    await idleHandle(apps, `pass-${pass}-empty`);
    lastPassFailures = failureCount - passStartFailures;
    continue;
  }
  if (apps.length > MAX_APPS_PER_PASS) {
    throw new Error(
      `fail-closed: ${apps.length} apps exceed MAX_APPS_PER_PASS=${MAX_APPS_PER_PASS}; narrow scope (args.appName) or run in batches`
    );
  }

  const fanCfg = {
    maxConcurrency: Math.min(maxConcurrency, apps.length),
  };

  // Phase 1: inventory survey — parallel bounded per-app agents.
  const inventories = await phase(`pass-${pass}-inventory`, async () =>
    parallel(
      apps.map((app) =>
        safeAgent({ prompt: withRecord(inventoryPrompt(app)), tools: AT })
      ),
      fanCfg
    )
  );

  // Phase 2: verdicts per app — confirmed gaps with file evidence.
  const verdicts = await phase(`pass-${pass}-verdicts`, async () => {
    const verdictOs = apps.map((app, i) =>
      parseObj(inventories[i], `inventory-${app}`)
    );
    const inventoryTexts = apps.map(
      (app, i) =>
        JSON.stringify(
          verdictOs[i] ?? {
            app,
            dirExists: false,
            pkgName: null,
            binKeys: null,
            exportKeys: null,
            scriptKeys: null,
            hasManifest: null,
            manifestPath: null,
            tests: null,
            readmeExists: null,
            readmeModes: 'unknown',
            storageCheck: 'unknown',
            notes: 'inventory lane failed or unparseable',
          }
        )
    );
    return parallel(
      apps.map((app, i) =>
        safeAgent({
          prompt: withRecord(
            verdictPrompt(app, inventoryTexts[i], appSlug(app))
          ),
          tools: AT,
        })
      ),
      fanCfg
    );
  });

  const verdictOs = apps.map((app, i) =>
    parseObj(verdicts[i], `verdict-${app}`)
  );
  lastScanned = verdictOs.filter(Boolean).length;
  log(
    `[audit-apps-gaps] pass ${pass}: scanned ${lastScanned} of ${lastPopulation} apps (real: ${
      lastScanned === lastPopulation
        ? 'complete'
        : `INCOMPLETE — ${lastPopulation - lastScanned} app(s) had a failed or unparseable verdict lane`
    })`
  );
  if (lastScanned !== lastPopulation) {
    log(
      `[fail-closed] pass ${pass}: scanned ${lastScanned} of ${lastPopulation} apps`
    );
  }

  // Phase 3: create/update todos tasks ONLY for confirmed gaps.
  const taskRows = await phase(`pass-${pass}-tasks`, async () =>
    parallel(
      apps.map((app, i) => {
        const v = verdictOs[i];
        const verdictText = v
          ? JSON.stringify(v)
          : JSON.stringify({
              app,
              gaps: [],
              unverified: ['verdict lane failed or unparseable'],
              clean: false,
            });
        return safeAgent({
          prompt: withRecord(taskPrompt(app, verdictText, repoPath)),
          tools: AT,
        });
      }),
      fanCfg
    )
  );

  const taskOs = apps.map((app, i) =>
    parseObj(taskRows[i], `task-${app}`)
  );

  // Phase 4: summary + #hasna-apps post.
  const verdictLines = apps.map((app, i) => {
    const v = verdictOs[i];
    if (!v) return `- apps/${app}: LANE FAILED (no verdict)`;
    const gapKinds = (v.gaps || [])
      .map((g) => g.kind)
      .join(', ');
    const unv = (v.unverified || []).length;
    return `- apps/${app}: ${(v.gaps || []).length} confirmed gap(s) [${gapKinds}] — unverified: ${unv}${v.clean ? ' (clean)' : ''}`;
  });
  const taskLines = apps.map((app, i) => {
    const t = taskOs[i];
    if (!t) return `- apps/${app}: task lane failed`;
    return `- apps/${app}: created=${(t.created || []).length} updated=${(t.updated || []).length} duplicatesSkipped=${t.duplicatesSkipped ?? 0} errors=${(t.errors || []).length}`;
  });

  const summary = await phase(`pass-${pass}-summary`, async () =>
    safeAgent({
      prompt: withRecord(
        summaryPrompt(apps, verdictLines.join('\n'), taskLines.join('\n'), lastScanned)
      ),
      tools: AT,
    })
  );
  finalSummary =
    summary && typeof summary === 'string'
      ? summary
      : `[summary lane returned nothing parseable] scanned ${lastScanned} of ${lastPopulation} apps`;

  log(`[audit-apps-gaps] pass ${pass} summary:\n${finalSummary}\n[end summary]`);

  lastPassFailures = failureCount - passStartFailures;

  // IDLE PATH for a clean pass under standing mode: agent-side sleep + one
  // re-check, then the next (bounded) pass re-censuses.
  const gapTotal = verdictOs.reduce(
    (n, v) => n + (v && Array.isArray(v.gaps) ? v.gaps.length : 0),
    0
  );
  if (gapTotal === 0 && pass < MAX_PASSES) {
    log(`[audit-apps-gaps] pass ${pass}: zero confirmed gaps — idle sleep + re-check`);
    await idleHandle(apps, `pass-${pass}-clean`);
  }
}

// ----------------------------------------------------------------------------
// Fail closed on bounds. A partial or failure-laden FINAL pass never passes;
// every message states the exact "scanned X of N apps" state.
// ----------------------------------------------------------------------------
if (lastScanned !== lastPopulation) {
  throw new Error(
    `fail-closed: scanned ${lastScanned} of ${lastPopulation} apps — the final pass was incomplete (a verdict/task lane failed or returned unparseable output); rerun with a working scope (or let the coordinator relaunch in standing mode)`
  );
}
if (lastPassFailures > 0) {
  throw new Error(
    `fail-closed: ${lastPassFailures} subagent failure(s) on the final pass; scanned ${lastScanned} of ${lastPopulation} apps — rerun or wait for the next coordinator relaunch`
  );
}

return finalSummary ?? 'no summary produced';
