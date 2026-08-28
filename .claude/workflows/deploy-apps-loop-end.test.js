// Regression test for O15-04437 — the deploy-apps lane never reaches a terminal
// state while idle, so the standing lane reads as DEAD ("hung run, no terminal
// result"). Measured 2026-08-27/28 on wf_e88eb9c2-1b7 (dispatched 21:32Z): the
// run churned 12+ idle surveys ~6-7 min apart with no terminal result for 77+
// minutes, then the final survey agent hung mid-command. The run never ended,
// so the one-effective-run-per-lane guard blocked a fresh dispatch and the
// coordinator's relaunch-on-completion trigger never fired.
//
// Root cause: the DRAIN-TO-ZERO loop's own design comment says "A pass that
// deploys nothing new or an empty deployable set ENDS the loop", but the
// empty-deployable branch did `continue` — the next pass re-ran the survey,
// which sleeps IDLE_SLEEP (300-1800s, args idleMinutes) and re-checks once
// before returning empty, so an idle run churned all MAX_PASSES (default 40)
// with a 5-30 min sleep per pass and never terminated. The `yielded` branch was
// also dead code: a yielded survey returns {deployable: [], yielded: true}, so
// the empty-deployable guard (checked first) caught it before the yield check.
//
// Structural layers (mirroring deploy-apps-arch.test.js / task-drain-apps-census.test.js):
//  1. EMPTY DEPLOYABLE ENDS THE RUN — the empty-deployable branch must `break`
//     (the survey already slept the idle window and re-checked once per its own
//     prompt), and the final return's 'deploy-survey-only' status is how the
//     run reports the idle state to the coordinator.
//  2. YIELDED CHECKED FIRST, ALSO ENDS THE RUN — a yielded survey (HOTFIX rows
//     exist; hotfix-drain owns the priority class) must be recognized by its
//     own branch (checked BEFORE the empty guard, so it is not dead code) and
//     must also `break`: the coordinator relaunches and the next run re-yields.
//  3. NO IDLE-CHURN `continue` LEFT IN THE LOOP — no standalone `continue`
//     statement may remain; every non-terminal branch either deploys or ends.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'deploy-apps-wf.js'), 'utf8')

test('an empty deployable survey ENDS the run (break, not the O15-04437 idle-churn continue)', () => {
  // The defect: `continue` on an empty deployable set re-ran the survey next
  // pass — each pass re-sleeps IDLE_SLEEP and re-checks, so an idle run never
  // reached a terminal state (wf_e88eb9c2-1b7: 77+ min, no terminal result).
  // The survey already slept + re-checked once before returning empty, so the
  // run must end here and let the coordinator relaunch for standing continuity.
  const emptyGuard = src.indexOf('deployable.length === 0')
  expect(emptyGuard).toBeGreaterThan(-1)
  const branch = src.slice(emptyGuard, emptyGuard + 800)
  expect(branch).toMatch(/\n\s*break\b/)
  expect(branch).not.toMatch(/\n\s*continue\b/)
})

test('a yielded survey (HOTFIX priority class) is checked BEFORE the empty guard and also ends the run', () => {
  // A yielded survey returns {deployable: [], blocked: [], yielded: true} — the
  // empty-deployable guard previously caught it first, making the yielded
  // branch dead code. The yield branch must precede the empty guard so the lane
  // records the yield reason, and must `break` so the run terminates and the
  // coordinator relaunches (the next run re-yields while hotfix rows persist).
  const yieldIdx = src.indexOf('survey && survey.yielded')
  const emptyIdx = src.indexOf('deployable.length === 0')
  expect(yieldIdx).toBeGreaterThan(-1)
  expect(emptyIdx).toBeGreaterThan(-1)
  expect(yieldIdx).toBeLessThan(emptyIdx)
  const yieldBranch = src.slice(yieldIdx, yieldIdx + 800)
  expect(yieldBranch).toMatch(/\n\s*break\b/)
  expect(yieldBranch).not.toMatch(/\n\s*continue\b/)
})

test('the only `continue` left in the loop is the agent-failure backoff (O15-00732) — an empty survey never churns', () => {
  // The idle-churn class: a `continue` after an EMPTY deployable re-runs the
  // idle survey next pass. After the O15-04437 fix the empty/yielded branches
  // `break`; the ONLY permitted `continue` is the `if (!survey) continue`
  // failure-class backoff (a failed agent did not already wait the idle window,
  // and the next pass's census sleeps 300s first via the censusPrompt banner).
  const continues = src.match(/if \(!survey\) continue|\n\s*continue\s*\n/g) || []
  expect(continues, 'exactly one continue construct in the whole file: the O15-00732 failure backoff').toHaveLength(1)
  expect(continues[0], 'the one permitted continue is the failure-class backoff').toContain('if (!survey) continue')
  // The empty-deployable guard must not be followed by a continue.
  const emptyGuard = src.indexOf('deployable.length === 0')
  expect(src.slice(emptyGuard, emptyGuard + 800)).not.toMatch(/\n\s*continue\b/)
})
