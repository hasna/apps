// Regression test for H10-00403 (row 39171d06-e50d-4a24-bc23-78ff737aaf5e) —
// fix-deepsec's dependencies scanner flags 0.0.x caret ranges WITHOUT checking
// the declared specifier's admitted set (dep-testers-2 false positive).
//
// Measured 2026-08-26: the dependencies scanner's check 1 instructed "flag any
// version published < 7 days ago" for every dep absent from the
// minimumReleaseAgeExcludes — WITHOUT verifying the declared specifier admits
// that version. apps/testers declares "@types/chrome": "^0.0.268"; the registry
// published 0.2.7 on 2026-08-21 (window-fresh), and the scanner flagged
// PIN VIOLATION dep-testers-2. But `^0.0.268` admits exactly 0.0.x — npm view
// @types/chrome@^0.0.268 version -> 0.0.268 (published 2024-05-10), and
// bun.lock pins 0.0.268. The finding's premise ("0.2.7 admitted by ^0.0.268")
// was false; no pin was needed. The admission-verified pattern already exists
// in the quarantine-admission lane (dep-docs-1,
// tooling/ci/tests/standard/quarantine-admission.test.ts fetchAdmittedVersions:
// `npm view <dep>@<spec> version --json`).
//
// STRUCTURAL (fleet convention, cf. agent-failure-hardening.test.js): the
// scanner prompt is prose that a scanner AGENT executes, so the regression
// pins the instruction text that drives the agent. It fails when check 1
// regresses to the unqualified "flag any version published < 7 days ago"
// wording, and passes only when the flag condition is bound to the admitted
// set via the declared specifier.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'fix-deepsec-wf.js'), 'utf8')

function checkOne() {
  const from = src.indexOf('1. 7-day pin vs excludes')
  const to = src.indexOf('2. Audit-all suspicious')
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return src.slice(from, to)
}

test('structural: the 7-day check binds the flag condition to the declared specifier admitted set', () => {
  const check1 = checkOne()
  // Admission verification via the declared specifier — the dep-docs-1 pattern
  // ("npm view <dep>@<spec> version"): resolves the set of versions the
  // DECLARED specifier admits, then flags only window-fresh versions inside it.
  expect(check1).toContain('npm view <pkg>@<spec>')
  expect(check1).toContain('admitted')
  // The unqualified flag wording must not survive: it is what produced the
  // dep-testers-2 false positive (^0.0.268 flagged against a 0.2.7 publish the
  // range never admits).
  expect(check1).not.toContain('flag any version published < 7 days ago')
})

test('structural: the check-1 extraction targets the right block (positive control)', () => {
  const check1 = checkOne()
  expect(check1).toContain('minimumReleaseAge=604800')
  expect(check1).toContain('minimumReleaseAgeExcludes')
  expect(check1).toContain('PIN VIOLATION (P1)')
})
