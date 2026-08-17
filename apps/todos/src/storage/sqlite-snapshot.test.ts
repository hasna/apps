import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject, getProject } from "../db/projects.js";
import { createTask, getTask } from "../db/tasks.js";
import { exportSqliteTodosStorageSnapshot, importSqliteTodosStorageSnapshot } from "./sqlite-snapshot.js";
import type { Project } from "../types/index.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

/**
 * Export everything, then import the snapshot into a fresh database and
 * return the import result. This is the real round-trip: the export emits
 * projects in `ORDER BY name`, and the import must still restore the whole
 * hierarchy even when a child sorts before its parent.
 */
function roundTripImport() {
  const snapshot = exportSqliteTodosStorageSnapshot();
  closeDatabase();
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  return importSqliteTodosStorageSnapshot(snapshot);
}

function expectHierarchyRestored(
  parent: Project,
  child: Project,
  taskId: string,
  taskTitle: string,
  result: { errors: string[] },
) {
  expect(result.errors).toEqual([]);
  const restoredParent = getProject(parent.id);
  expect(restoredParent?.name).toBe(parent.name);
  expect(restoredParent?.parent_id).toBeNull();
  const restoredChild = getProject(child.id);
  expect(restoredChild?.name).toBe(child.name);
  expect(restoredChild?.parent_id).toBe(parent.id);
  expect(getTask(taskId)?.title).toBe(taskTitle);
  expect(getTask(taskId)?.project_id).toBe(child.id);
}

describe("SQLite snapshot round-trip with parent_id", () => {
  test("restores a child that sorts BEFORE its parent, with its task rows", () => {
    const parent = createProject({ name: "Internal Apps", path: "/tmp/roundtrip/internal-apps" });
    const child = createProject({
      name: "Internal App Todos",
      path: "/tmp/roundtrip/internal-app-todos",
      parent_id: parent.id,
    });
    const task = createTask({ title: "child project task", project_id: child.id });

    // The exact ordering that used to break the round-trip: the child sorts
    // before its parent, so a name-ordered export inserts the child first and
    // the FK rejects it. Assert the premise so the regression cannot silently
    // stop testing what it claims to test.
    expect(child.name.localeCompare(parent.name)).toBeLessThan(0);

    const result = roundTripImport();
    expectHierarchyRestored(parent, child, task.id, task.title, result);
  });

  test("control: restores a child that sorts AFTER its parent", () => {
    const parent = createProject({ name: "Alpha", path: "/tmp/roundtrip/alpha" });
    const child = createProject({ name: "Beta Child", path: "/tmp/roundtrip/beta-child", parent_id: parent.id });
    const task = createTask({ title: "beta child task", project_id: child.id });

    expect(child.name.localeCompare(parent.name)).toBeGreaterThan(0);

    const result = roundTripImport();
    expectHierarchyRestored(parent, child, task.id, task.title, result);
  });

  test("imports a child-first projects array regardless of how it was produced", () => {
    const parent = createProject({ name: "Internal Apps", path: "/tmp/roundtrip/internal-apps" });
    const child = createProject({
      name: "Internal App Todos",
      path: "/tmp/roundtrip/internal-app-todos",
      parent_id: parent.id,
    });
    const task = createTask({ title: "child project task", project_id: child.id });

    // Force the exact failure shape: the child row placed before its parent
    // row, as a name-ordered export can produce. The import must reorder,
    // not depend on which producer wrote the file.
    const snapshot = exportSqliteTodosStorageSnapshot();
    const byId = new Map(snapshot.projects.map((project) => [project.id, project]));
    const projects = [
      byId.get(child.id)!,
      byId.get(parent.id)!,
      ...snapshot.projects.filter((project) => project.id !== child.id && project.id !== parent.id),
    ];

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    const result = importSqliteTodosStorageSnapshot({ ...snapshot, projects });
    expect(result.errors).toEqual([]);
    expect(getProject(child.id)?.parent_id).toBe(parent.id);
    expect(getTask(task.id)?.project_id).toBe(child.id);
  });
});
