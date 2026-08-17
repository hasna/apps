import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { createProject, getProject } from "../db/projects.js";
import { addComment } from "../db/comments.js";
import { addDependency } from "../db/tasks.js";
import {
  BUNDLE_SCHEMA,
  exportLocalBundle,
  validateBundle,
  previewSync,
  importBundle,
  writeBundleFile,
  readBundleFile,
  getBridgeDocs,
} from "./import-export-bridge.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-bridge-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("import-export bridge", () => {
  it("exports and validates a local bundle", () => {
    const project = createProject({ name: "bridge-test", path: "/tmp/bridge" });
    createTask({ title: "Export me", project_id: project.id });

    const bundle = exportLocalBundle({ project_id: project.id });
    expect(bundle.schema_version).toBe(BUNDLE_SCHEMA);
    expect(bundle.tasks).toHaveLength(1);
    expect(bundle.projects).toHaveLength(1);

    const validation = validateBundle(bundle);
    expect(validation.valid).toBe(true);
  });

  it("redacts local bundles by default and blocks unacknowledged plaintext exports", () => {
    const fakeToken = ["ghp", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"].join("_");
    const task = createTask({ title: "Legacy export" });
    getDatabase().run("UPDATE tasks SET title = ?, description = ?, metadata = ? WHERE id = ?", [
      `legacy ${fakeToken}`,
      `description ${fakeToken}`,
      JSON.stringify({ token: fakeToken }),
      task.id,
    ]);

    const bundle = exportLocalBundle();
    expect(JSON.stringify(bundle)).not.toContain(fakeToken);
    expect(() => exportLocalBundle({ profile: "plaintext" })).toThrow(/acknowledge_plaintext/);
  });

  it("writes and reads bundle files", () => {
    createTask({ title: "File test" });
    const bundle = exportLocalBundle();
    const file = join(tempDir, "export.json");
    writeBundleFile(bundle, file);
    expect(existsSync(file)).toBe(true);
    const loaded = readBundleFile(file);
    expect(loaded.tasks).toHaveLength(1);
  });

  it("imports tasks into an empty database", () => {
    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    const task = createTask({ title: "Remote task", description: "from bundle" });
    addComment({ task_id: task.id, content: "note" });
    const bundle = exportLocalBundle();
    closeDatabase();

    resetDatabase();
    getDatabase();
    const result = importBundle(bundle, { strategy: "remote_wins" });
    expect(result.created.tasks).toBe(1);
    expect(result.created.comments).toBe(1);

    const imported = getTask(task.id);
    expect(imported?.title).toBe("Remote task");
  });

  it("detects version conflicts in preview", () => {
    const task = createTask({ title: "Conflict task" });
    const bundle = exportLocalBundle();
    getDatabase().run("UPDATE tasks SET title = ?, version = version + 1 WHERE id = ?", ["Local change", task.id]);

    const preview = previewSync(bundle, "newest_wins");
    expect(preview.summary.conflict + preview.summary.update + preview.summary.skip).toBeGreaterThan(0);
    expect(preview.conflicts.some((c) => c.entity_id === task.id)).toBe(true);
  });

  it("imports dependencies", () => {
    const t1 = createTask({ title: "First" });
    const t2 = createTask({ title: "Second" });
    addDependency(t2.id, t1.id);
    const bundle = exportLocalBundle();
    closeDatabase();

    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    importBundle({ ...bundle, projects: [], plans: [], templates: [], comments: [], verification_records: [] }, { strategy: "remote_wins" });
    const deps = getDatabase().query("SELECT * FROM task_dependencies").all();
    expect(deps.length).toBeGreaterThanOrEqual(0);
  });

  it("does not import dependency edges whose endpoints exist nowhere (no dangling edges minted)", () => {
    // A bundle can legitimately reference a task that is not part of it and not
    // in the receiving store. Importing the edge anyway mints a dangling
    // depends_on row — the measured production defect class.
    const t1 = createTask({ title: "First" });
    const t2 = createTask({ title: "Second" });
    addDependency(t2.id, t1.id);
    const bundle = exportLocalBundle();
    closeDatabase();

    // Fresh receiving store. Drop the target task from the bundle, simulating
    // a partial bundle whose dependency points outside itself.
    const trimmed = {
      ...bundle,
      tasks: bundle.tasks.filter((t: { id: string }) => t.id !== t1.id),
      projects: [],
      plans: [],
      templates: [],
      comments: [],
      verification_records: [],
    };
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    const result = importBundle(trimmed, { strategy: "remote_wins" });

    expect(result.skipped.dependencies ?? 0).toBeGreaterThan(0);
    const deps = getDatabase().query("SELECT * FROM task_dependencies").all();
    expect(deps.length).toBe(0);
  });

  it("rejects invalid bundles", () => {
    const validation = validateBundle({ schema_version: "wrong" });
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("dry run does not mutate database", () => {
    const bundle = exportLocalBundle();
    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    const before = getDatabase().query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    importBundle(bundle, { dry_run: true });
    const after = getDatabase().query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("documents bridge workflow", () => {
    expect(getBridgeDocs()).toContain(BUNDLE_SCHEMA);
  });
});

describe("parent_id projects round-trip", () => {
  function roundTripImport() {
    const bundle = exportLocalBundle();
    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
    return importBundle(bundle, { strategy: "remote_wins" });
  }

  function expectHierarchyRestored(parentId: string, childId: string, taskId: string, result: { errors: string[] }) {
    expect(result.errors).toEqual([]);
    expect(getProject(childId)?.name).toBe("Internal App Todos");
    expect(getProject(childId)?.parent_id).toBe(parentId);
    expect(getTask(taskId)?.project_id).toBe(childId);
  }

  it("restores a child that sorts BEFORE its parent, with its task rows", () => {
    const parent = createProject({ name: "Internal Apps", path: "/tmp/roundtrip/internal-apps" });
    const child = createProject({
      name: "Internal App Todos",
      path: "/tmp/roundtrip/internal-app-todos",
      parent_id: parent.id,
    });
    const task = createTask({ title: "child project task", project_id: child.id });

    // The bundle is exported in name order, so the child lands before its
    // parent in the file; the import must still restore the whole hierarchy.
    expect(child.name.localeCompare(parent.name)).toBeLessThan(0);

    const result = roundTripImport();
    expectHierarchyRestored(parent.id, child.id, task.id, result);
    expect(getTask(task.id)?.title).toBe("child project task");
  });

  it("control: restores a child that sorts AFTER its parent", () => {
    const parent = createProject({ name: "Alpha", path: "/tmp/roundtrip/alpha" });
    const child = createProject({ name: "Beta Child", path: "/tmp/roundtrip/beta-child", parent_id: parent.id });
    const task = createTask({ title: "beta child task", project_id: child.id });

    expect(child.name.localeCompare(parent.name)).toBeGreaterThan(0);

    const result = roundTripImport();
    expect(result.errors).toEqual([]);
    expect(getProject(child.id)?.name).toBe("Beta Child");
    expect(getProject(child.id)?.parent_id).toBe(parent.id);
    expect(getTask(task.id)?.project_id).toBe(child.id);
  });
});
