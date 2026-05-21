import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask, getTaskDependencies, listTasks } from "../db/tasks.js";
import { runTodosDoctor } from "./doctor.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `todos-doctor-${crypto.randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  dbPath = join(tempDir, "todos.db");
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("local doctor diagnostics and repair", () => {
  test("reports a clean local database with migration and permission details", () => {
    const result = runTodosDoctor({ db: getDatabase(), dbPath, apply: false });

    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.summary.errors).toBe(0);
    expect(result.checks.some((check) => check.type === "migration_level")).toBe(true);
    expect(result.checks.some((check) => check.type === "database_permissions")).toBe(true);
  });

  test("preserves task-state diagnostics for stale and recurring tasks", () => {
    const db = getDatabase();
    const stale = createTask({ title: "Stale task" }, db);
    const invalidRecurring = createTask({ title: "Invalid recurring task" }, db);
    const overdueRecurring = createTask({ title: "Overdue recurring task" }, db);
    const oldTimestamp = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    db.run("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?", [oldTimestamp, stale.id]);
    db.run("UPDATE tasks SET recurrence_rule = 'every someday' WHERE id = ?", [invalidRecurring.id]);
    db.run("UPDATE tasks SET recurrence_rule = 'every day', due_at = ? WHERE id = ?", [yesterday, overdueRecurring.id]);

    const result = runTodosDoctor({ db, dbPath, apply: false });
    const checks = result.checks.map((check) => check.type);

    expect(result.ok).toBe(false);
    expect(checks).toContain("stale_tasks");
    expect(checks).toContain("invalid_recurrence");
    expect(checks).toContain("overdue_recurring");
    expect(result.checks.find((check) => check.type === "stale_tasks")?.repairable).toBe(false);
  });

  test("dry-runs repairable integrity issues without mutating the database", () => {
    const db = getDatabase();
    const parent = createTask({ title: "Parent" }, db);
    const child = createTask({ title: "Child" }, db);
    const dependency = createTask({ title: "Dependency" }, db);
    db.run("PRAGMA foreign_keys = OFF");
    db.run("UPDATE tasks SET parent_id = 'missing-parent', metadata = '{bad json' WHERE id = ?", [child.id]);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [child.id, dependency.id]);
    db.run("DELETE FROM tasks WHERE id = ?", [dependency.id]);
    db.run("PRAGMA foreign_keys = ON");

    const result = runTodosDoctor({ db, dbPath, apply: false });

    expect(result.ok).toBe(false);
    expect(result.dry_run).toBe(true);
    expect(result.checks.map((check) => check.type)).toContain("orphaned_task_parents");
    expect(result.checks.map((check) => check.type)).toContain("orphaned_task_dependencies");
    expect(result.checks.map((check) => check.type)).toContain("corrupt_json_metadata");
    expect(result.repairs.filter((repair) => repair.applied)).toHaveLength(0);
    const childRow = db.query("SELECT parent_id FROM tasks WHERE id = ?").get(child.id) as { parent_id: string };
    expect(childRow.parent_id).toBe("missing-parent");
    expect(getTaskDependencies(child.id, db)).toHaveLength(1);
    expect(parent.title).toBe("Parent");
  });

  test("applies safe repairs only with explicit apply mode and creates a backup first", () => {
    const db = getDatabase();
    const child = createTask({ title: "Child" }, db);
    const dependency = createTask({ title: "Dependency" }, db);
    db.run("PRAGMA foreign_keys = OFF");
    db.run("UPDATE tasks SET parent_id = 'missing-parent', metadata = '{bad json' WHERE id = ?", [child.id]);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [child.id, dependency.id]);
    db.run("DELETE FROM tasks WHERE id = ?", [dependency.id]);
    db.run("PRAGMA foreign_keys = ON");

    const result = runTodosDoctor({ db, dbPath, apply: true });

    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.backup?.path).toBeDefined();
    expect(existsSync(result.backup!.path)).toBe(true);
    expect(listTasks({}, db).find((task) => task.id === child.id)?.parent_id).toBeNull();
    expect(getTaskDependencies(child.id, db)).toHaveLength(0);
    const metadata = db.query("SELECT metadata FROM tasks WHERE id = ?").get(child.id) as { metadata: string };
    expect(metadata.metadata).toBe("{}");
    expect(result.repairs.some((repair) => repair.applied && repair.type === "backup_created")).toBe(true);
  });

  test("detects missing project roots and unsafe database permissions without deleting data", () => {
    const db = getDatabase();
    createProject({ name: "Missing root", path: join(tempDir, "missing-project") }, db);
    chmodSync(dbPath, 0o666);

    const result = runTodosDoctor({ db, dbPath, apply: false });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.type)).toContain("missing_project_roots");
    expect(result.checks.map((check) => check.type)).toContain("database_permissions");
    expect(result.checks.find((check) => check.type === "database_permissions")?.severity).toBe("warn");
    expect((statSync(dbPath).mode & 0o777)).toBe(0o666);
  });

  test("repairs unsafe database permissions in apply mode", () => {
    chmodSync(dbPath, 0o666);

    const result = runTodosDoctor({ db: getDatabase(), dbPath, apply: true });

    expect(result.ok).toBe(true);
    expect((statSync(dbPath).mode & 0o077)).toBe(0);
    expect(result.repairs.some((repair) => repair.type === "database_permissions" && repair.applied)).toBe(true);
  });

  test("repairs missing core schema tables through the migration safety net", () => {
    const db = getDatabase();
    db.run("DROP TABLE task_dependencies");

    const result = runTodosDoctor({ db, dbPath, apply: true });

    expect(result.ok).toBe(true);
    expect(result.repairs.map((repair) => repair.type)).toContain("schema_repair");
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='task_dependencies'").get()).toBeTruthy();
  });
});
