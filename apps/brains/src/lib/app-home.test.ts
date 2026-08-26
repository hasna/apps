import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `brains-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "brains"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  exactBrainsHome,
  getBrainsConfigPath,
  getBrainsDatasetsDir,
  getBrainsHome,
  getBrainsStorageConfigPath,
  HASNA_BRAINS_DIR_ENV,
  HASNA_BRAINS_HOME_ENV,
  legacyHomeDir,
  resolverHome,
} = await import("./app-home.js");

const KIND_HOME_ENV_KEYS = [
  "HASNA_DATA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  SAVED_ENV[HASNA_BRAINS_DIR_ENV] = process.env[HASNA_BRAINS_DIR_ENV];
  SAVED_ENV[HASNA_BRAINS_HOME_ENV] = process.env[HASNA_BRAINS_HOME_ENV];
  for (const k of KIND_HOME_ENV_KEYS) SAVED_ENV[k] = process.env[k];
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
  delete process.env[HASNA_BRAINS_DIR_ENV];
  delete process.env[HASNA_BRAINS_HOME_ENV];
  for (const k of KIND_HOME_ENV_KEYS) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverHome(), "brains.db"), { force: true });
});

describe("brains home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/brains default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "brains"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getBrainsHome()).toBe(legacyHomeDir());
    expect(getBrainsDatasetsDir()).toBe(join(legacyHomeDir(), "datasets"));
    expect(getBrainsConfigPath()).toBe(join(legacyHomeDir(), "config.json"));
    expect(getBrainsStorageConfigPath()).toBe(join(legacyHomeDir(), "storage", "config.json"));
  });

  it("honors the HASNA_BRAINS_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "brains-home-"));
    try {
      process.env[HASNA_BRAINS_DIR_ENV] = join(base, "custom-dir");
      expect(exactBrainsHome()).toBe(join(base, "custom-dir"));
      expect(getBrainsHome()).toBe(join(base, "custom-dir"));
      expect(getBrainsDatasetsDir()).toBe(join(base, "custom-dir", "datasets"));
      expect(getBrainsConfigPath()).toBe(join(base, "custom-dir", "config.json"));
    } finally {
      delete process.env[HASNA_BRAINS_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_BRAINS_HOME fallback override", () => {
    const base = mkdtempSync(join(tmpdir(), "brains-home-"));
    try {
      process.env[HASNA_BRAINS_HOME_ENV] = join(base, "alias-home");
      expect(exactBrainsHome()).toBe(join(base, "alias-home"));
      expect(getBrainsHome()).toBe(join(base, "alias-home"));
      expect(getBrainsDatasetsDir()).toBe(join(base, "alias-home", "datasets"));
    } finally {
      delete process.env[HASNA_BRAINS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "brains-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "brains"));
      expect(getBrainsHome()).toBe(join(base, "brains"));
      expect(getBrainsDatasetsDir()).toBe(join(base, "brains", "datasets"));
      expect(getBrainsConfigPath()).toBe(join(base, "brains", "config.json"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "brains-home-"));
    const resolved = join(base, "brains");
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
      writeFileSync(join(resolved, "brains.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
