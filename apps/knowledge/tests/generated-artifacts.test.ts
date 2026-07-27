/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_PATHS,
  STALE_PATTERNS,
  generatedJsFiles,
  patternSelfCheck,
  scanForStalePatterns,
  // @ts-expect-error - .mjs build script, intentionally untyped and not part of the public API
} from '../scripts/verify-generated-artifacts.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * The bundles this repo ships today. Hardcoded on purpose, as the counterweight to
 * `generatedJsFiles()` deriving its list from git: if the derivation ever comes back short —
 * a `.gitignore` rule swallowing a bundle, a rename, an emptied result — the scan it feeds
 * would silently cover fewer files while still reporting success. The old verifier had
 * exactly that drift: its hardcoded four-file list had stopped naming bin/knowledge-serve.js
 * and dist/serve.js.
 */
const EXPECTED_BUNDLES = [
  'bin/knowledge-mcp.js',
  'bin/knowledge-serve.js',
  'bin/knowledge.js',
  'dist/index.js',
  'dist/serve.js',
  'dist/storage.js',
].sort();

describe('generated artifact verification', () => {
  test('the gate covers whole generated directories, not a list that can drift', () => {
    expect(GENERATED_PATHS.length).toBeGreaterThan(0);
    expect([...GENERATED_PATHS].sort()).toEqual(['bin', 'dist']);
  });

  test('the scanned file list is derived from git and covers every shipped bundle', () => {
    const files = generatedJsFiles();
    // Non-empty first: a zero-length list makes the pattern scan loop zero times and report
    // clean, which is the failure mode this file exists to prevent.
    expect(files.length).toBeGreaterThan(0);
    for (const bundle of EXPECTED_BUNDLES) {
      expect(files, `${bundle} must be scanned for stale generated code`).toContain(bundle);
    }
    // And nothing outside the generated directories crept in.
    for (const file of files) {
      expect(GENERATED_PATHS.some((prefix) => file.startsWith(`${prefix}/`)), `${file} is outside ${GENERATED_PATHS.join(', ')}`).toBe(true);
    }
  });

  // A regex that can no longer match anything reports "clean" forever. This is the assertion
  // that makes a clean scan mean something.
  test('every stale pattern still fires on its own fixture and still rejects ordinary code', () => {
    expect(STALE_PATTERNS.length).toBeGreaterThan(0);
    for (const entry of STALE_PATTERNS) {
      expect(entry.fixture, `${entry.describe}: fixture must not be empty`).not.toBe('');
      expect(entry.counterFixture, `${entry.describe}: counter-fixture must not be empty`).not.toBe('');
      expect(entry.pattern.test(entry.fixture), `${entry.describe}: pattern must match its fixture`).toBe(true);
      expect(entry.pattern.test(entry.counterFixture), `${entry.describe}: pattern must not match its counter-fixture`).toBe(false);
    }
    expect(patternSelfCheck()).toEqual([]);
  });

  test('the shipped bundles carry no stale generated code', () => {
    expect(scanForStalePatterns(generatedJsFiles())).toEqual([]);
  });

  // The scan above has only ever been run against clean input, which proves nothing about
  // whether it detects anything. Point it at a directory holding a deliberately stale file and
  // require one problem per pattern.
  test('the scan reports real breakage when a bundle is stale', () => {
    const root = mkdtempSync(join(tmpdir(), 'kn-generated-'));
    mkdirSync(join(root, 'bin'));
    const planted: string[] = [];
    for (const [index, entry] of STALE_PATTERNS.entries()) {
      const file = `bin/planted-${index}.js`;
      writeFileSync(join(root, file), `// synthetic stale bundle\n${entry.fixture}\n`);
      planted.push(file);
    }
    const problems = scanForStalePatterns(planted, root);
    expect(problems.length).toBe(STALE_PATTERNS.length);
    for (const entry of STALE_PATTERNS) {
      expect(problems.some((problem: string) => problem.includes(entry.describe)), `no problem reported for: ${entry.describe}`).toBe(true);
    }
    // And the counter-fixtures must come back clean through the same code path, so the scan is
    // not simply flagging every file it is handed.
    const clean: string[] = [];
    for (const [index, entry] of STALE_PATTERNS.entries()) {
      const file = `bin/clean-${index}.js`;
      writeFileSync(join(root, file), `// synthetic clean bundle\n${entry.counterFixture}\n`);
      clean.push(file);
    }
    expect(scanForStalePatterns(clean, root)).toEqual([]);
  });

  // The defect this replaces was not a wrong answer, it was TWO answers under two names:
  // `bun scripts/verify-generated-artifacts.mjs` exited 0 while `bun run verify:generated`
  // exited 1, because only the npm script prefixed a rebuild. The rebuild now lives inside the
  // script, so there must be exactly one command and it must be the script.
  test('verify:generated is a single command, so there is only one answer', () => {
    const script = packageJson.scripts['verify:generated'];
    expect(script).toBeDefined();
    expect(script).toContain('scripts/verify-generated-artifacts.mjs');
    // No `&&`/`;`/`|` chaining: a prefixed build is what made the bare script's exit code
    // misleading, and a suffixed command would hide this script's exit code.
    expect(script).not.toContain('&&');
    expect(script).not.toContain(';');
    expect(script).not.toContain('|');
  });

  test('CI runs the single entry point rather than reassembling it', () => {
    const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    // Positive control: prove this test read the right file and that the step still exists,
    // so the two `not.toContain` assertions below are absences in a file that has content.
    expect(workflow).toContain('Verify generated artifacts');
    // The two-command form is what produced two different exit codes under two names.
    expect(workflow).not.toContain('bun run build && bun scripts/verify-generated-artifacts.mjs');
    expect(workflow).not.toContain('bun scripts/verify-generated-artifacts.mjs');
    expect(workflow).toContain('bun run verify:generated');
  });

  // Regression test for a defect found in adversarial review of this PR. `Verify generated
  // artifacts` rebuilds bin/ and dist/ and compares BYTE-FOR-BYTE, so it passes only when CI's
  // bun equals the bun that built the committed bundles. Measured at this commit: the committed
  // bundles are bun 1.3.14 output, and rebuilding under bun 1.3.13 drifts by 4 lines across
  // bin/knowledge-mcp.js and dist/index.js (1.3.13 keeps the empty `else {}` blocks 1.3.14's
  // dead-code elimination collapses). The version cannot be asserted against the bundles from
  // inside the suite without running a build, which is the trade documented at the bottom of
  // this file — but the two jobs pinning DIFFERENT versions is checkable here, and pin skew
  // would make the gate pass in one job and fail in the other for reasons unrelated to source.
  test('every CI job pins the same bun version, so the byte comparison has one answer', () => {
    const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const pins = [...workflow.matchAll(/^\s*bun-version:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    // Positive control: an empty match list would make the uniqueness assertion below vacuous.
    expect(pins.length).toBeGreaterThan(1);
    expect(new Set(pins).size, `CI pins more than one bun version: ${pins.join(', ')}`).toBe(1);
    // And it is pinned to an exact patch, not a floating range: `latest` or `1.3` would let the
    // minifier change under the gate without any commit in this repo.
    expect(pins[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// DELIBERATELY NOT TESTED HERE: end-to-end behaviour of the script itself — that it exits 1 on a
// planted bundle divergence and 1 on a dirty-before-rebuild tree. Both would require running
// `bun run build` inside the suite, which overwrites bin/ and dist/ in the working tree while
// other test files are running. A guard that corrupts the tree it guards is a worse trade than
// the coverage it buys. The pieces the script composes are unit-tested above.
//
// AND THE COMPENSATING CONTROL IS NOT YET OPERATIVE — corrected in adversarial review, because
// an earlier version of this comment claimed "the end-to-end path is exercised by CI on every
// PR, which is where a real divergence shows up." It is not. `Verify generated artifacts` runs
// AFTER `Run tests` in ci.yml with no `if: always()`, so a failing test suite skips it. Measured
// on this PR's own CI run 30310387905, job `test (ubuntu-latest, bun)`: step 6 `Run tests`
// failure, step 7 `Verify generated artifacts` **skipped**. The pre-existing
// `context pack and proposal context commands return bounded agent JSON` failure is red on main
// too, so the step is skipped on every run today — which is exactly the masking this PR's own
// description identifies as the reason the stale bundle survived in the first place. Citing a
// check that does not execute is the defect this PR exists to fix, so it must not be this file's
// justification. Until the suite is green the end-to-end path is exercised only by hand.
// Tracked: reorder the step or add `if: always()` so the gate cannot be skipped by an unrelated
// red test.
