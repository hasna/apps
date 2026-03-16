import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import {
  createProject,
  getProjectById,
  getProjectBySlug,
  listProjects,
  updateProject,
  deleteProject,
} from "./projects.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

beforeEach(() => {
  closeDatabase();
});

describe("projects", () => {
  test("creates a project with auto-slug", () => {
    const p = createProject({ name: "My Project" });
    expect(p.id).toMatch(/^prj-/);
    expect(p.slug).toBe("my-project");
    expect(p.name).toBe("My Project");
  });

  test("creates project with custom slug", () => {
    const p = createProject({ name: "Test", slug: "custom-slug" });
    expect(p.slug).toBe("custom-slug");
  });

  test("creates project with description and color", () => {
    const p = createProject({ name: "Color", description: "Desc", color: "#ff0000" });
    expect(p.description).toBe("Desc");
    expect(p.color).toBe("#ff0000");
  });

  test("throws DuplicateError on duplicate slug", () => {
    createProject({ name: "Dup", slug: "dup" });
    expect(() => createProject({ name: "Dup2", slug: "dup" })).toThrow(DuplicateError);
  });

  test("gets project by ID", () => {
    const p = createProject({ name: "Get" });
    const found = getProjectById(p.id);
    expect(found.id).toBe(p.id);
  });

  test("throws NotFoundError for missing ID", () => {
    expect(() => getProjectById("prj-notfound")).toThrow(NotFoundError);
  });

  test("gets project by slug", () => {
    const p = createProject({ name: "Slug Test" });
    const found = getProjectBySlug(p.slug);
    expect(found.id).toBe(p.id);
  });

  test("lists projects", () => {
    createProject({ name: "A" });
    createProject({ name: "B" });
    createProject({ name: "C" });
    const list = listProjects();
    expect(list.length).toBeGreaterThanOrEqual(3);
  });

  test("lists empty when no projects", () => {
    const list = listProjects();
    expect(list).toEqual([]);
  });

  test("updates project name", () => {
    const p = createProject({ name: "Original" });
    const updated = updateProject(p.id, { name: "Updated" });
    expect(updated.name).toBe("Updated");
  });

  test("updates project color", () => {
    const p = createProject({ name: "Color Test" });
    const updated = updateProject(p.id, { color: "#00ff00" });
    expect(updated.color).toBe("#00ff00");
  });

  test("throws on update of missing project", () => {
    expect(() => updateProject("prj-missing", { name: "x" })).toThrow(NotFoundError);
  });

  test("deletes project", () => {
    const p = createProject({ name: "Delete Me" });
    deleteProject(p.id);
    expect(() => getProjectById(p.id)).toThrow(NotFoundError);
  });

  test("throws on delete of missing project", () => {
    expect(() => deleteProject("prj-missing")).toThrow(NotFoundError);
  });
});
