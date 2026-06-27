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
    const home = mkdtempSync(join(tmpdir(), "security-home-"));
    const workDir = join(home, "work");
    try {
      process.env.HOME = home;
      delete process.env.USERPROFILE;
      delete process.env.SECURITY_DB;
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
      rmSync(home, { recursive: true, force: true });
    }
  });
});
