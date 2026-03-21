import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDb, getCurrentTestDb } from "./test-helpers.js";
import { createProject, getProject, getProjectByPath, listProjects, deleteProject } from "./projects.js";

describe("projects", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });

  afterEach(() => {
    cleanup();
  });

  test("createProject returns a project with generated id", () => {
    const project = createProject("test-project", "/tmp/test");
    expect(project.id).toBeDefined();
    expect(project.id.length).toBeGreaterThan(0);
    expect(project.name).toBe("test-project");
    expect(project.path).toBe("/tmp/test");
    expect(project.created_at).toBeDefined();
    expect(project.updated_at).toBeDefined();
  });

  test("getProject retrieves a project by id", () => {
    const created = createProject("my-project", "/home/user/repo");
    const fetched = getProject(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("my-project");
    expect(fetched!.path).toBe("/home/user/repo");
  });

  test("getProject returns null for unknown id", () => {
    const result = getProject("nonexistent-id");
    expect(result).toBeNull();
  });

  test("getProjectByPath retrieves a project by path", () => {
    const created = createProject("path-project", "/unique/path");
    const fetched = getProjectByPath("/unique/path");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
  });

  test("getProjectByPath returns null for unknown path", () => {
    const result = getProjectByPath("/no/such/path");
    expect(result).toBeNull();
  });

  test("listProjects returns all projects", () => {
    createProject("project-a", "/path/a");
    createProject("project-b", "/path/b");
    createProject("project-c", "/path/c");

    const projects = listProjects();
    expect(projects.length).toBe(3);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["project-a", "project-b", "project-c"]);
  });

  test("listProjects returns empty array when no projects", () => {
    const projects = listProjects();
    expect(projects).toEqual([]);
  });

  test("deleteProject removes the project", () => {
    const project = createProject("to-delete", "/tmp/delete-me");
    deleteProject(project.id);
    const result = getProject(project.id);
    expect(result).toBeNull();
  });

  test("deleteProject cascades to scans", () => {
    // We need to create a scan referencing the project to test cascading
    const project = createProject("cascade-test", "/tmp/cascade");

    // Insert a scan directly via the mocked DB
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO scans (id, project_id, status, scanner_types, findings_count, started_at, created_at)
       VALUES (?, ?, 'pending', '[]', 0, datetime('now'), datetime('now'))`,
    ).run("scan-1", project.id);

    // Verify scan exists
    const scanBefore = db.prepare("SELECT * FROM scans WHERE id = ?").get("scan-1");
    expect(scanBefore).toBeDefined();

    // Delete project — should cascade
    deleteProject(project.id);

    const scanAfter = db.prepare("SELECT * FROM scans WHERE id = ?").get("scan-1");
    expect(scanAfter).toBeNull();
  });

  test("duplicate paths are allowed (no unique constraint on path)", () => {
    const p1 = createProject("project-1", "/same/path");
    const p2 = createProject("project-2", "/same/path");
    expect(p1.id).not.toBe(p2.id);
    const projects = listProjects();
    expect(projects.length).toBe(2);
  });
});
