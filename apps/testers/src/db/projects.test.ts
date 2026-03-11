process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createProject, getProject, getProjectByPath, listProjects, ensureProject } from "./projects.js";

describe("projects", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createProject", () => {
    test("creates a project with all fields", () => {
      const project = createProject({
        name: "my-app",
        path: "/home/user/my-app",
        description: "A test application",
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("my-app");
      expect(project.path).toBe("/home/user/my-app");
      expect(project.description).toBe("A test application");
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    test("creates a project with minimal fields", () => {
      const project = createProject({ name: "minimal" });

      expect(project.name).toBe("minimal");
      expect(project.path).toBeNull();
      expect(project.description).toBeNull();
    });

    test("creates projects with unique names", () => {
      createProject({ name: "project-a" });
      expect(() => {
        createProject({ name: "project-a" });
      }).toThrow();
    });
  });

  describe("getProject", () => {
    test("gets a project by ID", () => {
      const created = createProject({ name: "test-proj" });
      const found = getProject(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("test-proj");
    });

    test("returns null for non-existent project", () => {
      const found = getProject("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("getProjectByPath", () => {
    test("gets a project by path", () => {
      const created = createProject({ name: "path-proj", path: "/home/user/proj" });
      const found = getProjectByPath("/home/user/proj");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent path", () => {
      const found = getProjectByPath("/nonexistent/path");
      expect(found).toBeNull();
    });
  });

  describe("listProjects", () => {
    test("lists all projects", () => {
      createProject({ name: "proj-1" });
      createProject({ name: "proj-2" });
      createProject({ name: "proj-3" });

      const projects = listProjects();
      expect(projects.length).toBe(3);
    });

    test("returns empty array when no projects exist", () => {
      const projects = listProjects();
      expect(projects).toEqual([]);
    });

    test("returns all created projects", () => {
      createProject({ name: "first" });
      createProject({ name: "second" });
      createProject({ name: "third" });

      const projects = listProjects();
      const names = projects.map((p) => p.name).sort();
      expect(names).toEqual(["first", "second", "third"]);
    });
  });

  describe("ensureProject", () => {
    test("creates a new project when none exists", () => {
      const project = ensureProject("new-proj", "/home/user/new-proj");
      expect(project.id).toBeDefined();
      expect(project.name).toBe("new-proj");
      expect(project.path).toBe("/home/user/new-proj");
    });

    test("returns existing project when path matches", () => {
      const created = createProject({ name: "existing", path: "/home/user/existing" });
      const ensured = ensureProject("different-name", "/home/user/existing");

      expect(ensured.id).toBe(created.id);
      expect(ensured.name).toBe("existing");
    });

    test("returns existing project when name matches", () => {
      const created = createProject({ name: "by-name" });
      const ensured = ensureProject("by-name", "/some/other/path");

      expect(ensured.id).toBe(created.id);
    });

    test("prefers path match over name match", () => {
      const pathProj = createProject({ name: "path-match", path: "/home/user/path-match" });
      createProject({ name: "name-match" });

      const ensured = ensureProject("name-match", "/home/user/path-match");
      expect(ensured.id).toBe(pathProj.id);
    });

    test("creates project when neither name nor path match", () => {
      createProject({ name: "other", path: "/other/path" });
      const ensured = ensureProject("brand-new", "/brand/new/path");

      expect(ensured.name).toBe("brand-new");
      expect(ensured.path).toBe("/brand/new/path");
    });
  });
});
