import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  updateTemplate,
  taskFromTemplate,
  addTemplateTasks,
  getTemplateWithTasks,
  getTemplateTasks,
  tasksFromTemplate,
} from "./templates.js";
import { createTask } from "./tasks.js";
import { createProject } from "./projects.js";
import { createTaskList } from "./task-lists.js";

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

  it("should resolve partial ID (first 8 chars)", () => {
    const t = createTemplate({ name: "Partial", title_pattern: "P" }, db);
    const found = getTemplate(t.id.slice(0, 8), db);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(t.id);
    expect(found!.name).toBe("Partial");
  });

  it("should return null for ambiguous partial ID", () => {
    // Insert two templates with same prefix by manually inserting
    const t1 = createTemplate({ name: "A", title_pattern: "A" }, db);
    const t2 = createTemplate({ name: "B", title_pattern: "B" }, db);
    // These have different UUIDs so partial matching with full prefix works individually
    expect(getTemplate(t1.id.slice(0, 8), db)).not.toBeNull();
    expect(getTemplate(t2.id.slice(0, 8), db)).not.toBeNull();
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

  it("should delete by partial ID", () => {
    const t = createTemplate({ name: "PartialDel", title_pattern: "PD" }, db);
    expect(deleteTemplate(t.id.slice(0, 8), db)).toBe(true);
    expect(listTemplates(db).length).toBe(0);
  });
});

describe("updateTemplate", () => {
  it("should update name", () => {
    const t = createTemplate({ name: "Old", title_pattern: "T" }, db);
    const updated = updateTemplate(t.id, { name: "New" }, db);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New");
  });

  it("should update title_pattern", () => {
    const t = createTemplate({ name: "T", title_pattern: "Old: {x}" }, db);
    const updated = updateTemplate(t.id, { title_pattern: "New: {y}" }, db);
    expect(updated!.title_pattern).toBe("New: {y}");
  });

  it("should update description", () => {
    const t = createTemplate({ name: "T", title_pattern: "T" }, db);
    const updated = updateTemplate(t.id, { description: "Updated desc" }, db);
    expect(updated!.description).toBe("Updated desc");
  });

  it("should update priority", () => {
    const t = createTemplate({ name: "T", title_pattern: "T", priority: "low" }, db);
    const updated = updateTemplate(t.id, { priority: "critical" }, db);
    expect(updated!.priority).toBe("critical");
  });

  it("should update tags", () => {
    const t = createTemplate({ name: "T", title_pattern: "T", tags: ["a"] }, db);
    const updated = updateTemplate(t.id, { tags: ["b", "c"] }, db);
    expect(updated!.tags).toEqual(["b", "c"]);
  });

  it("should update metadata", () => {
    const t = createTemplate({ name: "T", title_pattern: "T" }, db);
    const updated = updateTemplate(t.id, { metadata: { foo: "bar" } }, db);
    expect(updated!.metadata).toEqual({ foo: "bar" });
  });

  it("should update multiple fields at once", () => {
    const t = createTemplate({ name: "Old", title_pattern: "Old", priority: "low" }, db);
    const updated = updateTemplate(t.id, { name: "New", title_pattern: "New", priority: "high" }, db);
    expect(updated!.name).toBe("New");
    expect(updated!.title_pattern).toBe("New");
    expect(updated!.priority).toBe("high");
  });

  it("should return null for non-existent template", () => {
    expect(updateTemplate("nonexistent", { name: "X" }, db)).toBeNull();
  });

  it("should return unchanged template when no updates provided", () => {
    const t = createTemplate({ name: "T", title_pattern: "T" }, db);
    const updated = updateTemplate(t.id, {}, db);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("T");
  });

  it("should resolve partial ID", () => {
    const t = createTemplate({ name: "Partial", title_pattern: "P" }, db);
    const updated = updateTemplate(t.id.slice(0, 8), { name: "Updated" }, db);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
    expect(updated!.id).toBe(t.id);
  });

  it("should set description to null", () => {
    const t = createTemplate({ name: "T", title_pattern: "T", description: "Has desc" }, db);
    const updated = updateTemplate(t.id, { description: null }, db);
    expect(updated!.description).toBeNull();
  });

  it("should not affect other fields when updating one", () => {
    const t = createTemplate({ name: "T", title_pattern: "Pattern", priority: "high", tags: ["a"] }, db);
    const updated = updateTemplate(t.id, { name: "NewName" }, db);
    expect(updated!.title_pattern).toBe("Pattern");
    expect(updated!.priority).toBe("high");
    expect(updated!.tags).toEqual(["a"]);
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

  it("should resolve partial ID for taskFromTemplate", () => {
    const t = createTemplate({ name: "Partial", title_pattern: "Partial: {x}", priority: "high" }, db);
    const input = taskFromTemplate(t.id.slice(0, 8), {}, db);
    expect(input.title).toBe("Partial: {x}");
    expect(input.priority).toBe("high");
  });
});

// === Multi-task templates ===

describe("addTemplateTasks", () => {
  it("should add tasks to a template", () => {
    const t = createTemplate({ name: "Pipeline", title_pattern: "Pipeline: {name}" }, db);
    const tasks = addTemplateTasks(t.id, [
      { title_pattern: "Design {name}" },
      { title_pattern: "Implement {name}", depends_on: [0] },
      { title_pattern: "Test {name}", depends_on: [1], priority: "high" },
    ], db);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.position).toBe(0);
    expect(tasks[0]!.title_pattern).toBe("Design {name}");
    expect(tasks[1]!.position).toBe(1);
    expect(tasks[1]!.depends_on_positions).toEqual([0]);
    expect(tasks[2]!.position).toBe(2);
    expect(tasks[2]!.depends_on_positions).toEqual([1]);
    expect(tasks[2]!.priority).toBe("high");
  });

  it("should throw if template does not exist", () => {
    expect(() => addTemplateTasks("nonexistent", [{ title_pattern: "X" }], db)).toThrow("Template not found");
  });

  it("should replace existing tasks when called again", () => {
    const t = createTemplate({ name: "Rewrite", title_pattern: "Rewrite: {name}" }, db);
    addTemplateTasks(t.id, [
      { title_pattern: "Step 1" },
      { title_pattern: "Step 2" },
    ], db);

    // Replace with a different set
    addTemplateTasks(t.id, [
      { title_pattern: "New Step 1" },
    ], db);

    const tasks = getTemplateTasks(t.id, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title_pattern).toBe("New Step 1");
  });

  it("should store tags and metadata", () => {
    const t = createTemplate({ name: "Rich", title_pattern: "Rich" }, db);
    const tasks = addTemplateTasks(t.id, [
      { title_pattern: "Tagged", tags: ["a", "b"], metadata: { key: "val" } },
    ], db);

    expect(tasks[0]!.tags).toEqual(["a", "b"]);
    expect(tasks[0]!.metadata).toEqual({ key: "val" });
  });

  it("should store task_type", () => {
    const t = createTemplate({ name: "Typed", title_pattern: "Typed" }, db);
    const tasks = addTemplateTasks(t.id, [
      { title_pattern: "Feature task", task_type: "feature" },
    ], db);

    expect(tasks[0]!.task_type).toBe("feature");
  });
});

describe("getTemplateWithTasks", () => {
  it("should return template with empty tasks array for single-task template", () => {
    const t = createTemplate({ name: "Simple", title_pattern: "Simple task" }, db);
    const result = getTemplateWithTasks(t.id, db);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Simple");
    expect(result!.tasks).toEqual([]);
  });

  it("should return template with all tasks ordered by position", () => {
    const t = createTemplate({ name: "Multi", title_pattern: "Multi: {name}" }, db);
    addTemplateTasks(t.id, [
      { title_pattern: "A", priority: "low" },
      { title_pattern: "B", priority: "medium" },
      { title_pattern: "C", priority: "high", depends_on: [0, 1] },
    ], db);

    const result = getTemplateWithTasks(t.id, db);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(3);
    expect(result!.tasks[0]!.title_pattern).toBe("A");
    expect(result!.tasks[1]!.title_pattern).toBe("B");
    expect(result!.tasks[2]!.title_pattern).toBe("C");
    expect(result!.tasks[2]!.depends_on_positions).toEqual([0, 1]);
  });

  it("should return null for nonexistent template", () => {
    expect(getTemplateWithTasks("nonexistent", db)).toBeNull();
  });

  it("should resolve partial ID", () => {
    const t = createTemplate({ name: "PartialWith", title_pattern: "P" }, db);
    addTemplateTasks(t.id, [{ title_pattern: "Task" }], db);
    const result = getTemplateWithTasks(t.id.slice(0, 8), db);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });
});

describe("createTemplate with inline tasks", () => {
  it("should create a multi-task template in one call", () => {
    const t = createTemplate({
      name: "Feature Pipeline",
      title_pattern: "Feature: {name}",
      tasks: [
        { title_pattern: "Design {name}", priority: "medium" },
        { title_pattern: "Implement {name}", depends_on: [0], priority: "high" },
        { title_pattern: "Test {name}", depends_on: [1] },
      ],
    }, db);

    const withTasks = getTemplateWithTasks(t.id, db);
    expect(withTasks).not.toBeNull();
    expect(withTasks!.tasks).toHaveLength(3);
    expect(withTasks!.tasks[0]!.title_pattern).toBe("Design {name}");
    expect(withTasks!.tasks[1]!.depends_on_positions).toEqual([0]);
    expect(withTasks!.tasks[2]!.depends_on_positions).toEqual([1]);
  });

  it("should create single-task template without tasks array", () => {
    const t = createTemplate({
      name: "Simple",
      title_pattern: "Do it",
    }, db);

    const withTasks = getTemplateWithTasks(t.id, db);
    expect(withTasks!.tasks).toHaveLength(0);
  });
});

describe("tasksFromTemplate (multi-task)", () => {
  it("should create all tasks from a multi-task template", () => {
    const project = createProject({ name: "Test Project", path: "/tmp/test-multi" }, db);
    const t = createTemplate({
      name: "Sprint",
      title_pattern: "Sprint: {sprint}",
      tasks: [
        { title_pattern: "Plan {sprint}" },
        { title_pattern: "Execute {sprint}", depends_on: [0] },
        { title_pattern: "Review {sprint}", depends_on: [1] },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { sprint: "Q1" }, undefined, db);
    expect(tasks).toHaveLength(3);
    // Titles should have short_id prefix from project + variable substitution
    expect(tasks[0]!.title).toContain("Plan Q1");
    expect(tasks[1]!.title).toContain("Execute Q1");
    expect(tasks[2]!.title).toContain("Review Q1");
  });

  it("should wire dependencies between created tasks", () => {
    const project = createProject({ name: "Dep Test", path: "/tmp/test-deps" }, db);
    const t = createTemplate({
      name: "Deps",
      title_pattern: "Deps",
      tasks: [
        { title_pattern: "First" },
        { title_pattern: "Second", depends_on: [0] },
        { title_pattern: "Third", depends_on: [0, 1] },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, undefined, undefined, db);
    expect(tasks).toHaveLength(3);

    // Verify dependencies by checking task_dependencies table
    const deps1 = db.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(tasks[1]!.id) as { depends_on: string }[];
    expect(deps1).toHaveLength(1);
    expect(deps1[0]!.depends_on).toBe(tasks[0]!.id);

    const deps2 = db.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(tasks[2]!.id) as { depends_on: string }[];
    expect(deps2).toHaveLength(2);
    const depIds = deps2.map(d => d.depends_on).sort();
    const expectedIds = [tasks[0]!.id, tasks[1]!.id].sort();
    expect(depIds).toEqual(expectedIds);
  });

  it("should substitute variables in titles and descriptions", () => {
    const project = createProject({ name: "Vars", path: "/tmp/test-vars" }, db);
    const t = createTemplate({
      name: "Var Template",
      title_pattern: "Template: {feature}",
      tasks: [
        { title_pattern: "Design {feature}", description: "Design phase for {feature}" },
        { title_pattern: "Build {feature} for {client}", description: "Build {feature} for {client}" },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { feature: "OAuth", client: "Acme" }, undefined, db);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toContain("Design OAuth");
    expect(tasks[0]!.description).toBe("Design phase for OAuth");
    expect(tasks[1]!.title).toContain("Build OAuth for Acme");
    expect(tasks[1]!.description).toBe("Build OAuth for Acme");
  });

  it("should work without variables (no substitution needed)", () => {
    const project = createProject({ name: "NoVars", path: "/tmp/test-novars" }, db);
    const t = createTemplate({
      name: "Fixed",
      title_pattern: "Fixed template",
      tasks: [
        { title_pattern: "Step 1" },
        { title_pattern: "Step 2" },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, undefined, undefined, db);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toContain("Step 1");
    expect(tasks[1]!.title).toContain("Step 2");
  });

  it("should pass task_list_id to created tasks", () => {
    const project = createProject({ name: "ListTest", path: "/tmp/test-list" }, db);
    const list = createTaskList({ name: "My List", slug: "my-list", project_id: project.id }, db);

    const t = createTemplate({
      name: "Listed",
      title_pattern: "Listed",
      tasks: [
        { title_pattern: "Task A" },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, undefined, list.id, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.task_list_id).toBe(list.id);
  });

  it("should throw for nonexistent template", () => {
    expect(() => tasksFromTemplate("nonexistent", "some-project", undefined, undefined, db)).toThrow("Template not found");
  });

  it("should preserve task metadata from template tasks", () => {
    const project = createProject({ name: "Meta", path: "/tmp/test-meta" }, db);
    const t = createTemplate({
      name: "MetaTemplate",
      title_pattern: "Meta",
      tasks: [
        { title_pattern: "Task with meta", tags: ["frontend", "urgent"], priority: "critical", task_type: "feature", metadata: { source: "template" } },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, undefined, undefined, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe("critical");
    expect(tasks[0]!.tags).toContain("frontend");
    expect(tasks[0]!.tags).toContain("urgent");
    expect(tasks[0]!.task_type).toBe("feature");
    expect(tasks[0]!.metadata).toEqual({ source: "template" });
  });

  it("should fall back to single-task behavior when no template tasks exist", () => {
    const project = createProject({ name: "Fallback", path: "/tmp/test-fallback" }, db);
    const t = createTemplate({ name: "Simple", title_pattern: "Do the thing", priority: "low" }, db);

    const tasks = tasksFromTemplate(t.id, project.id, undefined, undefined, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe("low");
  });
});

describe("deleting multi-task template cascades", () => {
  it("should cascade delete template_tasks when template is deleted", () => {
    const t = createTemplate({
      name: "Cascade",
      title_pattern: "Cascade",
      tasks: [
        { title_pattern: "A" },
        { title_pattern: "B" },
      ],
    }, db);

    // Confirm tasks exist
    expect(getTemplateTasks(t.id, db)).toHaveLength(2);

    // Delete template
    deleteTemplate(t.id, db);

    // Template tasks should be gone
    const rows = db.query("SELECT * FROM template_tasks").all();
    expect(rows).toHaveLength(0);
  });
});
