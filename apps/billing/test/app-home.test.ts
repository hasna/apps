// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19) + P4 XDG
// resolver switch (hotfixes plan 0f49f56a, task P3.3).
//
// Priority 3 — app-home resolution contracts: HASNA_BILLING_HOME beats
// BILLING_HOME beats the ~/.hasna/billing default; the @hasna/paths resolver
// data home is adopted only once the store is migrated there or the operator
// sets HASNA_DATA_HOME; ensureBillingAppHome creates the root plus six 0700
// subdirectories; the default database path and backup directory resolve under
// the resolved home. All paths are redirected to a temporary HOME/override —
// nothing touches the real ~/.hasna/billing.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  BILLING_APP_SUBDIRS,
  ensureBillingAppHome,
  getBillingAppHome,
  getDefaultBillingBackupDir,
  getDefaultBillingDbPath,
  legacyHomeDir,
  resolverHome,
} from "../src/core/app-home.js";

const HOME_ENV_KEYS = [
  "HASNA_BILLING_HOME",
  "BILLING_HOME",
  "HASNA_DATA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_HOME_ENV: Record<string, string | undefined> = {};

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "billing-home-test-"));
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
  it("resolves HASNA_BILLING_HOME over BILLING_HOME and the default", () => {
    process.env["BILLING_HOME"] = join(tempHome, "legacy");
    process.env["HASNA_BILLING_HOME"] = join(tempHome, "canonical");
    expect(getBillingAppHome()).toBe(join(tempHome, "canonical"));
  });

  it("falls back to BILLING_HOME when HASNA_BILLING_HOME is unset", () => {
    process.env["BILLING_HOME"] = join(tempHome, "legacy");
    expect(getBillingAppHome()).toBe(join(tempHome, "legacy"));
  });

  it("defaults to ~/.hasna/billing when neither override is set", () => {
    process.env["HOME"] = tempHome;
    expect(legacyHomeDir()).toBe(join(tempHome, ".hasna", "billing"));
    expect(getBillingAppHome()).toBe(join(tempHome, ".hasna", "billing"));
  });
});

describe("resolver (XDG) home adoption — legacy default must never become invisible (P1/P2 regression)", () => {
  it("keeps the legacy ~/.hasna/billing default until the XDG store exists or HASNA_DATA_HOME is set", () => {
    // No overrides, no migrated store at the resolver home: the effective home
    // MUST stay on the legacy layout.
    process.env["HOME"] = tempHome;
    expect(getBillingAppHome()).toBe(join(tempHome, ".hasna", "billing"));
    expect(getDefaultBillingDbPath()).toBe(join(tempHome, ".hasna", "billing", "data", "billing.db"));
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "billing-resolver-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "billing"));
      expect(getBillingAppHome()).toBe(join(base, "billing"));
      expect(getDefaultBillingDbPath()).toBe(join(base, "billing", "data", "billing.db"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "billing-resolver-"));
    const resolved = join(base, "billing");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(join(resolved, "data"), { recursive: true });
      writeFileSync(join(resolved, "data", "billing.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      delete process.env["HASNA_DATA_HOME"];
    }
  });
});

describe("app-home tree", () => {
  it("creates the root and all six subdirectories with mode 0700", () => {
    process.env["HASNA_BILLING_HOME"] = join(tempHome, "home");
    const dirs = ensureBillingAppHome();
    expect(dirs.root).toBe(join(tempHome, "home"));
    expect(BILLING_APP_SUBDIRS).toHaveLength(6);
    for (const sub of BILLING_APP_SUBDIRS) {
      expect(dirs[sub]).toBe(join(tempHome, "home", sub));
      expect(statSync(dirs[sub]).isDirectory()).toBe(true);
      expect(statSync(dirs[sub]).mode & 0o777).toBe(0o700);
    }
    expect(statSync(dirs.root).mode & 0o777).toBe(0o700);
  });

  it("is idempotent (a second call does not fail on existing dirs)", () => {
    process.env["HASNA_BILLING_HOME"] = join(tempHome, "home");
    ensureBillingAppHome();
    expect(() => ensureBillingAppHome()).not.toThrow();
  });

  it("resolves the default database path under <home>/data/billing.db", () => {
    process.env["HASNA_BILLING_HOME"] = join(tempHome, "home");
    expect(getDefaultBillingDbPath()).toBe(join(tempHome, "home", "data", "billing.db"));
  });

  it("resolves the default backup directory under <home>/backups", () => {
    process.env["HASNA_BILLING_HOME"] = join(tempHome, "home");
    expect(getDefaultBillingBackupDir()).toBe(join(tempHome, "home", "backups"));
  });
});
