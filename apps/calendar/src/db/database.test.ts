import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, getDatabase } from "./database.js";

describe("database path resolution", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalBunTest: string | undefined;
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(() => {
    closeDatabase();
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    originalBunTest = process.env["BUN_TEST"];
    originalCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "calendar-db-"));
    delete process.env["BUN_TEST"];
    delete process.env["USERPROFILE"];
  });

  afterEach(() => {
    closeDatabase();
    process.chdir(originalCwd);
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("BUN_TEST", originalBunTest);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("copies legacy home database into ~/.hasna/calendar", () => {
    const home = join(tempRoot, "home");
    const workspace = join(home, "workspace", "repo");
    const legacyDb = join(home, ".calendar", "calendar.db");
    const newDb = join(home, ".hasna", "calendar", "calendar.db");
    mkdirSync(workspace, { recursive: true });
    createMarkerDatabase(legacyDb, "legacy-home");
    process.env["HOME"] = home;
    process.chdir(workspace);

    const db = getDatabase();

    expect(existsSync(newDb)).toBe(true);
    expect(existsSync(legacyDb)).toBe(true);
    expect(readMarker(db)).toBe("legacy-home");
  });

  test("keeps project-local .calendar database ahead of home migration", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const homeLegacyDb = join(home, ".calendar", "calendar.db");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(homeLegacyDb, "legacy-home");
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.chdir(project);

    const db = getDatabase();

    expect(readMarker(db)).toBe("project-local");
    expect(existsSync(homeNewDb)).toBe(false);
  });
});

function createMarkerDatabase(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.run("CREATE TABLE marker (value TEXT NOT NULL)");
    db.run("INSERT INTO marker (value) VALUES (?)", [value]);
  } finally {
    db.close();
  }
}

function readMarker(db: Database): string {
  const row = db.query("SELECT value FROM marker LIMIT 1").get() as { value: string } | null;
  return row?.value ?? "";
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
