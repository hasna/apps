import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `browser-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "browser"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  BROWSER_DATA_DIR_ENV,
  exactBrowserHome,
  getBrowserHome,
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
  SAVED_ENV[BROWSER_DATA_DIR_ENV] = process.env[BROWSER_DATA_DIR_ENV];
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
  delete process.env[BROWSER_DATA_DIR_ENV];
  for (const k of KIND_HOME_ENV_KEYS) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverHome(), "browser.db"), { force: true });
});

describe("browser home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/browser default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "browser"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getBrowserHome()).toBe(legacyHomeDir());
  });

  it("honors the BROWSER_DATA_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "browser-home-"));
    try {
      process.env[BROWSER_DATA_DIR_ENV] = join(base, "custom-dir");
      expect(exactBrowserHome()).toBe(join(base, "custom-dir"));
      expect(getBrowserHome()).toBe(join(base, "custom-dir"));
    } finally {
      delete process.env[BROWSER_DATA_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "browser-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "browser"));
      expect(getBrowserHome()).toBe(join(base, "browser"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "browser-home-"));
    const resolved = join(base, "browser");
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
      writeFileSync(join(resolved, "browser.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
