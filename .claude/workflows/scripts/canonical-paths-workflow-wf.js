export const meta = {
  name: 'canonical-paths-workflow',
  description: 'Canonical app-data paths: codewith exec investigators map every app\'s data root; fix lanes land PR-first fixes to ~/.hasna/<app>/ for every non-canonical app',
  phases: [
    { title: 'Investigate', detail: '4 driver agents each run a codewith exec lane (sol xhigh) mapping per-app data-root resolution with evidence' },
    { title: 'Fix', detail: 'up to 4 concurrent fix lanes: worktrees, PR per app, canonical default + safe migration + regression tests' },
    { title: 'Review', detail: 'Fable adversarial reviews per lane\'s PRs, bounded two-cycle remediation' },
    { title: 'Report', detail: 'aggregate canonical/non-canonical counts + landed fixes' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '875c805e-e14e-4cf3-a942-75545406108f'
const CHANNEL = 'board'
const ACCOUNTS = ['account019', 'account020', 'account021', 'account022']

const CONST = `
You are a lane of the canonical-paths workflow (owner-authorized 2026-08-18, task ${TASK}). The canonical app-data path on every machine is ~/.hasna/<app>/ (the fleet law: app data lives at ~/.hasna/<app>/ — package-owned; NOT hidden dot dirs like ~/.<app>, NOT ~/.config/<app>, NOT ~/.local/state/<app>, NOT ~/Library/Application Support/<app>, NOT repo-relative or other locations). Mission: find every app in the hasna/apps monorepo (${MONOREPO}) whose data root resolves somewhere non-canonical, and fix it — PR-first, worktrees — so the default is ~/.hasna/<app>/ with a safe verified migration and regression tests. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Edits ONLY in task worktrees ~/.hasna/repos/worktrees/apps/<name>, branch from UPDATED main. PRs target hasna/apps. Before EVERY commit/push: secrets scan staged (0 clean / 1 finding / 2 could-not-scan — non-zero blocks). Commits end with 'Agent: canonical-<your-role>' (the ONLY attribution line).
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named canonical-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const INVEST = CONST + `
ROLE: codewith investigator driver (Sonnet). You run ONE headless codewith exec (the adversarial-capable investigator, gpt-5.6-sol xhigh, read-only sandbox) over your app slice, wait for its real terminal state, and return its structured findings. Assigned account: ${'${ACCT}'}. Slice: {SLICE}.
Steps:
1. Write the investigation brief to <worktree>/canonical-brief-${'${LANE}'}.md: 'Investigate the data-root resolution of every app in this slice of the hasna/apps monorepo (${MONOREPO}, READ-ONLY). For each app in: {SLICE}: find where its data/store root is resolved — the default path (env var defaults, config path resolution, DB path, home-joined paths, XDG dirs, dot dirs like ~/.<name>, ~/.config/<name>, ~/.local/state/<name>, Library/Application Support on macOS, repo-relative paths). Classify each app: canonical (default resolves under ~/.hasna/<app>/), non-canonical (name the EXACT path + file:line evidence of the default), or unclear (no default found / env-only). ALSO note any env override names (they stay as overrides — only the DEFAULT must be canonical). Read-only: never modify anything; the monorepo checkout is read-only. Return a per-app table: app, default-path, classification, evidence (file:line), env-overrides.'
2. Run: codewith exec --auth-profile ${'${ACCT}'} -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only --skip-git-repo-check -C <worktree> -o <worktree>/canonical-report-${'${LANE}'}.md "$(cat <worktree>/canonical-brief-${'${LANE}'}.md)" < /dev/null > <worktree>/canonical-run-${'${LANE}'}.log 2>&1 &
   Wait: until [ -s <worktree>/canonical-report-${'${LANE}'}.md ] || ! kill -0 $! 2>/dev/null; do sleep 20; done — bounded 45 iterations (~15 min); on timeout kill + RETRY ONCE; if the retry also fails: record review-unavailable and return the slice as '?'. If the model slug 400s, re-run with gpt-5.6-terra and record the deviation.
3. Parse the report: per-app classification + evidence. Comment the classification on ${TASK}.
Return (JSON): { lane: ${'${LANE}'}, apps: [{app, defaultPath, classification: canonical|non-canonical|unclear, evidence, envOverrides: [string]}] }
`

const FIX = CONST + `
ROLE: fixer (Sonnet). Fix the non-canonical apps in your batch: {BATCH} (each entry: app, evidence). Up to 4 fix lanes run concurrently on the monorepo — your lane owns this batch ONLY. For EACH app in the batch (one PR per app):
0. IDEMPOTENCY CHECK FIRST (the previous run died mid-batch — some apps in your batch may already be fixed): for EACH app, first verify its CURRENT data-root resolution (the same evidence check as the investigation) AND check for an existing open PR (gh pr list --repo hasna/apps --search '<app> canonical' and 'fix-canonical-<app>' branches). If the app's default already resolves to ~/.hasna/<app>/ (or an open PR already changes it), record it as already-done and SKIP it — do not re-implement, do not duplicate the PR. Only apps still non-canonical AND with no open PR get fixed by you.
1. Worktree: ~/.hasna/repos/worktrees/apps/fix-canonical-<app> (branch from updated main).
2. Understand the current resolution (read the evidence file:line): the default data root must become ~/.hasna/<app>/ (e.g. ~/.hasna/notes). The env override (HASNA_<NAME>_ROOT/DB_PATH/... or the app's existing override) STAYS — only the default changes. Keep the app's existing config surface intact (a config file that stores an explicit path is honored; the DEFAULT is what must be canonical).
3. Migration: if the app has existing data at the old non-canonical path, add a ONE-TIME safe migration: on first run (or a CLI verb, per the app's shape): verify the old path exists AND the canonical path does not yet hold data, MOVE (or copy+verify+flag) with a recorded receipt; NEVER delete, never overwrite existing canonical data; dry-run support; the migration must be idempotent and resumable. If the app has no data at the old path, no migration is needed (say so).
4. Regression tests FIRST: the path-resolution test (default resolves to ~/.hasna/<app>/ under a fake HOME; env override still wins; migration moves old → new with verification). Add/update the app's tests; run the app's suite ('bun test' bounded) — green.
5. PR per app: title 'fix(<app>): canonical data root ~/.hasna/<app>' — body: the old path, the new default, the migration, the tests. Changeset only if package.json changes (unlikely — say none).
6. Coordinate: if two apps share a non-canonical path (e.g. ~/.notes used by two packages) — flag it in both PRs; do not double-migrate.
Return (JSON): { prs: [{prUrl, headSha, app, oldPath, newPath, migration: {needed: bool, strategy}, tests: {passed, failed}}], skipped: [{app, reason}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). You review the fix lane's PRs adversarially. Lane PRs: {PRS}.
For EACH PR (exact sha): verify against the diff (fetch the PR head; never mutate main): (a) the default resolves to ~/.hasna/<app>/ (the file:line change is right); (b) the env override still wins; (c) the migration is safe: never deletes, never overwrites canonical data, dry-run + idempotent + resumable, verified (a wrong migration is a data-loss hazard — P0); (d) the regression test actually covers the path resolution + migration; (e) secrets scan clean; changes confined to the app's dir. Post per-PR verdicts as PR comments with the first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: canonical-path, reviewer canonical-review ({I} of 4)'. Block ONLY concrete P0/P1 defects. Return per-PR verdicts.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report (Sonnet). Aggregate: the investigation counts (canonical / non-canonical / unclear per the investigators), the fixes landed (per-app old→new), any skipped apps with reasons, the remaining non-canonical apps (if any) as follow-ups. Comment the final state on ${TASK}, post the summary to #${CHANNEL}.
Return (JSON): { totals: {apps, canonical, nonCanonical, unclear, fixed, skipped, remaining}, prs: [string], followUps: [string] }
Investigators: {INVESTIGATORS}
Fixers: {FIXERS}
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent). Create your harvest row in the oss-apps project, comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: ${TASK} comments, the investigation + fix + review results, the report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (the canonical-path fix recipe — migration + regression pattern; the codewith-investigator lane pattern)?
- TODOS: what surfaced nobody filed (remaining non-canonical apps, shared-path conflicts, unreviewed edge apps)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (the canonical-path inventory as-built, migration pattern)?
- FILES: artefacts for hasna/files rather than scratch?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Report: {REPORT}
`

const INVEST_SCHEMA = {
  type: 'object',
  properties: {
    lane: { type: 'string' },
    apps: { type: 'array', items: { type: 'object', properties: { app: { type: 'string' }, defaultPath: { type: 'string' }, classification: { type: 'string' }, evidence: { type: 'string' }, envOverrides: { type: 'array', items: { type: 'string' } } }, required: ['app', 'classification'] } },
  },
  required: ['lane', 'apps'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { prUrl: { type: 'string' }, headSha: { type: 'string' }, app: { type: 'string' }, oldPath: { type: 'string' }, newPath: { type: 'string' }, migration: { type: 'object' }, tests: { type: 'object' } }, required: ['prUrl', 'app'] } },
    skipped: { type: 'array', items: { type: 'object', properties: { app: { type: 'string' }, reason: { type: 'string' } } } },
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

const SLICES = [
  ['access', 'accounts', 'actions', 'announce', 'attachments', 'automations', 'banking', 'billing', 'brains', 'bridge', 'browser', 'calendar', 'catalog', 'changelog', 'computer', 'computers', 'connectors', 'consolidations', 'context', 'contracts', 'controls', 'conversations'],
  ['crawl', 'datasets', 'dispatch', 'docs', 'domains', 'draw', 'economy', 'emails', 'evals', 'events', 'feedback', 'files', 'fleet', 'gateway', 'guardrails', 'holdings', 'hooks', 'instructions', 'knowledge'],
  ['logs', 'loops', 'machines', 'markdown', 'mcps', 'mementos', 'models', 'monitor', 'orgs', 'notes', 'prompts', 'recordings', 'router', 'search', 'secrets'],
  ['servers', 'sessions', 'sheets', 'shield', 'shortlinks', 'signatures', 'skills', 'slides', 'snapshots', 'statusline', 'styles', 'tables', 'tai', 'telephony', 'tenants', 'terminal', 'testers', 'tickets', 'todos', 'treasury', 'ui', 'workforce'],
]

phase('Investigate')
const investResults = await parallel(SLICES.map((slice, i) => () =>
  agent(
    INVEST.replaceAll('${ACCT}', ACCOUNTS[i]).replaceAll('${LANE}', String(i + 1)).replace('{SLICE}', JSON.stringify(slice)),
    { label: `investigate-${i + 1}`, phase: 'Investigate', schema: INVEST_SCHEMA, model: 'sonnet' },
  ),
))
const classified = (investResults.filter(Boolean).flatMap(r => r.apps || [])).filter(Boolean)
const nonCanonical = classified.filter(a => a.classification === 'non-canonical')
log(`investigation: ${classified.length} apps classified, ${nonCanonical.length} non-canonical`)

phase('Fix')
let fixResults = []
if (nonCanonical.length) {
  const chunks = []
  const size = Math.max(1, Math.ceil(nonCanonical.length / 4))
  for (let i = 0; i < nonCanonical.length; i += size) chunks.push(nonCanonical.slice(i, i + size))
  fixResults = await parallel(chunks.map((batch, i) => () =>
    agent(FIX.replace('{BATCH}', JSON.stringify(batch)), { label: `fix-${i + 1}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
  ))
  log(`fix lanes: ${fixResults.filter(Boolean).length} done, ${fixResults.filter(Boolean).reduce((n, r) => n + (r.prs || []).length, 0)} PRs`)
} else {
  log('no non-canonical apps — nothing to fix')
}

phase('Review')
let reviewResults = []
if (fixResults.length) {
  reviewResults = await parallel(fixResults.filter(Boolean).map((fr, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(fr.prs || [])).replace('{I}', String(i + 1)), {
      label: `review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable',
    }),
  ))
  log(`reviews: ${reviewResults.filter(Boolean).length} lanes`)
}

phase('Report')
const report = await agent(
  REPORT
    .replace('{INVESTIGATORS}', JSON.stringify(investResults.filter(Boolean)))
    .replace('{FIXERS}', JSON.stringify(fixResults.filter(Boolean))),
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

phase('Harvest')
const harvest = await agent(HARVEST.replace('{REPORT}', JSON.stringify(report || { report: null })), {
  label: 'harvest', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { investigation: investResults.filter(Boolean), classified, nonCanonical, fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), report, harvest }
