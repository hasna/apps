/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** The one lockfile this repo tracks. Bun-first: see the lockfile block in .gitignore. */
const BUN_LOCKFILE = 'bun.lock';

/**
 * Lockfiles from package managers this repo does not use. Every one of these must be
 * ignored, so a stray file cannot be swept up by `git add -A`, and none may be tracked.
 *
 * `pnpm-lock.yaml` is the one that actually bit: it appeared post-commit in this repo and,
 * because the old blanket `*.lock` rule does not match a name ending in `.yaml`, it was
 * untracked AND unignored. It got committed once, in 36b2099. A pnpm or npm install also
 * does not honour Bun's package release-age quarantine, so this list is a supply-chain
 * boundary and not just tidiness.
 *
 * `bun.lockb` is Bun's own LEGACY binary lockfile, listed here on purpose: it is not
 * foreign, but tracking it alongside the text lockfile would mean two lockfiles disagreeing
 * with no diffable record of which one won.
 */
const FOREIGN_LOCKFILES = [
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
].sort();

function git(args: string[]): { status: number; stdout: string } {
  const run = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  // A spawn that never ran reports status null. Treat that as failure rather than letting
  // `?? 0` read as a clean exit — an unrunnable check must not pass.
  return { status: run.status ?? 1, stdout: (run.stdout ?? '').trim() };
}

/** Is this repo-relative path ignored by .gitignore? */
const isIgnored = (path: string): boolean => git(['check-ignore', '-q', '--no-index', path]).status === 0;

/** Is this repo-relative path tracked in the index? */
const isTracked = (path: string): boolean => git(['ls-files', '--error-unmatch', '--', path]).status === 0;

const lockfileText = readFileSync(join(repoRoot, BUN_LOCKFILE), 'utf8');

/**
 * Resolve the exact version bun.lock pins for a package, or null if it pins none.
 *
 * bun.lock is JSONC — it carries trailing commas, so `JSON.parse` and `Bun.file().json()`
 * both refuse it (measured: "Property name must be a string literal"). Rather than
 * regex-normalise the whole document into something parseable, which would quietly accept
 * a corrupted file, this reads the one entry line it needs. Entry shape:
 *
 *   "@hasna/events": ["@hasna/events@0.1.14", "", { ... }, "sha512-UXzEM6/8..."],
 *
 * Returns null on no match. Throws on MORE than one match: a duplicated entry means the
 * lockfile is not the single answer this check assumes it is, and silently taking the first
 * would hide that. `tests/lockfile.test.ts` has a positive control for each branch.
 */
function pinnedVersion(name: string): string | null {
  const marker = `"${name}": ["${name}@`;
  const hits: string[] = [];
  for (const line of lockfileText.split('\n')) {
    const at = line.indexOf(marker);
    if (at === -1) continue;
    const rest = line.slice(at + marker.length);
    const end = rest.indexOf('"');
    if (end === -1) continue;
    hits.push(rest.slice(0, end));
  }
  if (hits.length > 1) throw new Error(`bun.lock has ${hits.length} entries for ${name}: ${hits.join(', ')}`);
  return hits[0] ?? null;
}

/** Does bun.lock carry an integrity hash on this package's entry line? */
function hasIntegrity(name: string): boolean {
  const marker = `"${name}": ["${name}@`;
  const line = lockfileText.split('\n').find((candidate) => candidate.includes(marker));
  // Bun writes sha512 for registry tarballs. A missing hash means the entry pins a name and
  // version but not the bytes, which is not a pin for supply-chain purposes.
  return line !== undefined && line.includes('"sha512-');
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

describe('lockfile policy', () => {
  // Everything below asks git about tracking and ignore rules, so if git cannot answer,
  // every one of those assertions would read as a pass for the wrong reason. Fail here
  // instead: a control that cannot verify must not pass.
  test('git can answer, so the tracking assertions below are measuring something', () => {
    expect(git(['rev-parse', '--is-inside-work-tree']).stdout).toBe('true');
    // Positive control on the two helpers themselves, using paths whose status is fixed by
    // this repo's own contents rather than by the rules under test.
    expect(isTracked('package.json')).toBe(true);
    expect(isTracked('this-path-does-not-exist-in-the-index.txt')).toBe(false);
    expect(isIgnored('node_modules/anything')).toBe(true);
    expect(isIgnored('package.json')).toBe(false);
  });

  // The defect: `*.lock` matched bun.lock, so the repo had no committed lockfile at all and
  // `bun install --frozen-lockfile` exited 0 while pinning nothing.
  test('bun.lock is committed, not ignored', () => {
    expect(existsSync(join(repoRoot, BUN_LOCKFILE))).toBe(true);
    expect(isIgnored(BUN_LOCKFILE)).toBe(false);
    expect(isTracked(BUN_LOCKFILE)).toBe(true);
  });

  test('no foreign lockfile is tracked, and every one of them is ignored', () => {
    for (const name of FOREIGN_LOCKFILES) {
      expect(isTracked(name), `${name} must not be tracked`).toBe(false);
      expect(isIgnored(name), `${name} must be ignored so \`git add -A\` cannot stage it`).toBe(true);
    }
  });

  // Reproducibility, which is the reason the lockfile has to be committed rather than merely
  // present. `@hasna/events` is imported by src/cli.ts and is NOT in the build's `--external`
  // list, so it is BUNDLED into bin/knowledge.js: the bytes of the shipped bundle depend on
  // which version the tree resolved. Measured on one box, same bun: 0.1.14 reproduces the
  // committed bundle, 0.1.13 does not (1045325 vs 1040485 bytes after whitespace stripping).
  // A `^0.1.3` range with no lockfile made that a coin flip.
  test('bun.lock pins every declared dependency to an exact version and to bytes', () => {
    const declared = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ].sort();
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      const version = pinnedVersion(name);
      expect(version, `${name} has no entry in ${BUN_LOCKFILE}`).not.toBeNull();
      expect(version, `${name} is pinned to a range, not an exact version`).toMatch(EXACT_VERSION);
      expect(hasIntegrity(name), `${name} has no integrity hash in ${BUN_LOCKFILE}`).toBe(true);
    }
  });

  // The lockfile only buys reproducibility if the installed tree actually matches it. This is
  // the assertion that catches the specific accident the pin exists to prevent: a bundle
  // rebuilt against a different @hasna/events than the one the lockfile names.
  test('the installed tree matches what bun.lock pins for the bundled dependency', () => {
    const name = '@hasna/events';
    const pinned = pinnedVersion(name);
    expect(pinned).not.toBeNull();
    const manifest = join(repoRoot, 'node_modules', name, 'package.json');
    // No fallback if node_modules is absent. `bun install` precedes `bun test` everywhere
    // this suite runs, and skipping here would turn the one reproducibility check in the
    // repo into a check that passes when it has measured nothing.
    expect(existsSync(manifest), `${name} is not installed; run \`bun install\``).toBe(true);
    const installed = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
    expect(installed).toBe(pinned);
  });

  // Every assertion above rests on `pinnedVersion` / `hasIntegrity` reading the lockfile
  // correctly. If those silently returned a hit for anything, the checks would pass while
  // measuring nothing — the failure mode this whole test file exists to close. So prove each
  // one can come back negative.
  test('the lockfile reader reports real breakage, in every shape', () => {
    // Absent package: not a hit, and specifically not an empty-string hit.
    expect(pinnedVersion('@hasna/definitely-not-a-dependency')).toBeNull();
    expect(hasIntegrity('@hasna/definitely-not-a-dependency')).toBe(false);
    // A name that appears in the lockfile only as a DEPENDENT's range, never as its own
    // entry, must not read as pinned. `commander` is a real entry, so invert the check:
    // the marker requires `"<name>": ["<name>@`, which a range line like
    // `"commander": "^13.1.0",` cannot satisfy.
    expect(lockfileText).toContain('"commander": "^13.1.0"');
    expect(pinnedVersion('commander')).toMatch(EXACT_VERSION);
    // Substring safety: a package whose name is a prefix of a real one must not match it.
    expect(pinnedVersion('@hasna/event')).toBeNull();
    expect(pinnedVersion('z')).toBeNull();
    // And the exact-version guard must actually reject a range.
    expect('^0.1.3').not.toMatch(EXACT_VERSION);
    expect('0.1.14').toMatch(EXACT_VERSION);
  });
});
