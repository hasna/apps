import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `loops-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "loops"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  exactLoopsDataDir,
  getLoopsDataDir,
  HASNA_LOOPS_DATA_DIR_ENV,
  legacyHomeDir,
  resolverHome,
} = await import("./app-home.js");

const OVERRIDE_ENV_KEYS = [
  "LOOPS_DATA_DIR",
  "HASNA_LOOPS_DATA_DIR",
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

describe("loops home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/loops default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "loops"));
    // No overrides and no store migrated to the resolver home:
    // the effective data home MUST stay on the legacy layout.
    expect(getLoopsDataDir()).toBe(legacyHomeDir());
  });

  it("honors the LOOPS_DATA_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "loops-home-"));
    try {
      process.env["LOOPS_DATA_DIR"] = join(base, "custom-dir");
      expect(exactLoopsDataDir()).toBe(join(base, "custom-dir"));
      expect(getLoopsDataDir()).toBe(join(base, "custom-dir"));
    } finally {
      delete process.env["LOOPS_DATA_DIR"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_LOOPS_DATA_DIR alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "loops-home-"));
    try {
      process.env[HASNA_LOOPS_DATA_DIR_ENV] = join(base, "alias-home");
      expect(exactLoopsDataDir()).toBe(join(base, "alias-home"));
      expect(getLoopsDataDir()).toBe(join(base, "alias-home"));
    } finally {
      delete process.env[HASNA_LOOPS_DATA_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "loops-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "loops"));
      expect(getLoopsDataDir()).toBe(join(base, "loops"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "loops-home-"));
    const resolved = join(base, "loops");
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
      writeFileSync(join(resolved, "loops.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
      // An empty resolver home (no loops.db) does not adopt.
      rmSync(join(resolved, "loops.db"));
      expect(adoptResolverHome(resolved, {})).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home once loops.db exists there", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "loops.db"), "");
    try {
      expect(adoptResolverHome(resolved)).toBe(true);
      expect(getLoopsDataDir()).toBe(resolved);
    } finally {
      rmSync(resolved, { recursive: true, force: true });
    }
  });
});
