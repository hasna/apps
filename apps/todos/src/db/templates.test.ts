import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTemplate, getTemplate, listTemplates, deleteTemplate, taskFromTemplate } from "./templates.js";
import { createTask } from "./tasks.js";

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

describe("createTemplate", () => {
  it("should create a template with defaults", () => {
    const t = createTemplate({ name: "Bug Fix", title_pattern: "BUG: {description}" }, db);
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("Bug Fix");
    expect(t.title_pattern).toBe("BUG: {description}");
    expect(t.priority).toBe("medium");
    expect(t.tags).toEqual([]);
    expect(t.description).toBeNull();
  });

  it("should create with all fields", () => {
    const t = createTemplate({
      name: "Feature",
      title_pattern: "FEAT: {name}",
      description: "Template desc",
      priority: "high",
      tags: ["feature"],
    }, db);
    expect(t.priority).toBe("high");
    expect(t.tags).toEqual(["feature"]);
    expect(t.description).toBe("Template desc");
  });

  it("should generate unique ids", () => {
    const t1 = createTemplate({ name: "A", title_pattern: "A" }, db);
    const t2 = createTemplate({ name: "B", title_pattern: "B" }, db);
    expect(t1.id).not.toBe(t2.id);
  });

  it("should set created_at timestamp", () => {
    const t = createTemplate({ name: "T", title_pattern: "T" }, db);
    expect(t.created_at).toBeTruthy();
  });

  it("should store metadata as object", () => {
    const t = createTemplate({
      name: "Meta",
      title_pattern: "M",
      metadata: { key: "value" },
    }, db);
    expect(t.metadata).toEqual({ key: "value" });
  });

  it("should default metadata to empty object", () => {
    const t = createTemplate({ name: "NoMeta", title_pattern: "N" }, db);
    expect(t.metadata).toEqual({});
  });
});

describe("getTemplate", () => {
  it("should get by id", () => {
    const t = createTemplate({ name: "T", title_pattern: "T" }, db);
    const found = getTemplate(t.id, db);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("T");
  });

  it("should return null for non-existent", () => {
    expect(getTemplate("nonexistent", db)).toBeNull();
  });

  it("should return tags as array", () => {
    const t = createTemplate({ name: "Tags", title_pattern: "T", tags: ["a", "b"] }, db);
    const found = getTemplate(t.id, db);
    expect(Array.isArray(found!.tags)).toBe(true);
    expect(found!.tags).toEqual(["a", "b"]);
  });
});

describe("listTemplates", () => {
  it("should list templates", () => {
    createTemplate({ name: "A", title_pattern: "A" }, db);
    createTemplate({ name: "B", title_pattern: "B" }, db);
    expect(listTemplates(db).length).toBe(2);
  });

  it("should return empty array when none exist", () => {
    expect(listTemplates(db)).toEqual([]);
  });

  it("should order by name", () => {
    createTemplate({ name: "Zebra", title_pattern: "Z" }, db);
    createTemplate({ name: "Alpha", title_pattern: "A" }, db);
    const templates = listTemplates(db);
    expect(templates[0]!.name).toBe("Alpha");
    expect(templates[1]!.name).toBe("Zebra");
  });
});

describe("deleteTemplate", () => {
  it("should delete and return true", () => {
    const t = createTemplate({ name: "D", title_pattern: "D" }, db);
    expect(deleteTemplate(t.id, db)).toBe(true);
    expect(listTemplates(db).length).toBe(0);
  });

  it("should return false for non-existent", () => {
    expect(deleteTemplate("nonexistent", db)).toBe(false);
  });

  it("should only delete the specified template", () => {
    const t1 = createTemplate({ name: "Keep", title_pattern: "K" }, db);
    const t2 = createTemplate({ name: "Delete", title_pattern: "D" }, db);
    deleteTemplate(t2.id, db);
    expect(listTemplates(db).length).toBe(1);
    expect(getTemplate(t1.id, db)).not.toBeNull();
  });
});

describe("taskFromTemplate", () => {
  it("should generate task input from template", () => {
    const t = createTemplate({ name: "Bug", title_pattern: "BUG: Fix it", priority: "high", tags: ["bug"] }, db);
    const input = taskFromTemplate(t.id, {}, db);
    expect(input.title).toBe("BUG: Fix it");
    expect(input.priority).toBe("high");
    expect(input.tags).toEqual(["bug"]);
  });

  it("should allow title override", () => {
    const t = createTemplate({ name: "Bug", title_pattern: "BUG: Fix it", priority: "high" }, db);
    const input = taskFromTemplate(t.id, { title: "Custom title" }, db);
    expect(input.title).toBe("Custom title");
  });

  it("should allow priority override", () => {
    const t = createTemplate({ name: "Bug", title_pattern: "BUG: Fix it", priority: "high" }, db);
    const input = taskFromTemplate(t.id, { priority: "critical" }, db);
    expect(input.priority).toBe("critical");
  });

  it("should allow multiple overrides", () => {
    const t = createTemplate({ name: "Bug", title_pattern: "BUG: Fix it", priority: "high" }, db);
    const input = taskFromTemplate(t.id, { title: "Custom", priority: "low", tags: ["custom"] }, db);
    expect(input.title).toBe("Custom");
    expect(input.priority).toBe("low");
    expect(input.tags).toEqual(["custom"]);
  });

  it("should throw for non-existent template", () => {
    expect(() => taskFromTemplate("nonexistent", {}, db)).toThrow("Template not found");
  });

  it("should include template description", () => {
    const t = createTemplate({ name: "Desc", title_pattern: "T", description: "Do the thing" }, db);
    const input = taskFromTemplate(t.id, {}, db);
    expect(input.description).toBe("Do the thing");
  });

  it("should create a real task from template", () => {
    const t = createTemplate({ name: "Bug", title_pattern: "BUG: Test", priority: "critical" }, db);
    const input = taskFromTemplate(t.id, {}, db);
    const task = createTask(input, db);
    expect(task.title).toBe("BUG: Test");
    expect(task.priority).toBe("critical");
  });

  it("should default project_id to undefined when not set", () => {
    const t = createTemplate({ name: "NoProj", title_pattern: "T" }, db);
    const input = taskFromTemplate(t.id, {}, db);
    expect(input.project_id).toBeUndefined();
  });

  it("should allow project_id override in taskFromTemplate", () => {
    const t = createTemplate({ name: "Proj", title_pattern: "T" }, db);
    const input = taskFromTemplate(t.id, { project_id: "proj-456" }, db);
    expect(input.project_id).toBe("proj-456");
  });
});
