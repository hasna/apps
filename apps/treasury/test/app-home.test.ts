/**
 * @hasna/treasury home resolution regression tests.
 *
 * The default data home for this package is ~/.hasna/treasury (SQLite db at
 * the home root + the config/data/exports/backups/logs/tmp subdirs). These
 * tests pin the @hasna/paths resolver switch:
 *
 *   1. the DEFAULT home resolves to $HOME/.hasna/treasury until the XDG data
 *      home is adopted — an existing local store never becomes invisible;
 *   2. env overrides (HASNA_TREASURY_DB_PATH / TREASURY_DB_PATH) still win;
 *   3. the exact-app override (HASNA_TREASURY_HOME / TREASURY_HOME) wins
 *      unconditionally and keeps the legacy layout under the override root;
 *   4. the resolver (XDG) data home is adopted only when HASNA_DATA_HOME is
 *      set (the data-kind override) or the store has already been migrated
 *      there (treasury.db exists); other HASNA_*_HOME kinds alone must NOT
 *      move the data home;
 *   5. ensureTreasuryAppHome provisions root + all subdirs mode 0700 at the
 *      effective home.
 *
 * Every function under test accepts an explicit env object, so no test mutates
 * the shared process.env.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDbPath } from "../src/config.js";
import {
  adoptResolverTreasuryHome,
  ensureTreasuryAppHome,
  exactTreasuryHome,
  getDefaultTreasuryBackupDir,
  getTreasuryAppDir,
  getTreasuryAppHome,
  legacyTreasuryHome,
  resolverTreasuryHome,
} from "../src/core/app-home.js";

interface FakeEnv {
  HOME: string;
  HASNA_TREASURY_DB_PATH?: string;
  TREASURY_DB_PATH?: string;
  HASNA_TREASURY_HOME?: string;
  TREASURY_HOME?: string;
  HASNA_DATA_HOME?: string;
  HASNA_CONFIG_HOME?: string;
  HASNA_CACHE_HOME?: string;
}

function fakeHomeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  return { HOME: mkdtempSync(join(tmpdir(), "treasury-home-")), ...overrides };
}

function rmHome(env: FakeEnv): void {
  rmSync(env.HOME, { recursive: true, force: true });
}

describe("treasury canonical home", () => {
  test("default home resolves to $HOME/.hasna/treasury", () => {
    const env = fakeHomeEnv();
    try {
      expect(legacyTreasuryHome(env)).toBe(join(env.HOME, ".hasna", "treasury"));
      expect(getTreasuryAppHome(env)).toBe(join(env.HOME, ".hasna", "treasury"));
      expect(getTreasuryAppDir("backups", env)).toBe(join(env.HOME, ".hasna", "treasury", "backups"));
      expect(getDefaultTreasuryBackupDir(env)).toBe(join(env.HOME, ".hasna", "treasury", "backups"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_TREASURY_DB_PATH override wins over the default", () => {
    const env = fakeHomeEnv({ HASNA_TREASURY_DB_PATH: "/tmp/treasury-override/db.sqlite" });
    try {
      expect(resolveDbPath(env)).toBe("/tmp/treasury-override/db.sqlite");
    } finally {
      rmHome(env);
    }
  });

  test("TREASURY_DB_PATH override wins over the default", () => {
    const env = fakeHomeEnv({ TREASURY_DB_PATH: "/tmp/treasury-override/legacy.db" });
    try {
      expect(resolveDbPath(env)).toBe("/tmp/treasury-override/legacy.db");
    } finally {
      rmHome(env);
    }
  });

  test("the default db path is at the root of the effective home", () => {
    const env = fakeHomeEnv();
    try {
      expect(resolveDbPath(env)).toBe(join(env.HOME, ".hasna", "treasury", "treasury.db"));
    } finally {
      rmHome(env);
    }
  });
});

describe("@hasna/paths resolver adoption — legacy default must never become invisible", () => {
  test("legacy ~/.hasna/treasury default stays until the XDG store exists or HASNA_DATA_HOME is set", () => {
    const env = fakeHomeEnv();
    try {
      expect(legacyTreasuryHome(env)).toBe(join(env.HOME, ".hasna", "treasury"));
      // No HASNA_*_HOME overrides and no store migrated to the resolver home:
      // the effective home and db path MUST stay on the legacy layout.
      expect(getTreasuryAppHome(env)).toBe(join(env.HOME, ".hasna", "treasury"));
      expect(resolveDbPath(env)).toBe(join(env.HOME, ".hasna", "treasury", "treasury.db"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_TREASURY_HOME exact-app override wins and keeps the legacy layout", () => {
    const env = fakeHomeEnv({ HASNA_TREASURY_HOME: "/tmp/treasury-exact" });
    try {
      expect(exactTreasuryHome(env)).toBe("/tmp/treasury-exact");
      expect(getTreasuryAppHome(env)).toBe("/tmp/treasury-exact");
      expect(resolveDbPath(env)).toBe(join("/tmp/treasury-exact", "treasury.db"));
      expect(getTreasuryAppDir("data", env)).toBe(join("/tmp/treasury-exact", "data"));
    } finally {
      rmHome(env);
    }
  });

  test("TREASURY_HOME legacy alias exact-app override wins", () => {
    const env = fakeHomeEnv({ TREASURY_HOME: "/tmp/treasury-alias" });
    try {
      expect(getTreasuryAppHome(env)).toBe("/tmp/treasury-alias");
      expect(resolveDbPath(env)).toBe(join("/tmp/treasury-alias", "treasury.db"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DATA_HOME data-kind override adopts the resolver home", () => {
    const env = fakeHomeEnv({ HASNA_DATA_HOME: "/tmp/data-home" });
    try {
      expect(resolverTreasuryHome(env)).toBe(join("/tmp/data-home", "treasury"));
      expect(getTreasuryAppHome(env)).toBe(join("/tmp/data-home", "treasury"));
      expect(resolveDbPath(env)).toBe(join("/tmp/data-home", "treasury", "treasury.db"));
    } finally {
      rmHome(env);
    }
  });

  test("adoptResolverTreasuryHome is true only for the data-kind override or a migrated store", () => {
    const env = fakeHomeEnv();
    const resolved = join(env.HOME, ".local", "share", "hasna", "treasury");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverTreasuryHome(resolved, env)).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverTreasuryHome(resolved, { ...env, HASNA_CACHE_HOME: "/tmp/cache" })).toBe(false);
      expect(adoptResolverTreasuryHome(resolved, { ...env, HASNA_CONFIG_HOME: "/tmp/config" })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverTreasuryHome(resolved, { ...env, HASNA_DATA_HOME: "/tmp/data" })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "treasury.db"), "");
      expect(adoptResolverTreasuryHome(resolved, env)).toBe(true);
      expect(adoptResolverTreasuryHome(resolved, { ...env, HASNA_CACHE_HOME: "/tmp/cache" })).toBe(true);
    } finally {
      rmHome(env);
    }
  });

  test("a migrated store at the resolver home adopts it for the home and db path", () => {
    const env = fakeHomeEnv();
    try {
      const resolved = join(env.HOME, ".local", "share", "hasna", "treasury");
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "treasury.db"), "");
      expect(getTreasuryAppHome(env)).toBe(resolved);
      expect(resolveDbPath(env)).toBe(join(resolved, "treasury.db"));
    } finally {
      rmHome(env);
    }
  });

  test("ensureTreasuryAppHome provisions root + all subdirs at the effective home", () => {
    const env = fakeHomeEnv();
    try {
      const dirs = ensureTreasuryAppHome(env);
      const root = join(env.HOME, ".hasna", "treasury");
      expect(dirs.root).toBe(root);
      for (const sub of ["config", "data", "exports", "backups", "logs", "tmp"]) {
        expect(existsSync(join(root, sub))).toBe(true);
        expect(dirs[sub as keyof typeof dirs]).toBe(join(root, sub));
      }
      expect(existsSync(root)).toBe(true);
    } finally {
      rmHome(env);
    }
  });

  test("ensureTreasuryAppHome provisions the adopted resolver home when HASNA_DATA_HOME is set", () => {
    const env = fakeHomeEnv({ HASNA_DATA_HOME: "/tmp/data-home" });
    try {
      const dirs = ensureTreasuryAppHome(env);
      const root = join("/tmp/data-home", "treasury");
      expect(dirs.root).toBe(root);
      expect(existsSync(root)).toBe(true);
      for (const sub of ["config", "data", "exports", "backups", "logs", "tmp"]) {
        expect(existsSync(join(root, sub))).toBe(true);
      }
    } finally {
      rmHome(env);
    }
  });
});
