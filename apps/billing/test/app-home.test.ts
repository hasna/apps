// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 3 — app-home resolution contracts: HASNA_BILLING_HOME beats
// BILLING_HOME beats the ~/.hasna/billing default; ensureBillingAppHome
// creates the root plus six 0700 subdirectories; the default database path
// and backup directory resolve under the resolved home. All paths are
// redirected to a temporary HOME/override — nothing touches the real
// ~/.hasna/billing.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BILLING_APP_SUBDIRS,
  ensureBillingAppHome,
  getBillingAppHome,
  getDefaultBillingBackupDir,
  getDefaultBillingDbPath,
} from "../src/core/app-home.js";

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "billing-home-test-"));
  delete process.env["HASNA_BILLING_HOME"];
  delete process.env["BILLING_HOME"];
});

afterEach(() => {
  delete process.env["HASNA_BILLING_HOME"];
  delete process.env["BILLING_HOME"];
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
    expect(getBillingAppHome()).toBe(join(tempHome, ".hasna", "billing"));
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
