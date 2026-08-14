import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { createCollection, getCollectionById, listCollections, updateCollection, deleteCollection } from "./collections.js";
import { createProject } from "./projects.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

describe("collections", () => {
  test("creates collection with auto-slug", () => {
    const c = createCollection({ name: "My Collection" });
    expect(c.id).toMatch(/^col-/);
    expect(c.slug).toBe("my-collection");
  });

  test("throws DuplicateError on duplicate slug", () => {
    createCollection({ name: "Dup", slug: "dup-col" });
    expect(() => createCollection({ name: "Dup2", slug: "dup-col" })).toThrow(DuplicateError);
  });

  test("links to project", () => {
    const p = createProject({ name: "P" });
    const c = createCollection({ name: "C", project_id: p.id });
    expect(c.project_id).toBe(p.id);
  });

  test("gets collection by ID", () => {
    const c = createCollection({ name: "Get Col" });
    expect(getCollectionById(c.id).id).toBe(c.id);
  });

  test("throws NotFoundError for missing ID", () => {
    expect(() => getCollectionById("col-nope")).toThrow(NotFoundError);
  });

  test("lists all collections", () => {
    createCollection({ name: "C1" });
    createCollection({ name: "C2" });
    expect(listCollections().length).toBeGreaterThanOrEqual(2);
  });

  test("lists collections filtered by project", () => {
    const p = createProject({ name: "Prj" });
    createCollection({ name: "C for P", project_id: p.id });
    createCollection({ name: "C standalone" });
    const filtered = listCollections(p.id);
    expect(filtered.every(c => c.project_id === p.id)).toBe(true);
  });

  test("updates collection name", () => {
    const c = createCollection({ name: "Old" });
    const updated = updateCollection(c.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  test("deletes collection", () => {
    const c = createCollection({ name: "Delete" });
    deleteCollection(c.id);
    expect(() => getCollectionById(c.id)).toThrow(NotFoundError);
  });
});
