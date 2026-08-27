import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  getAppHome,
  getAppDir,
  getBackupDir,
  getDefaultDbPath,
  LEGACY_HOME_DIR,
  resolverHome,
} from "../src/core/app-home.js";
import { defaultSqlitePath, resolveDbPath } from "../src/config.js";

const HOME_ENV_KEYS = [
  "HASNA_ACCESS_HOME",
  "ACCESS_HOME",
  "HASNA_ACCESS_DB_PATH",
  "ACCESS_DB_PATH",
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

describe("access home resolution — legacy default must never become invisible (P1/P2 regression)", () => {
  it("keeps the legacy ~/.hasna/access default until the XDG store exists or an override is set", () => {
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "access"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective home and default DB path MUST stay on the legacy layout.
    expect(getAppHome()).toBe(LEGACY_HOME_DIR);
    expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "access.db"));
    expect(defaultSqlitePath()).toBe(join(LEGACY_HOME_DIR, "access.db"));
    expect(resolveDbPath({})).toBe(join(LEGACY_HOME_DIR, "access.db"));
    expect(getBackupDir()).toBe(join(LEGACY_HOME_DIR, "backups"));
  });

  it("honors the HASNA_ACCESS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["HASNA_ACCESS_HOME"] = join(base, "custom-home");
      expect(getAppHome()).toBe(join(base, "custom-home"));
      expect(getDefaultDbPath()).toBe(join(base, "custom-home", "access.db"));
      expect(getBackupDir()).toBe(join(base, "custom-home", "backups"));
    } finally {
      delete process.env["HASNA_ACCESS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the ACCESS_HOME fallback override", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["ACCESS_HOME"] = join(base, "alias-home");
      expect(getAppHome()).toBe(join(base, "alias-home"));
      expect(getAppDir("data")).toBe(join(base, "alias-home", "data"));
    } finally {
      delete process.env["ACCESS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "access"));
      expect(getAppHome()).toBe(join(base, "access"));
      expect(getDefaultDbPath()).toBe(join(base, "access", "access.db"));
      expect(defaultSqlitePath()).toBe(join(base, "access", "access.db"));
      expect(resolveDbPath({})).toBe(join(base, "access", "access.db"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("HASNA_ACCESS_DB_PATH wins over the resolved home for the db path only", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["HASNA_ACCESS_DB_PATH"] = join(base, "custom.db");
      expect(resolveDbPath()).toBe(join(base, "custom.db"));
      // The home itself is unaffected by the db-path override.
      expect(getAppHome()).toBe(LEGACY_HOME_DIR);
      expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "access.db"));
    } finally {
      delete process.env["HASNA_ACCESS_DB_PATH"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    const resolved = join(base, "access");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_STATE_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "access.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
