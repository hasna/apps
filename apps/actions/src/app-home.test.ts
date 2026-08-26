import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  getActionsHome,
  getDefaultDbPath,
  LEGACY_HOME_DIR,
  resolverHome,
} from "./core/app-home.js";
import { getActionsDataDir, HASNA_ACTIONS_DIR_ENV, HASNA_ACTIONS_HOME_ENV } from "./storage.js";

const HOME_ENV_KEYS = [
  "HASNA_ACTIONS_DIR",
  "HASNA_ACTIONS_HOME",
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

describe("actions home resolution — legacy default must never become invisible (P1/P2 regression)", () => {
  it("keeps the legacy ~/.hasna/actions default until the XDG store exists or an override is set", () => {
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "actions"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective home and default DB path MUST stay on the legacy layout.
    expect(getActionsHome()).toBe(LEGACY_HOME_DIR);
    expect(getActionsDataDir()).toBe(LEGACY_HOME_DIR);
    expect(getDefaultDbPath()).toBe(join(LEGACY_HOME_DIR, "actions.db"));
  });

  it("honors the HASNA_ACTIONS_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "actions-home-"));
    try {
      process.env[HASNA_ACTIONS_DIR_ENV] = join(base, "custom-dir");
      expect(getActionsHome()).toBe(join(base, "custom-dir"));
      expect(getActionsDataDir()).toBe(join(base, "custom-dir"));
      expect(getDefaultDbPath()).toBe(join(base, "custom-dir", "actions.db"));
    } finally {
      delete process.env[HASNA_ACTIONS_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_ACTIONS_HOME fallback override", () => {
    const base = mkdtempSync(join(tmpdir(), "actions-home-"));
    try {
      process.env[HASNA_ACTIONS_HOME_ENV] = join(base, "alias-home");
      expect(getActionsHome()).toBe(join(base, "alias-home"));
      expect(getActionsDataDir()).toBe(join(base, "alias-home"));
    } finally {
      delete process.env[HASNA_ACTIONS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "actions-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "actions"));
      expect(getActionsHome()).toBe(join(base, "actions"));
      expect(getActionsDataDir()).toBe(join(base, "actions"));
      expect(getDefaultDbPath()).toBe(join(base, "actions", "actions.db"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "actions-home-"));
    const resolved = join(base, "actions");
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
      writeFileSync(join(resolved, "actions.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
