import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan, updatePlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import {
  PLAN_MARKDOWN_SCHEMA,
  buildPlanArtifactSnapshot,
  inspectPlanArtifact,
  readPlanArtifact,
  resolvePlanArtifactPaths,
  renderPlanArtifactMarkdown,
  writePlanArtifact,
} from "./plan-artifacts.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-plan-artifacts-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("plan Markdown artifacts", () => {
  test("native storage docs describe slugged plan artifact schema", () => {
    const docs = readFileSync(new URL("../../docs/native-storage.md", import.meta.url), "utf8");

    expect(docs).toContain("<plan-slug>--<id8>.md");
    expect(docs).toContain('plan_slug: "launch-plan"');
    expect(docs).toContain("legacy UUID path");
    expect(docs).toContain("todos plans --artifact <id-or-slug> --json");
  });

  test("resolves project-scoped artifact paths by id and slug", () => {
    const db = getDatabase();
    const projectRoot = join(root, "project");
    const project = createProject({ name: "Local Plan Project", path: projectRoot }, db);

    const byId = resolvePlanArtifactPaths({ project_id: project.id, plan_id: "plan-1", plan_slug: "Readable Plan", db });
    expect(byId.directory).toBe(join(projectRoot, ".hasna", "todos", "plans", project.id));
    expect(byId.file_path).toBe(join(projectRoot, ".hasna", "todos", "plans", project.id, "readable-plan--plan-1.md"));

    const legacy = resolvePlanArtifactPaths({ project_id: project.id, plan_id: "plan-1", db });
    expect(legacy.file_path).toBe(join(projectRoot, ".hasna", "todos", "plans", project.id, "plan-1.md"));

    const bySlug = resolvePlanArtifactPaths({ project_ref: "local-plan-project", plan_id: "plan-2", plan_slug: "Plan Two", db });
    expect(bySlug.directory).toBe(join(projectRoot, ".hasna", "todos", "plans", project.id));
    expect(() => resolvePlanArtifactPaths({ project_id: project.id, plan_id: "../escape", db })).toThrow("Invalid plan id");
    expect(() => resolvePlanArtifactPaths({ project_ref: "missing-project", db })).toThrow("Project not found");
  });

  test("writes and reads a Markdown artifact with schema metadata and task references", () => {
    const db = getDatabase();
    const projectRoot = join(root, "repo");
    const project = createProject({ name: "Artifact Repo", path: projectRoot }, db);
    const plan = createPlan({
      name: "Launch Plan",
      description: "Ship the local plan persistence slice.",
      project_id: project.id,
    }, db);
    const task = createTask({
      title: "Write plan artifacts",
      project_id: project.id,
      plan_id: plan.id,
      priority: "critical",
    }, db);

    const written = writePlanArtifact(plan, db)!;
    expect(written.path).toBe(join(projectRoot, ".hasna", "todos", "plans", project.id, `${plan.slug}--${plan.id.slice(0, 8)}.md`));
    expect(existsSync(written.path)).toBe(true);

    const markdown = readFileSync(written.path, "utf8");
    expect(markdown).toContain(`schema: "${PLAN_MARKDOWN_SCHEMA}"`);
    expect(markdown).toContain(`plan_id: "${plan.id}"`);
    expect(markdown).toContain(`plan_slug: "${plan.slug}"`);
    expect(markdown).toContain("# Launch Plan");
    expect(markdown).toContain("Ship the local plan persistence slice.");
    expect(markdown).toContain(`task_id=${task.id} status=pending priority=critical`);

    const read = readPlanArtifact(plan, db)!;
    expect(read.path).toBe(written.path);
    expect(read.metadata).toMatchObject({
      schema: PLAN_MARKDOWN_SCHEMA,
      plan_id: plan.id,
      plan_slug: plan.slug,
      project_id: project.id,
      stable_id: plan.id,
      name: "Launch Plan",
      status: "active",
    });
    expect(read.task_references).toEqual([
      {
        task_id: task.id,
        title: "Write plan artifacts",
        status: "pending",
        priority: "critical",
      },
    ]);
  });

  test("rewrites the stable artifact file when plan status changes", () => {
    const db = getDatabase();
    const projectRoot = join(root, "repo");
    const project = createProject({ name: "Update Repo", path: projectRoot }, db);
    const plan = createPlan({ name: "Update Plan", project_id: project.id }, db);
    const first = writePlanArtifact(plan, db)!;

    const completed = updatePlan(plan.id, { status: "completed" }, db);
    const second = writePlanArtifact(completed, db)!;

    expect(second.path).toBe(first.path);
    const read = readPlanArtifact(completed, db)!;
    expect(read.metadata.status).toBe("completed");
    expect(read.markdown).toContain('status: "completed"');
  });

  test("reads legacy UUID artifacts and migrates future writes to slugged filenames", () => {
    const db = getDatabase();
    const projectRoot = join(root, "repo");
    const project = createProject({ name: "Legacy Repo", path: projectRoot }, db);
    const plan = createPlan({ name: "Legacy Plan", project_id: project.id }, db);
    const legacy = resolvePlanArtifactPaths({ project_id: project.id, plan_id: plan.id, db });
    const primary = join(projectRoot, ".hasna", "todos", "plans", project.id, `${plan.slug}--${plan.id.slice(0, 8)}.md`);
    mkdirSync(legacy.directory, { recursive: true });
    const legacyMarkdown = renderPlanArtifactMarkdown(buildPlanArtifactSnapshot(plan, []))
      .replace(`plan_slug: "${plan.slug}"\n`, "");
    writeFileSync(legacy.file_path, legacyMarkdown, "utf8");

    const readLegacy = readPlanArtifact(plan, db)!;
    expect(readLegacy.path).toBe(legacy.file_path);
    const legacyInspection = inspectPlanArtifact(plan, db)!;
    expect(legacyInspection.path).toBe(legacy.file_path);
    expect(legacyInspection.exists).toBe(true);
    expect(legacyInspection.conflicts).toEqual([]);

    const written = writePlanArtifact(plan, db)!;
    expect(written.path).toBe(primary);
    expect(existsSync(primary)).toBe(true);
    expect(readPlanArtifact(plan, db)!.path).toBe(primary);
  });

  test("reports deterministic conflicts between SQLite plan state and Markdown artifacts", () => {
    const db = getDatabase();
    const projectRoot = join(root, "repo");
    const project = createProject({ name: "Conflict Repo", path: projectRoot }, db);
    const plan = createPlan({ name: "Database Name", project_id: project.id }, db);
    const written = writePlanArtifact(plan, db)!;

    const markdown = readFileSync(written.path, "utf8")
      .replace('name: "Database Name"', 'name: "Artifact Name"')
      .replace('status: "active"', 'status: "completed"');
    writeFileSync(written.path, markdown, "utf8");

    const inspection = inspectPlanArtifact(plan, db)!;
    expect(inspection.exists).toBe(true);
    expect(inspection.parse_error).toBeNull();
    expect(inspection.conflicts).toContainEqual({
      field: "name",
      database: "Database Name",
      artifact: "Artifact Name",
    });
    expect(inspection.conflicts).toContainEqual({
      field: "status",
      database: "active",
      artifact: "completed",
    });
  });
});
