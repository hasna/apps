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
} from "./projects.js";
import { ProjectNotFoundError } from "../types/index.js";

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
