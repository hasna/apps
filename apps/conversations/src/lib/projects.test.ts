import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "./projects";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-proj-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("createProject", () => {
  test("creates project with all fields", () => {
    const p = createProject({
      name: "myproject",
      created_by: "alice",
      description: "Test project",
      path: "/tmp/myproject",
      metadata: { key: "value" },
      tags: ["test", "demo"],
      repository: "https://github.com/test/repo",
      settings: { theme: "dark" },
    });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("myproject");
    expect(p.description).toBe("Test project");
    expect(p.path).toBe("/tmp/myproject");
    expect(p.created_by).toBe("alice");
    expect(p.metadata).toEqual({ key: "value" });
    expect(p.tags).toEqual(["test", "demo"]);
    expect(p.status).toBe("active");
    expect(p.repository).toBe("https://github.com/test/repo");
    expect(p.settings).toEqual({ theme: "dark" });
    expect(p.created_at).toBeTruthy();
  });

  test("creates project with minimal fields", () => {
    const p = createProject({ name: "minimal", created_by: "alice" });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("minimal");
    expect(p.description).toBeNull();
    expect(p.path).toBeNull();
    expect(p.metadata).toBeNull();
    expect(p.tags).toEqual([]);
    expect(p.status).toBe("active");
    expect(p.repository).toBeNull();
    expect(p.settings).toBeNull();
  });

  test("auto-generates UUID id", () => {
    const p = createProject({ name: "test", created_by: "alice" });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("throws on duplicate name", () => {
    createProject({ name: "myproject", created_by: "alice" });
    expect(() => createProject({ name: "myproject", created_by: "bob" })).toThrow();
  });
});

describe("listProjects", () => {
  test("returns empty when no projects", () => {
    expect(listProjects()).toEqual([]);
  });

  test("returns projects with channel_count", () => {
    createProject({ name: "myproject", created_by: "alice" });
    const projects = listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("myproject");
    expect(projects[0].channel_count).toBe(0);
  });

  test("filters by status", () => {
    const p = createProject({ name: "active-proj", created_by: "alice" });
    createProject({ name: "other-proj", created_by: "alice" });
    updateProject(p.id, { status: "archived" });

    const active = listProjects({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("other-proj");

    const archived = listProjects({ status: "archived" });
    expect(archived).toHaveLength(1);
    expect(archived[0].name).toBe("active-proj");
  });

  test("orders alphabetically", () => {
    createProject({ name: "beta", created_by: "alice" });
    createProject({ name: "alpha", created_by: "alice" });
    const projects = listProjects();
    expect(projects[0].name).toBe("alpha");
    expect(projects[1].name).toBe("beta");
  });

  test("applies limit", () => {
    createProject({ name: "alpha", created_by: "alice" });
    createProject({ name: "beta", created_by: "alice" });
    createProject({ name: "gamma", created_by: "alice" });

    const projects = listProjects({ limit: 2 });
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe("alpha");
    expect(projects[1].name).toBe("beta");
  });

  test("applies offset", () => {
    createProject({ name: "alpha", created_by: "alice" });
    createProject({ name: "beta", created_by: "alice" });
    createProject({ name: "gamma", created_by: "alice" });

    const projects = listProjects({ offset: 1 });
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe("beta");
    expect(projects[1].name).toBe("gamma");
  });
});

describe("getProject", () => {
  test("returns null for nonexistent", () => {
    expect(getProject("nonexistent-id")).toBeNull();
  });

  test("returns project details", () => {
    const p = createProject({ name: "myproject", created_by: "alice", description: "Test" });
    const found = getProject(p.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe("myproject");
    expect(found!.description).toBe("Test");
    expect(found!.channel_count).toBe(0);
  });
});

describe("getProjectByName", () => {
  test("finds by name", () => {
    createProject({ name: "myproject", created_by: "alice" });
    const found = getProjectByName("myproject");
    expect(found).toBeTruthy();
    expect(found!.name).toBe("myproject");
  });

  test("returns null for nonexistent", () => {
    expect(getProjectByName("nonexistent")).toBeNull();
  });
});

describe("updateProject", () => {
  test("updates name", () => {
    const p = createProject({ name: "old-name", created_by: "alice" });
    const updated = updateProject(p.id, { name: "new-name" });
    expect(updated.name).toBe("new-name");
  });

  test("updates status to archived", () => {
    const p = createProject({ name: "myproject", created_by: "alice" });
    const updated = updateProject(p.id, { status: "archived" });
    expect(updated.status).toBe("archived");
  });

  test("updates metadata", () => {
    const p = createProject({ name: "myproject", created_by: "alice" });
    const updated = updateProject(p.id, { metadata: { newKey: "newValue" } });
    expect(updated.metadata).toEqual({ newKey: "newValue" });
  });

  test("throws if project not found", () => {
    expect(() => updateProject("nonexistent", { name: "test" })).toThrow("Project not found");
  });

  test("returns unchanged project when no updates", () => {
    const p = createProject({ name: "myproject", created_by: "alice" });
    const updated = updateProject(p.id, {});
    expect(updated.name).toBe("myproject");
  });
});

describe("deleteProject", () => {
  test("deletes project with no channels", () => {
    const p = createProject({ name: "myproject", created_by: "alice" });
    const deleted = deleteProject(p.id);
    expect(deleted).toBe(true);
    expect(getProject(p.id)).toBeNull();
  });

  test("returns false for nonexistent project", () => {
    expect(deleteProject("nonexistent")).toBe(false);
  });
});
