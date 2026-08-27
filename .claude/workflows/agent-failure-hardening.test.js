// Regression test for O15-00732 — the infinite standing lanes must survive a
// transient agent() failure (a subagent that returns prose instead of calling
// StructuredOutput makes agent() throw; the uncaught throw killed the whole
// 2.7h run wf_b4894f28-d61 after 37 agents, measured 2026-08-25).
//
// AMENDED 2026-08-26 — the SAME class arrived as a RESULT instead of a throw:
// a schema-requested agent completed with prose and its raw string came back
// from agent() as the survey value; `survey.deployable.length` on the string
// crashed the deploy-apps resume (wf_a3a29325-194, after the O15-00732 fix
// was already live). The safeAgent wrapper now treats a non-object result
// under a schema as the same failure class (null + AGENT-PROSE log + next-census
// sleep banner), and the deploy-apps survey consumption shape-guards
// deployable/blocked.
//
// Two layers:
//  1. STRUCTURAL — no bare `await agent(` / `() => agent(` may remain in the 9
//     standing lane scripts outside the safeAgent helper; a lane added or
//     edited with an unguarded agent() call fails this test.
//  2. BEHAVIORAL (canonical case, hotfix-drain) — with agent() throwing on the
//     first census (prose instead of StructuredOutput), the run must NOT die:
//     the failure is logged, the NEXT census prompt carries the sleep-300 pause
//     banner (the lane waits out the transient condition via the established
//     bash-sleep-inside-census primitive), and the loop reaches a later pass.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Script } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))

const LANES = [
  'hotfix-drain-wf.js',
  'pr-drain-wf.js',
  'task-drain-apps-wf.js',
  'publish-all-apps-wf.js',
  'deploy-apps-wf.js',
  'stale-tasks-wf.js',
  'github-issues-to-todos-wf.js',
  'ship-latest-wf.js',
  'propagate-lanes-to-monorepos-wf.js',
  'closed-pr-audit-wf.js',
  'leak-scan-wf.js',
]

test('structural: every agent() call in the standing lanes is wrapped in safeAgent', () => {
  for (const f of LANES) {
    let src = readFileSync(join(here, f), 'utf8')
    // Strip the helper block itself (its body legitimately contains `await agent(...)`).
    src = src.replace(/\/\/ --- safeAgent hardening \(O15-00732\) ---[\s\S]*?\/\/ --- \/safeAgent ---/, '')
    const bare = [...src.matchAll(/\bawait\s+agent\(/g)]
    const bareClosure = [...src.matchAll(/\(\) =>\s*agent\(/g)]
    expect(bare, f + ': bare await agent( calls outside safeAgent').toEqual([])
    expect(bareClosure, f + ': bare () => agent( closures outside safeAgent').toEqual([])
    expect(src.includes('safeAgent'), f + ': defines the safeAgent wrapper').toBe(true)
  }
})

// The safeAgent migration (PR #1185, 2026-08-25) mis-parenthesized the census
// calls in 5 of 9 lanes: `safeAgent(censusPrompt(`...`, { schema }))` — the opts
// object landed INSIDE censusPrompt's parens, so safeAgent and agent() received
// NO schema. The census agent then ran unconstrained, a prose reply came back as
// the raw string result, and the run crashed at `survey.deployable.length`
// (wf_a3a29325-194, measured 2026-08-26). This test pins the call shape.
const censusSchemaReachesAgent = (src) => {
  const start = src.indexOf('safeAgent(censusPrompt(')
  if (start < 0) return null // no censusPrompt wrapper — not applicable
  let depth = 2 // safeAgent( + censusPrompt(
  let i = start + 'safeAgent(censusPrompt('.length
  let inTpl = false
  while (i < src.length) {
    const c = src[i]
    if (inTpl) {
      if (c === '`' && src[i - 1] !== '\\') inTpl = false
    } else if (c === '`') {
      inTpl = true
    } else if (c === '(') {
      depth++
    } else if (c === ')') {
      depth--
      if (depth === 1) return true // censusPrompt closed before any depth-2 comma
    } else if (c === ',' && depth === 2) {
      return false // opts comma inside censusPrompt — the schema is swallowed
    }
    i++
  }
  return null
}

test('structural: census opts (with the schema) reach safeAgent — never swallowed by censusPrompt', () => {
  for (const f of LANES) {
    const src = readFileSync(join(here, f), 'utf8')
    const shape = censusSchemaReachesAgent(src)
    expect(shape, f + ': census call must be safeAgent(censusPrompt(`...`), { schema ... }) — the opts object must sit OUTSIDE censusPrompt').not.toBe(false)
  }
})

test('behavioral: hotfix-drain survives an agent() schema failure and pauses the next census', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  let failures = 0
  const schemaErr = new Error('agent({schema}): subagent completed without calling StructuredOutput (after in-conversation nudge)')
  const prev = { agent: globalThis.agent, parallel: globalThis.parallel, log: globalThis.log, phase: globalThis.phase, args: globalThis.args }
  globalThis.agent = async (prompt) => {
    calls++
    prompts.push(String(prompt))
    if (calls === 1) throw schemaErr // pass-1 census: prose instead of StructuredOutput
    if (calls === 3) throw new Error('second transient failure') // pass-3 census: must ALSO be swallowed
    return { candidates: [], hotfixCount: 0 } // empty queue -> idle continue
  }
  globalThis.parallel = (fns) => Promise.all(fns.map((f) => f()))
  // Termination comes from OUTSIDE safeAgent (log is not wrapped): after two
  // swallowed agent failures, throw the test sentinel from log. With the fix,
  // the throw lands inside safeAgent's catch block (during its failure log) and
  // propagates out; WITHOUT the fix the very first agent throw kills the run
  // with the schema error instead.
  globalThis.log = (m) => {
    const s = String(m)
    logs.push(s)
    if (s.includes('AGENT-FAILURE')) failures++
    if (failures >= 2) throw new Error('__TEST_END__')
  }
  globalThis.phase = () => {}
  globalThis.args = {}
  let ended = null
  try {
    await import(pathToFileURL(join(here, 'hotfix-drain-wf.js')).href)
  } catch (err) {
    ended = err
  } finally {
    globalThis.agent = prev.agent
    globalThis.parallel = prev.parallel
    globalThis.log = prev.log
    globalThis.phase = prev.phase
    globalThis.args = prev.args
  }
  // The schema failures must NOT have killed the run: it reached pass 3+.
  expect(calls, 'run reached a later pass after the agent failures').toBeGreaterThanOrEqual(3)
  expect(ended && ended.message, 'loop terminated only via the test sentinel from outside safeAgent').toBe('__TEST_END__')
  // Both failures were logged, not swallowed silently.
  expect(failures, 'every agent failure is logged').toBeGreaterThanOrEqual(2)
  // The pass-2 census prompt carries the sleep-300 pause banner.
  expect(prompts.length, 'pass-2 census prompt recorded').toBeGreaterThanOrEqual(2)
  expect(prompts[1].includes('Sleep 300 (bash) FIRST'), 'next census sleeps 300s first').toBe(true)
})

test('behavioral: deploy-apps survives a PROSE RESULT (non-object under a schema) — the run must not crash on survey.deployable.length', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  // The lane is a CJS-style script (top-level return, top-level await) — load it
  // the way the workflow runtime does (a classic script with globals), not as an
  // ESM module: strip the `export ` keyword and wrap in an async IIFE so the
  // top-level return and await are legal in the vm context.
  let src = readFileSync(join(here, 'deploy-apps-wf.js'), 'utf8').replace(/^export /gm, '')
  src = '__runPromise = (async () => {\n' + src + '\n})()'
  const sandbox = {
    agent: async (prompt) => {
      calls++
      prompts.push(String(prompt))
      if (calls === 1) return 'Waiting on the armed re-check window; the monitor will deliver the completion event, after which the re-check runs and the final survey result is returned.'
      return { deployable: [], blocked: [], yielded: false, hotfixCount: 0 }
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (logs.filter((l) => l.includes('no deployable services')).length >= 3) throw new Error('__TEST_END__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  new Script(src).runInNewContext(sandbox)
  let ended = null
  await sandbox.__runPromise.catch((e) => {
    ended = e
  })
  // WITHOUT the prose guard, pass 1 binds the string and crashes with
  // "undefined is not an object (evaluating 'survey.deployable.length')".
  // WITH it, the string is treated as the failure class and the loop continues.
  expect(ended && ended.message, 'loop terminated only via the test sentinel, never the TypeError').toBe('__TEST_END__')
  expect(calls, 'run reached pass 3+ after the prose result').toBeGreaterThanOrEqual(3)
  expect(logs.some((l) => l.includes('AGENT-PROSE')), 'the prose result is logged as the failure class').toBe(true)
  expect(prompts[1].includes('Sleep 300 (bash) FIRST'), 'the pass-2 census prompt carries the sleep-300 pause banner').toBe(true)
})

// O15-04231 — publish-all must NEVER silently drop a failed [PUBLISH-CONFIRM]
// agent. Pre-fix, `r.confirmId = confirm ? confirm.confirmId : null` recorded a
// gate-verified release whose in-thread confirm was never posted: no retry, no
// marker, no follow-up — and the app is CURRENT on the registry, so no later
// pass ever revisits the missing confirm (a release-gate record defect; sibling
// of I38-01298). The fix: retry the confirm ONCE (the lane's established
// transient-failure pattern, deduped so a first attempt that actually posted is
// not duplicated), and if both attempts fail, record the release as
// confirmed-never (confirmPosted false / confirmFailed true), log CONFIRM-FAILED,
// and file a RELEASE CONFIRM MISSING row — the class the task-drain lane already
// remediates for RELEASE UNVERIFIED.
//
// The lane is a CJS-style script (top-level return, top-level await) — load it
// the way the workflow runtime does (a classic script with globals), not as an
// ESM module: strip the `export ` keyword and wrap in an async IIFE so the
// top-level return and await are legal in the vm context.
const loadPublishAll = (sandbox) => {
  const src = readFileSync(join(here, 'publish-all-apps-wf.js'), 'utf8').replace(/^export /gm, '')
  sandbox.__runPromise = null
  new Script('__runPromise = (async () => {\n' + src + '\n})()').runInNewContext(sandbox)
  return sandbox.__runPromise
}
const PUBLISH_ALL_CENSUS = { queue: [{ name: '@hasna/fixlane-test', repoVersion: '0.1.0', registryLatest: '0.0.9', breaking: false, bins: ['fixlane-test'] }], current: [], pendingPR: [], counts: { ahead: 1, current: 0, pendingPR: 0 }, yielded: false }
const PUBLISH_ALL_RELEASE = { app: 'fixlane-test', publishedVersion: '0.1.0', reviewVerdict: 'GO', reviewSha: 'abc123', mergedChangesetPr: null, intentId: 'msg-1', liveTest: { state: 'pass', version: '0.1.0', helpRc: 0, smoke: 'ok' }, skipped: false, reason: null }

test('behavioral: publish-all retries a failed [PUBLISH-CONFIRM] once, then records CONFIRM-FAILED and files a follow-up row — never a silent drop (O15-04231)', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  let confirmCalls = 0
  const sandbox = {
    agent: async (prompt) => {
      calls++
      prompts.push(String(prompt))
      const p = String(prompt)
      if (p.includes('ROLE: census')) return PUBLISH_ALL_CENSUS
      if (p.includes('ROLE: release lane')) return PUBLISH_ALL_RELEASE
      if (p.includes('LIVE GATE 1 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('LIVE GATE 2 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('GATE CONFIRM')) {
        confirmCalls++
        throw new Error('agent({schema}): subagent completed without calling StructuredOutput (confirm)')
      }
      if (p.includes('RELEASE CONFIRM MISSING')) return { taskId: 'cf-row-1' }
      return {}
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('CONFIRM-FAILED')) throw new Error('__TEST_CONFIRM_HANDLED__')
      if (logs.filter((l) => l.includes('AGENT-FAILURE')).length >= 3) throw new Error('__TEST_END__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  const run = loadPublishAll(sandbox)
  let ended = null
  await run.catch((e) => {
    ended = e
  })
  // WITHOUT the fix the confirm failure is dropped silently: no retry, no
  // CONFIRM-FAILED line, no follow-up prompt — the sentinel only fires after the
  // third AGENT-FAILURE on pass 3, and every assertion below fails.
  expect(ended && ended.message, 'terminated via the CONFIRM-FAILED sentinel, never a silent pass-through').toBe('__TEST_CONFIRM_HANDLED__')
  expect(confirmCalls, 'the confirm agent was retried exactly once (original + retry)').toBe(2)
  expect(prompts.some((p) => p.includes('RELEASE CONFIRM MISSING')), 'a RELEASE CONFIRM MISSING follow-up row was filed').toBe(true)
  expect(logs.some((l) => l.includes('CONFIRM-RETRY')), 'the retry is logged').toBe(true)
  expect(logs.some((l) => l.includes('CONFIRM-FAILED') && l.includes('@hasna/fixlane-test')), 'the CONFIRM-FAILED line names the package').toBe(true)
})

// O15-04231 review cycle 1, P1-1: the retry dedupe must return the EXISTING
// confirm (posted: false) when the first attempt actually posted before failing
// the schema return — and a found confirm must NOT trigger the follow-up row.
test('behavioral: publish-all retry finds an already-posted [PUBLISH-CONFIRM] and posts nothing — no duplicate, no follow-up row (O15-04231 P1-1)', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  let confirmCalls = 0
  const sandbox = {
    agent: async (prompt) => {
      calls++
      prompts.push(String(prompt))
      const p = String(prompt)
      if (p.includes('ROLE: census')) return PUBLISH_ALL_CENSUS
      if (p.includes('ROLE: release lane')) return PUBLISH_ALL_RELEASE
      if (p.includes('LIVE GATE 1 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('LIVE GATE 2 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('GATE CONFIRM')) {
        confirmCalls++
        if (confirmCalls === 1) throw new Error('agent({schema}): confirm agent posted then failed the schema return')
        return { confirmId: 'c-existing', posted: false } // the dedupe retry found the posted confirm
      }
      if (p.includes('RELEASE CONFIRM MISSING')) return { taskId: 'cf-row-1' }
      return {}
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 1 complete')) throw new Error('__TEST_PASS1_DONE__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  const run = loadPublishAll(sandbox)
  let ended = null
  await run.catch((e) => {
    ended = e
  })
  expect(ended && ended.message, 'terminated via the pass-1-complete sentinel').toBe('__TEST_PASS1_DONE__')
  expect(confirmCalls, 'the confirm agent was retried exactly once (attempt + dedupe retry)').toBe(2)
  expect(logs.some((l) => l.includes('CONFIRM-RETRY')), 'the retry is logged').toBe(true)
  expect(prompts.some((p) => p.includes('RELEASE CONFIRM MISSING')), 'NO follow-up row when the dedupe found the existing confirm').toBe(false)
  expect(logs.some((l) => l.includes('CONFIRM-FAILED')), 'NO CONFIRM-FAILED when the confirm exists').toBe(false)
})

// O15-04231 review cycles 1-2, P1-3: the follow-up row filing FAILS CLOSED — a
// throwing follow-up agent or an EMPTY taskId (minLength violation) is a
// failure, the filing is retried once, and if it still fails the app is queued
// so the NEXT pass's census retries the row before its registry census. The
// queue is cleared ONLY on a verified non-empty taskId receipt for the exact
// package@version (confirmFollowupFiling); a census that fails, yields, or
// returns no receipt leaves the entries queued for the following pass.
const PUBLISH_ALL_FAILING_STUBS = {
  agent: async (prompt) => {
    const p = String(prompt)
    if (p.includes('ROLE: census')) return PUBLISH_ALL_CENSUS
    if (p.includes('ROLE: release lane')) return PUBLISH_ALL_RELEASE
    if (p.includes('LIVE GATE 1 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
    if (p.includes('LIVE GATE 2 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
    if (p.includes('GATE CONFIRM')) throw new Error('agent({schema}): confirm agent failed')
    if (p.includes('RELEASE CONFIRM MISSING')) return { taskId: '' } // empty taskId: minLength violation — must NOT be accepted
    return {}
  },
  parallel: (fns) => Promise.all(fns.map((f) => f())),
  phase: () => {},
  args: {},
  __runPromise: null,
}

test('behavioral: publish-all retains the queued RELEASE CONFIRM MISSING row when the census returns NO receipt — fail closed across passes (O15-04231 P1-3)', async () => {
  const logs = []
  const prompts = []
  const sandbox = {
    ...PUBLISH_ALL_FAILING_STUBS,
    agent: async (prompt) => {
      prompts.push(String(prompt))
      return PUBLISH_ALL_FAILING_STUBS.agent(prompt)
    },
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 3 complete')) throw new Error('__TEST_RETAINED__')
      if (logs.filter((l) => l.includes('AGENT-FAILURE')).length >= 10) throw new Error('__TEST_END__')
    },
  }
  const run = loadPublishAll(sandbox)
  let ended = null
  await run.catch((e) => {
    ended = e
  })
  expect(ended && ended.message, 'terminated at pass 3 complete').toBe('__TEST_RETAINED__')
  // The note must appear in BOTH the pass-2 and pass-3 census prompts: no
  // receipt was returned, so the queue survived pass 2.
  const notedCensus = prompts.filter((p) => p.includes('RETRY filing those rows') && p.includes('@hasna/fixlane-test'))
  expect(notedCensus.length, 'the retry note is carried into every subsequent census while unverified').toBeGreaterThanOrEqual(2)
  expect(logs.some((l) => l.includes('QUEUED for the next pass census')), 'the queueing is logged').toBe(true)
})

test('behavioral: publish-all clears the queued row only on a VERIFIED census receipt — acknowledged success drops the note (O15-04231 P1-3)', async () => {
  const logs = []
  const prompts = []
  let confirmCalls = 0
  let followupCalls = 0
  const sandbox = {
    agent: async (prompt) => {
      prompts.push(String(prompt))
      const p = String(prompt)
      if (p.includes('ROLE: census')) {
        // Pass 2+ (the queue exists by then): return a VERIFIED receipt for the
        // queued entry; pass 1 has nothing queued yet.
        const queued = prompts.filter((x) => x.includes('RETRY filing those rows')).length
        const receipt = queued > 0 ? { confirmFollowupFiling: [{ pkgName: '@hasna/fixlane-test', gateV: '0.1.0', taskId: 'cf-row-1' }] } : {}
        return { ...PUBLISH_ALL_CENSUS, ...receipt }
      }
      if (p.includes('ROLE: release lane')) return PUBLISH_ALL_RELEASE
      if (p.includes('LIVE GATE 1 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('LIVE GATE 2 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('GATE CONFIRM')) {
        confirmCalls++
        if (confirmCalls <= 2) throw new Error('agent({schema}): confirm agent failed (pass 1 only)')
        return { confirmId: 'c-ok', posted: true }
      }
      if (p.includes('RELEASE CONFIRM MISSING')) {
        followupCalls++
        if (followupCalls === 1) return { taskId: '' }
        throw new Error('agent({schema}): follow-up agent failed on retry')
      }
      return {}
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 3 complete')) throw new Error('__TEST_CLEARED__')
      if (logs.filter((l) => l.includes('AGENT-FAILURE')).length >= 10) throw new Error('__TEST_END__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  const run = loadPublishAll(sandbox)
  let ended = null
  await run.catch((e) => {
    ended = e
  })
  expect(ended && ended.message, 'terminated at pass 3 complete').toBe('__TEST_CLEARED__')
  // Pass 2 census carried the note (the queue existed); after the verified
  // receipt the queue cleared, so pass 3's census prompt has NO note and the
  // pass-2 confirm succeeded without re-queueing.
  const notedCensus = prompts.filter((p) => p.includes('RETRY filing those rows') && p.includes('@hasna/fixlane-test'))
  expect(notedCensus.length, 'the note appears exactly once (pass 2) — cleared after the receipt').toBe(1)
  expect(logs.some((l) => l.includes('CONFIRM-FOLLOWUP-FILED')), 'the verified receipt clearing is logged').toBe(true)
  expect(logs.some((l) => l.includes('QUEUED for the next pass census')), 'the queueing is logged').toBe(true)
})

test('behavioral: publish-all confirm success path — single confirm call, no retry, no follow-up row (positive control, O15-04231)', async () => {
  const logs = []
  const prompts = []
  let calls = 0
  let confirmCalls = 0
  const sandbox = {
    agent: async (prompt) => {
      calls++
      prompts.push(String(prompt))
      const p = String(prompt)
      if (p.includes('ROLE: census')) return PUBLISH_ALL_CENSUS
      if (p.includes('ROLE: release lane')) return PUBLISH_ALL_RELEASE
      if (p.includes('LIVE GATE 1 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('LIVE GATE 2 OF 2')) return { verdict: 'GO', perCommand: [], failures: [] }
      if (p.includes('GATE CONFIRM')) {
        confirmCalls++
        return { confirmId: 'c-1', posted: true }
      }
      if (p.includes('RELEASE CONFIRM MISSING')) return { taskId: 'cf-row-1' }
      return {}
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 1 complete')) throw new Error('__TEST_PASS1_DONE__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  const run = loadPublishAll(sandbox)
  let ended = null
  await run.catch((e) => {
    ended = e
  })
  expect(ended && ended.message, 'terminated via the pass-1-complete sentinel').toBe('__TEST_PASS1_DONE__')
  expect(confirmCalls, 'a successful confirm is called exactly once — no retry').toBe(1)
  expect(logs.some((l) => l.includes('CONFIRM-RETRY') || l.includes('CONFIRM-FAILED')), 'no retry/failure markers on the success path').toBe(false)
  expect(prompts.some((p) => p.includes('RELEASE CONFIRM MISSING')), 'no follow-up row on the success path').toBe(false)
})

test('behavioral: closed-pr-audit completes a full census → record pass without template-eval ReferenceError', async () => {
  // Cycle-1 review (2026-08-26) found an unbound template interpolation in the
  // RECORD prompt — `"WRONG-CLOSE ${klass}: ..."` — evaluated as an argument
  // BEFORE safeAgent is called, so `klass is not defined` killed every launch
  // on pass 1, masked by the earlier parse failure. Structural tests cannot see
  // this class; only a runtime probe can. The stub census returns one flagged
  // W2 PR, the record agent returns a valid record, and the sentinel fires from
  // log when pass 1's flagged-summary line lands — proving the full census →
  // record pass completed without throwing.
  const logs = []
  const prompts = []
  let calls = 0
  let src = readFileSync(join(here, 'closed-pr-audit-wf.js'), 'utf8').replace(/^export /gm, '')
  src = '__runPromise = (async () => {\n' + src + '\n})()'
  const sandbox = {
    agent: async (prompt) => {
      calls++
      prompts.push(String(prompt))
      if (calls === 1) {
        return {
          window: '2026-08-26T00:00:00Z..2026-08-26T23:59:59Z',
          bound: 'paged to exhaustion',
          perRepo: [{ repo: 'hasna/apps', scanned: 5, closedUnmerged: 1, classified: { W2: 1 } }],
          flagged: [
            {
              repo: 'hasna/apps', prNumber: 999, title: 'test PR', headSha: 'a1b2c3d4',
              closedAt: '2026-08-26T10:00:00Z', closedBy: 'test', klass: 'W2',
              evidence: ['[REVIEW] GO — hasna/apps#999 @ a1b2c3d4'], predicate: 'task pending',
            },
          ],
          positiveControls: { legitimateCloseClassifiedL: true, knownW2ClassifiedW2: true },
        }
      }
      return { rowsFiled: 1, commentsPosted: 1, skippedDedup: 0, channelLine: 'test line' }
    },
    parallel: (fns) => Promise.all(fns.map((f) => f())),
    log: (m) => {
      const s = String(m)
      logs.push(s)
      if (s.includes('pass 1: 1 flagged')) throw new Error('__TEST_END__')
    },
    phase: () => {},
    args: {},
    __runPromise: null,
  }
  new Script(src).runInNewContext(sandbox)
  let ended = null
  await sandbox.__runPromise.catch((e) => {
    ended = e
  })
  // WITHOUT the \${klass} escape, the record prompt evaluation throws
  // `ReferenceError: klass is not defined` before safeAgent is called, and the
  // sentinel never fires. WITH it, pass 1 runs census → record → summary log.
  expect(ended && ended.message, 'loop terminated only via the test sentinel, never a ReferenceError').toBe('__TEST_END__')
  expect(calls, 'census + record agents both ran').toBeGreaterThanOrEqual(2)
  // The literal placeholder text reaches the record agent (the prompt is not
  // evaluated with an unbound name).
  expect(prompts[1].includes('WRONG-CLOSE ${klass}:'), 'record prompt carries the literal ${klass} placeholder').toBe(true)
})
