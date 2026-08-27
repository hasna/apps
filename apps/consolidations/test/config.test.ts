import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSqlitePath, databaseUrlPresent, resolveDataBackend } from "../src/config.js";
import {
  APP_HOME_SUBDIRS,
  LEGACY_HOME_DIR,
  adoptResolverHome,
  appHome,
  appHomeDir,
  getDefaultDbPath,
  resolverHome,
} from "../src/core/app-home.js";

const HOME_ENV_KEYS = [
  "HASNA_CONSOLIDATIONS_HOME",
  "CONSOLIDATIONS_HOME",
  "HASNA_DATA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_HOME_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of HOME_ENV_KEYS) SAVED_HOME_ENV[k] = process.env[k];
});

afterEach(() => {
  for (const k of HOME_ENV_KEYS) {
    if (SAVED_HOME_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_HOME_ENV[k];
  }
});

describe("server data backend resolution", () => {
  it("defaults to sqlite", () => {
    expect(resolveDataBackend({})).toBe("sqlite");
  });

  it("selects postgresql when a DATABASE_URL is present", () => {
    expect(resolveDataBackend({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("honors the alias env key", () => {
    expect(resolveDataBackend({ CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("selects postgresql when a DATABASE_URL_FILE mount is present", () => {
    expect(resolveDataBackend({ HASNA_CONSOLIDATIONS_DATABASE_URL_FILE: "/run/secrets/dsn" })).toBe(
      "postgresql",
    );
  });

  it("rejects legacy storage-mode variables with migration guidance", () => {
    const LEGACY_KEYS = [
      "HASNA_CONSOLIDATIONS_STORAGE_MODE",
      "HASNA_CONSOLIDATIONS_MODE",
      "CONSOLIDATIONS_STORAGE_MODE",
      "CONSOLIDATIONS_MODE",
    ] as const;
    for (const key of LEGACY_KEYS) {
      // A set variable is a stale configuration even when its value is blank.
      for (const value of ["cloud", "local", ""]) {
        expect(() => resolveDataBackend({ [key]: value })).toThrow(
          /was removed\. Delete the storage-mode variable/,
        );
      }
    }
  });

  it("databaseUrlPresent detects URL and FILE variants without reading values", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe(true);
    expect(databaseUrlPresent({ CONSOLIDATIONS_DATABASE_URL_FILE: "/run/secrets/dsn" })).toBe(true);
  });
});

describe("consolidations home resolution — legacy default must never become invisible (P1/P2 regression)", () => {
  it("keeps the legacy ~/.hasna/consolidations default until the XDG store exists or an override is set", () => {
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "consolidations"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective home and default DB path MUST stay on the legacy layout.
    expect(appHome()).toBe(LEGACY_HOME_DIR);
    expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "consolidations.db"));
    expect(defaultSqlitePath()).toBe(join(LEGACY_HOME_DIR, "consolidations.db"));
  });

  it("honors the HASNA_CONSOLIDATIONS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "consolidations-home-"));
    try {
      process.env["HASNA_CONSOLIDATIONS_HOME"] = join(base, "custom-consolidations-home");
      expect(appHome()).toBe(join(base, "custom-consolidations-home"));
      expect(getDefaultDbPath()).toBe(join(base, "custom-consolidations-home", "consolidations.db"));
      expect(defaultSqlitePath()).toBe(join(base, "custom-consolidations-home", "consolidations.db"));
    } finally {
      delete process.env["HASNA_CONSOLIDATIONS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the CONSOLIDATIONS_HOME legacy alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "consolidations-home-"));
    try {
      process.env["CONSOLIDATIONS_HOME"] = join(base, "alias-consolidations-home");
      expect(appHome()).toBe(join(base, "alias-consolidations-home"));
    } finally {
      delete process.env["CONSOLIDATIONS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "consolidations-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "consolidations"));
      expect(appHome()).toBe(join(base, "consolidations"));
      expect(getDefaultDbPath()).toBe(join(base, "consolidations", "consolidations.db"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "consolidations-home-"));
    const resolved = join(base, "consolidations");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "consolidations.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("maps app subdirs onto the XDG kinds once the resolver home is adopted", () => {
    const base = mkdtempSync(join(tmpdir(), "consolidations-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = join(base, "data");
      process.env["HASNA_CONFIG_HOME"] = join(base, "config");
      process.env["HASNA_STATE_HOME"] = join(base, "state");
      process.env["HASNA_CACHE_HOME"] = join(base, "cache");
      expect(appHome()).toBe(join(base, "data", "consolidations"));
      expect(appHomeDir("data")).toBe(join(base, "data", "consolidations"));
      expect(appHomeDir("exports")).toBe(join(base, "data", "consolidations", "exports"));
      expect(appHomeDir("backups")).toBe(join(base, "data", "consolidations", "backups"));
      expect(appHomeDir("config")).toBe(join(base, "config", "consolidations"));
      expect(appHomeDir("logs")).toBe(join(base, "state", "consolidations", "logs"));
      expect(appHomeDir("tmp")).toBe(join(base, "cache", "consolidations", "tmp"));
      // The pre-adoption legacy layout keeps all subdirs under the legacy root.
      delete process.env["HASNA_DATA_HOME"];
      delete process.env["HASNA_CONFIG_HOME"];
      delete process.env["HASNA_STATE_HOME"];
      delete process.env["HASNA_CACHE_HOME"];
      expect(appHome()).toBe(LEGACY_HOME_DIR);
      for (const sub of APP_HOME_SUBDIRS) {
        expect(appHomeDir(sub)).toBe(join(LEGACY_HOME_DIR, sub));
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
