import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStorageMode, defaultSqlitePath } from "../src/config.js";
import {
  adoptResolverHome,
  getAppHome,
  getDefaultDbPath,
  LEGACY_HOME_DIR,
  resolverHome,
} from "../src/core/app-home.js";
import { assertCloudTlsPolicy } from "../src/db/cloud.js";

const HOME_ENV_KEYS = ["HASNA_ACCESS_HOME", "ACCESS_HOME", "HASNA_DATA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"] as const;
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

describe("storage mode resolution", () => {
  it("defaults to local", () => {
    expect(resolveStorageMode({})).toBe("local");
  });

  it("resolves postgres backend when a DATABASE_URL is present", () => {
    expect(resolveStorageMode({ HASNA_ACCESS_DATABASE_URL: "postgres://x" })).toBe("cloud");
    expect(resolveStorageMode({ ACCESS_DATABASE_URL: "postgres://x" })).toBe("cloud");
  });

  it("ignores the retired HASNA_ACCESS_STORAGE_MODE variable", () => {
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "cloud" })).toBe("local");
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "cloud", ACCESS_STORAGE_MODE: "remote" })).toBe("local");
  });
});

describe("cloud TLS policy", () => {
  it("accepts sslmode=verify-full", () => {
    const policy = assertCloudTlsPolicy("postgres://u:p@h:5432/db?sslmode=verify-full");
    expect(policy.sslmode).toBe("verify-full");
    expect(policy.requiresCaBundle).toBe(true);
  });

  it("rejects sslmode=require (no cert verification)", () => {
    expect(() => assertCloudTlsPolicy("postgres://u:p@h:5432/db?sslmode=require")).toThrow(/verify-full/);
  });

  it("rejects a DSN with no sslmode", () => {
    expect(() => assertCloudTlsPolicy("postgres://u:p@h:5432/db")).toThrow(/verify-full/);
  });
});

describe("access home resolution — legacy default must never become invisible (P1/P2 regression)", () => {
  it("keeps the legacy ~/.hasna/access default until the XDG store exists or an override is set", () => {
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "access"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective home and default DB path MUST stay on the legacy layout.
    expect(getAppHome()).toBe(LEGACY_HOME_DIR);
    expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "access.db"));
    expect(defaultSqlitePath()).toBe(join(LEGACY_HOME_DIR, "access.db"));
  });

  it("honors the HASNA_ACCESS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["HASNA_ACCESS_HOME"] = join(base, "custom-access-home");
      expect(getAppHome()).toBe(join(base, "custom-access-home"));
      expect(getDefaultDbPath()).toBe(join(base, "custom-access-home", "access.db"));
      expect(defaultSqlitePath()).toBe(join(base, "custom-access-home", "access.db"));
    } finally {
      delete process.env["HASNA_ACCESS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the ACCESS_HOME legacy alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "access-home-"));
    try {
      process.env["ACCESS_HOME"] = join(base, "alias-access-home");
      expect(getAppHome()).toBe(join(base, "alias-access-home"));
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
    } finally {
      delete process.env["HASNA_DATA_HOME"];
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
