#!/usr/bin/env bun
/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Verify that the committed generated artifacts are the ones the current source produces.
 *
 * WHAT THIS USED TO BE, AND WHY IT WAS NOT ENOUGH. The previous version ran
 * `git diff --exit-code -- bin/knowledge-mcp.js dist` and then grepped four hardcoded files
 * for two stale Windows-path patterns. It never rebuilt anything, so on a clean checkout its
 * exit 0 meant only "the files I did not touch are untouched". Measured against that version:
 * it exited 0 with `src/cli.ts` diverged from `bin/knowledge.js`, and exited 0 with
 * `bin/knowledge.js` corrupted by 30 junk bytes — it did not require that file to be
 * byte-stable at all. Meanwhile `bun run verify:generated`, which prefixed a `bun run build`,
 * exited 1. One check, two names, two different answers, and the passing one was cited as
 * evidence of bundle/source sync in a CHANGELOG.
 *
 * THE THREE RULES THIS VERSION HOLDS TO:
 *
 *   1. ONE ENTRY POINT. The build happens inside this script, so there is no way to run it
 *      without the rebuild and read the result as a sync check. `package.json`'s
 *      `verify:generated` is this script and nothing else; `tests/generated-artifacts.test.ts`
 *      pins that it stays a single command.
 *
 *   2. NO HARDCODED ARTIFACT LIST. The gate covers whole directories (GENERATED_PATHS) and
 *      the pattern scan derives its file list from `git ls-files`, so a bundle added later is
 *      covered without anyone remembering to add it here. The old four-file list had already
 *      drifted: it omitted `bin/knowledge-serve.js` and `dist/serve.js`.
 *
 *   3. THE CHECK PROVES ITS OWN PATTERNS ARE LIVE BEFORE TRUSTING A CLEAN RESULT. A regex
 *      that can no longer match anything reports "clean" forever. Each entry in
 *      STALE_PATTERNS carries a fixture it MUST match; if it does not, this script fails
 *      instead of reporting success. That is the difference between a passing check and a
 *      check that measured nothing.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories whose entire tracked contents are build output. Both are wiped or overwritten
 * by `bun run build`, so after a rebuild any difference against the index is drift.
 */
export const GENERATED_PATHS = ['bin', 'dist'];

/**
 * Generated code that must never ship again, with the fixture that proves each pattern can
 * still fire. Both patterns come from the Windows path handling replaced in #33: a bundle
 * built before that fix decoded `import.meta.url` by hand and interpolated `file://${...}`,
 * which breaks on Windows drive letters.
 */
export const STALE_PATTERNS = [
  {
    pattern: /path:\s*decodeURIComponent\([^)]*\.pathname\)/,
    describe: 'hand-decoded URL pathname instead of fileURLToPath',
    // Verbatim the line 2bea200 removed from src/source-ref.ts, which is what this pattern
    // exists to catch. Must match; if a refactor makes this fixture stop matching, the pattern
    // is dead and this script fails rather than reporting every artifact clean.
    //
    // NOTE the pattern is narrow on purpose and this fixture documents the bound: `[^)]*`
    // cannot cross a nested `)`, so it does NOT catch
    // `path: decodeURIComponent(new URL(uri).pathname)`. Writing that as the fixture was the
    // first thing tried here and the self-check rejected it — which is the reason the
    // self-check exists. Widening the pattern would trade a known bound for unknown false
    // positives across four minified bundles; if that inline form ever ships, add it as its
    // own entry with its own fixture.
    fixture: "return { kind: 'file', uri, path: decodeURIComponent(parsed.pathname) };",
    // Must NOT match, so the pattern is not so loose that it fires on the fixed form.
    counterFixture: "return { kind: 'file', uri, path: fileURLToPath(uri) };",
  },
  {
    pattern: /file:\/\/\$\{/,
    describe: 'interpolated file:// URL instead of pathToFileURL',
    fixture: 'await import(`file://${target}`);',
    counterFixture: 'await import(pathToFileURL(target).href);',
  },
];

function git(args) {
  const run = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  // A spawn that never started reports status null. Treat that as failure: this whole script
  // is a control, and a control that cannot run must not pass.
  return { status: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** Tracked `.js` files under the generated directories, derived rather than listed. */
export function generatedJsFiles() {
  const listed = git(['ls-files', '--', ...GENERATED_PATHS]);
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  return listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.js')).sort();
}

/**
 * Assert every stale pattern still matches its fixture and still rejects its counter-fixture.
 * Returns the list of problems; an empty list means the scan below is worth believing.
 */
export function patternSelfCheck() {
  const problems = [];
  for (const { pattern, describe, fixture, counterFixture } of STALE_PATTERNS) {
    if (!pattern.test(fixture)) problems.push(`stale pattern ${pattern} (${describe}) no longer matches its own fixture — it cannot detect anything`);
    if (pattern.test(counterFixture)) problems.push(`stale pattern ${pattern} (${describe}) matches its counter-fixture — it is too loose to be meaningful`);
  }
  return problems;
}

/**
 * Scan the generated bundles for stale generated code. Returns the list of problems.
 *
 * `root` is a parameter rather than a closed-over constant so a test can point the scanner at
 * a temp directory holding a deliberately stale file and prove the scan actually fires. A scan
 * that has only ever been run against clean input is not evidence that it detects anything.
 */
export function scanForStalePatterns(files, root = repoRoot) {
  const problems = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const { pattern, describe } of STALE_PATTERNS) {
      if (pattern.test(text)) problems.push(`${file} contains stale generated code (${describe}): ${pattern}`);
    }
  }
  return problems;
}

function fail(message) {
  console.error(`verify-generated-artifacts: ${message}`);
  process.exit(1);
}

function main() {
  // The patterns are checked BEFORE anything else, so a dead pattern cannot be masked by a
  // clean rebuild.
  const patternProblems = patternSelfCheck();
  if (patternProblems.length > 0) {
    for (const problem of patternProblems) console.error(`verify-generated-artifacts: ${problem}`);
    process.exit(1);
  }

  // Precondition. The gate below is `git diff` after a rebuild, which only means something if
  // the generated paths matched the index BEFORE the rebuild. If they already differed, a
  // difference afterwards proves nothing about whether the source and the bundles agree.
  const dirtyBefore = git(['status', '--porcelain', '--', ...GENERATED_PATHS]);
  if (dirtyBefore.status !== 0) fail(`git status failed: ${dirtyBefore.stderr.trim()}`);
  if (dirtyBefore.stdout.trim() !== '') {
    fail(
      `generated paths are already modified before the rebuild, so this check cannot tell drift from your edits:\n${dirtyBefore.stdout.trimEnd()}\n` +
      'Commit or restore them, then re-run.'
    );
  }

  // Rebuild through the package script rather than repeating its command here, so the two can
  // never disagree.
  const build = spawnSync('bun', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  if ((build.status ?? 1) !== 0) fail(`\`bun run build\` exited ${build.status ?? 'without a status'}`);

  // The gate: whatever the rebuild produced must equal what is committed.
  const drift = spawnSync('git', ['diff', '--exit-code', '--', ...GENERATED_PATHS], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if ((drift.status ?? 1) !== 0) {
    console.error(
      'verify-generated-artifacts: the committed generated artifacts are not what the current source builds.\n' +
      'Run `bun run build` and commit the result. If the only difference is toolchain churn, that is still drift — commit it.'
    );
    process.exit(drift.status ?? 1);
  }

  const files = generatedJsFiles();
  // A silently emptied file list would make the scan below vacuous, so require it to be
  // non-empty rather than looping zero times and reporting success.
  if (files.length === 0) fail(`no tracked .js files found under ${GENERATED_PATHS.join(', ')} — the pattern scan would measure nothing`);

  const scanProblems = scanForStalePatterns(files);
  if (scanProblems.length > 0) {
    for (const problem of scanProblems) console.error(`verify-generated-artifacts: ${problem}`);
    process.exit(1);
  }

  console.log(`verify-generated-artifacts: ${files.length} generated bundles rebuild byte-identically and carry no stale generated code.`);
}

// Run only when invoked directly, so the exports above are importable from tests. `process.argv[1]`
// rather than `import.meta.main`, which is not available on the older Node versions that may run
// this script from a published install.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
