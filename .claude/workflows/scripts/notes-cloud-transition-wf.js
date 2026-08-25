export const meta = {
  name: 'notes-cloud-transition',
  description: 'Fully transition @hasna/notes to sqlite/postgresql two-backend storage (internal infra on PostgreSQL) and remove the multi-machine sync machinery from CLI/app/everywhere; ship live',
  phases: [
    { title: 'Fix', detail: 'two Sonnet fixers in hasna/apps worktrees: storage-core (two-backend + contract); sync-removal (CLI/app/server sync surfaces)' },
    { title: 'Review', detail: 'two Fable adversarial reviewers, bounded two-cycle remediation, exact-sha verdicts incl. npm release receipt' },
    { title: 'Ship', detail: 'changesets, publish, install stations, internal Postgres deployment, live test' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const APP = 'apps/notes'
const TASK = '5b2d66b4-0b5f-4680-8144-022b8a548e57'
const CHANNEL = 'notes'

const CONST = `
You are one lane of the notes cloud-transition workflow (owner-authorized 2026-08-17, task ${TASK}). The package is @hasna/notes at ${MONOREPO}/${APP} (0.1.1, renamed from personalnotes). Owner directives for this workflow: (1) FULLY transition to the fleet two-backend contract — client = local SQLite+markdown store OR hosted HTTP API (HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY, URL-without-key FAILS CLOSED; client never opens Postgres), server = HASNA_NOTES_DATABASE_URL present -> PostgreSQL else SQLite, NO mode enums (retire/ratchet any remaining); (2) our internal infra deployment MUST run on PostgreSQL; (3) REMOVE the multi-machine sync ability from the CLI, the macOS app, the server, everywhere — sync verbs, sync daemon, SyncScheduler, machine manifest, machine dropdown, sync state, sync tables; the client becomes a plain HTTP API client; the personalnotes/v1 wire dialect stays (the future SaaS wrapper speaks it — document, do not rename). Reference: the knowledge app (${MONOREPO}/apps/knowledge) is the canonical two-backend pattern (client-transport.ts, http-store.ts, storage-kit, pg-migrations, scripts/apply-postgres-migrations.mjs). Your final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Edits ONLY in task worktrees ~/.hasna/repos/worktrees/apps/<name>, branch from UPDATED main. PRs target hasna/apps. Before EVERY commit/push: secrets scan staged (0 clean / 1 finding / 2 could-not-scan — non-zero blocks). Commits end with 'Agent: notes-cloud-<your-role>' (the ONLY attribution line).
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings (*.hasna.xyz, ARNs, AWS account ids) in ANY artifact (the publish-guard blocks them — the internal deployment config lives in the vault, not the tree).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named notes-cloud-<your-role>.
- Repo laws: ${MONOREPO}/AGENTS.md + .claude/rules/. Version discipline: do NOT bump versions yourself — add a changeset ('bunx changeset', patch or minor per the package's pre-1.0 convention: a breaking change is a MINOR bump 0.2.0) in your PR; the ship lane runs 'bunx changeset version'.
- Distinguish measured vs inferred; state what you did not check. Plain register, no superlatives.
`

const LANE_STORAGE = CONST + `
ROLE: fixer — storage core (Sonnet). PR title 'feat(notes): two-backend storage — PostgreSQL server backend + HTTP client transport'. Worktree: ~/.hasna/repos/worktrees/apps/fix-notes-storage (task ${TASK}). Regression tests FIRST. Base your branch on the sync-removal lane's branch if that lane is merged first, else open in parallel and coordinate (the new transport lives here; the sync lane removes the OLD transport).
Current measured state: client backend selection lives in sync/client.mjs ('One dialect, two backends' — PERSONALNOTES_/HASNA_NOTES_ envs; to be replaced); the server (server/index.mjs + server/db.mjs) is bun:sqlite-only (schema v1: tenants/users/sessions/api_keys/otp_login_requests/notes/note_events/sync_batches); hasna.contract.json has a storage block (envPrefix HASNA_NOTES_) but repo-conformance still fails surface_matrix (no sdk surface) + self_host_artifact (no Dockerfile) at kit 0.10.6 (reconcile task 32336d85).
Implement:
1. Server backend: HASNA_NOTES_DATABASE_URL present -> PostgreSQL (write server/pg-migrations.ts translating the schema — DROP the sync_batches table in the new backend; keep note_events); absent -> SQLite (unchanged default). Use the contracts vendor-kit storage pattern (MigrationLedger, sha256 checksums, append-only ids) + api_keys via @hasna/contracts/auth (signing secret HASNA_NOTES_API_SIGNING_KEY with the documented fallbacks). Migration runner scripts/apply-postgres-migrations.mjs with --dry-run --json and an OWNER DSN (HASNA_NOTES_DATABASE_URL_OWNER). The server must not log the DSN.
2. Client transport: replace the sync/client.mjs selection with the canonical pattern (mirror knowledge's client-transport.ts + http-store.ts): HASNA_NOTES_API_URL present -> HTTP client over /v1 (api-key auth, fail closed when the key is missing); absent -> local SQLite+md store. The CLI/MCP/app go through ONE transport resolver; client code never reads HASNA_NOTES_DATABASE_URL and never opens Postgres. Keep the local markdown store as the local backend (the app's data contract).
3. Storage verbs: 'notes storage status' (selected client/server store, backend, readiness — no credentials/bucket capabilities) and 'notes storage migrate --dry-run' where applicable; the config migration for ~/.config/hasna-notes/config.json already exists — keep it.
4. Contract: hasna.contract.json — storage block (backend, envPrefix HASNA_NOTES_, sqlitePath ~/.hasna/apps/notes-server/server.db, pgTestGate), metadata.service (port, probes /health /ready /version /openapi.json, auth api-key, migrationCommand, signingSecretSecretRef + ownerDatabaseUrlSecretRef per the knowledge pattern), metadata.client (apiUrlEnv HASNA_NOTES_API_URL, apiKeyEnv HASNA_NOTES_API_KEY), sdk surface declaration; add a Dockerfile/compose for the self-host artifact (closes self_host_artifact). Run 'contracts validate apps/notes/hasna.contract.json' (package-pinned bin) — must pass; note which repo-conformance gates close and which remain (surface_matrix must close with the sdk declaration).
5. Tests: two-backend fixtures — local store contract tests (existing) + Postgres store tests gated by the pgTestGate env (fails closed rc=2 when absent, like knowledge); transport selection tests (URL+key -> http; URL no key -> fail-closed error; no URL -> local); migration dry-run tests. 'bun test' in ${APP} green.
Return (JSON): { prUrl, headSha, branch, changed: [string], tests: {lanes, passed, failed}, changeset: boolean, openGates: [string], followUps: [string] }
`

const LANE_SYNC = CONST + `
ROLE: fixer — sync removal (Sonnet). PR title 'feat(notes): remove multi-machine sync machinery — CLI, app, server (single-server model)'. Worktree: ~/.hasna/repos/worktrees/apps/fix-notes-sync (task ${TASK}). Regression tests FIRST. Coordinate with the storage lane: the new HTTP transport is theirs; this lane REMOVES the old sync surfaces. Base your branch on the storage lane's branch if it merges first, else open in parallel and say so in the PR description.
REMOVE (the owner: sync-multi-machine goes away from cli, app, everywhere):
1. CLI: the sync verb (sync [--watch|--install-service|--uninstall-service]) and the cloud verb (cloud status/list/create/sync) + billing verb if it exists solely for the sync/cloud story — remove them from the CLI surface and the help; replace 'sync' where used as the daemon entry with nothing (the client is a plain HTTP API client — see the storage lane). Check bin/, cli/, tools/ for sync entry points (sync/index.mjs, sync/engine.mjs, sync/daemon.mjs, sync/client.mjs, sync-state handling) and remove them; MCP tools (notes_sync etc. — enumerate 'notes_*' tools and drop the sync/cloud ones).
2. macOS app: main.swift's SyncScheduler (Timer 5min spawning the bundled CLI sync --json) — remove the scheduler and its config (syncIntervalMinutes); the web UI's Machines dropdown and machine manifest (MachineManifest) — remove the machine surface from the UI; the app's bundled sync/*.mjs and bin/personalnotes.mjs sync entry in the bundle — remove from the build script's bundle list.
3. Server: drop sync_batches (the storage lane drops it in the new backend — coordinate so only ONE lane owns the table removal; if the storage lane already drops it in pg, this lane drops it in the SQLite schema + removes the sync endpoints in server/index.mjs).
4. Config/state: HASNA_NOTES_SYNC_INTERVAL_MINUTES, sync-state.json/sync-status.json handling, PERSONALNOTES_SYNC_* leftovers — remove; the one-release compat envs from the rename (PERSONALNOTES_*) are ALREADY slated for next-release removal — this is that release: remove the compat aliases (RETIRED_PREFIX fragments in server/env.mjs, tools/notes-env.mjs, the LEGACY_CONFIG_PATH in sync/client.mjs — sync/client.mjs is removed anyway; the web alias window['Personal'+'Notes'] — remove).
5. Docs/tests: README sync sections, docs/sync.md (remove or rewrite to the single-server model: 'notes syncs to your notes server via the HTTP API' — NO machine sync), tests updated (sync tests removed or rewritten to transport tests); the app's bundle test lists updated.
6. Acceptance grep: after your PR, 'git grep -iE "sync --watch|sync daemon|SyncScheduler|machine manifest|personalnotes-sync|notes sync" -- apps/notes' must return ZERO hits in shipped surfaces (docs may explain the removal).
Return (JSON): { prUrl, headSha, branch, changed: [string], tests: {lanes, passed, failed}, changeset: boolean, remainingSyncHits: [string], followUps: [string] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). You have NOT done this work; review it adversarially. PR: {PR_BLOCK}.
Verdict format: post as a PR comment first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: {LENS}, reviewer notes-cloud-{REVIEWER} ({I} of 2)', plus a post to #${CHANNEL}. This verdict is ALSO part of the npm release review for @hasna/notes (the ship lane publishes only when BOTH verdicts are GO, bound to repo hasna/apps, registry npmjs).
Scope: check the fixer's claims against the actual diff (fetch the PR head; never mutate main). Block only concrete, evidence-backed, currently reachable, in-scope P0/P1 defects: secrets/credential exposure (incl. DSN/signing-secret handling), mode-enum reintroduction, contract/manifest violations (contracts validate must pass), data-loss or migration hazards (notes store, config migration), broken four-surface parity, the new transport failing closed on URL-without-key, sync-removal leaving live references (dead imports, broken build, UI referencing removed surfaces, launchd/daemon residue in docs that would re-create the sync story), changes outside ${APP}. Verify the regression tests pass where runnable. P2/P3 non-blocking. Name exactly what must be proven at ship/live-test time and whether it blocks GO.
Return (JSON): { verdict: 'GO'|'NO_GO', prUrl, sha, findings: [{severity, title, detail}], shipProofsNeeded: [string] }
`

const SHIP = CONST + `
ROLE: ship + install + internal Postgres deployment + live test (Sonnet). You act only after BOTH reviews return GO (below). If either lane is exhausted/NO_GO, DO NOT publish — report and stop that part.
Order of operations (all mandatory):
1. Merge both PRs at their exact reviewed heads: gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: notes-cloud-ship'>; record merged shas.
2. Version: 'bunx changeset version' in ${MONOREPO} (the breaking sync removal => MINOR bump per the package's pre-1.0 convention: 0.1.1 -> 0.2.0). Commit via a worktree PR (same trailer). Verify apps/notes/package.json.
3. Announce BEFORE publish: 'conversations send --channel git-publishing "PUBLISH INTENT: @hasna/notes@<version> — two-backend storage (PG server), single-server model, sync machinery removed"'. Confirm in-thread after.
4. Publish from ${MONOREPO}/apps/notes: NPMRC="$(mktemp)"; chmod 600 "$NPMRC"; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC". Verify two-sided: 'npm view @hasna/notes version' = new AND not before; fresh timestamp.
5. Install + verify on station01, station03, station04: bun install -g @hasna/notes@<version> (quarantine: the exact name is already in each machine's minimumReleaseAgeExcludes from the 0.1.1 install — re-verify per machine; never bypass). Verify: notes --version; notes list works on the local store; 'notes storage status' shows the local backend; the sync verb is GONE (notes sync -> unknown command).
6. INTERNAL INFRA ON POSTGRESQL (the owner: our internal infra must be on postgresql): investigate the existing internal deployment pattern for OSS apps FIRST (where does knowledge-serve / emails run — check the machines manifest, the contracts metadata.service of apps/knowledge, any deployment docs in the monorepo; use the provider-role table discipline: registrar/DNS/CA/host/DB are separate roles). Then deploy notes-serve internally: build the Docker image (the new Dockerfile), run it on the same host/ECS pattern knowledge uses, database = PostgreSQL (the shared internal RDS microservices-prod-postgres in hasna-xyz-infra per the internal-apps convention, or the pattern knowledge uses — verify which; create the notes database + run the migrations with the OWNER DSN), vault entries for the deployment (hasna/oss/notes/database-url*, signing secret — created via secrets set with values via stdin, NEVER in args or transcript), routing per the pattern (Cloudflare subdomain or the knowledge pattern). VERIFY LIVE: /health + /ready answer ok; an authenticated /v1 note create + list round-trip works against the PostgreSQL backend (the pgTestGate path); the CLI on station01 configured with HASNA_NOTES_API_URL+API_KEY talks to the hosted server. The internal-infra strings stay in the vault, never in the tree.
7. LIVE TEST (declared stop condition): (a) local backend: notes list/create works on station01's local store; (b) notes storage status shows the two-backend selection correctly in both modes (local, and hosted when configured); (c) the sync surface is gone (notes sync -> unknown command; no sync daemon, no SyncScheduler, no machine dropdown in the app UI — verify via the installed bundle: no sync/*.mjs in Resources/bin, grep the web bundle for the machines dropdown); (d) hosted round-trip against the internal Postgres deployment (above). PASS = all green. FAIL = any named failure with evidence; fix (root cause) and re-test — at most 3 fix-retest cycles; on exhaustion STOP and report the live failure verbatim.
8. Todos: comment final state on ${TASK}; mementos; posts to #${CHANNEL} and the git-publishing thread.
Return (JSON): { publishedVersion, mergedShas: [string], stations: [{id, state, version, evidence}], deployment: {target, database: {backend, dbName}, health: {state, evidence}, v1RoundTrip: {state, evidence}}, liveTest: {state: pass|fail|pending, detail}, followUps: [string] }
Reviews: {REVIEWS}
`

const HARVEST = CONST + `
ROLE: harvest (Opus) — you did NOT do this work; harvest it independently. Create your harvest row in the oss-apps project (Notes task list), comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: ${TASK} comments, the 2 PRs + reviews, the ship report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (two-backend storage build recipe — third instance now; internal OSS-app deployment recipe; sync-removal recipe)?
- TODOS: what surfaced nobody filed (the PROGRAM task b868735b's cloud part now superseded — mark it; the SaaS wrapper compat check; remaining conformance gates; the naming rule render 70931686)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (notes two-backend as-built, single-server model, internal deployment as-built, sync-removal scope)?
- FILES: artefacts for hasna/files rather than scratch?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Ship report: {SHIP}
`

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    prUrl: { type: 'string' }, headSha: { type: 'string' }, branch: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' } },
    tests: { type: 'object', properties: { lanes: { type: 'array', items: { type: 'string' } }, passed: { type: 'integer' }, failed: { type: 'integer' } } },
    changeset: { type: 'boolean' },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['prUrl', 'headSha', 'branch', 'changed', 'tests', 'followUps'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO_GO'] },
    prUrl: { type: 'string' }, sha: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['severity', 'title', 'detail'] } },
    shipProofsNeeded: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'prUrl', 'sha', 'findings'],
}
const SHIP_SCHEMA = {
  type: 'object',
  properties: {
    publishedVersion: { type: 'string' },
    mergedShas: { type: 'array', items: { type: 'string' } },
    stations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string' }, version: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'state', 'evidence'] } },
    deployment: { type: 'object', properties: { target: { type: 'string' }, database: { type: 'object' }, health: { type: 'object' }, v1RoundTrip: { type: 'object' } } },
    liveTest: { type: 'object', properties: { state: { type: 'string' }, detail: { type: 'string' } } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['publishedVersion', 'mergedShas', 'stations', 'liveTest', 'followUps'],
}
const HARVEST_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'object',
      properties: {
        skills: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        todos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        mementos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        knowledge: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        files: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
      },
      required: ['skills', 'todos', 'mementos', 'knowledge', 'files'],
    },
  },
  required: ['categories'],
}

async function lane(label, fixPrompt, lens, i) {
  let fix = await agent(fixPrompt, { label, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' })
  if (!fix) return { fix: null, review: null, exhausted: true }
  let lastReview = null
  for (let cycle = 0; cycle < 3; cycle++) {
    const reviewPrompt = REVIEW
      .replace('{PR_BLOCK}', JSON.stringify(fix))
      .replace('{LENS}', lens)
      .replace('{REVIEWER}', label.replace('fix-', 'review-'))
      .replace('{I}', String(i))
    lastReview = await agent(reviewPrompt, { label: `review-${label}:cycle-${cycle}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
    if (!lastReview) return { fix, review: null, exhausted: true }
    if (lastReview.verdict === 'GO') return { fix, review: lastReview, exhausted: false }
    if (cycle === 2) return { fix, review: lastReview, exhausted: true }
    const blocking = lastReview.findings.filter(f => f.severity === 'P0' || f.severity === 'P1')
    if (!blocking.length) return { fix, review: lastReview, exhausted: false }
    fix = await agent(fixPrompt + `\nREVIEWER FINDINGS TO REMEDIATE (cycle ${cycle + 1}): address ONLY these named defects and their direct regressions: ${JSON.stringify(blocking)}. Return the same schema.`, {
      label: `${label}:remediate-${cycle + 1}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet',
    })
    if (!fix) return { fix, review: lastReview, exhausted: true }
  }
  return { fix, review: lastReview, exhausted: true }
}

phase('Fix')
const results = await parallel([
  () => lane('fix-notes-storage', LANE_STORAGE, 'storage+transport+contract', 1),
  () => lane('fix-notes-sync', LANE_SYNC, 'sync-removal+app', 2),
])
const [storageLane, syncLane] = results
log(`lanes: storage=${storageLane.review ? storageLane.review.verdict : 'NO-VERDICT'}(exh=${storageLane.exhausted}), sync=${syncLane.review ? syncLane.review.verdict : 'NO-VERDICT'}(exh=${syncLane.exhausted})`)

phase('Ship')
const allLanes = [storageLane, syncLane]
const allGo = allLanes.every(l => l.review && !l.exhausted && l.review.verdict === 'GO')
let ship = null
if (allGo) {
  ship = await agent(
    SHIP.replace('{REVIEWS}', JSON.stringify(allLanes.map(l => l.review))),
    { label: 'ship-notes-cloud', phase: 'Ship', schema: SHIP_SCHEMA, model: 'sonnet' },
  )
} else {
  const bad = allLanes.map((l, i) => (l.review && l.review.verdict === 'GO' ? null : ['storage', 'sync'][i])).filter(Boolean)
  log(`SHIP SKIPPED — lanes not GO: ${bad.join(', ')}`)
}

phase('Harvest')
const harvest = await agent(HARVEST.replace('{SHIP}', JSON.stringify(ship || { ship: null })), {
  label: 'harvest-notes-cloud', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { lanes: { storage: storageLane, sync: syncLane }, ship, harvest }
