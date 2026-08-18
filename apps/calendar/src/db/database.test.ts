import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, getDatabase } from "./database.js";

describe("database path resolution", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalBunTest: string | undefined;
  let originalCwd: string;
  let originalDbPath: string | undefined;
  let originalDbScope: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    closeDatabase();
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    originalBunTest = process.env["BUN_TEST"];
    originalCwd = process.cwd();
    originalDbPath = process.env["CALENDAR_DB_PATH"];
    originalDbScope = process.env["CALENDAR_DB_SCOPE"];
    tempRoot = mkdtempSync(join(tmpdir(), "calendar-db-"));
    delete process.env["BUN_TEST"];
    delete process.env["USERPROFILE"];
    delete process.env["CALENDAR_DB_PATH"];
    delete process.env["CALENDAR_DB_SCOPE"];
  });

  afterEach(() => {
    closeDatabase();
    process.chdir(originalCwd);
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("BUN_TEST", originalBunTest);
    restoreEnv("CALENDAR_DB_PATH", originalDbPath);
    restoreEnv("CALENDAR_DB_SCOPE", originalDbScope);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("defaults to ~/.hasna/calendar/calendar.db under a fake HOME", () => {
    const home = join(tempRoot, "home");
    const workspace = join(home, "workspace", "repo");
    const newDb = join(home, ".hasna", "calendar", "calendar.db");
    mkdirSync(workspace, { recursive: true });
    process.env["HOME"] = home;
    process.chdir(workspace);

    const db = getDatabase();

    expect(existsSync(newDb)).toBe(true);
    expect(migrationCount(db)).toBe(1);
  });

  test("CALENDAR_DB_PATH override wins over the canonical default", () => {
    const home = join(tempRoot, "home");
    const customDb = join(tempRoot, "custom", "calendar.db");
    mkdirSync(home, { recursive: true });
    process.env["HOME"] = home;
    process.env["CALENDAR_DB_PATH"] = customDb;
    process.chdir(home);

    const db = getDatabase();

    expect(existsSync(customDb)).toBe(true);
    expect(existsSync(join(home, ".hasna", "calendar", "calendar.db"))).toBe(false);
    expect(migrationCount(db)).toBe(1);
  });

  test("CALENDAR_DB_SCOPE=project still selects the project git root", () => {
    const home = join(tempRoot, "home");
    const project = join(tempRoot, "workspace", "project");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, ".git"), "gitdir: .git\n");
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.env["CALENDAR_DB_SCOPE"] = "project";
    process.chdir(project);

    const db = getDatabase();

    expect(readMarker(db)).toBe("project-local");
    expect(existsSync(join(home, ".hasna", "calendar", "calendar.db"))).toBe(false);
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

  test("defaults to canonical even when a project-local .calendar exists (no env override)", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.chdir(project);

    const db = getDatabase();

    // The default data root is canonical: the project-local .calendar file is
    // no longer selected (it becomes a migration source, see next test).
    expect(existsSync(homeNewDb)).toBe(true);
    expect(existsSync(projectDb)).toBe(true);
    expect(readMarker(db)).toBe("project-local");
  });

  test("migrates project-local .calendar data into ~/.hasna/calendar on first run", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    const projectDb = join(project, ".calendar", "calendar.db");
    const receiptPath = join(home, ".hasna", "calendar", "migration-receipt.json");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.chdir(project);

    const db = getDatabase();

    // Data was copied (never moved), the source is preserved, and a receipt
    // records the one-time migration.
    expect(readMarker(db)).toBe("project-local");
    expect(existsSync(homeNewDb)).toBe(true);
    expect(existsSync(projectDb)).toBe(true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf-8")) as { source: string; target: string };
    expect(receipt.source).toBe(projectDb);
    expect(receipt.target).toBe(homeNewDb);
  });

  test("never overwrites existing canonical data (idempotent and resumable)", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(projectDb, "project-local");
    createMarkerDatabase(homeNewDb, "canonical");
    process.env["HOME"] = home;
    process.chdir(project);

    const db = getDatabase();

    // Canonical data wins; the project-local source is left untouched.
    expect(readMarker(db)).toBe("canonical");
    expect(readMarkerFromFile(projectDb)).toBe("project-local");
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

function migrationCount(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
  return row.n;
}

function readMarkerFromFile(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return readMarker(db);
  } finally {
    db.close();
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
