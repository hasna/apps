import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "./store-interface.js";
import {
  LOCAL_OPT_IN_ENV_KEY,
  isLocalOptIn,
  resolveStore,
  withStore,
} from "./client-store.js";

const CLOUD_ENV = {
  HASNA_SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz",
  HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key",
} as const;

const CLOUD_ALIAS_ENV = {
  SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz",
  SHORTLINKS_API_KEY: "hasna_shortlinks_test_key",
} as const;

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "shortlinks-resolver-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Hermetic env base: HOME + SHORTLINKS_HOME point at a scratch dir so the
 * @hasna/contracts resolver never sees a real fleet app-config / credential
 * file on disk from the machine running the tests.
 */
function env(home: string, extra: Record<string, string> = {}): Env {
  return { HOME: home, SHORTLINKS_HOME: home, ...extra };
}

describe("fail-closed store resolution (owner ruling 2026-09-04)", () => {
  test("no hosted env and no local opt-in: resolveStore throws naming the required fleet API env", () => {
    const home = tempHome();
    const error = () => resolveStore(env(home));
    expect(error).toThrow(/HASNA_SHORTLINKS_API_URL/);
    expect(error).toThrow(/HASNA_SHORTLINKS_API_KEY/);
    // The error is actionable: it names the local opt-in as well.
    expect(error).toThrow(new RegExp(`${LOCAL_OPT_IN_ENV_KEY}=1`));
  });

  test("failed resolution creates no local database and no data-dir files", () => {
    const home = tempHome();
    expect(() => resolveStore(env(home))).toThrow(/HASNA_SHORTLINKS_API_URL/);
    // The on-box SQLite store (~/.hasna/<app>/<app>.db) is never opened or
    // created by a failing resolution — no db file, no config file.
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("withStore rejects without env and creates no local database", async () => {
    const home = tempHome();
    await expect(withStore(async () => null, env(home))).rejects.toThrow(
      /HASNA_SHORTLINKS_API_URL/,
    );
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
  });

  test("partial API env (URL without key, or key without URL) fails closed naming both keys", () => {
    const home = tempHome();
    const urlOnly = () =>
      resolveStore(env(home, { HASNA_SHORTLINKS_API_URL: "https://shortlinks.example.test" }));
    expect(urlOnly).toThrow(/partially configured/);
    expect(urlOnly).toThrow(/HASNA_SHORTLINKS_API_URL/);
    expect(urlOnly).toThrow(/HASNA_SHORTLINKS_API_KEY/);

    const keyOnly = () =>
      resolveStore(env(home, { HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key" }));
    expect(keyOnly).toThrow(/partially configured/);
    expect(keyOnly).toThrow(/HASNA_SHORTLINKS_API_URL/);
    expect(keyOnly).toThrow(/HASNA_SHORTLINKS_API_KEY/);
  });

  test("a fully configured hosted API selects the cloud store", () => {
    const home = tempHome();
    const store = resolveStore(env(home, CLOUD_ENV));
    expect(store.kind).toBe("http");
    void store.close();
  });

  test("legacy alias env (SHORTLINKS_API_URL / SHORTLINKS_API_KEY) selects the cloud store", () => {
    const home = tempHome();
    const store = resolveStore(env(home, CLOUD_ALIAS_ENV));
    expect(store.kind).toBe("http");
    void store.close();
  });

  test("a fully configured hosted API wins over the local opt-in", () => {
    const home = tempHome();
    const store = resolveStore(env(home, { ...CLOUD_ENV, [LOCAL_OPT_IN_ENV_KEY]: "1" }));
    expect(store.kind).toBe("http");
    void store.close();
  });
});

describe("explicit local opt-in", () => {
  test("an explicit dbPath opts into the on-box SQLite store", () => {
    const home = tempHome();
    const dbPath = join(home, "explicit.db");
    const store = resolveStore(env(home), { dbPath });
    expect(store.kind).toBe("local");
    void store.close();
    expect(existsSync(dbPath)).toBe(true);
  });

  test("SHORTLINKS_LOCAL=1 opts into the on-box SQLite store without a dbPath", () => {
    const home = tempHome();
    const previousHome = process.env.SHORTLINKS_HOME;
    process.env.SHORTLINKS_HOME = home;
    try {
      const store = resolveStore(env(home, { [LOCAL_OPT_IN_ENV_KEY]: "1" }));
      expect(store.kind).toBe("local");
      void store.close();
      expect(existsSync(join(home, "shortlinks.db"))).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.SHORTLINKS_HOME;
      else process.env.SHORTLINKS_HOME = previousHome;
    }
  });

  test("SHORTLINKS_LOCAL is an explicit opt-in: 0/false/no/off do not select local", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      const home = tempHome();
      const error = () => resolveStore(env(home, { [LOCAL_OPT_IN_ENV_KEY]: value }));
      expect(error).toThrow(/HASNA_SHORTLINKS_API_URL/);
    }
  });

  test("isLocalOptIn accepts truthy values and rejects falsy ones", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV_KEY]: value })).toBe(true);
    }
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV_KEY]: value })).toBe(false);
    }
    expect(isLocalOptIn({})).toBe(false);
  });
});
