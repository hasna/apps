import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_PATH_ENV_KEYS } from "./api-mode.js";
import { getDbPath } from "./database.js";
import { getDbPath as getConfigDbPath } from "../lib/config.js";
import { MEMENTOS_LOCAL_OPT_IN_ENV_KEYS } from "../lib/local-opt-in.js";
import { STORE_SELECTOR_ENV_KEYS } from "../test-support/store-isolation.js";

// ============================================================================
// The legacy `~/.mementos` -> data-root auto-migration (a recursive cpSync)
// used to run from getDbPath() UNCONDITIONALLY — including from the hosted-mode
// diagnostics (`storage mode`, `status`, `doctor`, resolveStoreBackend) on a
// station with NO local opt-in — materialising ~/.hasna/mementos/mementos.db,
// the very file the fail-closed gate refuses to open (hasna/apps#1720
// acceptance (f): no *.db under the app home from a hosted read). The copy now
// runs only when the environment selects the on-box store. Hermetic: a fake
// HOME carrying a legacy directory, every store selector scrubbed.
// ============================================================================

const KEYS: readonly string[] = Array.from(
  new Set([
    ...STORE_SELECTOR_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
    ...MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
    "MEMENTOS_DB_SCOPE",
    "MEMENTOS_PROFILE",
    "HASNA_DATA_HOME",
    "HASNA_MEMENTOS_HOME",
    "MEMENTOS_HOME",
    "HOME",
    "USERPROFILE",
  ]),
);

let saved: Record<string, string | undefined> = {};
let home = "";
let savedCwd = "";

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // realpath: on macOS the temp root is a symlink (/var -> /private/var) and
  // process.cwd() reports the resolved path, so HOME and cwd must agree for
  // the walk-up's legacy-home exclusion to compare equal paths.
  home = realpathSync(mkdtempSync(join(tmpdir(), "mementos-legacy-gate-")));
  process.env["HOME"] = home;
  mkdirSync(join(home, ".mementos"), { recursive: true });
  writeFileSync(join(home, ".mementos", "mementos.db"), "legacy");
  // From the fake home itself, so no ancestor `.mementos/mementos.db` of the
  // repo checkout can be discovered by the walk-up.
  savedCwd = process.cwd();
  process.chdir(home);
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(home, { recursive: true, force: true });
});

const migrated = (): string => join(home, ".hasna", "mementos", "mementos.db");

describe("legacy ~/.mementos auto-migration is gated behind the local opt-in", () => {
  test("FAILING INPUT: hosted mode with no opt-in — getDbPath() names the path but copies NOTHING", () => {
    const path = getDbPath();
    expect(path).toBe(migrated());
    expect(existsSync(join(home, ".hasna"))).toBe(false);
    expect(existsSync(migrated())).toBe(false);
  });

  test("the config-module getDbPath() is gated the same way", () => {
    getConfigDbPath();
    expect(existsSync(migrated())).toBe(false);
  });

  test("control: the explicit opt-in (HASNA_MEMENTOS_LOCAL=1) still migrates the legacy store", () => {
    process.env["HASNA_MEMENTOS_LOCAL"] = "1";
    const path = getDbPath();
    expect(path).toBe(migrated());
    expect(existsSync(migrated())).toBe(true);
  });

  test("control: an explicit HASNA_MEMENTOS_DB_PATH names that file and never migrates anything", () => {
    const pinned = join(home, "pinned", "mementos.db");
    process.env["HASNA_MEMENTOS_DB_PATH"] = pinned;
    expect(getDbPath()).toBe(pinned);
    expect(existsSync(migrated())).toBe(false);
  });
});
