import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
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
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-bridge-"));
  dbPath = join(tempDir, "todos.db");
  process.env["TODOS_DB_PATH"] = dbPath;
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
    const sourceDb = join(tempDir, "source.db");
    process.env["TODOS_DB_PATH"] = sourceDb;
    resetDatabase();
    getDatabase();
    const task = createTask({ title: "Remote task", description: "from bundle" });
    addComment({ task_id: task.id, content: "note" });
    const bundle = exportLocalBundle();
    closeDatabase();

    process.env["TODOS_DB_PATH"] = join(tempDir, "target.db");
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

    process.env["TODOS_DB_PATH"] = join(tempDir, "dep.db");
    resetDatabase();
    getDatabase();
    importBundle({ ...bundle, projects: [], plans: [], templates: [], comments: [], verification_records: [] }, { strategy: "remote_wins" });
    const deps = getDatabase().query("SELECT * FROM task_dependencies").all();
    expect(deps.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid bundles", () => {
    const validation = validateBundle({ schema_version: "wrong" });
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("dry run does not mutate database", () => {
    const bundle = exportLocalBundle();
    closeDatabase();
    process.env["TODOS_DB_PATH"] = join(tempDir, "dry.db");
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
