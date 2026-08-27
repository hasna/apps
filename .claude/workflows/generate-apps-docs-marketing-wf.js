// .claude/workflows/generate-apps-docs-marketing.js
// ============================================================================
// generate-apps-docs-marketing — docs + marketing-page accuracy lane (hasna/apps)
//
// RUNTIME CAPS ([FACTS] verified 2026-08): plain-JS dynamic workflow; the script
// body is plain JavaScript with top-level `await`; NO import() (a script that
// contains it fails before the run starts); NO direct filesystem/shell access
// from the workflow itself — the AGENTS do all reads/writes/commands; up to 16
// concurrent agents (fewer when CPU-limited); 1,000 agents TOTAL per run (the
// cap that forbids an unbounded while-loop); every agent inherits the SESSION
// MODEL unless the script sets one — this file sets NO model fields anywhere,
// per owner requirement. Runs are resumable within the same session; saved
// workflows run as /generate-apps-docs-marketing.
//
// CONTINUITY MODEL ([FACTS] verified): "infinite" standing behaviour =
// BOUNDED pass loop in-script (MAX_PASSES hard bound per run, because of the
// 1,000-agent cap) + idle handled INSIDE a census agent via bash sleep (fleet
// uses 300s) + one re-check; the standing continuity comes from the
// COORDINATOR re-launching the workflow (the 10-min health loop). Never a
// literal while(true); never an unbounded agent spawn.
//
// SAFETY MODEL ([FACTS] verified, required): a subagent completing WITHOUT
// StructuredOutput makes agent() throw; the runtime also resolves agent() to
// null when an agent is stopped or hits an unrecoverable API error. An uncaught
// throw previously killed a whole infinite run (wf_b4894f28-d61, 37 agents,
// 2.7h). Every agent() therefore goes through safeAgent(), which catches, logs,
// returns null, and records the label in `failures` so the NEXT pass's census
// agent sleeps 300s first; a final pass with failures exits failed — never a
// silent partial pass.
//
// API SURFACE ([FACTS] + code.claude.com/docs/en/workflows, v2.1.x):
//   export const meta = { name, description }
//   agent(promptString, { label, schema?, tools? }) -> StructuredOutput result (or null)
//   pipeline(list, (item) => agent(...), opts?) -> results array, keeps nulls
//   phase(name), log(message), global `args` (undefined if omitted)
// Fan-outs here use pipeline(), the documented parallel primitive; `parallel`
// has no documented signature, so it is intentionally not invoked.
//
// [FACTS] THIS FILE DEPENDS ON:
//  - RECORDING V2 (owner requirement, EVERY workflow, EVERY agent prompt — the
//    RECORD const is interpolated into every agent prompt below): conversations
//    #hasna-apps claim/milestone/done, todos --project hasna-apps task+comments,
//    mementos apps-<topic> on root causes/decisions, KNOWLEDGE/SKILL/INSTRUCTIONS
//    follow-up todos (never silent adds), cloud env sourcing, NEVER print a
//    credential value.
//  - REPO LAWS (hasna/apps): PR-first, worktree-only; commits end with the
//    trailer `Agent: <registered-fleet-identity>` (exactly one, no
//    Co-Authored-By); staged secrets scan before every commit/push; never
//    introduce @hasna-internal / internal strings (AWS ids, *.hasna.xyz) into
//    public docs/marketing artifacts; `bun run check` before PR.
//  - TAXONOMY: basename == meta.name == 'generate-apps-docs-marketing' matches
//    ^(audit|fix|generate|migrate|monitor|research|review|triage|verify)-[a-z0-9]+(?:-[a-z0-9]+)*$
//    (closed verb 'generate'); no dates/versions/ids in the name; version via
//    source control, not the command name.
//  - NO SILENT DOCS CLAIMS: every added/changed sentence in docs or marketing
//    must trace to an artifact (code file:line, release tag, issue number, or
//    published version); verify phase enforces it mechanically.
// ============================================================================

export const meta = {
  name: 'generate-apps-docs-marketing',
  description: 'Keep hasna/apps docs and the marketing page truthful against release and issue state: parallel gather of release history, open issue/PR themes, marketing-page sources, and docs claims; verdict every claim and page section against code and shipped features; produce traced worktree edits plus a release-notes delta; then mechanically verify claim-to-artifact traces and render. Owner-authorized standing lane: bounded pass loop (args.maxPasses, default 3, hard cap 5) with agent-side idle sleep (args.idleMinutes default 30, capped at 300s), fail-closed on failed subagents, standing continuity via coordinator re-launch; no deploy, no merge.',
};

// ----------------------------------------------------------------------------
// Scope from args only — fail closed on missing required input.
// ----------------------------------------------------------------------------
const A = args ?? {};
const REPO = typeof A.repo === 'string' ? A.repo.trim() : '';
if (!REPO) {
  throw new Error('generate-apps-docs-marketing: missing required arg --repo (e.g. "hasna/apps"); scope comes from args only');
}
const WORKTREE = typeof A.worktree === 'string' ? A.worktree.trim() : '';
if (!WORKTREE) {
  throw new Error('generate-apps-docs-marketing: missing required arg --worktree (task worktree path, e.g. $HOME/.hasna/repos/worktrees/apps/<task-name>); docs edits land there only');
}
const BRANCH = typeof A.branch === 'string' ? A.branch.trim() : '';
const MAX_PASSES = Math.min(5, Math.max(1, Number(A.maxPasses ?? 3) || 3)); // hard bound per run (1,000-agent cap)
// Idle window: args-driven in minutes; the census agent sleeps min(idleMinutes*60, 300)s
// then re-checks once — with the default idleMinutes=30 this lands exactly on the
// fleet-measured 300s sleep cap. Never a live wait longer than 300s inside one agent.
const IDLE_SLEEP_SECS = Math.min(300, Math.max(30, (Number(A.idleMinutes ?? 30) || 30) * 60));

// ----------------------------------------------------------------------------
// RECORDING V2 preamble (owner requirement) — interpolated into EVERY agent prompt.
// ----------------------------------------------------------------------------
const RECORD = `Record while working: (1) conversations: claim/post to #hasna-apps at start (create via 'conversations channel create hasna-apps' if missing), milestone after each phase, done at the end; (2) todos: one task per work item (todos add --project hasna-apps), todos comment with evidence as you go, status start/complete only with proof (merged PR / verified live); (3) mementos: mementos save key apps-<topic> on every non-obvious root cause/decision; (4) knowledge: on durable doctrine, file a follow-up task 'KNOWLEDGE: <item>' for the knowledge lane (never silent add); (5) skills: on a repeated procedure, file 'SKILL: <name>' follow-up; (6) instructions: only when the workflow itself changes rules (then file 'INSTRUCTIONS: <config>'). Cloud env (fleet-env primary; legacy ~/.hasna/cloud removed 2026-10-01): for f in todos conversations mementos knowledge; do if [ -f "$HOME/.hasna/fleet-env/$f.env" ]; then set -a; . "$HOME/.hasna/fleet-env/$f.env"; set +a; elif [ -f "$HOME/.hasna/cloud/$f.env" ]; then set -a; . "$HOME/.hasna/cloud/$f.env"; set +a; fi; done. NEVER print a credential value.`;

function withRecord(text) {
  return `${RECORD}\n\n${text}`;
}

// ----------------------------------------------------------------------------
// Safe agent wrapper + result helpers.
// ----------------------------------------------------------------------------
const failures = [];

function safeText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r.content === 'string') return r.content;
  if (typeof r.output === 'string') return r.output;
  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}

function parseJson(text) {
  const t = String(text ?? '').trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* not parseable */ }
  }
  return null;
}

// catch -> log -> null + failure flag (next pass sleeps 300s first via the census agent)
async function safeAgent(label, prompt, opts = {}) {
  try {
    const result = await agent(prompt, { label, ...opts });
    // The runtime resolves an agent to null when it is stopped mid-run or hits an
    // unrecoverable API error; a completed agent without StructuredOutput throws.
    // Both are failures here — never count them as a pass.
    if (result == null) {
      throw new Error('agent() resolved to null (stopped or unrecoverable API error)');
    }
    return result;
  } catch (err) {
    log(`[SAFE-AGENT] ${label} FAILED: ${err && err.message ? err.message : String(err)}`);
    failures.push(label);
    return null;
  }
}

// Fan-out helper over the documented pipeline() primitive.
function runLane(specs) {
  return pipeline(specs, (spec) => safeAgent(spec.label, spec.prompt, { tools: spec.tools }));
}

const TOOLS_READ = ['Bash', 'Read', 'Grep', 'Glob'];
const TOOLS_WRITE = ['Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write'];

// ----------------------------------------------------------------------------
// Agent prompts (each one ends with the StructuredOutput contract).
// ----------------------------------------------------------------------------

function censusPrompt(pass) {
  const prior = failures.length > 0
    ? `PRIOR-FAILURE: the previous pass had failed agents: [${failures.join(', ')}]. BEFORE any other action, run bash: sleep 300 ; then re-check the state those agents were verifying and note whether it recovered. Do not proceed to the normal idle check until that re-check is done.`
    : '';
  return withRecord(`You are the census agent for pass ${pass} of the hasna/apps docs+marketing accuracy lane (repo ${REPO}).

${prior}

Claims-check the lane BEFORE any work: keep docs and the marketing page truthful against release/issue state. Determine, from the task worktree and the GitHub API, whether any docs/marketing work is pending:

1. RELEASES: in the worktree, read git log --oneline -40, CHANGELOG/release-notes files, and the apps' package.json versions; compare with published releases: gh release list --repo ${REPO} --limit 30 and npm view <@hasna/* package> versions --json for the main packages. Any release/version not reflected in docs or the marketing page = pending.
2. ISSUES/PRs: gh issue list --repo ${REPO} --state open --limit 100 --json number,title,labels and gh pr list --repo ${REPO} --state open --limit 100 --json number,title — any issue/PR whose title or labels touch docs, marketing, or a released/renamed/removed surface = pending.
3. Only count as pending items that actually change what docs or the marketing page claim.
4. Post the claim to #hasna-apps first (if the phase has no prior claim), per the record rules above, and record one todos task "--project hasna-apps" for this pass.

If NO pending work: run bash: sleep ${IDLE_SLEEP_SECS} ; then re-check once with the same three probes. If still nothing pending, return IDLE.
If pending work exists, return WORK with a concrete findings list (what changed, what file/section it affects, which release/issue proves it). Never invent an item — an unverifiable claim is not evidence.

End with StructuredOutput: {"verdict":"WORK|IDLE","findings":"<concrete findings after the probes>"}.

Do the sleep by bash. Do not deploy, do not edit files.`);
}

function releaseHistoryPrompt() {
  return withRecord(`You are the release-history gather agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE} (a task worktree; do not touch any other checkout).

Produce the authoritative release/version picture for docs+marketing accuracy:
1. In the worktree: git log --oneline -40 (read the raw output, no pipes), list CHANGELOG*/RELEASE_NOTES* files and read the most recent ones.
2. gh release list --repo ${REPO} --limit 30 (read raw output).
3. Enumerate the published packages: find app package.json files under apps/ (their "name" and "version" fields only), then for each public @hasna/* package compare the published version (npm view <name> version) with the version in the tree and with the latest README/docs claims.
4. For each package, state the surface-level delta since the last docs sync: new/deprecated/renamed/removed public API, new install instructions, changed behavior. Every delta must cite an artifact (a commit sha from the log, a release tag, or a version number).

Record progress per the record rules (milestone to #hasna-apps, todos comment with evidence).

End with StructuredOutput: {"content":"<the release/version delta list, each item citing its artifact>"}`);
}

function issueThemesPrompt() {
  return withRecord(`You are the issue/PR-themes gather agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

Gather and cluster what the open GitHub state implies for docs and the marketing page:
1. gh issue list --repo ${REPO} --state open --limit 100 --json number,title,labels — read the raw JSON output to a file, do NOT pipe it (the CLI truncates stdout through pipes).
2. gh pr list --repo ${REPO} --state open --limit 100 --json number,title,labels — same capture rule.
3. Cluster items into themes; classify each cluster DOCS-AFFECTING only when it changes what a reader is told: new feature, renamed or removed surface, migration path, behavior change, or a claim that is now false. Assign each docs-affecting item the page/section it would touch (inference is fine; the later diff agent verifies it).
4. List unreleased features that the marketing page may already be claiming.

Record progress per the record rules.

End with StructuredOutput: {"content":"<themes:\\n- <theme>: items <numbers>, docsImpact=<sections>\\nDOCS-AFFECTING:<issue|pr|feature -> section>\\nUNRELEASED-FEATURES:<...>>"}`);
}

function marketingSourcePrompt() {
  return withRecord(`You are the marketing-page source-location gather agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE} (task worktree only).

Find where "the marketing page" lives in this tree and what it claims:
1. Search for the site/landing directories: find . -maxdepth 5 -type d \( -name '*site*' -o -name '*landing*' -o -name 'www' \) (in the worktree), plus apps/*/README.md files and docs/ directories.
2. Identify the marketing page source files (the page the owner would see at the public site) versus plain repo docs. Likely candidates: an app site dir (e.g. apps/<app>/site or similar), a top-level marketing/ or site/ dir, or the README hero/feature section. Distinguish clearly: MARKETING-PAGE files vs DOC files.
3. Extract the page's factual claims: headline, feature bullets, install/quick-start lines, pricing/status assertions — as a list of {section, claim, file}.
4. Also report the static-render/build entry point of that site (package.json scripts or a build config), so the verify phase can render-check it.

Record progress per the record rules.

End with StructuredOutput: {"content":"<MARKETING-FILES:\\n<absolute-or-repo-relative path>\\nDOC-FILES:\\n<...>\\nCLAIMS:\\n- section=<section> file=<file> claim=<claim>\\nRENDER-ENTRY:<command or n/a>>"}`);
}

function docsInventoryPrompt() {
  return withRecord(`You are the docs-claims inventory gather agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

Inventory documentation claims and collect the present-tense statements that must match reality (the agent-md claim-check discipline):
1. Enumerate docs: README.md files under apps/, AGENTS.md files, docs/ directories, any CONTRIBUTING or install guides. Use find . -maxdepth 5 -name 'README.md' -o -name 'AGENTS.md'.
2. For each, extract every PRESENT-TENSE factual claim — sentences asserting what the software does, how to install/configure it, what it supports, version compatibility ("install with X", "supports Y", "is delivered as Z") — as a list of {file, claim}.
3. Flag the claims that look stale on inspection (a claim that contradicts a glance at the code or the release history), but do NOT edit anything — this is gather only.

Record progress per the record rules.

End with StructuredOutput: {"content":"<CLAIMS:\\n- file=<path> claim=<sentence>\\nSTALE-LOOKING:<claims you flagged and why>>"}`);
}

function docsVerdictPrompt(relText, invText) {
  return withRecord(`You are the docs-vs-reality verdict agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

Verdict every docs claim against code and shipped releases — read-only, no edits.

INVENTORY (from the gather agents, quoted verbatim — trust it only as a starting point, re-verify against the worktree):
${invText}

RELEASES:
${relText}

For EVERY claim, run the check and record one verdict:
- ACCURATE: the claim matches code/releases; name the proof (file:line, release tag, version).
- STALE: the claim no longer matches (code changed, release shipped, behavior differs); name what it should say and the artifact proving the new truth.
- MISSING: the claim asserts something with no supporting code/release artifact.
- UNVERIFIED: you could not check it (rate limit, missing access); say so.

Output per claim exactly one line: CLAIM-VERDICT: <ACCURATE|STALE|MISSING|UNVERIFIED> | file=<path> | claim=<short> | proof=<artifact or none>.
Add a summary line: CLAIM-CHECK: <PASS if zero STALE/MISSING, else FAIL>.

Record your verdict per the record rules (milestone to #hasna-apps, todos comment).

End with StructuredOutput: {"content":"<the verdict lines + summary line>"}`);
}

function marketingVerdictPrompt(mktText, relText, issueText) {
  return withRecord(`You are the marketing-vs-release verdict agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

Map every marketing-page section claim to shipped reality and open issues — read-only, no edits.

MARKETING-PAGE:
${mktText}

RELEASES:
${relText}

OPEN ISSUES/PRs:
${issueText}

For every section claim list one verdict:
- IN-SYNC: the page matches shipped features; proof = release tag or version.
- STALE: a feature shipped/renamed/removed but the page still claims the old truth; cite the release/version.
- UNRELEASED: the page claims a feature not in the latest shipped package versions; cite the failing version.
- ISSUE-DRIVEN: an open issue/PR requires a page change (bug in what the page says, feature the page must add, wording correction); cite the issue/PR number.
- OWNER-APPROVAL: the change is marketing copy where wording judgment belongs to the owner — list it as a follow-up TODO, do NOT draft the final wording as an edit.

Output one line per section: SECTION-VERDICT: <IN-SYNC|STALE|UNRELEASED|ISSUE-DRIVEN|OWNER-APPROVAL> | section=<name> | claim=<short> | driver=<release tag | issue # | version | none>.
Also list any issue/PR that must drive an update: ISSUE-DRIVE: <number> -> <section>.
Summary line: MARKETING-CHECK: <PASS if no STALE/UNRELEASED/ISSUE-DRIVEN, else FAIL>.

Record your verdict per the record rules.

End with StructuredOutput: {"content":"<the section verdict lines + ISSUE-DRIVE lines + summary line>"}`);
}

function editDocsPrompt(verdictText, relText) {
  return withRecord(`You are the docs-editing produce agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE} — the ONLY place you edit; never touch another checkout, never edit on a shared checkout.

VERDICTS FROM THE DIFF PASS:
${verdictText}

RELEASES FOR CONTEXT:
${relText}

Do the mechanical docs corrections only:
1. Confirm the worktree's current branch is NOT main (bash: git -C ${WORKTREE} branch --show-current; if it is main, abort and return the refusal in StructuredOutput — never edit or commit on main). If a task branch is missing, create it: git -C ${WORKTREE} checkout -b docs/sync-\$(date +%Y%m%d).
2. For every STALE/MISSING claim: edit the file so the claim matches the artifact (code, release tag, version). Keep the change minimal. If a fix needs copy judgment the owner should make, do NOT edit — create follow-up: todos add --project hasna-apps "DOCS-APPROVAL: <file> — <what wording decision is needed>".
3. For every newly added/changed sentence, record its trace: CLAIM-SOURCE: <file> | <claim> | <artifact (file:line, release tag, issue #, npm version)>.
4. NEVER introduce @hasna-internal, AWS account ids, *.hasna.xyz internal URLs, or any internal-only string into a public docs artifact.
5. Commit: staged secrets scan first (secrets scan staged > file; rc=0 means clean; any non-zero = stop, do not commit), then commit with a conventional message ENDING with exactly one trailer line: Agent: <your registered fleet identity (conversations whoami; never a model/vendor/email)>.
6. If any edits were made: push the branch and open ONE pull request (gh pr create --repo ${REPO} --title "docs: sync claims to release/issue state" --body-file <file>), with the PR body ending with the same single Agent: trailer line. If nothing needed editing, make no commit and no PR.

Record per the record rules: milestone to #hasna-apps, todos comments with commit/PR evidence.

End with StructuredOutput: {"content":"<EDITS:\\n- file=<path> change=<what changed> trace=<artifact>\\nCOMMIT:<sha or none>\\nPR:<url or none>\\nAPPROVAL-FOLLOWUPS:<todos ids or none>>"}`);
}

function editMarketingPrompt(mktText, verdictText, issueText) {
  return withRecord(`You are the marketing-page editing produce agent for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE} — the ONLY place you edit.

MARKETING VERDICTS:
${verdictText}

MARKETING PAGE:
${mktText}

OPEN ISSUES/PRs:
${issueText}

Apply only the changes that are factual and mechanical:
1. Confirm the worktree branch is NOT main (git -C ${WORKTREE} branch --show-current; abort via StructuredOutput if main).
2. For each STALE or UNRELEASED section: align the page's claim with the shipped reality (cite the release tag/version in the commit message or a comment). For each ISSUE-DRIVEN section: apply only what the issue spells out as a fact; link the issue number in the commit message or a comment.
3. OWNER-APPROVAL items: NO edit. Create the follow-up instead: todos add --project hasna-apps "DOCS-APPROVAL: <section> — <the wording decision needed, with the evidence>" and record the id.
4. Every added/changed sentence must carry a trace: CLAIM-SOURCE: <section> | <claim> | <artifact (issue #, release tag, version)>.
5. NEVER introduce @hasna-internal, AWS account ids, internal *.hasna.xyz URLs, or any internal-only string into the marketing page.
6. Commit: staged secrets scan first (secrets scan staged; rc 0 = clean; non-zero = stop, do not commit), then one commit with a conventional message ending with exactly one trailer line: Agent: <your registered fleet identity>. Push the branch (do not merge).

Record per the record rules (milestone to #hasna-apps, todos comments).

End with StructuredOutput: {"content":"<EDITS:\\n- section=<name> change=<what changed> trace=<artifact>\\nCOMMIT:<sha or none>\\nAPPROVAL-FOLLOWUPS:<todos ids or none>>"}`);
}

function releaseDeltaPrompt(relText, verdictText) {
  return withRecord(`You are the release-notes delta producer for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE} — the ONLY place you edit.

RELEASES:
${relText}

VERDICTS:
${verdictText}

Produce the release-notes delta:
1. Read the existing CHANGELOG*/RELEASE_NOTES* file (whichever the repo uses). Determine which new releases/versions are NOT yet documented.
2. Create the delta section(s) for exactly those releases, at the top of the file (or in a new RELEASE_NOTES.md only if the repo has no notes file — then say so in the output). Each delta entry contains: package + version, one-line summary of the user-visible change, and every item traceable to a commit sha or release tag from the release history.
3. NEVER invent a change — no artifact, no entry. A change missing from the release history is a KNOWN-GAP line, not a claim.
4. NEVER introduce internal-only strings into the notes (they are public).
5. Commit: staged secrets scan first (secrets scan staged; rc 0 = clean; non-zero = stop), then one conventional commit ending with exactly one trailer line: Agent: <your registered fleet identity>. Push the branch (do not merge, do not open a second PR if the docs PR covers it — otherwise open one).

Record per the record rules.

End with StructuredOutput: {"content":"<DELTA:\\n- version=<pkg@version> entry=<summary> trace=<sha|tag>\\nKNOWN-GAPS:<...>\\nCOMMIT:<sha or none>\\nPR:<url or none>>"}`);
}

function verifyClaimsPrompt(editText, mktText) {
  return withRecord(`You are the mechanical claims verifier for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

EDITS CLAIMING TRACE:
${editText}

MARKETING EDITS:
${mktText}

Enforce NO SILENT DOCS CLAIMS mechanically:
1. For every sentence the produce phase added/changed (in docs and the marketing page), re-derive its artifact: grep the code for the asserted symbol/behavior (bash grep -rn in the affected app's src), or cite the release tag / published version / issue number. A claim traces when the artifact exists in the code or in a release the tree actually declares.
2. Present-tense claims MUST exist in code: verify each by running the grep; a present-tense claim with no matching code symbol = FAIL.
3. Run the repo conformance check for the affected scope (bun run check in the app dir, or the repo root if docs-only changes break nothing — pick the narrowest lane that plausibly changed; name the lane you ran). Report the exact command and rc.
4. Do not fix anything; report only.

Output line per claim: CLAIM-TRACE: PASS|FAIL | claim=<short> | artifact=<file:line | release tag | version | issue # | NONE>.
Summary line: CLAIM-CHECK: <PASS if all PASS and check rc=0, else FAIL>.

Record per the record rules (milestone to #hasna-apps).

End with StructuredOutput: {"content":"<the claim-trace lines + summary line>"}`);
}

function verifyRenderPrompt(mktText) {
  return withRecord(`You are the render verifier for hasna/apps (repo ${REPO}). Working directory: ${WORKTREE}.

MARKETING PAGE (from gather):
${mktText}

Prove the marketing page still renders after the edits — verification only, no deploy, no publish:
1. If the page has a declared build/render entry (from the gather step, or by reading the site package.json scripts): run the narrowest build/static check that exercises the page in the worktree (e.g. bun run build in the site dir, next build, or a static HTML/link sanity pass). Report the exact command and rc.
2. If no build infra exists, do a bounded static check: all internal links in the changed page resolve to files in the worktree; no broken markdown fences; no template placeholder left; no internal-only string (@hasna-internal, AWS account ids, *.hasna.xyz) in the page.
3. Do NOT run any deploy step. Deploy ([DEPLOY INTENT]/[DEPLOY-CONFIRM] to git-deployments) is explicitly out of scope for this lane — note that in the output.
4. Record per the record rules (milestone to #hasna-apps).

Output line: RENDER-CHECK: <PASS | FAIL> | command=<... or static> | rc=<...> | note=<evidence or reason>.
End with StructuredOutput: {"content":"<the RENDER-CHECK line + evidence>"}`);
}

function followupPrompt(editDocsText, editMktText, deltaText) {
  return withRecord(`You are the follow-up audit agent for the hasna/apps docs+marketing lane (repo ${REPO}).

WORK DONE:
${editDocsText}
${editMktText}
${deltaText}

1. Audit that every item needing an owner decision or a durable artifact has a row in todos --project hasna-apps: DOCS-APPROVAL:<...> for copy-approval items; KNOWLEDGE:<item> for any doctrine this lane established (never a silent knowledge add); SKILL:<name> only if a repeated procedure emerged (this lane repeats, but the repeated orchestration lives in this workflow, so SKILL applies only to a manual procedure an agent performs); INSTRUCTIONS:<config> only if the workflow changed rules (it does not — say so if that is the case).
2. Create any missing rows (todos add --project hasna-apps "<TYPE>: <item> — <one-line reason>"), and list every row id with its type and status.
3. Post the DONE milestone to #hasna-apps: summarize pass count, the edits/PR, the verdicts (CLAIM-CHECK / MARKETING-CHECK / RENDER-CHECK), and the follow-up ids.
4. Verify the production PR (if one was opened) at least exists and the branch is pushed; do not merge.

End with StructuredOutput: {"content":"<FOLLOWUPS:\\n- <type> <todos-id> <status>\\nPR:<url or none>\\nDONE:<one-line summary of what changed this run>"}`);
}

// ----------------------------------------------------------------------------
// Run — bounded pass loop (NEVER unbounded; standing continuity via coordinator relaunch).
// ----------------------------------------------------------------------------

phase('generate-apps-docs-marketing');
log(`start repo=${REPO} worktree=${WORKTREE} maxPasses=${MAX_PASSES} idleSleepSecs=${IDLE_SLEEP_SECS}`);

let finalClaimCheck = '';
let finalMarketingCheck = '';
let finalRenderCheck = '';
let finalFailures = 0;

for (let pass = 1; pass <= MAX_PASSES; pass++) {
  phase(`pass-${pass}`);
  log(`pass ${pass}/${MAX_PASSES} started${failures.length > 0 ? ` — ${failures.length} prior agent failure(s); census sleeps 300s first` : ''}`);

  // --- census: failure recovery sleep, then idle check (sleep + one re-check) ---
  const census = await safeAgent('census', censusPrompt(pass), { tools: TOOLS_READ });
  if (census == null) {
    log('census failed; recorded — next pass retries after the 300s recovery sleep');
    continue;
  }
  const censusJson = parseJson(safeText(census));
  const verdict = censusJson && typeof censusJson.verdict === 'string' ? censusJson.verdict : '';
  if (verdict === 'IDLE') {
    log(`pass ${pass}: census IDLE — docs/marketing already in sync; standing continuity is the coordinator re-launching this workflow (10-min health loop)`);
    return { status: 'idle', pass, repo: REPO };
  }
  if (verdict !== 'WORK') {
    log(`census verdict unparseable: "${safeText(census).slice(0, 160)}" — recorded as failure`);
    failures.push('census-verdict');
    continue;
  }
  log(`pass ${pass}: census found pending work — ${String(censusJson.findings ?? '').slice(0, 200)}`);

  // --- Phase 1: gather (parallel fan-out; read-only) ---
  phase('gather');
  const [rel, issues, mkt, inv] = await runLane([
    { label: 'release-history', prompt: releaseHistoryPrompt(), tools: TOOLS_READ },
    { label: 'issue-themes', prompt: issueThemesPrompt(), tools: TOOLS_READ },
    { label: 'marketing-source', prompt: marketingSourcePrompt(), tools: TOOLS_READ },
    { label: 'docs-inventory', prompt: docsInventoryPrompt(), tools: TOOLS_READ },
  ]);
  const relText = safeText(rel);
  const issueText = safeText(issues);
  const mktText = safeText(mkt);
  const invText = safeText(inv);
  if ([rel, issues, mkt, inv].some((r) => r == null)) {
    log('gather incomplete (failures recorded); next pass retries');
    continue;
  }

  // --- Phase 2: diff-verdicts (parallel; read-only) ---
  phase('diff-verdicts');
  const [docsVerdict, mktVerdict] = await runLane([
    { label: 'docs-vs-reality', prompt: docsVerdictPrompt(relText, invText), tools: TOOLS_READ },
    { label: 'marketing-vs-release', prompt: marketingVerdictPrompt(mktText, relText, issueText), tools: TOOLS_READ },
  ]);
  const docsVerdictText = safeText(docsVerdict);
  const mktVerdictText = safeText(mktVerdict);
  if (docsVerdict == null || mktVerdict == null) {
    log('verdicts incomplete (failures recorded); next pass retries');
    continue;
  }
  finalClaimCheck = (docsVerdictText.match(/CLAIM-CHECK:\s*(PASS|FAIL)/) ?? [])[1] ?? '';
  finalMarketingCheck = (mktVerdictText.match(/MARKETING-CHECK:\s*(PASS|FAIL)/) ?? [])[1] ?? '';
  const needsWork = /STALE|UNRELEASED|ISSUE-DRIVEN|MISSING/i.test(`${docsVerdictText}\n${mktVerdictText}`);
  log(`pass ${pass}: docs check=${finalClaimCheck || 'n/a'} marketing check=${finalMarketingCheck || 'n/a'} needsWork=${needsWork}`);

  // --- Phase 3: produce (parallel; edits land in the task worktree, PR-first) ---
  if (needsWork) {
    phase('produce');
    const [docsEdit, mktEdit, deltaEdit] = await runLane([
      { label: 'edit-docs', prompt: editDocsPrompt(docsVerdictText, relText), tools: TOOLS_WRITE },
      { label: 'edit-marketing', prompt: editMarketingPrompt(mktText, mktVerdictText, issueText), tools: TOOLS_WRITE },
      { label: 'release-notes-delta', prompt: releaseDeltaPrompt(relText, mktVerdictText), tools: TOOLS_WRITE },
    ]);
    const docsEditText = safeText(docsEdit);
    const mktEditText = safeText(mktEdit);
    const deltaEditText = safeText(deltaEdit);

    // --- Phase 4: verify (parallel; mechanical + render + follow-up audit) ---
    phase('verify');
    const [claimCheck, renderCheck, followups] = await runLane([
      { label: 'verify-claims', prompt: verifyClaimsPrompt(docsEditText, mktEditText), tools: TOOLS_READ },
      { label: 'verify-render', prompt: verifyRenderPrompt(mktText), tools: TOOLS_READ },
      { label: 'verify-followups', prompt: followupPrompt(docsEditText, mktEditText, deltaEditText), tools: TOOLS_READ },
    ]);
    const claimCheckText = safeText(claimCheck);
    finalClaimCheck = (claimCheckText.match(/CLAIM-CHECK:\s*(PASS|FAIL)/) ?? [])[1] ?? finalClaimCheck;
    finalRenderCheck = (safeText(renderCheck).match(/RENDER-CHECK:\s*(PASS|FAIL)/) ?? [])[1] ?? '';
    log(`pass ${pass}: claim check=${finalClaimCheck} render check=${finalRenderCheck}`);
  } else {
    log(`pass ${pass}: no stale/unreleased claims — no produce phase this pass`);
  }

  finalFailures = failures.length;
  if (finalFailures === 0 && finalClaimCheck !== 'FAIL' && finalMarketingCheck !== 'FAIL') {
    log(`pass ${pass}: clean — stopping the pass loop`);
    return {
      status: 'done',
      pass,
      claimCheck: finalClaimCheck || 'n/a',
      marketingCheck: finalMarketingCheck || 'n/a',
      renderCheck: finalRenderCheck || 'n/a',
      repo: REPO,
    };
  }
}

// Fail closed: a run with any failed subagent, or an unverified claim still failing
// at the pass bound, is reported as failed — never a silent partial pass.
const failureList = failures.length > 0 ? `failed agents: [${failures.join(', ')}]` : '';
const failingCheck = finalClaimCheck === 'FAIL' ? 'CLAIM-CHECK still FAIL at the pass bound' : '';
if (failureList || failingCheck) {
  throw new Error(`generate-apps-docs-marketing FAILED after ${MAX_PASSES} passes: ${failureList ? failureList : ''} ${failingCheck ? failingCheck : ''} ${finalMarketingCheck === 'FAIL' ? 'MARKETING-CHECK still FAIL at the pass bound' : ''}`);
}

return { status: 'no-progress', maxPasses: MAX_PASSES };
