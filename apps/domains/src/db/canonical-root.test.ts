/**
 * Canonical LOCAL data root regression tests for open-domains.
 *
 * The app's local data lives at `~/.hasna/domains/` (SQLite db + config.json)
 * — the same `~/.hasna` namespace the shared resolver's disk tier reads
 * (`~/.hasna/domains/config/credentials` for the credential file). These tests
 * pin:
 *
 *   1. the DEFAULT db path resolves to $HOME/.hasna/domains/domains.db, and
 *      follows $HASNA_HOME when the shared root override is set;
 *   2. env overrides still win: the canonical HASNA_DOMAINS_DB_PATH /
 *      HASNA_DOMAINS_DIR / HASNA_DOMAINS_HOME names ALWAYS beat their legacy
 *      unprefixed aliases (the aliases no longer outrank the canonical names);
 *   3. the DEFAULT config path resolves to $HOME/.hasna/domains/config.json;
 *   4. env overrides for config (HASNA_DOMAINS_CONFIG_PATH /
 *      DOMAINS_CONFIG_PATH / DOMAINS_CONFIG_DIR) still win;
 *   5. the XDG layout is STRIPPED (hasna/apps#1720, class B): nothing in the
 *      package consults $XDG_CONFIG_HOME / $XDG_DATA_HOME / ~/.config/hasna,
 *      the @hasna/paths reimplementation is gone, and there is no migration.
 *
 * Every function under test accepts an explicit env object, so no test mutates
 * the shared process.env (the global test setup already points DOMAINS_DIR at a
 * temp dir for the rest of the suite).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "./database.js";
import { getConfigPath, loadConfig, saveConfig } from "../lib/config.js";
import {
  appDataHome,
  exactAppOverride,
  getDefaultConfigPath,
  getDefaultDbPath,
} from "../lib/app-home.js";

interface FakeEnv {
  HOME: string;
  HASNA_HOME?: string;
  HASNA_CONFIG_HOME?: string;
  DOMAINS_DB_PATH?: string;
  HASNA_DOMAINS_DB_PATH?: string;
  DOMAINS_DIR?: string;
  HASNA_DOMAINS_DIR?: string;
  HASNA_DOMAINS_HOME?: string;
  DOMAINS_HOME?: string;
  DOMAINS_CONFIG_PATH?: string;
  HASNA_DOMAINS_CONFIG_PATH?: string;
  DOMAINS_CONFIG_DIR?: string;
}

function fakeHomeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  return { HOME: mkdtempSync(join(tmpdir(), "domains-canonical-")), ...overrides };
}

function rmHome(env: FakeEnv): void {
  rmSync(env.HOME, { recursive: true, force: true });
}

describe("canonical db root", () => {
  test("default db path resolves to $HOME/.hasna/domains/domains.db", () => {
    const env = fakeHomeEnv();
    try {
      expect(appDataHome(env)).toBe(join(env.HOME, ".hasna", "domains"));
      expect(getDefaultDbPath(env)).toBe(join(env.HOME, ".hasna", "domains", "domains.db"));
      expect(getDbPath(env)).toBe(join(env.HOME, ".hasna", "domains", "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("$HASNA_HOME redirects the local data root (shared-root override)", () => {
    const env = fakeHomeEnv({ HASNA_HOME: "/tmp/shared-root" });
    try {
      expect(appDataHome(env)).toBe(join("/tmp/shared-root", "domains"));
      expect(getDbPath(env)).toBe(join("/tmp/shared-root", "domains", "domains.db"));
      expect(getConfigPath(env)).toBe(join("/tmp/shared-root", "domains", "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_DB_PATH wins over the DOMAINS_DB_PATH alias — canonical outranks legacy", () => {
    const env = fakeHomeEnv({
      DOMAINS_DB_PATH: "/tmp/legacy/db.sqlite",
      HASNA_DOMAINS_DB_PATH: "/tmp/canonical/hasna.db",
    });
    try {
      expect(getDbPath(env)).toBe("/tmp/canonical/hasna.db");
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

  test("HASNA_DOMAINS_DIR wins over the DOMAINS_DIR alias", () => {
    const env = fakeHomeEnv({ DOMAINS_DIR: "/tmp/legacy-dir", HASNA_DOMAINS_DIR: "/tmp/canonical-dir" });
    try {
      expect(getDbPath(env)).toBe(join("/tmp/canonical-dir", "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_HOME wins over the DOMAINS_HOME alias and appends domains.db", () => {
    const env = fakeHomeEnv({ DOMAINS_HOME: "/tmp/legacy-home", HASNA_DOMAINS_HOME: "/tmp/canonical-home" });
    try {
      expect(exactAppOverride(env)).toBe("/tmp/canonical-home");
      expect(getDbPath(env)).toBe(join("/tmp/canonical-home", "domains.db"));
    } finally {
      rmHome(env);
    }
  });

  test("the legacy unprefixed aliases still work when the canonical names are absent", () => {
    const env = fakeHomeEnv({ DOMAINS_DB_PATH: "/tmp/legacy/db.sqlite" });
    try {
      expect(getDbPath(env)).toBe("/tmp/legacy/db.sqlite");
    } finally {
      rmHome(env);
    }
  });
});

describe("canonical config root", () => {
  test("default config path resolves to $HOME/.hasna/domains/config.json", () => {
    const env = fakeHomeEnv();
    try {
      expect(getDefaultConfigPath(env)).toBe(join(env.HOME, ".hasna", "domains", "config.json"));
      expect(getConfigPath(env)).toBe(join(env.HOME, ".hasna", "domains", "config.json"));
    } finally {
      rmHome(env);
    }
  });

  test("HASNA_DOMAINS_CONFIG_PATH wins over DOMAINS_CONFIG_PATH", () => {
    const env = fakeHomeEnv({
      DOMAINS_CONFIG_PATH: "/tmp/legacy-conf/custom.json",
      HASNA_DOMAINS_CONFIG_PATH: "/tmp/canonical-conf/custom.json",
    });
    try {
      expect(getConfigPath(env)).toBe("/tmp/canonical-conf/custom.json");
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
      const canonical = join(env.HOME, ".hasna", "domains", "config.json");
      expect(existsSync(canonical)).toBe(true);
      expect(loadConfig(env).default_registrar).toBe("godaddy");
    } finally {
      rmHome(env);
    }
  });
});

describe("the XDG layout is stripped (hasna/apps#1720 class B)", () => {
  test("the db and config paths never consult XDG or ~/.config/hasna — even with files present", () => {
    const env = fakeHomeEnv({
      XDG_CONFIG_HOME: "/tmp/xdg-config",
      XDG_DATA_HOME: "/tmp/xdg-data",
    } as FakeEnv);
    try {
      // Pre-existing data under the retired layouts must NOT move the store:
      // there is no migration, and the canonical root is the only root.
      mkdirSync(join(env.HOME, ".config", "open-domains"), { recursive: true });
      writeFileSync(join(env.HOME, ".config", "open-domains", "config.json"), "{}");
      expect(appDataHome(env)).toBe(join(env.HOME, ".hasna", "domains"));
      expect(getDbPath(env)).toBe(join(env.HOME, ".hasna", "domains", "domains.db"));
      expect(getConfigPath(env)).toBe(join(env.HOME, ".hasna", "domains", "config.json"));
      // Nothing was created under the retired layouts by resolution.
      expect(existsSync(join(env.HOME, ".local", "share", "hasna"))).toBe(false);
    } finally {
      rmHome(env);
    }
  });

  test("the package source no longer contains the retired path machinery", async () => {
    const appHome = await Bun.file(new URL("../lib/app-home.ts", import.meta.url)).text();
    const database = await Bun.file(new URL("./database.ts", import.meta.url)).text();
    const config = await Bun.file(new URL("../lib/config.ts", import.meta.url)).text();
    // Comments may retell the strip story; the CODE must not.
    const code = [appHome, database, config]
      .join("\n")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/XDG_|pathsResolver|HASNA_DATA_HOME|\.config\/hasna|migrateLegacy|\.local\/share\/hasna/);
  });
});