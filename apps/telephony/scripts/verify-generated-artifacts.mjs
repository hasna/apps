#!/usr/bin/env bun
/**
 * Verify that the committed generated SDK client is byte-identical to what the
 * current source produces under the pinned bun — the class of drift that
 * release-train C1 shipped as `// Source: Telephony 0.2.11` inside a 0.3.1
 * package (the tarball carries `src/`, so the committed stamp was what would
 * publish).
 *
 * Mirrors apps/knowledge/scripts/verify-generated-artifacts.mjs, adapted to
 * the one file this package regenerates. Same rules:
 *
 *   1. ONE ENTRY POINT. The regeneration happens inside this script, so there
 *      is no way to run it without the regen and read the result as a sync
 *      check. `package.json`'s `verify:generated` is this script and nothing
 *      else; scripts/verify-generated-artifacts.test.ts pins that it stays a
 *      single command.
 *
 *   2. THE REGENERATION MUST BE BYTE-STABLE, NOT ONLY MATCH THE INDEX. The
 *      generator runs TWICE, and the two outputs must be byte-identical before
 *      the index comparison means anything. If a regeneration were
 *      order-nondeterministic — two runs of the same source differing from each
 *      other — the index comparison could pass on one run and fail on the next
 *      without any commit in between, which is the vacuous-check class wearing
 *      a green gate.
 *
 *   3. THE CHECK PROVES ITS OWN PATTERN IS LIVE BEFORE TRUSTING A CLEAN
 *      RESULT. The stale-stamp scan matches the committed header
 *      `// Source: Telephony <v>` against the package version. The pattern
 *      carries a fixture (the exact stale text this gate was added to kill) it
 *      MUST match; if a refactor makes the fixture stop matching, this script
 *      fails instead of reporting success.
 *
 *   4. THE GATE IS `git diff --exit-code` AFTER REGENERATION, SCOPED TO THE
 *      GENERATED FILE. Whole-directory comparisons would be vacuous here:
 *      `src/` is hand-written source plus generated artifacts, and only
 *      src/generated/telephony-api-client.ts is generator output. `dist/` is
 *      gitignored (built at publish, not committed), so the committed-and-
 *      shipped drift surface is exactly this one file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The single committed-and-shipped file `generate:sdk` (and therefore `build`)
 * rewrites. `files` in package.json carries `src/`, so this file is what lands
 * in the published tarball — a stamp that disagrees with package.json is a
 * release artifact defect, not a cosmetic header.
 */
export const GENERATED_FILE = 'src/generated/telephony-api-client.ts';

/**
 * The version stamp the @hasna/contracts SDK generator embeds in its header,
 * e.g. `// Source: Telephony 0.3.1` — with the fixture that proves the pattern
 * can still fire. The fixture is the exact stale line this gate exists to
 * catch (0.2.11 committed against a 0.3.1 package). Must match; if a refactor
 * makes it stop matching, the stamp scan below is dead and this script fails
 * rather than reporting everything clean.
 */
export const STAMP_PATTERN = /^\/\/ Source: Telephony (\S+)$/m;
export const STAMP_FIXTURE = '// Source: Telephony 0.2.11\n';
// Must NOT match: a header line with no version makes the scan below vacuous.
export const STAMP_COUNTER_FIXTURE = '// Source: Telephony\n';

function git(args) {
  const run = spawnSync('git', args, { cwd: appRoot, encoding: 'utf8' });
  // A spawn that never started reports status null. Treat that as failure: this
  // whole script is a control, and a control that cannot run must not pass.
  return { status: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function fail(message) {
  console.error(`verify-generated-artifacts: ${message}`);
  process.exit(1);
}

function sha256Of(relativePath) {
  return createHash('sha256').update(readFileSync(join(appRoot, relativePath))).digest('hex');
}

/** The version the current package says it is — what the stamp must equal. */
export function packageVersion() {
  return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version;
}

/**
 * The version the committed generated header is stamped with, or null when the
 * stamp line is absent. Regex-built so callers can test it against fixtures.
 */
export function stampedVersion(text) {
  return text.match(STAMP_PATTERN)?.[1] ?? null;
}

export function committedStamp() {
  return stampedVersion(readFileSync(join(appRoot, GENERATED_FILE), 'utf8'));
}

/**
 * Assert the stamp pattern still matches its fixture and still rejects its
 * counter-fixture. Returns the list of problems; an empty list means the stamp
 * scan below is worth believing.
 */
export function patternSelfCheck() {
  const problems = [];
  if (!STAMP_PATTERN.test(STAMP_FIXTURE)) {
    problems.push(`stamp pattern ${STAMP_PATTERN} no longer matches its own fixture — it cannot detect anything`);
  }
  if (STAMP_PATTERN.test(STAMP_COUNTER_FIXTURE)) {
    problems.push(`stamp pattern ${STAMP_PATTERN} matches its counter-fixture — it is too loose to be meaningful`);
  }
  return problems;
}

function main() {
  // The pattern is checked BEFORE anything else, so a dead pattern cannot be
  // masked by a clean regeneration.
  const patternProblems = patternSelfCheck();
  if (patternProblems.length > 0) {
    for (const problem of patternProblems) console.error(`verify-generated-artifacts: ${problem}`);
    process.exit(1);
  }

  // First-class version-stamp gate, BEFORE anything regenerates: a committed
  // header stamped with anything but the package version is the drift this
  // gate exists to refuse — the release-train C1 class (0.2.11 committed
  // against a 0.3.1 package, tarball ships `src/`). Failing here is always
  // correct: even a hand-edit that only touches the stamp is regenerated
  // content and must come from the generator.
  const committed = committedStamp();
  const expected = packageVersion();
  if (committed !== expected) {
    fail(
      `${GENERATED_FILE} is stamped ${committed ?? '(no stamp)'}, but package.json is ${expected} — ` +
      'run `bun run generate:sdk` and commit the result. Do not hand-edit the stamp; regenerate.'
    );
  }

  // Precondition. The gate below is `git diff` after a regeneration, which only
  // means something if the generated file matched the index BEFORE it. If it
  // already differed, a difference afterwards proves nothing about whether the
  // source and the committed artifact agree.
  const dirtyBefore = git(['status', '--porcelain', '--', GENERATED_FILE]);
  if (dirtyBefore.status !== 0) fail(`git status failed: ${dirtyBefore.stderr.trim()}`);
  if (dirtyBefore.stdout.trim() !== '') {
    fail(
      `${GENERATED_FILE} is already modified before the regeneration, so this check cannot tell drift from your edits:\n${dirtyBefore.stdout.trimEnd()}\n` +
      'Commit or restore it, then re-run.'
    );
  }

  // Regenerate through the package script rather than repeating its command
  // here, so the two can never disagree — same one-entry-point rule as the
  // knowledge gate, applied at the generator level.
  const generate = (pass) => {
    const run = spawnSync('bun', ['run', 'generate:sdk'], { cwd: appRoot, stdio: 'inherit' });
    if ((run.status ?? 1) !== 0) {
      fail(`\`bun run generate:sdk\` (pass ${pass}) exited ${run.status ?? 'without a status'}`);
    }
  };

  // Pass 1, snapshot, pass 2, compare: two regenerations of the same source
  // must be byte-identical. Only then does comparing either against the index
  // mean anything.
  generate(1);
  const first = sha256Of(GENERATED_FILE);
  generate(2);
  const second = sha256Of(GENERATED_FILE);
  if (first !== second) {
    fail(
      `regeneration is NOT byte-stable: two consecutive \`bun run generate:sdk\` runs of the same source produced different bytes for ${GENERATED_FILE}.\n` +
      `This bun is ${process.versions?.bun ?? 'unknown'}. A nondeterministic generator makes the byte gate vacuous — fix the generator (or the bun version) rather than committing either output.`
    );
  }

  // The gate: whatever the regeneration produced must equal what is committed.
  const drift = spawnSync('git', ['diff', '--exit-code', '--', GENERATED_FILE], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if ((drift.status ?? 1) !== 0) {
    console.error(
      'verify-generated-artifacts: the committed SDK client is not what the current source generates.\n' +
      'Run `bun run generate:sdk` and commit the result. A version bump that does not regenerate the\n' +
      'committed stamp ships a tarball whose src/ header disagrees with package.json (the drift this\n' +
      'gate exists to refuse). If the stamp you see is older than package.json, that is it — do not\n' +
      'hand-edit the stamp; regenerate.'
    );
    process.exit(drift.status ?? 1);
  }

  // Post-condition: the regenerated-and-committed file must carry exactly the
  // package version. Holds by construction today (the generator stamps
  // package.json's version), but if that ever changes — a generator that stops
  // stamping, a stamp fed from another source — this fails with the reason
  // instead of silently shipping a header that lies about the version.
  const finalStamp = committedStamp();
  if (finalStamp !== expected) {
    fail(
      `regeneration rewrote ${GENERATED_FILE} but its stamp is ${finalStamp ?? '(none)'}, not the package version ${expected} — ` +
      'the generator\'s stamp source and package.json disagree; fix the generator.'
    );
  }

  console.log(
    `verify-generated-artifacts: stamp ${committed} matches package.json; two consecutive regenerations of ${GENERATED_FILE} are byte-identical to each other and to the committed output.`
  );
}

// Run only when invoked directly, so the exports above are importable from
// tests. `process.argv[1]` rather than `import.meta.main`, which is not
// available on the older Node versions that may run this script from a
// published install.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();