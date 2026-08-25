export const meta = {
  name: 'naming-open-prefix-removal',
  description: 'Remove "Open <Name>" display names and any open-/hasna- prefix remnants across hasna/apps — display names become "Hasna <Name>", member names stay bare <name>; PR-first per app',
  phases: [
    { title: 'Census', detail: 'find every "Open <Name>" / "open-<name>" surface in the monorepo with file:line evidence' },
    { title: 'Fix', detail: 'up to 4 concurrent fix lanes: PR per app, display -> Hasna <Name>, docs/help/UI/bundle surfaces' },
    { title: 'Review', detail: 'Fable adversarial reviews per lane, bounded two-cycle remediation' },
    { title: 'Report', detail: 'aggregate counts + landed fixes + remaining' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '6d824d44-8047-4121-ace6-dc5bd1cc7819'
const CHANNEL = 'board'

const CONST = `
You are a lane of the naming workflow (owner-authorized 2026-08-18, task ${TASK}). Ratified conventions (knowledge k_msy9w9fo_bdwwkj + hasna-app-naming-convention-2026-08-14): (1) DISPLAY NAMES are 'Hasna <Name>' — 'Open <Name>' is retired everywhere (README titles, package.json descriptions, CLI help text, app UI titles, macOS bundle display names, docs); (2) member/npm names are bare '<name>' inside the @hasna scope (@hasna/loops) — no 'hasna-' and no 'open-' prefix; (3) the open- prefix is fully retired. Mission: find and fix every surface in the hasna/apps monorepo (${MONOREPO}) that still says 'Open <Name>' or uses open-<name> naming. PR-first, worktrees. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Edits ONLY in task worktrees ~/.hasna/repos/worktrees/apps/<name>, branch from UPDATED main. PRs target hasna/apps. Before EVERY commit/push: secrets scan staged (0 clean / 1 finding / 2 could-not-scan — non-zero blocks). Commits end with 'Agent: naming-<your-role>' (the ONLY attribution line).
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named naming-<your-role>.
- The member directory names (apps/<name>) and the @hasna/<name> package names are ALREADY correct (the naming gate enforces them) — DO NOT rename directories or package names. Only DISPLAY surfaces and doc references change.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const CENSUS = CONST + `
ROLE: census (Opus). Find every surface in ${MONOREPO} that violates the ratified naming. Do:
1. Grep the monorepo (exclude node_modules, dist, bun.lock): case-insensitive 'open-<name>' and 'Open <Name>' patterns — e.g. 'open-loops', 'Open Loops', 'open-todos', 'Open Todos', etc. across README.md files, package.json (description, keywords), src (CLI help strings, UI titles), web/dashboard sources, docs/, macOS bundle Info.plist/display names, .changeset bodies, tooling/ (census exceptions, CI configs referencing open-<name>).
2. For each hit: file:line + the literal text + which app it belongs to (or monorepo-level). Classify: app-surface (display name in the app's own README/description/help/UI/bundle — must be fixed to 'Hasna <Name>'), doc-reference (docs mentioning the retired open-<name> convention — fix or remove), tooling (census/CI exceptions carrying open-<name> — must become <name>), stale-folder (references to open-<name> folder paths that no longer exist — remove).
3. Also check: any app whose package.json description or README title says 'Open ...' — the full list of affected apps.
Comment the census on ${TASK}.
Return (JSON): { apps: [{app, surfaces: [{kind: app-surface|doc-reference|tooling|stale-folder, file, line, text}]}], monorepoLevel: [{file, line, text, kind}], affectedAppCount: number }
`

const FIX = CONST + `
ROLE: fixer (Sonnet). Fix the affected apps in your batch: {BATCH} (each entry: app + surfaces). Up to 4 fix lanes run concurrently — your lane owns this batch ONLY. For EACH app (one PR per app):
1. Worktree: ~/.hasna/repos/worktrees/apps/fix-naming-<app> (branch from updated main).
2. Fix every surface of that app: README title/mentions, package.json description (and keywords if they carry open-<name>), CLI help strings ('Open ...' -> 'Hasna <Name>'), UI/web titles, macOS bundle display names (Info.plist CFBundleDisplayName if generated in a build script), docs. 'Open <Name>' -> 'Hasna <Name>' (e.g. 'Open Loops' -> 'Hasna Loops').
3. Keep the member/package name untouched (apps/<app> and @hasna/<app> stay). If a doc references the retired open-<name> FOLDER convention historically, reword to the current convention (no open- prefix) rather than deleting the history.
4. Regression: no tests need changing for display strings unless a test asserts the old display name — update those assertions. Run the app's suite ('bun test' bounded) — green. No version bump, no changeset (display-only changes).
5. PR per app: title 'chore(<app>): display name "Hasna <App>" (open- prefix retired)' — body: the surfaces changed with the old->new.
Return (JSON): { prs: [{prUrl, headSha, app, changedSurfaces: [string]}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the fix lane's PRs adversarially. Lane PRs: {PRS}.
For EACH PR (exact sha): verify against the diff (fetch the PR head; never mutate main): (a) every 'Open <Name>' surface in that app is fixed to 'Hasna <Name>' (grep the app's README/package.json/src/web for the old string — zero hits); (b) no member/package rename happened (directory + package name unchanged); (c) no unrelated changes; (d) tests still pass where runnable; (e) secrets scan clean. Post per-PR verdicts as PR comments with the first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: naming, reviewer naming-review ({I} of 4)'. Block ONLY concrete P0/P1 defects (a missed display surface, an accidental rename, unrelated scope). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report (Sonnet). Aggregate: affected apps, fixed apps, remaining surfaces (if any) as follow-ups, PRs landed. Comment the final state on ${TASK}, post the summary to #${CHANNEL}.
Return (JSON): { totals: {affectedApps, fixedApps, prsLanded, remainingSurfaces: [{app, file, text}]}, prs: [string], followUps: [string] }
Census: {CENSUS}
Fixers: {FIXERS}
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent). Create your harvest row in the oss-apps project, comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: ${TASK} comments, census + fix + review results, the report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (the naming-sweep recipe)?
- TODOS: what surfaced nobody filed (remaining surfaces, unreviewed apps, doc stale references)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (the display-naming as-built, convention k_msy9w9fo_bdwwkj now enforced)?
- FILES: artefacts for hasna/files rather than scratch?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Report: {REPORT}
`

const CENSUS_SCHEMA = {
  type: 'object',
  properties: {
    apps: { type: 'array', items: { type: 'object', properties: { app: { type: 'string' }, surfaces: { type: 'array', items: { type: 'object' } } }, required: ['app'] } },
    monorepoLevel: { type: 'array', items: { type: 'object' } },
    affectedAppCount: { type: 'integer' },
  },
  required: ['apps', 'affectedAppCount'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { prUrl: { type: 'string' }, headSha: { type: 'string' }, app: { type: 'string' }, changedSurfaces: { type: 'array', items: { type: 'string' } } }, required: ['prUrl', 'app'] } },
  },
  required: ['prs'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object' } } }, required: ['number', 'verdict'] } },
  },
  required: ['prs'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    totals: { type: 'object' },
    prs: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['totals', 'prs'],
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

phase('Census')
const census = await agent(CENSUS, { label: 'census-naming', phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' })
const affected = (census && census.apps) || []
log(`census: ${census ? census.affectedAppCount : '?'} affected apps`)

phase('Fix')
let fixResults = []
if (affected.length) {
  const chunks = []
  const size = Math.max(1, Math.ceil(affected.length / 4))
  for (let i = 0; i < affected.length; i += size) chunks.push(affected.slice(i, i + size))
  fixResults = await parallel(chunks.map((batch, i) => () =>
    agent(FIX.replace('{BATCH}', JSON.stringify(batch)), { label: `fix-naming-${i + 1}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
  ))
  log(`fix lanes: ${fixResults.filter(Boolean).reduce((n, r) => n + (r.prs || []).length, 0)} PRs`)
} else {
  log('no affected apps — nothing to fix')
}

phase('Review')
let reviewResults = []
if (fixResults.length) {
  reviewResults = await parallel(fixResults.filter(Boolean).map((fr, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(fr.prs || [])).replace('{I}', String(i + 1)), {
      label: `review-naming-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable',
    }),
  ))
}

phase('Report')
const report = await agent(
  REPORT
    .replace('{CENSUS}', JSON.stringify(census || {}))
    .replace('{FIXERS}', JSON.stringify(fixResults.filter(Boolean))),
  { label: 'report-naming', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

phase('Harvest')
const harvest = await agent(HARVEST.replace('{REPORT}', JSON.stringify(report || { report: null })), {
  label: 'harvest-naming', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { census, fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), report, harvest }
