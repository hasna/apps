/**
 * Canonical data root regression tests for open-domains.
 *
 * Fleet law (ruling hasna/apps#1668): one resolver in @hasna/contracts; the default data root for this
 * package is the domains data root (SQLite db + config.json). These tests pin:
 *
 *   1. the DEFAULT db path resolves to the resolver data root's domains.db;
 *   2. env overrides (DOMAINS_DB_PATH / HASNA_DOMAINS_DB_PATH / DOMAINS_DIR)
 *      still win over the default;
 *   3. the DEFAULT config path resolves to the resolver data root's config.json;
 *   4. env overrides for config (DOMAINS_CONFIG_PATH / DOMAINS_CONFIG_DIR)
 *      still win;
 *   5. one-time migration from the previous XDG defaults
 *      ($XDG_DATA_HOME/open-domains, $XDG_CONFIG_HOME/open-domains) copies data
 *      into the canonical root, verifies it, records a receipt, is idempotent,
 *      never deletes the source, and never overwrites existing canonical data.
 *
 * Every function under test accepts an explicit env object, so no test mutates
 * the shared process.env (the global test setup already points DOMAINS_DIR at a
 * temp dir for the rest of the suite).
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir as resolverDataDir } from \"@hasna/contracts/paths\";
import { getDbPath, migrateLegacyDataDir } from "./database.js";
import { getConfigPath, loadConfig, migrateLegacyConfig, saveConfig } from "../lib/config.js";
import {
  adoptResolverHome,
  appHome,
  exactAppOverride,
  getDefaultConfigPath,
  getDefaultDbPath,
  legacyHomeDir,
  resolverHome,
} from "../lib/app-home.js";

interface FakeEnv {
  HOME: string;
  XDG_DATA_HOME?: string;
  XDG_CONFIG_HOME?: string;
  DOMAINS_DB_PATH?: string;
  HASNA_DOMAINS_DB_PATH?: string;
  DOMAINS_DIR?: string;
  HASNA_DOMAINS_DIR?: string;
  HASNA_DOMAINS_HOME?: string;
  DOMAINS_HOME?: string;
  HASNA_DATA_HOME?: string;
  DOMAINS_CONFIG_PATH?: string;
  DOMAINS_CONFIG_DIR?: string;
}

function fakeHomeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  return { HOME: mkdtempSync(join(tmpdir(), "domains-canonical-")), ...overrides };
}

function rmHome(env: FakeEnv): void {
  rmSync(env.HOME, { recursive: true, force: true });
}

describe("canonical db root", () => {
  test("default db path resolves to the resolver data root db", () => {
    const env = fakeHomeEnv();
    try {
      expect(getDbPath(env)).toBe(canonical(env, "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("DOMAINS_DB_PATH override wins over the default", () => {
    const env = fakeHomeEnv({ DOMAINS_DB_PATH: "/tmp/domains-override/db.sqlite" });
    try {
      expect(getDbPath(env)).toBe("/tmp/domains-override/db.sqlite");
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_DB_PATH override wins over the default", () => {
    const env = fakeHomeEnv({ HASNA_DOMAINS_DB_PATH: "/tmp/domains-override/hasna.db" });
    try {
      expect(getDbPath(env)).toBe("/tmp/domains-override/hasna.db");
    } finally {
      rmHome(env);
    }
  });

  test("DOMAINS_DIR override wins and appends domains.db", () => {
    const env = fakeHomeEnv({ DOMAINS_DIR: "/tmp/domains-dir" });
    try {
      expect(getDbPath(env)).toBe(join("/tmp/domains-dir", "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_DIR override wins and appends domains.db", () => {
    const env = fakeHomeEnv({ HASNA_DOMAINS_DIR: "/tmp/domains-dir-2" });
    try {
      expect(getDbPath(env)).toBe(join("/tmp/domains-dir-2", "domains.db"));
    } finally {
      rmHome(env);
    }
  });
});

describe("canonical config root", () => {
  test("default config path resolves to the resolver data root config", () => {
    const env = fakeHomeEnv();
    try {
      expect(getConfigPath(env)).toBe(canonical(env, "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("DOMAINS_CONFIG_PATH override wins", () => {
    const env = fakeHomeEnv({ DOMAINS_CONFIG_PATH: "/tmp/domains-conf/custom.json" });
    try {
      expect(getConfigPath(env)).toBe("/tmp/domains-conf/custom.json");
    } finally {
      rmHome(env);
    }
  });

  test("DOMAINS_CONFIG_DIR override wins and appends config.json", () => {
    const env = fakeHomeEnv({ DOMAINS_CONFIG_DIR: "/tmp/domains-conf-dir" });
    try {
      expect(getConfigPath(env)).toBe(join("/tmp/domains-conf-dir", "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("saveConfig/loadConfig round-trips at the canonical default path", () => {
    const env = fakeHomeEnv();
    try {
      saveConfig({ default_registrar: "godaddy" }, env);
      const canonical = canonical(env, "config.json");
      expect(existsSync(canonical)).toBe(true);
      expect(loadConfig(env).default_registrar).toBe("godaddy");
    } finally {
      rmHome(env);
    }
  });
});

describe("one-time migration from the previous XDG default", () => {
  test("copies the XDG data db into the canonical root, verifies, receipts, keeps the source", () => {
    const env = fakeHomeEnv();
    try {
      const oldDir = join(env.HOME, ".local", "share", "open-domains");
      const oldDb = join(oldDir, "domains.db");
      mkdirSync(oldDir, { recursive: true });
      const payload = Buffer.from("migrate-me-domain-db");
      writeFileSync(oldDb, payload);

      const canonicalDb = canonical(env, "domains.db");
      expect(existsSync(canonicalDb)).toBe(false);

      migrateLegacyDataDir(env);

      // Copied, byte-identical, and the canonical default now resolves there.
      expect(existsSync(canonicalDb)).toBe(true);
      expect(readFileSync(canonicalDb).equals(payload)).toBe(true);
      expect(getDbPath(env)).toBe(canonicalDb);
      // Source is never deleted.
      expect(existsSync(oldDb)).toBe(true);
      // Receipt recorded.
      expect(existsSync(canonical(env, ".migrated-from-xdg.receipt.json"))).toBe(true);
    } finally {
      rmHome(env);
    }
  });

  test("is idempotent and resumable — a second run changes nothing", () => {
    const env = fakeHomeEnv();
    try {
      const oldDir = join(env.HOME, ".local", "share", "open-domains");
      const oldDb = join(oldDir, "domains.db");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(oldDb, "data-v1");

      migrateLegacyDataDir(env);
      const canonicalDb = canonical(env, "domains.db");
      const before = readFileSync(canonicalDb);

      migrateLegacyDataDir(env);
      expect(readFileSync(canonicalDb).equals(before)).toBe(true);
    } finally {
      rmHome(env);
    }
  });

  test("never overwrites existing canonical data", () => {
    const env = fakeHomeEnv();
    try {
      const canonicalDir = canonical(env);
      mkdirSync(canonicalDir, { recursive: true });
      writeFileSync(join(canonicalDir, "domains.db"), "canonical-wins");

      const oldDir = join(env.HOME, ".local", "share", "open-domains");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, "domains.db"), "old-should-lose");

      migrateLegacyDataDir(env);
      expect(readFileSync(join(canonicalDir, "domains.db")).toString()).toBe("canonical-wins");
    } finally {
      rmHome(env);
    }
  });

  test("dry-run reports what would be copied and writes nothing", () => {
    const env = fakeHomeEnv();
    try {
      const oldDir = join(env.HOME, ".local", "share", "open-domains");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, "domains.db"), "dry-run-me");

      const report = migrateLegacyDataDir(env, true);

      expect(report.dryRun).toBe(true);
      expect(report.wouldCopy).toContain("domains.db");
      expect(report.copied).toEqual([]);
      expect(existsSync(canonical(env))).toBe(false);
      expect(existsSync(canonical(env, "domains.db"))).toBe(false);
    } finally {
      rmHome(env);
    }
  });

  test("dry-run on the config migration writes nothing", () => {
    const env = fakeHomeEnv();
    try {
      const oldDir = join(env.HOME, ".config", "open-domains");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, "config.json"), JSON.stringify({ default_registrar: "namecheap" }));

      const report = migrateLegacyConfig(env, true);

      expect(report.dryRun).toBe(true);
      expect(report.wouldCopy).toBe(true);
      expect(report.copied).toBe(false);
      expect(existsSync(canonical(env, "config.json"))).toBe(false);
    } finally {
      rmHome(env);
    }
  });

  test("copies the XDG config.json into the canonical root", () => {
    const env = fakeHomeEnv();
    try {
      const oldDir = join(env.HOME, ".config", "open-domains");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, "config.json"), JSON.stringify({ default_registrar: "namecheap" }));

      const canonicalConfig = canonical(env, "config.json");
      expect(existsSync(canonicalConfig)).toBe(false);

      // loadConfig with a fake env triggers the one-time config migration.
      expect(loadConfig(env).default_registrar).toBe("namecheap");
      expect(existsSync(canonicalConfig)).toBe(true);
      expect(existsSync(join(oldDir, "config.json"))).toBe(true);
      expect(loadConfig(env).default_registrar).toBe("namecheap");
    } finally {
      rmHome(env);
    }
  });

  test("no migration runs when there is no XDG data", () => {
    const env = fakeHomeEnv();
    try {
      migrateLegacyDataDir(env);
      expect(existsSync(canonical(env))).toBe(false);
    } finally {
      rmHome(env);
    }
  });
});

describe("@hasna/paths resolver adoption — legacy default must never become invisible", () => {
  test("legacy the domains data root default stays until the XDG store exists or HASNA_DATA_HOME is set", () => {
    const env = fakeHomeEnv();
    try {
      expect(legacyHomeDir(env)).toBe(canonical(env));
      // No HASNA_*_HOME overrides and no store migrated to the resolver home:
      // the effective home, db path and config path MUST stay on the legacy layout.
      expect(appHome(env)).toBe(canonical(env));
      expect(getDefaultDbPath(env)).toBe(canonical(env, "domains.db"));
      expect(getDbPath(env)).toBe(canonical(env, "domains.db"));
      expect(getDefaultConfigPath(env)).toBe(canonical(env, "config.json"));
      expect(getConfigPath(env)).toBe(canonical(env, "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_HOME exact-app override wins and keeps the legacy layout", () => {
    const env = fakeHomeEnv({ HASNA_DOMAINS_HOME: "/tmp/domains-exact" });
    try {
      expect(exactAppOverride(env)).toBe("/tmp/domains-exact");
      expect(appHome(env)).toBe("/tmp/domains-exact");
      expect(getDbPath(env)).toBe(join("/tmp/domains-exact", "domains.db"));
      expect(getConfigPath(env)).toBe(join("/tmp/domains-exact", "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("DOMAINS_HOME legacy alias exact-app override wins", () => {
    const env = fakeHomeEnv({ DOMAINS_HOME: "/tmp/domains-alias" });
    try {
      expect(appHome(env)).toBe("/tmp/domains-alias");
      expect(getDbPath(env)).toBe(join("/tmp/domains-alias", "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DATA_HOME data-kind override adopts the resolver home", () => {
    const env = fakeHomeEnv({ HASNA_DATA_HOME: "/tmp/data-home" });
    try {
      expect(resolverHome(env)).toBe(join("/tmp/data-home", "domains"));
      expect(appHome(env)).toBe(join("/tmp/data-home", "domains"));
      expect(getDbPath(env)).toBe(join("/tmp/data-home", "domains", "domains.db"));
      expect(getConfigPath(env)).toBe(join("/tmp/data-home", "domains", "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const env = fakeHomeEnv();
    const resolved = join(env.HOME, ".local", "share", "hasna", "domains");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, env)).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { ...env, HASNA_CACHE_HOME: "/tmp/cache" })).toBe(false);
      expect(adoptResolverHome(resolved, { ...env, HASNA_CONFIG_HOME: "/tmp/config" })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { ...env, HASNA_DATA_HOME: "/tmp/data" })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "domains.db"), "");
      expect(adoptResolverHome(resolved, env)).toBe(true);
      expect(adoptResolverHome(resolved, { ...env, HASNA_CACHE_HOME: "/tmp/cache" })).toBe(true);
    } finally {
      rmHome(env);
    }
  });

  test("a migrated store at the resolver home adopts it for the db and config paths", () => {
    const env = fakeHomeEnv();
    try {
      const resolved = join(env.HOME, ".local", "share", "hasna", "domains");
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "domains.db"), "");
      expect(appHome(env)).toBe(resolved);
      expect(getDbPath(env)).toBe(join(resolved, "domains.db"));
      expect(getConfigPath(env)).toBe(join(resolved, "config.json"));
    } finally {
      rmHome(env);
    }
  });
});
