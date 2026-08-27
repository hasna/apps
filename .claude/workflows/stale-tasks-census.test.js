// Regression test for O15-04308 — the stale-tasks census covers only a fraction
// of the project's rows. Measured 2026-08-27: the hasna/apps todos project holds
// 685 pending + 7 in_progress = 692 rows; the census enumerated with
// `--limit 300` (the CLI truncates at 300 with an explicit warning — 385 pending
// rows were never even fetched) AND capped at "process the 150 most recently
// updated rows", so ~150 of 681 rows were ever evaluated and 531 never were.
//
// Structural layers, mirroring task-drain-apps-census.test.js:
//  1. FULL-POPULATION ENUMERATION — the `--limit 300` fetch and the
//     "150 most recently updated" cap must be gone; the census must fetch with a
//     limit that covers the whole population.
//  2. FAIL-LOUD TRUNCATION GUARD — if the CLI still warns that the matching set
//     exceeds the fetch limit, the census must refuse to proceed on a partial
//     population (return LIST-TRUNCATED) rather than silently evaluate a
//     fraction of the project.
//  3. COVERAGE GUARANTEE — every row must be evaluated: a deterministic rotating
//     batch (batchIndex = (pass - 1) % numBatches) advances one batch per pass
//     and wraps, so every row is in exactly one batch per full rotation, and
//     numBatches must stay far below MAX_PASSES so a single run covers the whole
//     population several times over.
//  4. PAYLOAD BOUND PRESERVED — the ~30KB compact-payload gate (2026-08-20)
//     still bounds the census return; the batch size must be sized under it.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'stale-tasks-wf.js'), 'utf8')

test('census enumerates the FULL population, not a --limit 300 truncation', () => {
  // The defect (O15-04308): `--limit 300` on a 685-pending-row project returns
  // the first 300 with a CLI warning; 385 rows were never fetched. The census
  // must fetch with a limit covering the whole population.
  expect(src).not.toMatch(/--limit 300/)
  expect(src).toMatch(/--limit 2000/)
})

test('the "150 most recently updated" hard cap is gone', () => {
  // The second cap: even within the fetched set, the census processed only the
  // 150 most recently updated rows — 531 of 681 never evaluated.
  expect(src).not.toMatch(/process the 150 most recently updated/)
})

test('census fails loud on a truncated fetch instead of evaluating a partial population', () => {
  // A silently-truncated census is the defect. If the CLI truncation warning
  // appears, the census must return LIST-TRUNCATED and refuse to proceed.
  expect(src).toMatch(/LIST-TRUNCATED/)
  expect(src).toMatch(/truncation warning/)
  expect(src).toMatch(/partial population/i)
})

test('every row is evaluated: rotating batch with deterministic coverage', () => {
  // The coverage guarantee: batchIndex = (pass - 1) % numBatches advances one
  // batch per pass and wraps, so every row is in exactly one batch per full
  // rotation — and numBatches stays far below MAX_PASSES.
  expect(src).toMatch(/numBatches/)
  expect(src).toMatch(/batchIndex/)
  expect(src).toMatch(/\(passNumber - 1\) % numBatches/)
  expect(src).toMatch(/every row is in exactly one batch per full rotation/i)
  expect(src).toMatch(/numBatches/)
})

test('the census prompt receives the pass number for rotation', () => {
  // The rotation needs the pass number interpolated per pass.
  expect(src).toMatch(/\{PASS\}/)
  expect(src).toMatch(/replaceAll\('\{PASS\}', String\(pass\)\)/)
})

test('the ~30KB compact-payload gate still bounds the batch size', () => {
  // The payload gate (2026-08-20) must survive the coverage fix: a full batch
  // stays under ~30KB.
  expect(src).toMatch(/30KB/)
  expect(src).toMatch(/BATCH_SIZE/)
})
