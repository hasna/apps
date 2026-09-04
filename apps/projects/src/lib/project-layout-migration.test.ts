import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../types/workspace.js";
import { runMigrations } from "../db/schema.js";
import { createWorkspace } from "../db/workspaces.js";
import { doctorWorkspace } from "./workspace-doctor.js";
import {
  inspectLegacyProjectLayout,
  legacyProjectLayoutPath,
  migrateLegacyProjectLayout,
} from "./project-layout-migration.js";

const savedProjectsHome = process.env.HASNA_PROJECTS_HOME;

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function workspace(id: string, primaryPath: string | null): Workspace {
  return {
    id,
    name: id,
    slug: id.replace(/^wks_/, ""),
    kind: "project",
    status: "active",
    primary_path: primaryPath,
    tags: [],
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Workspace;
}

describe("legacy singular project layout migration", () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "projects-layout-migration-"));
    home = join(root, "projects-home");
    mkdirSync(home, { recursive: true });
    process.env.HASNA_PROJECTS_HOME = home;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(() => {
    if (savedProjectsHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
    else process.env.HASNA_PROJECTS_HOME = savedProjectsHome;
  });

  test("reports absent when a workspace has no singular directory", () => {
    const projectDir = join(root, "clean-project");
    mkdirSync(projectDir, { recursive: true });
    const project = workspace("wks_clean", projectDir);

    expect(legacyProjectLayoutPath(project)).toBe(join(projectDir, ".hasna", "project"));
    expect(inspectLegacyProjectLayout(project).present).toBe(false);
    const migration = migrateLegacyProjectLayout(project, { dryRun: true });
    expect(migration.detected).toBe(false);
    expect(migration.moved).toEqual([]);
  });

  test("doctor flags the singular layout and dry-run fix plans the move", () => {
    const projectDir = join(root, "stray-project");
    const singular = join(projectDir, ".hasna", "project");
    mkdirSync(join(singular, "dashboard"), { recursive: true });
    writeFileSync(join(singular, "dashboard", "render.json"), "{}");
    writeFileSync(join(singular, "snapshots"), "latest");
    mkdirSync(join(projectDir, ".hasna", "goals"), { recursive: true });
    writeFileSync(join(projectDir, ".hasna", "goals", "season.md"), "# goals");
    const db = makeDb();
    const project = workspace("wks_stray", projectDir);
    createWorkspace({ id: project.id, name: "Stray", slug: "stray", kind: "project", primary_path: projectDir }, db);

    try {
      const checks = doctorWorkspace(project, {}, db).checks;
      const layoutCheck = checks.find((check) => check.code === "WORKSPACE_LEGACY_LAYOUT_DIR");
      expect(layoutCheck).toBeDefined();
      expect(layoutCheck?.status).toBe("warn");
      expect(layoutCheck?.fixable).toBe(true);
      expect(layoutCheck?.message).toContain(projectDir);

      const dryRun = doctorWorkspace(project, { fix: true, dryRun: true }, db);
      const dryFix = dryRun.fixes.find((fix) => fix.code === "FIX_WORKSPACE_LAYOUT_MIGRATED");
      expect(dryFix?.dryRun).toBe(true);
      expect(dryFix?.message).toContain("2 legacy layout entries");
      expect(existsSync(singular)).toBe(true);

      const fixed = doctorWorkspace(project, { fix: true }, db);
      const fix = fixed.fixes.find((fix) => fix.code === "FIX_WORKSPACE_LAYOUT_MIGRATED");
      expect(fix?.changed).toBe(true);
      expect(fix?.message).toContain("2 legacy layout entries");
      expect(existsSync(singular)).toBe(false);
      expect(existsSync(join(projectDir, ".hasna", "goals", "season.md"))).toBe(true);
      expect(readFileSync(join(home, "workspaces", project.id, "dashboard", "render.json"), "utf8")).toBe("{}");
      expect(readFileSync(join(home, "workspaces", project.id, "snapshots"), "utf8")).toBe("latest");
      expect(doctorWorkspace(project, {}, db).checks.some((check) => check.code === "WORKSPACE_LAYOUT_OK")).toBe(true);
    } finally {
      db.close();
    }
  });

  test("skips entries whose plural target already exists and leaves stragglers", () => {
    const projectDir = join(root, "mixed-project");
    const singular = join(projectDir, ".hasna", "project");
    mkdirSync(singular, { recursive: true });
    writeFileSync(join(singular, "dashboard.render.json"), "old");
    writeFileSync(join(singular, "snapshots.json"), "old-snapshot");
    const store = join(home, "workspaces", "wks_mixed");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "dashboard.render.json"), "newer");
    const project = workspace("wks_mixed", projectDir);

    const migration = migrateLegacyProjectLayout(project);
    expect(migration.moved).toEqual(["snapshots.json"]);
    expect(migration.skipped).toEqual(["dashboard.render.json"]);
    expect(readFileSync(join(store, "dashboard.render.json"), "utf8")).toBe("newer");
    expect(readFileSync(join(store, "snapshots.json"), "utf8")).toBe("old-snapshot");
    // The skipped entry keeps the singular directory alive so nothing is lost.
    expect(existsSync(singular)).toBe(true);
  });

  test("repeat migration is a no-op once the singular directory is gone", () => {
    const projectDir = join(root, "once-project");
    const singular = join(projectDir, ".hasna", "project");
    mkdirSync(singular, { recursive: true });
    writeFileSync(join(singular, "dashboard.render.json"), "{}");
    const project = workspace("wks_once", projectDir);

    const first = migrateLegacyProjectLayout(project);
    expect(first.moved).toEqual(["dashboard.render.json"]);
    expect(first.removed_singular_dir).toBe(true);
    const second = migrateLegacyProjectLayout(project);
    expect(second.detected).toBe(false);
    expect(second.moved).toEqual([]);
  });
});
