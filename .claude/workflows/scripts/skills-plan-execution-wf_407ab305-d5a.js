export const meta = {
  name: 'skills-plan-execution',
  description: 'Execute the todos plan skills-local-cloud-unification (8022d27f): implement each task PR-first, adversarial review via headless codewith (healthy profiles, parallel), fix, merge',
  phases: [
    { title: 'Enumerate', detail: 'fetch the plan + its 13 tasks fresh, order by plan sequence, classify' },
    { title: 'Execute', detail: 'waves of 4 lanes: implement task in worktree (PR-first), codewith exec adversarial review, fix-merge, complete task' },
    { title: 'Report', detail: 'per-task outcomes + plan completion state' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PLAN_ID = '8022d27f-fc09-437a-aa72-93eb8ad9517c'
const PLAN_SLUG = 'skills-local-cloud-unification'
const APP = 'apps/skills'
const CHANNEL = 'board'
const ACCOUNTS = ['account006', 'account007', 'account009', 'account010']

const CONST = `
You are a lane of the skills-plan-execution workflow (owner-authorized 2026-08-18). The plan: 'skills local+cloud unification' (todos plan ${PLAN_ID}, project c96b48e4, app ${MONOREPO}/${APP} @hasna/skills v0.1.63). Mission: execute the plan's tasks — one task per lane — implement PR-first in worktrees, adversarial review via headless codewith exec on healthy subscription profiles, fix-merge, complete the task with evidence. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Edits ONLY in task worktrees ~/.hasna/repos/worktrees/apps/skills-<task-short-id>, branch from UPDATED main. PRs target hasna/apps. Before EVERY commit/push: secrets scan staged (0 clean / 1 finding / 2 could-not-scan — non-zero blocks). Commits end with 'Agent: skills-plan-<your-role>' (the ONLY attribution line). Merges ONLY via gh pr merge --squash --body-file <file whose LAST line is 'Agent: skills-plan-<driver>'>.
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on the task you execute + ${PLAN_ID}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named skills-plan-<your-role>.
- The codewith review is the ADVERSARIAL GATE: never merge without a GO from a codewith exec run. Two failed/timed-out review runs = SKIP the task (never merge unreviewed). The plan's dependency bugs (170b0e9b corpus root, f068febe signing key) may or may not be resolved — implement the task's own scope; where a dependency is unresolved and blocks the task, record it and SKIP with that reason rather than guessing.
- Repo laws: ${MONOREPO}/AGENTS.md + .claude/rules/. Changes confined to ${APP} unless the task's stated scope is broader.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const ENUM = CONST + `
ROLE: enumerator. Do: 'todos plans --show ${PLAN_ID}' (the plan's task list) and for each pending task 'todos show <id>' (project to: id, title, description, status, priority, dependencies). Order the worklist by the plan's task sequence (T1..T13). Exclude tasks already in_progress/completed by another lane (check the task's status + comments for an active driver). Comment the worklist on ${PLAN_ID}.
Return (JSON): { worklist: [{id, title, priority, deps: [string]}], excluded: [{id, reason}], planStatus: string }
`

const DRIVER = CONST + `
ROLE: task driver for ${'${TID}'} '${'${TTITLE}'}' (priority ${'${TPRI}'}). Assigned codewith account: ${'${ACCT}'}. Do:
0. IDEMPOTENCY CHECK FIRST (the previous run died mid-wave — some tasks in your set may already be done): 'todos show ${'${TID}'}' — if the task is ALREADY completed (a previous driver merged + completed it), record it as already-done and SKIP (return merged=true, taskState=already-completed). If an open PR exists for this task (gh pr list --repo hasna/apps --search 'plan/${'${TSHORT}'}' or check the branch plan/${'${TSHORT}'} on origin) with a GO verdict, merge it if unreviewed-at-head is clear and complete the task; if the PR exists but is unreviewed, SKIP the implementation and go straight to the review steps (6-7) for that PR's head. Only tasks that are neither completed nor PR'd get full implementation. TERMINATION SKIP (bounded-review policy): if the task's comments carry the termination marker ('terminated' or 'Third NO_GO'), the candidate is NON-MERGEABLE — do NOT re-attempt the same candidate and do NOT re-open its terminated PR; record the skip with the termination reference (return merged=false, taskState=terminated). A successor (materially new candidate) is dispatched ONLY through the workflow's dedicated successor phase, never by a driver.
1. Register identity 'skills-plan-driver-${'${TSHORT}'}' (conversations agents register) before any post. Comment the task: 'driver starting'.
2. 'todos show ${'${TID}'}' (full details: description, acceptance, deps, evidence pointers — read the whole task, including comments).
3. Sync ${MONOREPO}; worktree ~/.hasna/repos/worktrees/apps/skills-${'${TSHORT}'} from origin/main; branch 'plan/${'${TSHORT}'}'.
4. IMPLEMENT the task's acceptance criteria (read the task description): regression tests FIRST (write the failing test, see it fail, then implement). Scope confined to ${APP} unless the task says otherwise. If a task depends on an unresolved bug (170b0e9b / f068febe or a listed dep) that genuinely blocks the acceptance, record it and SKIP with that reason.
5. Pre-checks on the diff: secrets scan (redirect the diff to a file, 'secrets scan input <file> --json' — rc 0 clean / 1 finding / 2 could-not-scan; finding or rc=2 BLOCKS merge), grep internal-infra strings, changes outside ${APP}.
6. ADVERSARIAL REVIEW via codewith exec: write review-brief-${'${TSHORT}'}.md: 'Adversarially review PR hasna/apps <branch plan/${'${TSHORT}'}> at head <headSha> (diff vs origin/main). Read the diff in the worktree (git diff origin/main...<headSha>). Repo laws: AGENTS.md + .claude/rules/. This implements todos task ${'${TID}'} of plan ${PLAN_ID}: <task description first 500 chars>. Return a verdict with FIRST LINE exactly: [REVIEW] GO|NO_GO — hasna/apps#<n> @ <sha>. Then ONLY concrete P0/P1 blocking findings (file:line + evidence): secrets, contract/manifest violations, data-loss/migration hazards, mode-enum reintroduction, scope creep outside ${APP}, false claims. P2/P3 in a separate non-blocking list. State what you could NOT check.' Run: codewith exec --auth-profile ${'${ACCT}'} -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only --skip-git-repo-check -C <worktree> -o <worktree>/review-${'${TSHORT}'}.md "$(cat review-brief-${'${TSHORT}'}.md)" < /dev/null > review-${'${TSHORT}'}.log 2>&1 &
   Wait: until [ -s review-${'${TSHORT}'}.md ] || ! kill -0 $! 2>/dev/null; do sleep 20; done — bounded 45 iterations (~15 min); on timeout kill + RETRY ONCE. CAPACITY RULE (measured fleet pattern): if the run exits with 'Selected model is at capacity' or the review file is absent after a clean exit, do NOT retry the same account — sweep the fleet for a healthy profile (for p in ~/.codewith/auth_profiles/*/; do [ -f "$p/auth.json" ] && codewith usage --auth-profile "$(basename "$p")" 2>&1 | grep -q Healthy && echo "$(basename "$p")"; done), pick a fresh healthy one, and re-run the review there (record the account switch). Two capacity failures on DIFFERENT accounts = review-unavailable -> SKIP the task with that recorded (never merge unreviewed). If the model slug 400s, re-run with gpt-5.6-terra and record the deviation.
7. Parse the verdict (first [REVIEW] line) + P0/P1 findings (quote the literal line).
8. GO: open the PR (gh pr create, body ending 'Agent: skills-plan-driver-${'${TSHORT}'}'), post the [REVIEW] GO line as a PR comment, then merge (gh pr merge <n> --squash --body-file with the trailer last). Verify the merged sha. COMPLETE the task: 'todos done ${'${TID}'}' after commenting the merge sha + evidence on the task.
9. NO_GO: remediate ONLY the named P0/P1 findings (commit with the trailer, push), re-run the codewith review — cycle 1. At most TWO remediation cycles; a third NO_GO terminates: leave the task in_progress with the open findings commented (never weaken a finding to force a merge).
10. Comment the plan (${PLAN_ID}) with the outcome line.
Return (JSON): { id, title, verdicts: [string], merged: bool, mergedSha: string|null, skipped: bool, reason: string|null, reviewAccount: string, taskState: string }
`

const REPORT = CONST + `
ROLE: report. Aggregate the drivers' outcomes (below): per-task state (merged/skipped/terminated), the plan's completion picture, follow-ups. Comment the final state on ${PLAN_ID}, post the summary to #${CHANNEL}.
Return (JSON): { tasks: [{id, title, merged, skipped, reason}], planState: string, followUps: [string] }
Drivers: {DRIVERS}
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent). Create your harvest row in the apps project (c96b48e4), comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: the plan ${PLAN_ID} comments, the driver reports (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (plan-execution-with-codewith-review recipe — this is now a repeatable pattern)?
- TODOS: what surfaced nobody filed (skipped tasks + reasons, the dependency bugs' status, plan follow-ups)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (skills cloud unification as-built)?
- FILES: artefacts for hasna/files rather than scratch?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Report: {REPORT}
`

const ENUM_SCHEMA = {
  type: 'object',
  properties: {
    worklist: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string' }, deps: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title'] } },
    excluded: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
    planStatus: { type: 'string' },
  },
  required: ['worklist', 'planStatus'],
}
const DRIVER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' }, title: { type: 'string' },
    verdicts: { type: 'array', items: { type: 'string' } },
    merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] },
    skipped: { type: 'boolean' }, reason: { type: ['string', 'null'] },
    reviewAccount: { type: 'string' }, taskState: { type: 'string' },
  },
  required: ['id', 'verdicts', 'merged', 'skipped'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, merged: { type: 'boolean' }, skipped: { type: 'boolean' }, reason: { type: ['string', 'null'] } }, required: ['id'] } },
    planState: { type: 'string' },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasks', 'planState'],
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

phase('Enumerate')
const enumResult = await agent(ENUM, { label: 'enumerate-plan', phase: 'Enumerate', schema: ENUM_SCHEMA, model: 'sonnet' })
const worklist = (enumResult && enumResult.worklist) || []
log(`plan census: ${worklist.length} tasks in worklist`)

phase('Execute')
const drivers = []
for (let i = 0; i < worklist.length; i += 4) {
  const wave = worklist.slice(i, i + 4)
  const results = await parallel(wave.map((t, j) => () =>
    agent(
      DRIVER
        .replaceAll('${TID}', t.id)
        .replaceAll('${TTITLE}', t.title)
        .replaceAll('${TPRI}', t.priority || 'medium')
        .replaceAll('${TSHORT}', t.id.slice(0, 8))
        .replaceAll('${ACCT}', ACCOUNTS[(i + j) % ACCOUNTS.length]),
      { label: `task-${t.id.slice(0, 8)}`, phase: 'Execute', schema: DRIVER_SCHEMA, model: 'sonnet' },
    ),
  ))
  drivers.push(...results)
  const merged = drivers.filter(d => d && d.merged).length
  log(`wave ${i / 4 + 1} done; cumulative merged=${merged}/${drivers.filter(Boolean).length}`)
}

phase('Report')
const report = await agent(
  REPORT.replace('{DRIVERS}', JSON.stringify(drivers.filter(Boolean))),
  { label: 'report-plan', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

phase('Harvest')
const harvest = await agent(HARVEST.replace('{REPORT}', JSON.stringify(report || { report: null })), {
  label: 'harvest-plan', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { census: enumResult, drivers: drivers.filter(Boolean), report, harvest }
