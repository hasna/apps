import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { addComment } from "../db/comments.js";
import {
  SAVED_VIEWS_SCHEMA,
  createSavedView,
  listSavedViews,
  unifiedSearch,
  runSavedView,
  getBuiltinSavedViews,
  deleteSavedView,
} from "./saved-views.js";

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

describe("saved views and unified search", () => {
  it("creates and lists saved views", () => {
    createSavedView({ name: "Open bugs", filters: { status: "pending", priority: "high" } }, db);
    const views = listSavedViews(db);
    expect(views).toHaveLength(1);
    expect(views[0]!.slug).toBe("open-bugs");
    expect(views[0]!.schema_version).toBe(SAVED_VIEWS_SCHEMA);
  });

  it("searches tasks with ranking", () => {
    createTask({ title: "Fix authentication bug", description: "login fails" }, db);
    createTask({ title: "Update docs", description: "readme" }, db);
    const result = unifiedSearch({ query: "authentication", entity_types: ["task"] }, db);
    expect(result.total).toBe(1);
    expect(result.hits[0]!.title).toContain("authentication");
    expect(result.hits[0]!.score).toBeGreaterThan(0);
  });

  it("searches across projects and comments", () => {
    createProject({ name: "open-todos", path: "/tmp/ot" }, db);
    const task = createTask({ title: "T" }, db);
    addComment({ task_id: task.id, content: "unique-search-token-xyz" }, db);

    const all = unifiedSearch({ query: "open-todos", entity_types: ["all"] }, db);
    expect(all.hits.some((h) => h.entity_type === "project")).toBe(true);

    const comments = unifiedSearch({ query: "unique-search-token", entity_types: ["comment"] }, db);
    expect(comments.total).toBe(1);
  });

  it("runs saved view filters", () => {
    createTask({ title: "Pending one", status: "pending" }, db);
    createTask({ title: "Done", status: "completed" }, db);
    const view = createSavedView({ name: "Pending only", filters: { status: "pending" } }, db);
    const result = runSavedView(view.slug, {}, db);
    expect(result.hits.every((h) => h.entity_type === "task")).toBe(true);
    expect(result.total).toBe(1);
  });

  it("paginates results", () => {
    for (let i = 0; i < 5; i++) createTask({ title: `Task ${i}` }, db);
    const page = unifiedSearch({ entity_types: ["task"], limit: 2, offset: 0 }, db);
    expect(page.hits).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("deletes saved views", () => {
    const v = createSavedView({ name: "Temp" }, db);
    expect(deleteSavedView(v.id, db)).toBe(true);
    expect(listSavedViews(db)).toHaveLength(0);
  });

  it("exposes builtin view presets", () => {
    expect(getBuiltinSavedViews().length).toBeGreaterThan(0);
  });
});
