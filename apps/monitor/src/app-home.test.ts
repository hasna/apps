import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `monitor-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "monitor"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  exactMonitorDir,
  getMonitorDir,
  HASNA_MONITOR_HOME_ENV,
  hasExactMonitorOverride,
  legacyHomeDir,
  resolverHome,
} = await import("./app-home.js");

const OVERRIDE_ENV_KEYS = [
  "MONITOR_CONFIG_DIR",
  HASNA_MONITOR_HOME_ENV,
  "HASNA_DATA_HOME",
] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of OVERRIDE_ENV_KEYS) SAVED_ENV[k] = process.env[k];
});

afterAll(() => {
  process.env.HOME = savedHome;
  for (const k of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
  rmSync(testHome, { recursive: true, force: true });
});

// Reset all overrides between tests so the isolated default is deterministic.
beforeEach(() => {
  for (const k of OVERRIDE_ENV_KEYS) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(resolverHome(), { recursive: true, force: true });
});

describe("monitor home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy the monitor data root default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "monitor"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getMonitorDir()).toBe(legacyHomeDir());
  });

  it("honors the MONITOR_CONFIG_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "monitor-home-"));
    try {
      process.env["MONITOR_CONFIG_DIR"] = join(base, "custom-dir");
      expect(exactMonitorDir()).toBe(join(base, "custom-dir"));
      expect(getMonitorDir()).toBe(join(base, "custom-dir"));
      expect(hasExactMonitorOverride()).toBe(true);
    } finally {
      delete process.env["MONITOR_CONFIG_DIR"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_MONITOR_HOME alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "monitor-home-"));
    try {
      process.env[HASNA_MONITOR_HOME_ENV] = join(base, "alias-home");
      expect(exactMonitorDir()).toBe(join(base, "alias-home"));
      expect(getMonitorDir()).toBe(join(base, "alias-home"));
      expect(hasExactMonitorOverride()).toBe(true);
    } finally {
      delete process.env[HASNA_MONITOR_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "monitor-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "monitor"));
      expect(getMonitorDir()).toBe(join(base, "monitor"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "monitor-home-"));
    const resolved = join(base, "monitor");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated config at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "config.json"), "{}");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
      // A migrated db alone also adopts.
      rmSync(join(resolved, "config.json"));
      writeFileSync(join(resolved, "monitor.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      // An empty resolver home (no config.json / monitor.db) does not adopt.
      rmSync(join(resolved, "monitor.db"));
      expect(adoptResolverHome(resolved, {})).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home once config.json or monitor.db exists there", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "monitor.db"), "");
    try {
      expect(adoptResolverHome(resolved)).toBe(true);
      expect(getMonitorDir()).toBe(resolved);
    } finally {
      rmSync(resolved, { recursive: true, force: true });
    }
  });
});
