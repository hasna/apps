import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `holdings-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "holdings"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverAppHome,
  getExactAppHome,
  getHoldingsAppHome,
  getLegacyAppHome,
  getResolverAppHome,
} = await import("../src/core/app-home.js");

const KIND_HOME_ENV_KEYS = [
  "HASNA_DATA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const EXACT_HOME_ENV_KEYS = ["HASNA_HOLDINGS_HOME", "HOLDINGS_HOME"] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...EXACT_HOME_ENV_KEYS, ...KIND_HOME_ENV_KEYS]) SAVED_ENV[k] = process.env[k];
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
  for (const k of [...EXACT_HOME_ENV_KEYS, ...KIND_HOME_ENV_KEYS]) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(getResolverAppHome(), "holdings.db"), { force: true });
});

describe("holdings app-home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/holdings default until the XDG store exists or an override is set", () => {
    expect(getLegacyAppHome()).toBe(join(testHome, ".hasna", "holdings"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getHoldingsAppHome()).toBe(getLegacyAppHome());
  });

  it("honors the HASNA_HOLDINGS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "holdings-home-"));
    try {
      process.env["HASNA_HOLDINGS_HOME"] = join(base, "custom-dir");
      expect(getExactAppHome()).toBe(join(base, "custom-dir"));
      expect(getHoldingsAppHome()).toBe(join(base, "custom-dir"));
    } finally {
      delete process.env["HASNA_HOLDINGS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the bare HOLDINGS_HOME exact-app override when the HASNA_ prefixed one is absent", () => {
    const base = mkdtempSync(join(tmpdir(), "holdings-home-"));
    try {
      process.env["HOLDINGS_HOME"] = join(base, "bare-dir");
      expect(getExactAppHome()).toBe(join(base, "bare-dir"));
      expect(getHoldingsAppHome()).toBe(join(base, "bare-dir"));
    } finally {
      delete process.env["HOLDINGS_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("treats a whitespace-only exact override as unset (falls through to legacy)", () => {
    process.env["HASNA_HOLDINGS_HOME"] = "   ";
    expect(getExactAppHome()).toBeUndefined();
    expect(getHoldingsAppHome()).toBe(getLegacyAppHome());
    delete process.env["HASNA_HOLDINGS_HOME"];
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "holdings-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      // holdings is a public app, so the resolver home sits under hasna/holdings.
      expect(getResolverAppHome()).toBe(join(base, "holdings"));
      expect(getHoldingsAppHome()).toBe(join(base, "holdings"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverAppHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "holdings-home-"));
    const resolved = join(base, "holdings");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverAppHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverAppHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverAppHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverAppHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "holdings.db"), "");
      expect(adoptResolverAppHome(resolved, {})).toBe(true);
      expect(adoptResolverAppHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
