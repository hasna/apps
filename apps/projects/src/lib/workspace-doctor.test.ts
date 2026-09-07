import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import { closeDatabase } from "../db/database.js";
import { doctorWorkspace, doctorWorkspaceWithStore, type WorkspaceDoctorStore } from "./workspace-doctor.js";
import type { Recipe, Root, Workspace } from "../types/workspace.js";

// Regression for hasna/apps#1720 acceptance (f): a HOSTED doctor run must not
// open or create the on-box SQLite registry. Every on-box path is pointed at a
// directory this file never populates; a check that reached getDatabase()
// would create projects.db there and fail the "nothing on disk" assertion.

let scratch: string;
const previous = new Map<string, string | undefined>();

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "projects-doctor-hosted-"));
  for (const [key, value] of [
    ["HASNA_PROJECTS_HOME", join(scratch, "home")],
    ["HASNA_PROJECTS_DB_PATH", join(scratch, "registry", "projects.db")],
    ["HASNA_WORKSPACES_DB_PATH", join(scratch, "registry", "legacy.db")],
  ] as const) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  closeDatabase();
});

afterAll(() => {
  closeDatabase();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

function sqliteFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).filter((name) => /\.db(-wal|-shm|-journal)?$/.test(name));
}

function hostedWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "wks_hosted_doctor_unit",
    slug: "hosted-doctor-unit",
    name: "Hosted Doctor Unit",
    description: null,
    kind: "generic",
    status: "active",
    root_id: "root_hosted_ok",
    recipe_id: "rcp_hosted_missing",
    canonical_machine: null,
    primary_path: null,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: [],
    integrations: {},
    metadata: { migrated_from_project_id: "wks_old_local_row" },
    last_opened_at: null,
    created_at: "2026-08-07 12:00:00.000",
    updated_at: "2026-08-07 12:00:00.000",
    synced_at: null,
    ...overrides,
  } as Workspace;
}

function hostedStore(lookups: string[]): WorkspaceDoctorStore {
  return {
    transport: "http",
    async getRoot(idOrSlug: string): Promise<Root | null> {
      lookups.push(`roots/${idOrSlug}`);
      return idOrSlug === "root_hosted_ok" ? ({ id: idOrSlug, slug: "hosted-root" } as Root) : null;
    },
    async getRecipe(idOrSlug: string): Promise<Recipe | null> {
      lookups.push(`recipes/${idOrSlug}`);
      return null;
    },
  };
}

describe("doctorWorkspaceWithStore on the hosted transport", () => {
  test("resolves root/recipe through the Store and answers the on-box checks as local-only — nothing opened on disk", async () => {
    const lookups: string[] = [];
    const result = await doctorWorkspaceWithStore(hostedStore(lookups), hostedWorkspace());

    const byName = Object.fromEntries(result.checks.map((check) => [check.name, check]));
    expect(byName["root"]).toMatchObject({ code: "WORKSPACE_ROOT_OK", status: "ok", message: "root_hosted_ok" });
    expect(byName["recipe"]).toMatchObject({ code: "WORKSPACE_RECIPE_MISSING", status: "error", message: "rcp_hosted_missing" });
    expect(byName["locations"]).toMatchObject({ code: "WORKSPACE_LOCATIONS_LOCAL_ONLY", status: "warn", fixable: false });
    expect(byName["agent_runs"]).toMatchObject({ code: "WORKSPACE_AGENT_RUNS_LOCAL_ONLY", status: "warn", fixable: false });
    expect(byName["migration"]).toMatchObject({ code: "WORKSPACE_MIGRATION_MAP_LOCAL_ONLY", status: "warn", fixable: false });
    expect(result.ok).toBe(false);
    expect(lookups.sort()).toEqual(["recipes/rcp_hosted_missing", "roots/root_hosted_ok"]);

    // The on-box registry was neither opened nor created.
    expect(sqliteFilesUnder(scratch)).toEqual([]);
  });

  test("skips the registry lookups for a project with no root/recipe, and a non-migrated project is not applicable", async () => {
    const lookups: string[] = [];
    const result = await doctorWorkspaceWithStore(
      hostedStore(lookups),
      hostedWorkspace({ root_id: null, recipe_id: null, metadata: {} }),
    );
    const codes = result.checks.map((check) => check.code);
    expect(codes).toContain("WORKSPACE_ROOT_OK");
    expect(codes).toContain("WORKSPACE_RECIPE_OK");
    expect(codes).toContain("WORKSPACE_MIGRATION_NOT_APPLICABLE");
    expect(lookups).toEqual([]);
    expect(sqliteFilesUnder(scratch)).toEqual([]);
  });

  test("a direct hosted call without resolved references reports them as not checked instead of reading SQLite", () => {
    const result = doctorWorkspace(hostedWorkspace(), { transport: "http" });
    const codes = result.checks.map((check) => check.code);
    expect(codes).toContain("WORKSPACE_ROOT_NOT_CHECKED");
    expect(codes).toContain("WORKSPACE_RECIPE_NOT_CHECKED");
    expect(codes).not.toContain("WORKSPACE_AGENT_RUNS_OK");
    expect(result.checks.find((check) => check.code === "WORKSPACE_ROOT_NOT_CHECKED")).toMatchObject({ status: "warn", fixable: false });
    expect(sqliteFilesUnder(scratch)).toEqual([]);
  });
});

describe("doctorWorkspaceWithStore on the local transport", () => {
  test("keeps answering references and the run ledger from the on-box registry it is handed", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    try {
      const result = doctorWorkspace(hostedWorkspace({ metadata: {} }), { transport: "local" }, db);
      const byName = Object.fromEntries(result.checks.map((check) => [check.name, check]));
      expect(byName["root"]).toMatchObject({ code: "WORKSPACE_ROOT_MISSING", status: "error" });
      expect(byName["recipe"]).toMatchObject({ code: "WORKSPACE_RECIPE_MISSING", status: "error" });
      expect(byName["agent_runs"]).toMatchObject({ code: "WORKSPACE_AGENT_RUNS_OK", status: "ok" });
      expect(byName["locations"]).toMatchObject({ code: "WORKSPACE_LOCATIONS_MISSING", status: "warn" });
    } finally {
      db.close();
    }
    // The in-memory registry answered everything; the default path stayed untouched.
    expect(sqliteFilesUnder(scratch)).toEqual([]);
  });
});
