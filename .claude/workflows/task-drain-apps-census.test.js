// Regression test for O15-00760 — UNVERIFIED gate rows are undrainable.
// The task-drain census selected rows whose title starts with "BUG" ONLY, so the
// RELEASE/SHIP/DEPLOY UNVERIFIED rows filed by the 2-agent live gates
// (publish-all-apps, deploy-apps, ship-latest — the harden-lanes-review-gates
// protocol) were never candidates and never drained. Measured 2026-08-25:
// 25 pending unassigned UNVERIFIED rows, 0 comments, no fixer.
//
// Structural layers, mirroring agent-failure-hardening.test.js:
//  1. CENSUS COVERAGE — the census prompt must select BOTH the BUG class and the
//     UNVERIFIED gate-row class (the live-gate NO_GO rows), and the single-class
//     "starts with BUG" selector must be gone.
//  2. TERMINAL MARKERS — rows whose comments record a gate-row terminal verdict
//     ("VERIFIED" / "NO_GO ROUTED") are excluded from candidates, so a drained
//     gate row is not re-picked every pass.
//  3. EXECUTION BRANCH — the execution prompt must branch by class: UNVERIFIED
//     rows get the gate-remediation protocol (two independent live gates
//     re-verify the artifact; BOTH GO -> post the missing confirm + complete;
//     ANY NO_GO -> record the verdict + route the defect to ONE deduped BUG row;
//     never confirm on a NO_GO; no code mutation).
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'task-drain-apps-wf.js'), 'utf8')

test('census covers the UNVERIFIED gate-row class, not only BUG rows', () => {
  // The single-class selector is the defect (O15-00760): it made the 25
  // live-gate NO_GO rows undrainable. It must be gone from the census prompt.
  expect(src).not.toMatch(/Select rows whose title starts with "BUG"\./)
  // The UNVERIFIED class must be named in the census selection.
  expect(src).toMatch(/UNVERIFIED/)
})

test('census excludes gate rows that already carry a terminal verdict marker', () => {
  // A drained gate row records "VERIFIED <artifact> — both gates GO" or
  // "NO_GO at head — fix routed to <id>"; both must exclude it from candidates
  // so the drain never re-picks it.
  expect(src).toMatch(/"VERIFIED"/)
  expect(src).toMatch(/NO_GO ROUTED/)
})

test('execution branches to the gate-remediation protocol for UNVERIFIED rows', () => {
  // The branch must exist and name the protocol.
  expect(src).toMatch(/GATE-REMEDIATION/)
  // Re-verification needs TWO independent gates; confirm only on BOTH GO.
  expect(src).toMatch(/BOTH return GO/)
  // A NO_GO must not be confirmed — it records the verdict and routes the fix.
  expect(src).toMatch(/ANY NO_GO/)
  expect(src).toMatch(/never post a confirm/i)
  // Gate remediation is verification-and-record, never a code change.
  expect(src).toMatch(/NO worktree/)
  expect(src).toMatch(/no code changes|never mutate code/i)
})
