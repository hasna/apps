// O15-04648 regression: a bare (un-pinned) `bun test` must leave a migrated
// live instructions state store byte-identical.
//
// The package test script pins HASNA_STATE_HOME=$(mktemp -d), but a bare
// `bun test` / `bun test <file>` invocation has no script-level pin. On a
// machine whose state store has been migrated to the resolver XDG dir, the
// snapshot-writing suites adopted the LIVE store and wrote synthetic snapshots
// into it (measured 2026-08-28: 96 fixture files; re-measured 2026-08-29 on a
// single test file: 4 files). The fix is the package bunfig.toml `[test]
// preload` (src/test-support/preload-state-home.ts), which pins HASNA_STATE_HOME
// for every `bun test` process regardless of invocation.
//
// This test spawns a REAL bare `bun test` subprocess — env stripped of the
// state/config selectors, HOME pointed at a fixture home whose state store
// holds one baseline snapshot — and asserts the store is byte-identical after
// the run. The subprocess's own preload redirects its snapshot writes to a
// temp dir; without the preload this test fails with 4 new files in the
// fixture store (verified on the un-fixed tree).

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dir, "..", "..");

/** Temp-dir prefix the preload uses (src/test-support/preload-state-home.ts). */
const PRELOAD_TMP_PREFIX = "hasna-instructions-state-";

/** Directories under the OS tmp dir created by the preload, by name. */
function preloadTmpDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(PRELOAD_TMP_PREFIX));
}

/**
 * Positive control: the child suite must actually have WRITTEN snapshots —
 * through the preload-pinned temp dir — otherwise the store-identical
 * assertion would pass vacuously (a child whose snapshot-writing path died
 * silently would also leave the fixture store untouched).
 */
function assertChildWroteSnapshots(before: string[]): void {
  const created = preloadTmpDirs().filter((name) => !before.includes(name));
  expect(created.length, "child suite created no preload state dir — did it run the snapshot path?").toBeGreaterThan(0);
  const snapshots = created.flatMap((name) => {
    const dir = join(tmpdir(), name);
    if (!statSync(dir).isDirectory()) return [];
    // The resolver appends the app segment: ~/.local/state/hasna/<app> — so
    // with the override pinned to <dir>, snapshots land in <dir>/instructions.
    const appDir = join(dir, "instructions");
    const base = statSync(appDir).isDirectory() ? readdirSync(appDir) : readdirSync(dir);
    return base.filter((file) => file.endsWith(".json"));
  });
  expect(snapshots.length, "child suite wrote no snapshot .json into its pinned state dir").toBeGreaterThan(0);
}

/** Selectors a fleet operator shell exports; the subprocess must be bare. */
const STRIPPED_KEYS = [
  "HASNA_STATE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_CONFIGS_HOME",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_INSTRUCTIONS_API_URL",
  "HASNA_INSTRUCTIONS_API_KEY",
] as const;

/** A snapshot-writing suite; bare runs of it polluted the real store (O15-04648). */
const SNAPSHOT_WRITING_SUITE = "src/cli/project-context.test.ts";

function storeFingerprint(storeDir: string): string[] {
  return readdirSync(storeDir)
    .sort()
    .map((name) => `${name}:${readFileSync(join(storeDir, name), "utf8")}`);
}

describe("bare 'bun test' hermeticity (O15-04648)", () => {
  test("an unpinned suite run leaves a migrated live state store byte-identical", () => {
    const fixtureHome = mkdtempSync(join(tmpdir(), "instr-hermetic-home-"));
    const storeDir = join(fixtureHome, ".local", "state", "hasna", "instructions");
    mkdirSync(storeDir, { recursive: true });
    const baselineName = "2026-08-29T00-00-00-000Z-00000000-0000-4000-8000-000000000000.json";
    const baselineBody = JSON.stringify({ baseline: true });
    writeFileSync(join(storeDir, baselineName), baselineBody);
    const before = storeFingerprint(storeDir);
    const preloadDirsBefore = preloadTmpDirs();

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !(STRIPPED_KEYS as readonly string[]).includes(key)) {
        env[key] = value;
      }
    }
    env.HOME = fixtureHome;
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";

    const run = spawnSync("bun", ["test", SNAPSHOT_WRITING_SUITE], {
      cwd: PKG_ROOT,
      env,
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(
      run.status,
      `bare subprocess suite failed (status ${run.status}):\n${run.stdout}\n${run.stderr}`,
    ).toBe(0);

    // The live store must be byte-identical: same names, same contents.
    expect(storeFingerprint(storeDir)).toEqual(before);
    expect(readdirSync(storeDir)).toEqual([baselineName]);

    // Non-vacuous: the child really did run the snapshot-writing path.
    assertChildWroteSnapshots(preloadDirsBefore);

    rmSync(fixtureHome, { recursive: true, force: true });
  });
});
