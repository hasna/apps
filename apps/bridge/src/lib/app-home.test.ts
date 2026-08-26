import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `bridge-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "bridge"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  exactBridgeHome,
  getBridgeHome,
  getConfigPath,
  getDaemonDir,
  getStatePath,
  HASNA_BRIDGE_HOME_ENV,
  legacyHomeDir,
  resolverHome,
} = await import("./app-home.js");

const OVERRIDE_ENV_KEYS = [
  "BRIDGE_HOME",
  "BRIDGE_CONFIG",
  "BRIDGE_STATE",
  "HASNA_BRIDGE_HOME",
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

describe("bridge home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/bridge default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "bridge"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getBridgeHome()).toBe(legacyHomeDir());
    expect(getConfigPath()).toBe(join(legacyHomeDir(), "config.json"));
    expect(getStatePath()).toBe(join(legacyHomeDir(), "state.json"));
    expect(getDaemonDir()).toBe(join(legacyHomeDir(), "daemon"));
  });

  it("honors the BRIDGE_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "bridge-home-"));
    try {
      process.env["BRIDGE_HOME"] = join(base, "custom-dir");
      expect(exactBridgeHome()).toBe(join(base, "custom-dir"));
      expect(getBridgeHome()).toBe(join(base, "custom-dir"));
      expect(getConfigPath()).toBe(join(base, "custom-dir", "config.json"));
      expect(getStatePath()).toBe(join(base, "custom-dir", "state.json"));
      expect(getDaemonDir()).toBe(join(base, "custom-dir", "daemon"));
    } finally {
      delete process.env["BRIDGE_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_BRIDGE_HOME alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "bridge-home-"));
    try {
      process.env[HASNA_BRIDGE_HOME_ENV] = join(base, "alias-home");
      expect(exactBridgeHome()).toBe(join(base, "alias-home"));
      expect(getBridgeHome()).toBe(join(base, "alias-home"));
      expect(getConfigPath()).toBe(join(base, "alias-home", "config.json"));
    } finally {
      delete process.env[HASNA_BRIDGE_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "bridge-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "bridge"));
      expect(getBridgeHome()).toBe(join(base, "bridge"));
      expect(getConfigPath()).toBe(join(base, "bridge", "config.json"));
      expect(getStatePath()).toBe(join(base, "bridge", "state.json"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("BRIDGE_CONFIG and BRIDGE_STATE overrides win independently of the home", () => {
    const base = mkdtempSync(join(tmpdir(), "bridge-home-"));
    try {
      process.env["BRIDGE_CONFIG"] = join(base, "custom-config.json");
      process.env["BRIDGE_STATE"] = join(base, "custom-state.json");
      expect(getConfigPath()).toBe(join(base, "custom-config.json"));
      expect(getStatePath()).toBe(join(base, "custom-state.json"));
      // The home itself is untouched by the file overrides.
      expect(getBridgeHome()).toBe(legacyHomeDir());
    } finally {
      delete process.env["BRIDGE_CONFIG"];
      delete process.env["BRIDGE_STATE"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "bridge-home-"));
    const resolved = join(base, "bridge");
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
      writeFileSync(join(resolved, "config.json"), "{}");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
      // A state-only store also signals adoption.
      rmSync(join(resolved, "config.json"));
      writeFileSync(join(resolved, "state.json"), "{}");
      expect(adoptResolverHome(resolved, {})).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home once a store file exists there, and resolves subpaths beneath it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "config.json"), "{}");
    try {
      expect(adoptResolverHome(resolved)).toBe(true);
      expect(getBridgeHome()).toBe(resolved);
      expect(getConfigPath()).toBe(join(resolved, "config.json"));
      expect(getStatePath()).toBe(join(resolved, "state.json"));
      expect(getDaemonDir()).toBe(join(resolved, "daemon"));
    } finally {
      rmSync(resolved, { recursive: true, force: true });
    }
  });
});
