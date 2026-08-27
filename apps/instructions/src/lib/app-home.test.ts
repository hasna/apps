// P4 XDG resolver switch (hotfixes plan 0f49f56a, task P3.3).
//
// Configs-app store-home resolution contracts: HASNA_CONFIGS_HOME (the exact-app
// override) beats the legacy ~/.hasna/instructions default; the @hasna/paths
// resolver config home (~/.config/hasna/configs on Linux) is adopted only once
// the store is migrated there (instructions.db exists at the resolver home) or
// the operator sets the config-kind override HASNA_CONFIG_HOME; a machine that
// only redirects another kind (HASNA_DATA_HOME / HASNA_CACHE_HOME / …) must NOT
// have its configs store moved. All paths are redirected to a temporary
// HOME/override — nothing touches the real ~/.hasna/instructions or ~/.config.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverStoreHome,
  getConfigsStoreDbPath,
  getConfigsStoreHome,
  legacyStoreHome,
  resolverStoreHome,
} from "./app-home.js";

const HOME_ENV_KEYS = [
  "HASNA_CONFIGS_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_HOME_ENV: Record<string, string | undefined> = {};

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "configs-home-test-"));
  for (const k of HOME_ENV_KEYS) SAVED_HOME_ENV[k] = process.env[k];
  for (const k of HOME_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of HOME_ENV_KEYS) {
    if (SAVED_HOME_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_HOME_ENV[k];
  }
});

describe("home resolution precedence", () => {
  it("HASNA_CONFIGS_HOME exact-app override beats the legacy default", () => {
    process.env["HOME"] = tempHome;
    const override = join(tempHome, "alt-root");
    process.env["HASNA_CONFIGS_HOME"] = override;
    expect(getConfigsStoreHome()).toBe(override);
    expect(getConfigsStoreDbPath()).toBe(join(override, "instructions.db"));
  });

  it("defaults to ~/.hasna/instructions when no override is set and no store is migrated", () => {
    process.env["HOME"] = tempHome;
    expect(legacyStoreHome()).toBe(join(tempHome, ".hasna", "instructions"));
    expect(getConfigsStoreHome()).toBe(join(tempHome, ".hasna", "instructions"));
    expect(getConfigsStoreDbPath()).toBe(join(tempHome, ".hasna", "instructions", "instructions.db"));
  });
});

describe("resolver (XDG) config home adoption — legacy default must never become invisible", () => {
  it("adoptResolverStoreHome is true only for the config-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "configs-resolver-"));
    const resolved = join(base, "configs");
    // No override, no store -> legacy default stays.
    expect(adoptResolverStoreHome(resolved, {})).toBe(false);
    // Non-config HASNA_*_HOME kinds alone must NOT move the configs store.
    expect(adoptResolverStoreHome(resolved, { HASNA_DATA_HOME: base })).toBe(false);
    expect(adoptResolverStoreHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
    expect(adoptResolverStoreHome(resolved, { HASNA_STATE_HOME: base })).toBe(false);
    // Config-kind override adopts even before a store exists.
    expect(adoptResolverStoreHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(true);
    // A migrated store at the resolver home adopts without any override.
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "instructions.db"), "");
    expect(adoptResolverStoreHome(resolved, {})).toBe(true);
    expect(adoptResolverStoreHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
  });

  it("resolverStoreHome resolves the XDG config home under the redirected HOME", () => {
    process.env["HOME"] = tempHome;
    expect(resolverStoreHome()).toBe(join(tempHome, ".config", "hasna", "configs"));
  });

  it("adopts the resolver home on the HASNA_CONFIG_HOME config-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "configs-resolver-"));
    try {
      process.env["HASNA_CONFIG_HOME"] = base;
      expect(resolverStoreHome()).toBe(join(base, "configs"));
      expect(getConfigsStoreHome()).toBe(join(base, "configs"));
      expect(getConfigsStoreDbPath()).toBe(join(base, "configs", "instructions.db"));
    } finally {
      delete process.env["HASNA_CONFIG_HOME"];
    }
  });

  it("keeps the legacy ~/.hasna/instructions default until the XDG store exists or HASNA_CONFIG_HOME is set", () => {
    process.env["HOME"] = tempHome;
    expect(getConfigsStoreHome()).toBe(join(tempHome, ".hasna", "instructions"));
    // A migrated store at the resolver home flips the effective home to XDG.
    const resolved = join(tempHome, ".config", "hasna", "configs");
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "instructions.db"), "");
    expect(getConfigsStoreHome()).toBe(resolved);
    expect(getConfigsStoreDbPath()).toBe(join(resolved, "instructions.db"));
  });
});
