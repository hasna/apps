import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "./index.js";

/**
 * Regression tests for the one-time ~/.hooks auto-migration guard
 * (release-review P1): the postinstall (scripts/ensure-profiles-dir.mjs)
 * pre-creates the effective data root, so the old dir-existence guard
 * (`!existsSync(effective)`) evaluated false and a live ~/.hooks store was
 * never copied — Hooks opened a fresh store and the data became invisible.
 * The guard must key on the store marker (hooks.db at the target), not on
 * directory existence.
 */

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_HOOKS_DATA_DIR",
  "HOOKS_DATA_DIR",
  "HASNA_HOOKS_HOME",
  "HOOKS_HOME",
  "HASNA_HOOKS_DB_PATH",
  "HOOKS_DB_PATH",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hooks-db-migrate-home-"));
  cleanups.push(home);
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  return home;
}

describe("~/.hooks auto-migration (release-review P1 guard)", () => {
  test("migrates a live ~/.hooks store into a postinstall-created (existing) effective root", () => {
    const home = isolateHome();
    // The postinstall-created effective root: exists, but holds no store yet.
    const effective = mkdtempSync(join(tmpdir(), "hooks-db-migrate-root-"));
    cleanups.push(effective);
    process.env.HASNA_HOOKS_DATA_DIR = effective;

    // A live store at the old ~/.hooks home.
    const oldDir = join(home, ".hooks");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "hooks.db"), "legacy-store-bytes");
    writeFileSync(join(oldDir, "config.json"), "{}");

    const dbPath = getDbPath();

    expect(dbPath).toBe(join(effective, "hooks.db"));
    // The regression: the old dir-existence guard skipped the copy, so this
    // file never appeared. It must exist now, with the migrated content.
    expect(existsSync(join(effective, "hooks.db"))).toBe(true);
    expect(readFileSync(join(effective, "hooks.db"), "utf-8")).toBe("legacy-store-bytes");
    expect(existsSync(join(effective, "config.json"))).toBe(true);
  });

  test("does NOT copy over a target that already has a live store", () => {
    const home = isolateHome();
    const effective = mkdtempSync(join(tmpdir(), "hooks-db-migrate-root2-"));
    cleanups.push(effective);
    writeFileSync(join(effective, "hooks.db"), "existing-live-store");
    process.env.HASNA_HOOKS_DATA_DIR = effective;

    const oldDir = join(home, ".hooks");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "hooks.db"), "stale-~/.hooks-store");

    expect(getDbPath()).toBe(join(effective, "hooks.db"));
    expect(readFileSync(join(effective, "hooks.db"), "utf-8")).toBe("existing-live-store");
  });

  test("no ~/.hooks dir means no migration, plain effective-root path", () => {
    const home = isolateHome();
    const effective = mkdtempSync(join(tmpdir(), "hooks-db-migrate-root3-"));
    cleanups.push(effective);
    process.env.HASNA_HOOKS_DATA_DIR = effective;

    expect(getDbPath()).toBe(join(effective, "hooks.db"));
    expect(existsSync(join(effective, "hooks.db"))).toBe(false);
  });

  test("default (no overrides): ~/.hooks migrates into the legacy ~/.hasna/hooks root", () => {
    const home = isolateHome();
    const oldDir = join(home, ".hooks");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "hooks.db"), "legacy-store");

    const dbPath = getDbPath();
    expect(dbPath).toBe(join(home, ".hasna", "hooks", "hooks.db"));
    expect(existsSync(join(home, ".hasna", "hooks", "hooks.db"))).toBe(true);
    expect(readFileSync(join(home, ".hasna", "hooks", "hooks.db"), "utf-8")).toBe("legacy-store");
  });
});
