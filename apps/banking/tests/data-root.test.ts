import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  bankingDataRoot,
  createSqliteDevStore,
  defaultDevStorePath,
  getBankingHome,
  getDefaultDbPath,
  LEGACY_HOME_DIR,
  resolverHome,
} from "../src/index.ts";

const HOME_ENV_KEYS = ["HOME", "HASNA_BANKING_HOME", "HASNA_DATA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"] as const;
const SAVED_ENV: Record<string, string | undefined> = {};
let tempRoot: string;

beforeEach(() => {
  for (const k of HOME_ENV_KEYS) SAVED_ENV[k] = process.env[k];
  tempRoot = mkdtempSync(join(tmpdir(), "banking-data-root-"));
});

afterEach(() => {
  for (const k of HOME_ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("canonical data root — legacy default must never become invisible (P1/P2 regression)", () => {
  test("keeps the legacy ~/.hasna/banking default until the XDG store exists or an override is set", () => {
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "banking"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective home and default DB path MUST stay on the legacy layout.
    expect(getBankingHome()).toBe(LEGACY_HOME_DIR);
    expect(bankingDataRoot()).toBe(LEGACY_HOME_DIR);
    expect(defaultDevStorePath()).toBe(join(LEGACY_HOME_DIR, "banking.db"));
    expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "banking.db"));
  });

  test("HASNA_BANKING_HOME override wins over the resolver and the legacy default", () => {
    const override = join(tempRoot, "override-root");
    process.env["HASNA_BANKING_HOME"] = override;

    expect(getBankingHome()).toBe(override);
    expect(bankingDataRoot()).toBe(override);
    expect(defaultDevStorePath()).toBe(join(override, "banking.db"));

    const store = createSqliteDevStore();
    expect(existsSync(join(override, "banking.db"))).toBe(true);
    void store;
  });

  test("HASNA_DATA_HOME adopts the XDG data home via the @hasna/paths resolver", () => {
    const dataHome = join(tempRoot, "data-home");
    process.env["HASNA_DATA_HOME"] = dataHome;

    expect(resolverHome()).toBe(join(dataHome, "banking"));
    expect(getBankingHome()).toBe(join(dataHome, "banking"));
    expect(bankingDataRoot()).toBe(join(dataHome, "banking"));
    expect(defaultDevStorePath()).toBe(join(dataHome, "banking", "banking.db"));

    const store = createSqliteDevStore();
    expect(existsSync(join(dataHome, "banking", "banking.db"))).toBe(true);
    void store;
  });

  test("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const resolved = join(tempRoot, "banking");
    // No override, no store -> legacy default stays.
    expect(adoptResolverHome(resolved, {})).toBe(false);
    // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
    expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: tempRoot })).toBe(false);
    expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: tempRoot })).toBe(false);
    // Data-kind override adopts even before a store exists.
    expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: tempRoot })).toBe(true);
    // A migrated store at the resolver home adopts without any override.
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "banking.db"), "");
    expect(adoptResolverHome(resolved, {})).toBe(true);
    expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: tempRoot })).toBe(true);
  });

  test("explicit path option wins over the env override and the default", () => {
    const explicit = join(tempRoot, "explicit", "banking.db");
    process.env["HASNA_BANKING_HOME"] = join(tempRoot, "override-root");

    const store = createSqliteDevStore({ path: explicit });
    expect(existsSync(explicit)).toBe(true);
    void store;
  });
});
