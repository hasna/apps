// Regression test for O15-00732 — the infinite standing lanes must survive a
// transient agent() failure (a subagent that returns prose instead of calling
// StructuredOutput makes agent() throw; the uncaught throw killed the whole
// 2.7h run wf_b4894f28-d61 after 37 agents, measured 2026-08-25).
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
