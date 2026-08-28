import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "./database.js";

const originalCwd = process.cwd();

afterEach(() => {
  closeDb();
  process.chdir(originalCwd);
});

describe("hasna home database", () => {
  test("migrates legacy shield database into ~/.hasna/security", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalSecurityDb = process.env.SECURITY_DB;
    const originalDataHome = process.env.HASNA_DATA_HOME;
    const originalExactHome = process.env.HASNA_SHIELD_HOME;
    const home = mkdtempSync(join(tmpdir(), "security-home-"));
    const workDir = join(home, "work");
    try {
      process.env.HOME = home;
      delete process.env.USERPROFILE;
      delete process.env.SECURITY_DB;
      delete process.env.HASNA_DATA_HOME;
      delete process.env.HASNA_SHIELD_HOME;
      mkdirSync(workDir, { recursive: true });
      const legacyDir = join(home, ".hasna", "shield");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "shield.db"), "");
      process.chdir(workDir);

      closeDb();
      getDb();
      closeDb();

      expect(existsSync(join(home, ".hasna", "security", "shield.db"))).toBe(true);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
      if (originalDataHome === undefined) delete process.env.HASNA_DATA_HOME;
      else process.env.HASNA_DATA_HOME = originalDataHome;
      if (originalExactHome === undefined) delete process.env.HASNA_SHIELD_HOME;
      else process.env.HASNA_SHIELD_HOME = originalExactHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("adopts the resolver data home when HASNA_DATA_HOME is set", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalSecurityDb = process.env.SECURITY_DB;
    const originalDataHome = process.env.HASNA_DATA_HOME;
    const originalExactHome = process.env.HASNA_SHIELD_HOME;
    const root = mkdtempSync(join(tmpdir(), "security-xdg-home-"));
    const home = join(root, "home");
    const dataHome = join(root, "xdg");
    const workDir = join(root, "work");
    try {
      process.env.HOME = home;
      delete process.env.USERPROFILE;
      delete process.env.SECURITY_DB;
      process.env.HASNA_DATA_HOME = dataHome;
      delete process.env.HASNA_SHIELD_HOME;
      mkdirSync(workDir, { recursive: true });
      process.chdir(workDir);

      closeDb();
      const db = getDb();
      expect((db.prepare("SELECT 1 AS value").get() as { value?: number }).value).toBe(1);
      closeDb();

      // The resolver app slug (`security`) is appended beneath HASNA_DATA_HOME.
      const adopted = join(dataHome, "security", "shield.db");
      expect(existsSync(adopted)).toBe(true);
      expect(existsSync(join(home, ".hasna", "security", "shield.db"))).toBe(false);
    } finally {
      closeDb();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
      if (originalDataHome === undefined) delete process.env.HASNA_DATA_HOME;
      else process.env.HASNA_DATA_HOME = originalDataHome;
      if (originalExactHome === undefined) delete process.env.HASNA_SHIELD_HOME;
      else process.env.HASNA_SHIELD_HOME = originalExactHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses project .security directory for the database", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalSecurityDb = process.env.SECURITY_DB;
    const originalShieldMode = process.env.HASNA_SHIELD_STORAGE_MODE;
    const originalSecurityMode = process.env.HASNA_SECURITY_STORAGE_MODE;
    const root = mkdtempSync(join(tmpdir(), "security-project-db-"));
    const workDir = join(root, "repo");
    const home = join(root, "home");
    try {
      process.env.HOME = home;
      delete process.env.USERPROFILE;
      delete process.env.SECURITY_DB;
      delete process.env.HASNA_SHIELD_STORAGE_MODE;
      delete process.env.HASNA_SECURITY_STORAGE_MODE;
      mkdirSync(join(workDir, ".security"), { recursive: true });
      process.chdir(workDir);

      const db = getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name")
        .all("table", "sqlite_%")
        .map((row: any) => row.name);
      closeDb();

      expect(existsSync(join(workDir, ".security", "shield.db"))).toBe(true);
      expect(existsSync(join(home, ".hasna", "security", "shield.db"))).toBe(false);
      expect(tables).toContain("projects");
      expect(tables).toContain("rules");
      expect(tables).toContain("scans");
    } finally {
      closeDb();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
      if (originalShieldMode === undefined) delete process.env.HASNA_SHIELD_STORAGE_MODE;
      else process.env.HASNA_SHIELD_STORAGE_MODE = originalShieldMode;
      if (originalSecurityMode === undefined) delete process.env.HASNA_SECURITY_STORAGE_MODE;
      else process.env.HASNA_SECURITY_STORAGE_MODE = originalSecurityMode;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores the retired storage-mode variables (legacy retirement)", () => {
    const originalSecurityDb = process.env.SECURITY_DB;
    try {
      process.env.HASNA_SHIELD_STORAGE_MODE = "remote";
      process.env.HASNA_SECURITY_STORAGE_MODE = "shared";
      delete process.env.SECURITY_DB;
      closeDb();
      // The retired mode variables are deliberately not read: the store is
      // always local SQLite, so setting them changes nothing.
      const db = getDb();
      expect((db.prepare("SELECT 1 AS value").get() as { value?: number }).value).toBe(1);
    } finally {
      closeDb();
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
    }
  });
});
