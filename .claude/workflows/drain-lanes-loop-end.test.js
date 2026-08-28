// Regression test for O15-04464 — the pr-drain and publish-all-apps lanes share
// deploy-apps' idle-churn loop-end defect (O15-04437, hasna/apps#1369, merge
// f0ea332e4): they `continue` on an empty census/queue despite their own design
// comments saying an empty pass ENDS the loop, so an idle run churns
// MAX_PASSES x IDLE_SLEEP (publish-all's loop is even UNBOUNDED —
// `for (pass = 1; ; pass++)` — so an idle run loops forever) and never reaches a
// terminal state. The lane then reads as DEAD ("hung run, no terminal result"),
// the one-effective-run-per-lane guard blocks a fresh dispatch, and the
// coordinator's relaunch-on-completion trigger never fires — the exact class
// measured on deploy-apps' wf_e88eb9c2-1b7 (77+ min, no terminal result).
//
// Root cause (both lanes): the census agent already sleeps the idle window
// (IDLE_SLEEP in pr-drain, ~5 min in publish-all) and re-checks once BEFORE
// returning an empty result — per the lanes' own census prompts ("NEVER return
// an empty result without the sleep+re-check having run"). So an empty census
// IS the run's end signal: the branch must `break` (the coordinator relaunches
// for standing continuity), not `continue` into another idle pass.
//
// Structural layers (mirroring deploy-apps-loop-end.test.js, per repo convention):
//  1. EMPTY CENSUS ENDS THE RUN — the empty-queue branch must `break`.
//  2. YIELDED CHECKED FIRST, ALSO ENDS THE RUN — the HOTFIX priority yield
//     branch must precede the empty guard (a yielded census returns empty
//     lists, so the empty guard would otherwise swallow the yield reason) and
//     must also `break`.
//  3. NO IDLE-CHURN `continue` LEFT IN THE DRAIN LOOP — the only permitted
//     `continue` is the O15-00732 agent-failure backoff (`if (!census)
//     continue`: a failed agent did not already wait the idle window, and the
//     next pass's census sleeps 300s first via the censusPrompt banner).
//     publish-all additionally keeps the per-lane-result guard
//     (`if (!r || !r.publishedVersion) continue`) inside the Release phase —
//     that skips ONE lane's gate, not the whole loop, and is legitimate.
//  4. HARD BOUND (publish-all) — the meta documents "(hard bound MAX_PASSES)"
//     but the loop header was `for (pass = 1; ; pass++)`. The drain loop must
//     be bounded by MAX_PASSES so even the failure-class backoff terminates,
//     with a MAX_PASSES-reached log after the loop (the pr-drain shape).
//  5. NO SILENT FAIL-CLOSED-STATE DROP (publish-all, O15-04231 interaction,
//     review remediation): the new break paths and the MAX_PASSES bound can END
//     the run while the in-script confirm-followup queue is still non-empty.
//     The queue does not survive the run boundary and the published app is
//     already CURRENT on the registry, so dropping it silently would recreate
//     the exact silent-drop state O15-04231 exists to prevent — it must be
//     logged (CONFIRM-QUEUE-PENDING-AT-RUN-END) and carried on the run result.
//  6. BEHAVIORAL (pr-drain, vm harness per agent-failure-hardening.test.js):
//     an empty census run must TERMINATE cleanly after exactly 2 agent calls
//     (census + report) — never churn idle passes.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Script } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const prDrain = readFileSync(join(here, 'pr-drain-wf.js'), 'utf8')
const publishAll = readFileSync(join(here, 'publish-all-apps-wf.js'), 'utf8')

// --- pr-drain ---

test('pr-drain: an empty census ENDS the run (break, not the O15-04464 idle-churn continue)', () => {
  // The defect: `continue` on an empty census re-ran the census next pass —
  // each pass re-sleeps IDLE_SLEEP and re-checks (per the census prompt), so an
  // idle run churned all MAX_PASSES and never reached a terminal state. The
  // census already slept + re-checked once before returning empty, so the run
  // must end here and let the coordinator relaunch for standing continuity.
  const emptyGuard = prDrain.indexOf('!ready.length && !rebase.length && !review.length')
  expect(emptyGuard).toBeGreaterThan(-1)
  const branch = prDrain.slice(emptyGuard, emptyGuard + 800)
  expect(branch).toMatch(/\n\s*break\b/)
  expect(branch).not.toMatch(/\n\s*continue\b/)
})

test('pr-drain: a yielded census (HOTFIX priority class) is checked BEFORE the empty guard and also ends the run', () => {
  // A yielded census returns {mergeReady: [], needsRebase: [], needsReview: [],
  // yielded: true} — the empty guard would catch it first, making the yield
  // branch dead code. The yield branch must precede the empty guard so the lane
  // records the yield reason, and must `break` so the run terminates and the
  // coordinator relaunches (the next run re-yields while hotfix rows persist).
  const yieldIdx = prDrain.indexOf('census && census.yielded')
  const emptyIdx = prDrain.indexOf('!ready.length && !rebase.length && !review.length')
  expect(yieldIdx).toBeGreaterThan(-1)
  expect(emptyIdx).toBeGreaterThan(-1)
  expect(yieldIdx).toBeLessThan(emptyIdx)
  const yieldBranch = prDrain.slice(yieldIdx, yieldIdx + 800)
  expect(yieldBranch).toMatch(/\n\s*break\b/)
  expect(yieldBranch).not.toMatch(/\n\s*continue\b/)
})

test('pr-drain: the only `continue` left in the file is the agent-failure backoff (O15-00732) — an empty census never churns', () => {
  const continues = prDrain.match(/if \(!census\) continue|\n\s*continue\s*\n/g) || []
  expect(continues, 'exactly one continue construct: the O15-00732 failure backoff').toHaveLength(1)
  expect(continues[0], 'the one permitted continue is the failure-class backoff').toContain('if (!census) continue')
  const emptyGuard = prDrain.indexOf('!ready.length && !rebase.length && !review.length')
  expect(prDrain.slice(emptyGuard, emptyGuard + 800)).not.toMatch(/\n\s*continue\b/)
})

// --- publish-all-apps ---

test('publish-all-apps: an empty publish queue ENDS the run (break, not the O15-04464 idle-churn continue)', () => {
  // The defect: `continue` on an empty queue re-ran the census next pass —
  // each pass sleeps ~5 min and re-checks (per the census prompt), and the loop
  // header was UNBOUNDED (`for (pass = 1; ; pass++)`), so an idle run churned
  // forever and never reached a terminal state. The census already slept +
  // re-checked once before returning empty, so the run must end here and let
  // the coordinator relaunch for standing continuity.
  const emptyGuard = publishAll.indexOf('if (!queue.length) {')
  expect(emptyGuard).toBeGreaterThan(-1)
  const branch = publishAll.slice(emptyGuard, emptyGuard + 800)
  expect(branch).toMatch(/\n\s*break\b/)
  expect(branch).not.toMatch(/\n\s*continue\b/)
})

test('publish-all-apps: a yielded census (HOTFIX priority class) is checked BEFORE the empty guard and also ends the run', () => {
  const yieldIdx = publishAll.indexOf('census && census.yielded')
  const emptyIdx = publishAll.indexOf('if (!queue.length) {')
  expect(yieldIdx).toBeGreaterThan(-1)
  expect(emptyIdx).toBeGreaterThan(-1)
  expect(yieldIdx).toBeLessThan(emptyIdx)
  const yieldBranch = publishAll.slice(yieldIdx, yieldIdx + 800)
  expect(yieldBranch).toMatch(/\n\s*break\b/)
  expect(yieldBranch).not.toMatch(/\n\s*continue\b/)
})

test('publish-all-apps: the only loop-level `continue` left is the agent-failure backoff; the per-lane-result guard survives', () => {
  // Loop-level churn continues are banned. The O15-00732 failure backoff is the
  // one permitted loop-level `continue`; the per-lane-result guard
  // (`if (!r || !r.publishedVersion) continue`, Release phase) skips ONE lane's
  // publish gate — it is per-item, not a loop-end decision, and must remain.
  const continues = publishAll.match(/if \(!census\) continue|\n\s*continue\s*\n/g) || []
  expect(continues, 'exactly one loop-level continue construct: the O15-00732 failure backoff').toHaveLength(1)
  expect(continues[0], 'the one permitted continue is the failure-class backoff').toContain('if (!census) continue')
  const perResultGuard = publishAll.match(/if \(!r \|\| !r\.publishedVersion\) continue/g) || []
  expect(perResultGuard, 'the Release-phase per-lane-result guard is preserved').toHaveLength(1)
  const emptyGuard = publishAll.indexOf('if (!queue.length) {')
  expect(publishAll.slice(emptyGuard, emptyGuard + 800)).not.toMatch(/\n\s*continue\b/)
})

test('publish-all-apps: the drain loop is hard-bounded by MAX_PASSES (the meta documents the bound; the loop header must carry it)', () => {
  // The meta says "(hard bound MAX_PASSES)" but the loop header was
  // `for (pass = 1; ; pass++)` — unbounded, so even the failure-class backoff
  // could loop forever. The drain loop must run `pass <= MAX_PASSES` (the
  // pr-drain/deploy-apps shape) with a MAX_PASSES-reached log after the loop.
  const def = publishAll.match(/const MAX_PASSES = Math\.min\(500, Math\.max\(1, Number\(args && args\.maxPasses\) \|\| \d+\)\)/)
  expect(def, 'publish-all defines the args-driven MAX_PASSES bound').not.toBeNull()
  expect(publishAll, 'the drain loop header is bounded by MAX_PASSES').toMatch(/for \(pass = 1; pass <= MAX_PASSES; pass\+\+\) \{/)
  expect(publishAll, 'a MAX_PASSES-reached log ends the bounded run').toMatch(/if \(pass > MAX_PASSES\) log\(`MAX_PASSES reached/)
})

test('publish-all-apps: a run ending (break or MAX_PASSES) with the O15-04231 confirm-followup queue non-empty never drops it silently', () => {
  // Review remediation (O15-04464 cycle 1, P1): the empty-queue/yielded break
  // paths and the MAX_PASSES bound end the run while `pendingConfirmFollowups`
  // (IN-SCRIPT state) may still hold entries. The queue does not survive the
  // run boundary, and the published app is already CURRENT on the registry —
  // no later run's census would ever revisit it, so dropping it silently would
  // recreate the O15-04231 silent-drop state. The run end must log
  // CONFIRM-QUEUE-PENDING-AT-RUN-END and carry the queue on the run result.
  expect(publishAll, 'run-end guard logs still-queued confirm-followups').toMatch(/if \(pendingConfirmFollowups\.length\) \{/)
  expect(publishAll, 'run-end guard names the CONFIRM-QUEUE-PENDING-AT-RUN-END marker').toMatch(/CONFIRM-QUEUE-PENDING-AT-RUN-END/)
  expect(publishAll, 'the final return carries the confirm-followup queue').toMatch(/confirmFollowups: pendingConfirmFollowups/)
})

test('behavioral: pr-drain with an empty census TERMINATES cleanly — exactly 2 agent calls (census + report), never an idle-churn pass 2+', async () => {
  // The O15-04464 hung-run class: pre-fix, an empty census `continue`d into
  // another pass (each pass re-sleeps IDLE_SLEEP and re-checks), so an idle run
  // churned MAX_PASSES and never reached a terminal state. Post-fix, the empty
  // census breaks and the run ends after the census + report agents. Load the
  // real script the way the workflow runtime does (classic script with globals,
  // per agent-failure-hardening.test.js) — never a reimplementation.
  let src = prDrain.replace(/^export /gm, '')
  src = '__runPromise = (async () => {\n' + src + '\n})()'
  const calls = []
  const logs = []
  const sandbox = {
    agent: async (prompt) => {
      calls.push(String(prompt).slice(0, 60))
      return { mergeReady: [], needsRebase: [], needsReview: [], blocked: [], held: [], ownerHeld: [], totals: { open: 0, processed: 0 }, yielded: false, hotfixCount: 0 }
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      logs.push(String(m))
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  new Script(src).runInNewContext(sandbox)
  const result = await sandbox.__runPromise
  // WITHOUT the fix, call 2 would be the pass-2 census (empty again) and the
  // run would churn on — the assertion below pins termination.
  expect(result, 'run returns a terminal result object').toBeTypeOf('object')
  expect(calls.length, 'exactly two agent calls: pass-1 census (empty -> break) + report — never a churned pass 2+').toBe(2)
  expect(logs.some((l) => l.includes('ending this run')), 'the empty-census break logs the run end').toBe(true)
})
