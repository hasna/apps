import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
  renameProject,
} from "./projects.js";
import { createTaskList } from "./task-lists.js";
import { ProjectNotFoundError } from "../types/index.js";
import { runMigrations } from "./schema.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createProject", () => {
  it("should create a project", () => {
    const project = createProject(
      { name: "Test", path: "/tmp/test" },
      db,
    );
    expect(project.name).toBe("Test");
    expect(project.path).toBe("/tmp/test");
    expect(project.id).toBeTruthy();
  });

  it("should create a project with description", () => {
    const project = createProject(
      { name: "Test", path: "/tmp/test", description: "A test project" },
      db,
    );
    expect(project.description).toBe("A test project");
  });
});

describe("legacy-safe canonical slug enforcement", () => {
  it("keeps legacy duplicates readable while DB triggers reject new raw duplicates", () => {
    for (const trigger of [
      "claim_project_canonical_slug_insert",
      "claim_project_canonical_slug_update",
      "release_project_canonical_slug_delete",
      "claim_task_list_canonical_slug_insert",
      "claim_task_list_canonical_slug_update",
      "release_task_list_canonical_slug_delete",
    ]) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);

    const timestamp = "2026-01-01T00:00:00.000Z";
    for (const id of ["legacy-project-a", "legacy-project-b"]) {
      db.run(
        "INSERT INTO projects(id, name, path, task_list_id, task_prefix, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, id, `/tmp/${id}`, "legacy-duplicate", id.slice(-3).toUpperCase(), timestamp, timestamp],
      );
    }
    for (const id of ["legacy-list-a", "legacy-list-b"]) {
      db.run(
        "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)",
        [id, "legacy-list-duplicate", id, timestamp, timestamp],
      );
    }

    runMigrations(db);
    expect(db.query("SELECT id FROM projects WHERE task_list_id = ?").all("legacy-duplicate")).toHaveLength(2);
    expect(db.query("SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ?").all("legacy-list-duplicate")).toHaveLength(2);
    expect(db.query("SELECT * FROM canonical_slug_claims").all()).toEqual([]);
    expect(() => createProject({ name: "Other", path: "/tmp/other", task_list_id: "legacy-duplicate" }, db))
      .toThrow("already exists");

    db.run(
      "INSERT INTO projects(id, name, path, task_list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["fresh-a", "Fresh A", "/tmp/fresh-a", "fresh", timestamp, timestamp],
    );
    expect(() => db.run(
      "INSERT INTO projects(id, name, path, task_list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["fresh-b", "Fresh B", "/tmp/fresh-b", "fresh", timestamp, timestamp],
    )).toThrow("PROJECT_SLUG_CONFLICT");

    db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)",
      ["fresh-list-a", "fresh-list", "Fresh List A", timestamp, timestamp],
    );
    expect(() => db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)",
      ["fresh-list-b", "fresh-list", "Fresh List B", timestamp, timestamp],
    )).toThrow("TASK_LIST_SLUG_CONFLICT");

    db.run("UPDATE projects SET task_list_id = NULL WHERE id = ?", ["fresh-a"]);
    db.run(
      "INSERT INTO projects(id, name, path, task_list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["fresh-c", "Fresh C", "/tmp/fresh-c", "fresh", timestamp, timestamp],
    );
    db.run("UPDATE task_lists SET slug = '' WHERE id = ?", ["fresh-list-a"]);
    db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)",
      ["fresh-list-c", "fresh-list", "Fresh List C", timestamp, timestamp],
    );

    for (const id of ["scope-p1", "scope-p2", "standalone:"]) {
      db.run(
        "INSERT INTO projects(id, name, path, task_list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, id, `/tmp/${id}`, `project-${id}`, timestamp, timestamp],
      );
    }
    db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["scope-list-a", "scope-p1", "scoped", "Scope A", timestamp, timestamp],
    );
    db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["scope-list-b", "scope-p2", "scoped", "Scope B", timestamp, timestamp],
    );
    expect(() => db.run("UPDATE task_lists SET project_id = ? WHERE id = ?", ["scope-p2", "scope-list-a"]))
      .toThrow("TASK_LIST_SLUG_CONFLICT");
    expect(db.query("SELECT project_id FROM task_lists WHERE id = ?").get("scope-list-a"))
      .toEqual({ project_id: "scope-p1" });

    db.run(
      "INSERT INTO task_lists(id, project_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["sentinel-list", "standalone:", "fresh-list", "Sentinel", timestamp, timestamp],
    );
    expect(db.query("SELECT id FROM task_lists WHERE slug = ? ORDER BY id").all("fresh-list")).toHaveLength(2);
    expect(() => db.run(
      "INSERT INTO canonical_slug_claims(kind, scope_key, slug, object_id) VALUES ('project', 'global', 'fresh', 'racer')",
    )).toThrow("UNIQUE constraint failed");
  });
});

describe("getProject", () => {
  it("should return null for non-existent project", () => {
    expect(getProject("non-existent", db)).toBeNull();
  });

  it("should get by id", () => {
    const created = createProject({ name: "Test", path: "/tmp/test" }, db);
    const project = getProject(created.id, db);
    expect(project).not.toBeNull();
    expect(project!.name).toBe("Test");
  });
});

describe("getProjectByPath", () => {
  it("should get by path", () => {
    createProject({ name: "Test", path: "/tmp/test" }, db);
    const project = getProjectByPath("/tmp/test", db);
    expect(project).not.toBeNull();
    expect(project!.name).toBe("Test");
  });

  it("should return null for non-existent path", () => {
    expect(getProjectByPath("/non/existent", db)).toBeNull();
  });
});

describe("listProjects", () => {
  it("should list all projects", () => {
    createProject({ name: "A", path: "/tmp/a" }, db);
    createProject({ name: "B", path: "/tmp/b" }, db);
    const projects = listProjects(db);
    expect(projects).toHaveLength(2);
  });

  it("should order by name", () => {
    createProject({ name: "Zebra", path: "/tmp/z" }, db);
    createProject({ name: "Alpha", path: "/tmp/a" }, db);
    const projects = listProjects(db);
    expect(projects[0]!.name).toBe("Alpha");
    expect(projects[1]!.name).toBe("Zebra");
  });
});

describe("updateProject", () => {
  it("should update name", () => {
    const project = createProject({ name: "Old", path: "/tmp/test" }, db);
    const updated = updateProject(project.id, { name: "New" }, db);
    expect(updated.name).toBe("New");
  });

  it("should throw ProjectNotFoundError for non-existent", () => {
    expect(() => updateProject("non-existent", { name: "Test" }, db)).toThrow(
      ProjectNotFoundError,
    );
  });
});

describe("renameProject", () => {
  it("normalizes consistently and keeps an identical retry idempotent", async () => {
    const project = createProject({ name: "Emails", path: "/tmp/emails", task_list_id: "emails" }, db);
    createTaskList({ name: "Emails", slug: "emails", project_id: project.id }, db);

    const first = renameProject(project.id, { new_slug: "Emails Next", name: "Emails Next" }, db);
    await Bun.sleep(2);
    const retry = renameProject(project.id, { new_slug: "emails-next", name: "Emails Next" }, db);

    expect(first).toMatchObject({ project: { task_list_id: "emails-next" }, task_lists_updated: 1 });
    expect(retry).toMatchObject({
      project: { task_list_id: "emails-next", updated_at: first.project.updated_at },
      task_lists_updated: 0,
    });
    expect(() => renameProject(project.id, { new_slug: "---" }, db)).toThrow("non-empty kebab-case");
  });

  it("rolls back the project when the task-list cascade fails", () => {
    const project = createProject({ name: "Emails", path: "/tmp/emails", task_list_id: "emails" }, db);
    createTaskList({ name: "Emails", slug: "emails", project_id: project.id }, db);
    db.run(`CREATE TRIGGER reject_task_list_rename BEFORE UPDATE OF slug ON task_lists
      BEGIN SELECT RAISE(ABORT, 'forced cascade failure'); END`);

    expect(() => renameProject(project.id, { new_slug: "emails-next", name: "Emails Next" }, db)).toThrow("forced cascade failure");
    expect(getProject(project.id, db)).toMatchObject({ name: "Emails", task_list_id: "emails" });
    expect(db.query("SELECT slug, name FROM task_lists WHERE project_id = ?").get(project.id)).toEqual({
      slug: "emails",
      name: "Emails",
    });
  });
});

describe("deleteProject", () => {
  it("should delete a project", () => {
    const project = createProject({ name: "Test", path: "/tmp/test" }, db);
    expect(deleteProject(project.id, db)).toBe(true);
    expect(getProject(project.id, db)).toBeNull();
  });

  it("should return false for non-existent", () => {
    expect(deleteProject("non-existent", db)).toBe(false);
  });
});

describe("ensureProject", () => {
  it("should create if not exists", () => {
    const project = ensureProject("Test", "/tmp/test", db);
    expect(project.name).toBe("Test");
  });

  it("should return existing if same path", () => {
    const first = ensureProject("Test", "/tmp/test", db);
    const second = ensureProject("Test 2", "/tmp/test", db);
    expect(first.id).toBe(second.id);
    expect(second.name).toBe("Test"); // Name shouldn't change
  });
});
