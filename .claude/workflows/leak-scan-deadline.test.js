// Regression test for O15-04207 — the leak-scan lane must never FREEZE on a
// lost agent result. Measured 2026-08-27 on wf_ba7258cc-755 (task w3119ijn3):
// the pass-22 scan agent completed its final StructuredOutput at 14:41:54.736Z
// ("Structured output provided successfully", toolEndsTurn: true) and the
// runtime's journal records the result — but the workflow's `await
// parallel(thunks)` never received it. The lane froze 77 minutes with the
// runtime holding the run live-but-stopped; no log line was produced; the
// transcript stayed silent until an external kill at 15:58:03Z and a manual
// resume at ~16:10Z. safeAgent (O15-00732) catches thrown errors and prose
// results, but NOT a result the runtime accepts and loses in delivery.
//
// The fix races every phase's agent await against a wall-clock deadline; on
// expiry the pass logs and continues, and the next census re-queues every repo
// whose cursor was not advanced (the state resume contract already treats a
// repo without an advanced cursor as unscanned). A lost result must degrade to
// a rescan, never to a dead lane.
//
// CANONICAL CASE: one scan agent's promise NEVER resolves (the result is lost
// in delivery). With the fix, the scan-phase deadline fires, the expiry is
// logged, and the loop continues to the next pass. WITHOUT the fix the run
// hangs at `await parallel(thunks)` forever — the bun:test timeout kills the
// test and it fails.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Script } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))

const CENSUS_OK = {
  yielded: false,
  specPresent: true,
  spec: null,
  sweep: 1,
  sweepStarted: true,
  population: ['hasna/apps'],
  populationComplete: true,
  reposTotal: 1,
  remainingThisSweep: 1,
  idle: false,
  queue: [{ repo: 'hasna/apps', mode: 'full', cursor: null }],
}

test('behavioral: leak-scan survives a LOST scan result — the scan deadline fires and the loop continues', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  let src = readFileSync(join(here, 'leak-scan-wf.js'), 'utf8').replace(/^export /gm, '')
  src = '__runPromise = (async () => {\n' + src + '\n})()'
  const sandbox = {
    agent: async (prompt) => {
      calls++
      const p = String(prompt)
      prompts.push(p)
      if (p.includes('Census for the leak-scan lane')) return CENSUS_OK
      if (p.includes('SCAN phase of the leak-scan lane')) {
        // The scan agent's result is LOST: the promise never resolves. This is
        // the measured 2026-08-27 failure (wf_ba7258cc-755 pass 22) — the agent
        // completed its StructuredOutput, the runtime confirmed it, and the
        // workflow await never resolved.
        return new Promise(() => {})
      }
      if (p.includes('RECORD phase of the leak-scan lane')) {
        return { rowsFiled: 0, commentsPosted: 0, skippedDedup: 0, stateWritten: true, channelLine: 'test' }
      }
      throw new Error('unexpected agent call: ' + p.slice(0, 80))
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('scan phase exceeded')) throw new Error('__TEST_END__')
    },
    phase: () => {},
    // Short deadlines: 100ms scan deadline makes the race fire quickly; the
    // other phases resolve immediately in this stub.
    args: { scanDeadlineMs: 100, censusDeadlineMs: 5000, investigateDeadlineMs: 5000, recordDeadlineMs: 5000 },
    setTimeout,
    __runPromise: null,
  }
  new Script(src).runInNewContext(sandbox)
  let ended = null
  await sandbox.__runPromise.catch((e) => {
    ended = e
  })
  // WITHOUT the deadline guard the run hangs at `await parallel(thunks)` and
  // this test times out (bun:test 5s default). WITH it, the sentinel fires
  // from log on the first deadline expiry — proving the pass loop continued.
  expect(ended && ended.message, 'the lost scan result must not hang the lane — the scan deadline fires and the loop continues').toBe('__TEST_END__')
  expect(logs.some((l) => l.includes('scan phase exceeded')), 'the deadline expiry is logged').toBe(true)
  expect(calls, 'the next pass reached a fresh census after the deadline').toBeGreaterThanOrEqual(2)
})

test('behavioral: leak-scan still completes a full census → scan → record pass when results ARE delivered', async () => {
  const logs = []
  let calls = 0
  let src = readFileSync(join(here, 'leak-scan-wf.js'), 'utf8').replace(/^export /gm, '')
  src = '__runPromise = (async () => {\n' + src + '\n})()'
  const sandbox = {
    agent: async (prompt) => {
      calls++
      const p = String(prompt)
      if (p.includes('Census for the leak-scan lane')) return CENSUS_OK
      if (p.includes('SCAN phase of the leak-scan lane')) {
        return { results: [{ repo: 'hasna/apps', mode: 'full', scannedCommits: 0, scannedFiles: 1, cursor: 'abc123', failed: false, truncated: false, findings: [], controls: { fixtureDetected: true, knownCleanPassed: true, syntheticCredentialBlocked: true } }] }
      }
      if (p.includes('RECORD phase of the leak-scan lane')) {
        return { rowsFiled: 0, commentsPosted: 0, skippedDedup: 0, stateWritten: true, channelLine: 'leak-scan pass 1: clean — 0 findings across hasna/apps; sweep 1 remaining 0' }
      }
      throw new Error('unexpected agent call: ' + p.slice(0, 80))
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 1: clean')) throw new Error('__TEST_END__')
    },
    phase: () => {},
    args: { scanDeadlineMs: 5000, censusDeadlineMs: 5000, investigateDeadlineMs: 5000, recordDeadlineMs: 5000 },
    setTimeout,
    __runPromise: null,
  }
  new Script(src).runInNewContext(sandbox)
  let ended = null
  await sandbox.__runPromise.catch((e) => {
    ended = e
  })
  expect(ended && ended.message, 'a healthy pass completes census → scan → record and logs the clean summary').toBe('__TEST_END__')
  expect(calls, 'census + scan + record agents all ran').toBeGreaterThanOrEqual(3)
  expect(logs.some((l) => l.includes('scan phase exceeded')), 'no deadline expiry on a healthy pass').toBe(false)
})
