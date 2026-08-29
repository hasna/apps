// Regression test for O15-04651 — the ship-latest lane hot-loops its idle
// census: NO sleep despite its own contract. Measured 2026-08-29: the infinite
// loop comment (owner 2026-08-25, added with #1226 ff370a60c) states "The
// census agent sleeps 1800 (bash) and re-checks once when it is a NO-OP, so the
// run stays alive at ~1 agent per idle window" — but the CENSUS prompt carried
// NO sleep instruction, so a NO-OP census returned immediately and the loop
// re-dispatched the next census with no wait: ~1 agent per pass continuously,
// burning tokens 24/7, while the pass log claimed "the census waited ~30 min
// and re-checked" (a false statement). The only sleep wired anywhere was the
// 300s safeAgent failure banner (O15-00732) — the failure path, not the idle
// path.
//
// The fix ports the standing idle-wait primitive (task-drain-apps, deploy-apps,
// stale-tasks — the same repo's other standing lanes): an args-driven
// IDLE_MINUTES/IDLE_SLEEP pair and a census prompt that makes the NO-OP branch
// sleep the idle window (bash) and re-run the census once BEFORE returning.
//
// Structural layers:
//  1. IDLE CONSTANTS — IDLE_MINUTES (args-driven, default 30) and the clamped
//     IDLE_SLEEP (floor 300 = the safeAgent failure-banner sleep, cap 1800),
//     exactly the sibling-lane shape.
//  2. CENSUS NO-OP SLEEP — the census prompt's NO-OP branch must instruct
//     "sleep ${IDLE_SLEEP} (bash ...), re-run the census steps once, and return
//     the RE-CHECK result" — the same wording the sibling lanes use.
//  3. NEVER-EMPTY GUARD — the NO-OP branch must forbid returning {noop: true}
//     without the sleep+re-check having run ("NEVER return ... without the
//     sleep+re-check having run"), so an agent cannot silently skip the wait.
//  4. HONEST LOOP LOG — the pass log that claimed "the census waited ~30 min"
//     must name the actual IDLE_SLEEP it waited.
//  5. FAILURE BANNER PRESERVED — the O15-00732 failure-path sleep-300 banner
//     must remain untouched (it is a different wait, and a regression there
//     kills the transient-failure backoff).
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'ship-latest-wf.js'), 'utf8')

test('idle window constants exist with the sibling clamp shape', () => {
  // The defect: no IDLE_SLEEP anywhere — the contract number (1800) existed
  // only inside a comment. The constants must be real and args-driven with the
  // floor-300/cap-1800 clamp the other standing lanes use.
  expect(src).toMatch(/const IDLE_MINUTES = Math\.min\(\(\(args && args\.idleMinutes\) \|\| 30\), 300\)/)
  expect(src).toMatch(/const IDLE_SLEEP = Math\.min\(Math\.max\(300, IDLE_MINUTES \* 60\), 1800\)/)
})

test('census NO-OP branch sleeps the idle window and re-checks once', () => {
  // The defect: the NO-OP branch said only "return {noop: true} with the
  // counts — no further phases run, no tokens burned" — an immediate return
  // with NO wait, so the loop hot-looped. The prompt must instruct the bash
  // sleep of IDLE_SLEEP and a single re-run of the census before returning.
  expect(src).toMatch(/sleep \$\{IDLE_SLEEP\} \(bash/)
  expect(src).toMatch(/re-run the census steps once/)
  expect(src).toMatch(/the RE-CHECK result/)
})

test('census may NEVER return an empty noop without the sleep+re-check', () => {
  // The never-empty guard is what makes the contract enforceable in-prompt:
  // a NO-OP result that did not wait the idle window is a contract violation.
  expect(src).toMatch(/NEVER return \{noop: true\} without the sleep\+re-check having run/)
})

test('the pass log names the actual idle wait, not an unqualified claim', () => {
  // The old log asserted "the census waited ~30 min and re-checked" while no
  // sleep existed anywhere — a false statement. It must reference IDLE_SLEEP.
  expect(src).toMatch(/the census waited \$\{IDLE_SLEEP\}s and re-checked/)
})

test('the O15-00732 failure banner sleep is preserved', () => {
  // The 300s failure-path banner is a DIFFERENT wait (transient-failure
  // backoff); the fix must not disturb it.
  expect(src).toMatch(/Sleep 300 \(bash\) FIRST/)
})
