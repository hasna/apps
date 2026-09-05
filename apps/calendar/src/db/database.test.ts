import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, getDatabase, scanLegacyData } from "./database.js";

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

  test("defaults to the calendar data root/calendar.db under a fake HOME", () => {
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

  test("copies legacy home database into the calendar data root", () => {
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

    // The data root stays canonical-rooted, but legacy project-local data
    // keeps its own dataset: it migrates to a project-scoped canonical path,
    // never into the shared home database.
    expect(existsSync(homeNewDb)).toBe(false);
    expect(existsSync(projectDb)).toBe(true);
    expect(readMarker(db)).toBe("project-local");
  });

  test("migrates project-local .calendar data into a project-scoped canonical path on first run", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.chdir(project);

    const db = getDatabase();

    // Data was copied (never moved), the source is preserved, and a receipt
    // records the one-time migration into the project-scoped target.
    expect(readMarker(db)).toBe("project-local");
    expect(existsSync(homeNewDb)).toBe(false);
    expect(existsSync(projectDb)).toBe(true);
    const projectsRoot = join(home, ".hasna", "calendar", "projects");
    const scopedTargets = readdirSync(projectsRoot);
    expect(scopedTargets.length).toBe(1);
    const scopedDb = join(projectsRoot, scopedTargets[0], "calendar.db");
    expect(existsSync(scopedDb)).toBe(true);
    const receipt = JSON.parse(readFileSync(join(projectsRoot, scopedTargets[0], "migration-receipt.json"), "utf-8")) as { source: string; target: string };
    expect(receipt.source).toBe(projectDb);
    expect(receipt.target).toBe(scopedDb);
  });

  test("keeps two projects' legacy databases separate — no cross-project data routing", () => {
    const home = join(tempRoot, "home");
    const repoA = join(home, "workspace", "repo-a");
    const repoB = join(home, "workspace", "repo-b");
    const projectDbA = join(repoA, ".calendar", "calendar.db");
    const projectDbB = join(repoB, ".calendar", "calendar.db");
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    writeFileSync(join(repoA, ".git"), "gitdir: .git\n");
    writeFileSync(join(repoB, ".git"), "gitdir: .git\n");
    createMarkerDatabase(projectDbA, "data-A");
    createMarkerDatabase(projectDbB, "data-B");
    process.env["HOME"] = home;

    process.chdir(repoA);
    const dbA = getDatabase();
    expect(readMarker(dbA)).toBe("data-A");
    closeDatabase();

    // The second project must NEVER see the first project's data.
    process.chdir(repoB);
    const dbB = getDatabase();
    expect(readMarker(dbB)).toBe("data-B");
    closeDatabase();

    // Re-entering repo A still sees its own data.
    process.chdir(repoA);
    const dbA2 = getDatabase();
    expect(readMarker(dbA2)).toBe("data-A");
    closeDatabase();
  });

  test("fresh repo without legacy data uses the shared canonical home database", () => {
    const home = join(tempRoot, "home");
    const repo = join(home, "workspace", "repo");
    const homeNewDb = join(home, ".hasna", "calendar", "calendar.db");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, ".git"), "gitdir: .git\n");
    process.env["HOME"] = home;
    process.chdir(repo);

    const db = getDatabase();

    expect(existsSync(homeNewDb)).toBe(true);
    expect(migrationCount(db)).toBe(1);
  });

  test("scanLegacyData reports the project-scoped target for legacy project data", () => {
    const home = join(tempRoot, "home");
    const project = join(home, "workspace", "project");
    const projectDb = join(project, ".calendar", "calendar.db");
    mkdirSync(project, { recursive: true });
    createMarkerDatabase(projectDb, "project-local");
    process.env["HOME"] = home;
    process.chdir(project);

    const scan = scanLegacyData();

    expect(scan.source).toBe(projectDb);
    expect(scan.target.startsWith(join(home, ".hasna", "calendar", "projects"))).toBe(true);
    expect(scan.target.endsWith("calendar.db")).toBe(true);
    expect(scan.wouldMigrate).toBe(true);
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

    // The pre-existing shared home database is never overwritten...
    expect(readMarkerFromFile(homeNewDb)).toBe("canonical");
    // ...and the legacy project database keeps its own dataset in a
    // project-scoped target: the CLI reads the project's own data.
    expect(readMarker(db)).toBe("project-local");
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
