import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { addProjectSource, removeProjectSource, listProjectSources, getProjectWithSources } from "./projects.js";

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

describe("addProjectSource", () => {
  it("should add a source to a project", () => {
    const project = createProject({ name: "Test", path: "/tmp/test" }, db);
    const source = addProjectSource({
      project_id: project.id,
      type: "s3",
      name: "Assets bucket",
      uri: "s3://my-bucket/assets/",
      description: "Project media files",
    }, db);
    expect(source.id).toBeDefined();
    expect(source.project_id).toBe(project.id);
    expect(source.type).toBe("s3");
    expect(source.name).toBe("Assets bucket");
    expect(source.uri).toBe("s3://my-bucket/assets/");
    expect(source.description).toBe("Project media files");
    expect(source.metadata).toEqual({});
  });

  it("should store metadata", () => {
    const project = createProject({ name: "Test", path: "/tmp/meta" }, db);
    const source = addProjectSource({
      project_id: project.id,
      type: "gdrive",
      name: "Drive folder",
      uri: "https://drive.google.com/drive/folders/abc123",
      metadata: { shared: true, region: "us" },
    }, db);
    expect(source.metadata).toEqual({ shared: true, region: "us" });
  });
});

describe("listProjectSources", () => {
  it("should list sources for a project", () => {
    const p1 = createProject({ name: "P1", path: "/tmp/p1" }, db);
    const p2 = createProject({ name: "P2", path: "/tmp/p2" }, db);
    addProjectSource({ project_id: p1.id, type: "s3", name: "Bucket A", uri: "s3://a/" }, db);
    addProjectSource({ project_id: p1.id, type: "local", name: "Docs", uri: "/docs" }, db);
    addProjectSource({ project_id: p2.id, type: "github", name: "Repo", uri: "https://github.com/org/repo" }, db);

    const p1Sources = listProjectSources(p1.id, db);
    expect(p1Sources.length).toBe(2);

    const p2Sources = listProjectSources(p2.id, db);
    expect(p2Sources.length).toBe(1);
    expect(p2Sources[0]!.type).toBe("github");
  });

  it("should return empty array for project with no sources", () => {
    const p = createProject({ name: "Empty", path: "/tmp/empty" }, db);
    expect(listProjectSources(p.id, db)).toEqual([]);
  });
});

describe("removeProjectSource", () => {
  it("should remove a source by id", () => {
    const p = createProject({ name: "P", path: "/tmp/rm" }, db);
    const s = addProjectSource({ project_id: p.id, type: "s3", name: "A", uri: "s3://x/" }, db);
    expect(listProjectSources(p.id, db).length).toBe(1);
    const removed = removeProjectSource(s.id, db);
    expect(removed).toBe(true);
    expect(listProjectSources(p.id, db).length).toBe(0);
  });

  it("should return false for nonexistent source", () => {
    expect(removeProjectSource("nonexistent-id", db)).toBe(false);
  });
});

describe("getProjectWithSources", () => {
  it("should include sources in project", () => {
    const p = createProject({ name: "Full", path: "/tmp/full" }, db);
    addProjectSource({ project_id: p.id, type: "notion", name: "Specs", uri: "https://notion.so/abc" }, db);
    const project = getProjectWithSources(p.id, db);
    expect(project).not.toBeNull();
    expect(project!.sources).toHaveLength(1);
    expect(project!.sources![0]!.type).toBe("notion");
  });

  it("should cascade delete sources when project is deleted", () => {
    const p = createProject({ name: "Del", path: "/tmp/del" }, db);
    addProjectSource({ project_id: p.id, type: "s3", name: "Bucket", uri: "s3://del/" }, db);
    db.run("DELETE FROM projects WHERE id = ?", [p.id]);
    expect(listProjectSources(p.id, db).length).toBe(0);
  });
});
