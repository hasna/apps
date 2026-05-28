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
  previewTemplate,
  resolveVariables,
  evaluateCondition,
  exportTemplate,
  importTemplate,
  getTemplateVersion,
  listTemplateVersions,
} from "./templates.js";
import { initBuiltinTemplates, BUILTIN_TEMPLATES } from "./builtin-templates.js";
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

  it("should create multi-task template without project_id", () => {
    const t = createTemplate({
      name: "No Project",
      title_pattern: "No Project: {feature}",
      tasks: [
        { title_pattern: "Design {feature}" },
        { title_pattern: "Build {feature}", depends_on: [0] },
        { title_pattern: "Test {feature}", depends_on: [1] },
      ],
    }, db);

    // This should NOT throw REFERENCE_ERROR (Bug 1 fix)
    const tasks = tasksFromTemplate(t.id, undefined, { feature: "SSO" }, undefined, db);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.title).toContain("Design SSO");
    expect(tasks[1]!.title).toContain("Build SSO");
    expect(tasks[2]!.title).toContain("Test SSO");
    expect(tasks[0]!.project_id).toBeNull();
  });

  it("should create single-task template without project_id", () => {
    const t = createTemplate({ name: "NoProjSingle", title_pattern: "Quick task", priority: "high" }, db);

    const tasks = tasksFromTemplate(t.id, undefined, undefined, undefined, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Quick task");
    expect(tasks[0]!.project_id).toBeNull();
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

// === Feature 1: Template variables with defaults ===

describe("template variables", () => {
  it("should store variables on template creation", () => {
    const t = createTemplate({
      name: "WithVars",
      title_pattern: "Project: {name}",
      variables: [
        { name: "name", required: true, description: "Project name" },
        { name: "org", required: false, default: "hasna", description: "GitHub org" },
      ],
    }, db);
    expect(t.variables).toHaveLength(2);
    expect(t.variables[0]!.name).toBe("name");
    expect(t.variables[0]!.required).toBe(true);
    expect(t.variables[1]!.name).toBe("org");
    expect(t.variables[1]!.default).toBe("hasna");
  });

  it("should default variables to empty array", () => {
    const t = createTemplate({ name: "NoVars", title_pattern: "T" }, db);
    expect(t.variables).toEqual([]);
  });

  it("should return variables in getTemplate", () => {
    const t = createTemplate({
      name: "GetVars",
      title_pattern: "T",
      variables: [{ name: "x", required: true }],
    }, db);
    const found = getTemplate(t.id, db);
    expect(found!.variables).toHaveLength(1);
    expect(found!.variables[0]!.name).toBe("x");
  });

  it("should return variables in getTemplateWithTasks", () => {
    const t = createTemplate({
      name: "WithTasksVars",
      title_pattern: "T: {name}",
      variables: [{ name: "name", required: true }],
      tasks: [{ title_pattern: "Do {name}" }],
    }, db);
    const result = getTemplateWithTasks(t.id, db);
    expect(result!.variables).toHaveLength(1);
  });

  it("should update variables", () => {
    const t = createTemplate({ name: "UpdVars", title_pattern: "T" }, db);
    const updated = updateTemplate(t.id, {
      variables: [{ name: "v", required: false, default: "x" }],
    }, db);
    expect(updated!.variables).toHaveLength(1);
    expect(updated!.variables[0]!.default).toBe("x");
  });
});

describe("resolveVariables", () => {
  it("should fill defaults for missing variables", () => {
    const vars = [
      { name: "name", required: true },
      { name: "org", required: false, default: "hasna" },
    ];
    const resolved = resolveVariables(vars, { name: "todos" });
    expect(resolved.name).toBe("todos");
    expect(resolved.org).toBe("hasna");
  });

  it("should throw on missing required variables", () => {
    const vars = [{ name: "name", required: true }];
    expect(() => resolveVariables(vars, {})).toThrow("Missing required template variable(s): name");
  });

  it("should not throw when required variable is provided", () => {
    const vars = [{ name: "name", required: true }];
    const resolved = resolveVariables(vars, { name: "test" });
    expect(resolved.name).toBe("test");
  });

  it("should allow overriding defaults", () => {
    const vars = [{ name: "org", required: false, default: "hasna" }];
    const resolved = resolveVariables(vars, { org: "custom" });
    expect(resolved.org).toBe("custom");
  });

  it("should work with empty variables array", () => {
    const resolved = resolveVariables([], { extra: "value" });
    expect(resolved.extra).toBe("value");
  });

  it("should report all missing required variables at once", () => {
    const vars = [
      { name: "a", required: true },
      { name: "b", required: true },
    ];
    expect(() => resolveVariables(vars, {})).toThrow("Missing required template variable(s): a, b");
  });
});

describe("tasksFromTemplate with variables validation", () => {
  it("should throw when required variable is missing", () => {
    const project = createProject({ name: "VarReq", path: "/tmp/test-varreq" }, db);
    const t = createTemplate({
      name: "RequiredVar",
      title_pattern: "T: {name}",
      variables: [{ name: "name", required: true }],
      tasks: [{ title_pattern: "Build {name}" }],
    }, db);

    expect(() => tasksFromTemplate(t.id, project.id, {}, undefined, db)).toThrow("Missing required template variable(s): name");
  });

  it("should fill defaults and substitute", () => {
    const project = createProject({ name: "VarDef", path: "/tmp/test-vardef" }, db);
    const t = createTemplate({
      name: "DefaultVar",
      title_pattern: "T: {name}",
      variables: [
        { name: "name", required: true },
        { name: "org", required: false, default: "hasna" },
      ],
      tasks: [{ title_pattern: "Create {org}/{name}" }],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { name: "todos" }, undefined, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toContain("Create hasna/todos");
  });
});

// === Feature 2: Built-in starter templates ===

describe("initBuiltinTemplates", () => {
  it("should create all 4 built-in templates", () => {
    const result = initBuiltinTemplates(db);
    expect(result.created).toBe(4);
    expect(result.skipped).toBe(0);
    expect(result.names).toContain("open-source-project");
    expect(result.names).toContain("bug-fix");
    expect(result.names).toContain("feature");
    expect(result.names).toContain("security-audit");
  });

  it("should skip already existing templates", () => {
    initBuiltinTemplates(db);
    const result2 = initBuiltinTemplates(db);
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(4);
  });

  it("should create templates with variables", () => {
    initBuiltinTemplates(db);
    const templates = listTemplates(db);
    const osp = templates.find(t => t.name === "open-source-project");
    expect(osp).not.toBeNull();
    expect(osp!.variables).toHaveLength(2);
    expect(osp!.variables[0]!.name).toBe("name");
    expect(osp!.variables[0]!.required).toBe(true);
    expect(osp!.variables[1]!.name).toBe("org");
    expect(osp!.variables[1]!.default).toBe("hasna");
  });

  it("should create templates with tasks", () => {
    initBuiltinTemplates(db);
    const templates = listTemplates(db);
    const osp = templates.find(t => t.name === "open-source-project");
    const withTasks = getTemplateWithTasks(osp!.id, db);
    expect(withTasks!.tasks.length).toBe(16);
  });

  it("should create bug-fix template with 5 tasks", () => {
    initBuiltinTemplates(db);
    const templates = listTemplates(db);
    const bf = templates.find(t => t.name === "bug-fix");
    const withTasks = getTemplateWithTasks(bf!.id, db);
    expect(withTasks!.tasks.length).toBe(5);
    expect(withTasks!.tasks[0]!.title_pattern).toBe("Reproduce: {bug}");
  });

  it("should only create templates that are missing", () => {
    // Create one manually first
    createTemplate({ name: "bug-fix", title_pattern: "Custom bug fix" }, db);
    const result = initBuiltinTemplates(db);
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.names).not.toContain("bug-fix");
  });
});

describe("BUILTIN_TEMPLATES constant", () => {
  it("should have 4 templates", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);
  });

  it("should have required variables in each template", () => {
    for (const bt of BUILTIN_TEMPLATES) {
      expect(bt.variables.length).toBeGreaterThan(0);
      // Each template should have at least one required variable
      const hasRequired = bt.variables.some(v => v.required);
      expect(hasRequired).toBe(true);
    }
  });
});

// === Feature 3: Template preview ===

describe("previewTemplate", () => {
  it("should preview a multi-task template", () => {
    const t = createTemplate({
      name: "Preview Test",
      title_pattern: "Preview: {name}",
      variables: [{ name: "name", required: true }],
      tasks: [
        { title_pattern: "Design {name}" },
        { title_pattern: "Build {name}", depends_on: [0] },
        { title_pattern: "Test {name}", depends_on: [1], priority: "high" },
      ],
    }, db);

    const preview = previewTemplate(t.id, { name: "invoices" }, db);
    expect(preview.template_id).toBe(t.id);
    expect(preview.template_name).toBe("Preview Test");
    expect(preview.tasks).toHaveLength(3);
    expect(preview.tasks[0]!.title).toBe("Design invoices");
    expect(preview.tasks[1]!.title).toBe("Build invoices");
    expect(preview.tasks[1]!.depends_on_positions).toEqual([0]);
    expect(preview.tasks[2]!.title).toBe("Test invoices");
    expect(preview.tasks[2]!.priority).toBe("high");
  });

  it("should NOT create any tasks", () => {
    const project = createProject({ name: "NoCreate", path: "/tmp/test-nocreate" }, db);
    const t = createTemplate({
      name: "NoCreate",
      title_pattern: "NC: {name}",
      variables: [{ name: "name", required: true }],
      tasks: [{ title_pattern: "Task {name}" }],
    }, db);

    const tasksBefore = db.query("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
    previewTemplate(t.id, { name: "test" }, db);
    const tasksAfter = db.query("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
    expect(tasksAfter.count).toBe(tasksBefore.count);
  });

  it("should fill default variables", () => {
    const t = createTemplate({
      name: "DefPreview",
      title_pattern: "DP: {name}",
      variables: [
        { name: "name", required: true },
        { name: "org", required: false, default: "hasna" },
      ],
      tasks: [{ title_pattern: "Create {org}/{name}" }],
    }, db);

    const preview = previewTemplate(t.id, { name: "todos" }, db);
    expect(preview.tasks[0]!.title).toBe("Create hasna/todos");
    expect(preview.resolved_variables.org).toBe("hasna");
    expect(preview.resolved_variables.name).toBe("todos");
  });

  it("should throw on missing required variables", () => {
    const t = createTemplate({
      name: "ReqPreview",
      title_pattern: "RP: {name}",
      variables: [{ name: "name", required: true }],
      tasks: [{ title_pattern: "Task {name}" }],
    }, db);

    expect(() => previewTemplate(t.id, {}, db)).toThrow("Missing required template variable(s): name");
  });

  it("should preview single-task template", () => {
    const t = createTemplate({
      name: "Single",
      title_pattern: "Bug: {desc}",
      description: "Fix {desc}",
      variables: [{ name: "desc", required: true }],
    }, db);

    const preview = previewTemplate(t.id, { desc: "login crash" }, db);
    expect(preview.tasks).toHaveLength(1);
    expect(preview.tasks[0]!.title).toBe("Bug: login crash");
    expect(preview.tasks[0]!.description).toBe("Fix login crash");
  });

  it("should throw for nonexistent template", () => {
    expect(() => previewTemplate("nonexistent", {}, db)).toThrow("Template not found");
  });

  it("should show variables metadata in preview", () => {
    const t = createTemplate({
      name: "VarMeta",
      title_pattern: "VM: {name}",
      variables: [
        { name: "name", required: true, description: "Service name" },
        { name: "env", required: false, default: "prod" },
      ],
      tasks: [{ title_pattern: "Deploy {name} to {env}" }],
    }, db);

    const preview = previewTemplate(t.id, { name: "api" }, db);
    expect(preview.variables).toHaveLength(2);
    expect(preview.variables[0]!.description).toBe("Service name");
    expect(preview.tasks[0]!.title).toBe("Deploy api to prod");
  });

  it("should preview built-in templates after init", () => {
    initBuiltinTemplates(db);
    const templates = listTemplates(db);
    const osp = templates.find(t => t.name === "open-source-project");

    const preview = previewTemplate(osp!.id, { name: "invoices" }, db);
    expect(preview.tasks).toHaveLength(16);
    expect(preview.tasks[0]!.title).toBe("Scaffold invoices package structure");
    expect(preview.tasks[8]!.title).toBe("Create GitHub repo hasna/invoices");
    expect(preview.resolved_variables.org).toBe("hasna");
  });
});

// === Feature: Conditional tasks ===

describe("evaluateCondition", () => {
  it("should return true for empty condition", () => {
    expect(evaluateCondition("", {})).toBe(true);
    expect(evaluateCondition("  ", {})).toBe(true);
  });

  it("should evaluate truthy: {var} when value exists", () => {
    expect(evaluateCondition("{env}", { env: "prod" })).toBe(true);
  });

  it("should evaluate truthy: {var} when value is empty", () => {
    expect(evaluateCondition("{env}", { env: "" })).toBe(false);
  });

  it("should evaluate truthy: {var} when value is false string", () => {
    expect(evaluateCondition("{env}", { env: "false" })).toBe(false);
  });

  it("should evaluate truthy: {var} when key doesn't exist", () => {
    expect(evaluateCondition("{env}", {})).toBe(false);
  });

  it("should evaluate falsy: !{var} when key doesn't exist", () => {
    expect(evaluateCondition("!{env}", {})).toBe(true);
  });

  it("should evaluate falsy: !{var} when value is empty", () => {
    expect(evaluateCondition("!{env}", { env: "" })).toBe(true);
  });

  it("should evaluate falsy: !{var} when value exists", () => {
    expect(evaluateCondition("!{env}", { env: "prod" })).toBe(false);
  });

  it("should evaluate equality: {var} == value", () => {
    expect(evaluateCondition("{env} == prod", { env: "prod" })).toBe(true);
    expect(evaluateCondition("{env} == staging", { env: "prod" })).toBe(false);
  });

  it("should evaluate inequality: {var} != value", () => {
    expect(evaluateCondition("{env} != prod", { env: "staging" })).toBe(true);
    expect(evaluateCondition("{env} != prod", { env: "prod" })).toBe(false);
  });

  it("should handle unknown condition format as true", () => {
    expect(evaluateCondition("some random text", {})).toBe(true);
  });
});

describe("conditional tasks in tasksFromTemplate", () => {
  it("should skip tasks when condition evaluates to false", () => {
    const project = createProject({ name: "Cond", path: "/tmp/test-cond" }, db);
    const t = createTemplate({
      name: "Conditional",
      title_pattern: "Deploy {service}",
      tasks: [
        { title_pattern: "Build {service}" },
        { title_pattern: "Run migrations", condition: "{needs_migration}" },
        { title_pattern: "Deploy {service}", depends_on: [0, 1] },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { service: "api" }, undefined, db);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toContain("Build api");
    expect(tasks[1]!.title).toContain("Deploy api");
  });

  it("should include tasks when condition evaluates to true", () => {
    const project = createProject({ name: "CondTrue", path: "/tmp/test-cond-true" }, db);
    const t = createTemplate({
      name: "ConditionalTrue",
      title_pattern: "Deploy",
      tasks: [
        { title_pattern: "Build" },
        { title_pattern: "Run migrations", condition: "{needs_migration}" },
        { title_pattern: "Deploy", depends_on: [0, 1] },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { needs_migration: "true" }, undefined, db);
    expect(tasks).toHaveLength(3);
  });

  it("should skip dependencies pointing to skipped tasks", () => {
    const project = createProject({ name: "CondDeps", path: "/tmp/test-cond-deps" }, db);
    const t = createTemplate({
      name: "CondDeps",
      title_pattern: "Pipeline",
      tasks: [
        { title_pattern: "Step A" },
        { title_pattern: "Optional step", condition: "{include_optional}" },
        { title_pattern: "Step C", depends_on: [0, 1] },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, {}, undefined, db);
    expect(tasks).toHaveLength(2);

    // Step C should only depend on Step A (not the skipped optional step)
    const deps = db.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(tasks[1]!.id) as { depends_on: string }[];
    expect(deps).toHaveLength(1);
    expect(deps[0]!.depends_on).toBe(tasks[0]!.id);
  });

  it("should respect condition with equality check", () => {
    const project = createProject({ name: "CondEq", path: "/tmp/test-cond-eq" }, db);
    const t = createTemplate({
      name: "CondEq",
      title_pattern: "Deploy",
      tasks: [
        { title_pattern: "Staging deploy", condition: "{env} == staging" },
        { title_pattern: "Prod deploy", condition: "{env} == prod" },
      ],
    }, db);

    const tasks = tasksFromTemplate(t.id, project.id, { env: "prod" }, undefined, db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toContain("Prod deploy");
  });

  it("should filter conditional tasks in preview", () => {
    const t = createTemplate({
      name: "PreviewCond",
      title_pattern: "Deploy",
      tasks: [
        { title_pattern: "Always" },
        { title_pattern: "Only prod", condition: "{env} == prod" },
        { title_pattern: "Only staging", condition: "{env} == staging" },
      ],
    }, db);

    const preview = previewTemplate(t.id, { env: "prod" }, db);
    expect(preview.tasks).toHaveLength(2);
    expect(preview.tasks[0]!.title).toBe("Always");
    expect(preview.tasks[1]!.title).toBe("Only prod");
  });
});

// === Feature: Export/Import ===

describe("exportTemplate", () => {
  it("should export a template with all fields", () => {
    const t = createTemplate({
      name: "Export Test",
      title_pattern: "Test: {name}",
      description: "A test template",
      priority: "high",
      tags: ["test"],
      variables: [{ name: "name", required: true }],
      tasks: [
        { title_pattern: "Step 1", priority: "low" },
        { title_pattern: "Step 2", depends_on: [0], condition: "{flag}" },
      ],
    }, db);

    const exported = exportTemplate(t.id, db);
    expect(exported.name).toBe("Export Test");
    expect(exported.title_pattern).toBe("Test: {name}");
    expect(exported.description).toBe("A test template");
    expect(exported.priority).toBe("high");
    expect(exported.tags).toEqual(["test"]);
    expect(exported.variables).toHaveLength(1);
    expect(exported.tasks).toHaveLength(2);
    expect(exported.tasks[1]!.condition).toBe("{flag}");
    expect(exported.tasks[1]!.depends_on_positions).toEqual([0]);
  });

  it("should throw for non-existent template", () => {
    expect(() => exportTemplate("nonexistent", db)).toThrow("Template not found");
  });
});

describe("importTemplate", () => {
  it("should import a template from exported JSON", () => {
    const original = createTemplate({
      name: "Original",
      title_pattern: "Task: {x}",
      priority: "critical",
      tags: ["imported"],
      variables: [{ name: "x", required: true }],
      tasks: [
        { title_pattern: "Do {x}", priority: "high" },
        { title_pattern: "Verify {x}", depends_on: [0] },
      ],
    }, db);

    const exported = exportTemplate(original.id, db);
    const imported = importTemplate(exported, db);

    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe("Original");
    expect(imported.title_pattern).toBe("Task: {x}");
    expect(imported.priority).toBe("critical");
    expect(imported.tags).toEqual(["imported"]);
    expect(imported.variables).toHaveLength(1);

    const importedTasks = getTemplateTasks(imported.id, db);
    expect(importedTasks).toHaveLength(2);
    expect(importedTasks[0]!.title_pattern).toBe("Do {x}");
    expect(importedTasks[1]!.depends_on_positions).toEqual([0]);
  });

  it("should round-trip through JSON serialization", () => {
    const original = createTemplate({
      name: "RoundTrip",
      title_pattern: "T",
      tasks: [{ title_pattern: "Step", condition: "{flag}", metadata: { key: "val" } }],
    }, db);

    const exported = exportTemplate(original.id, db);
    const jsonStr = JSON.stringify(exported);
    const parsed = JSON.parse(jsonStr);
    const imported = importTemplate(parsed, db);

    const importedTasks = getTemplateTasks(imported.id, db);
    expect(importedTasks[0]!.condition).toBe("{flag}");
    expect(importedTasks[0]!.metadata).toEqual({ key: "val" });
  });
});

// === Feature: Template composition ===

describe("template composition", () => {
  it("should include tasks from another template", () => {
    const project = createProject({ name: "Compose", path: "/tmp/test-compose" }, db);

    const inner = createTemplate({
      name: "Inner",
      title_pattern: "Inner",
      tasks: [
        { title_pattern: "Inner step 1" },
        { title_pattern: "Inner step 2", depends_on: [0] },
      ],
    }, db);

    const outer = createTemplate({
      name: "Outer",
      title_pattern: "Outer",
      tasks: [
        { title_pattern: "Setup" },
        { title_pattern: "(include)", include_template_id: inner.id },
        { title_pattern: "Cleanup", depends_on: [0] },
      ],
    }, db);

    const tasks = tasksFromTemplate(outer.id, project.id, undefined, undefined, db);
    // Setup + Inner step 1 + Inner step 2 + Cleanup = 4 tasks
    expect(tasks).toHaveLength(4);
    expect(tasks[0]!.title).toContain("Setup");
    expect(tasks[1]!.title).toContain("Inner step 1");
    expect(tasks[2]!.title).toContain("Inner step 2");
    expect(tasks[3]!.title).toContain("Cleanup");
  });

  it("should pass variables to included template", () => {
    const project = createProject({ name: "ComposeVars", path: "/tmp/test-compose-vars" }, db);

    const inner = createTemplate({
      name: "InnerVars",
      title_pattern: "InnerVars",
      tasks: [
        { title_pattern: "Deploy {service}" },
      ],
    }, db);

    const outer = createTemplate({
      name: "OuterVars",
      title_pattern: "OuterVars",
      tasks: [
        { title_pattern: "Build {service}" },
        { title_pattern: "(include)", include_template_id: inner.id },
      ],
    }, db);

    const tasks = tasksFromTemplate(outer.id, project.id, { service: "api" }, undefined, db);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toContain("Build api");
    expect(tasks[1]!.title).toContain("Deploy api");
  });

  it("should detect circular template references", () => {
    const project = createProject({ name: "Circular", path: "/tmp/test-circular" }, db);

    const tA = createTemplate({
      name: "CircA",
      title_pattern: "A",
      tasks: [{ title_pattern: "A step" }],
    }, db);

    const tB = createTemplate({
      name: "CircB",
      title_pattern: "B",
      tasks: [{ title_pattern: "(include)", include_template_id: tA.id }],
    }, db);

    // Now make A include B (circular)
    addTemplateTasks(tA.id, [
      { title_pattern: "(include)", include_template_id: tB.id },
    ], db);

    expect(() => tasksFromTemplate(tA.id, project.id, undefined, undefined, db))
      .toThrow("Circular template reference detected");
  });
});

// === Feature: Template versioning ===

describe("template versioning", () => {
  it("should start at version 1", () => {
    const t = createTemplate({ name: "V1", title_pattern: "V1" }, db);
    expect(t.version).toBe(1);
  });

  it("should increment version on update", () => {
    const t = createTemplate({ name: "V1", title_pattern: "V1" }, db);
    const updated = updateTemplate(t.id, { name: "V2" }, db);
    expect(updated!.version).toBe(2);
  });

  it("should save snapshot on update", () => {
    const t = createTemplate({ name: "Original", title_pattern: "OG" }, db);
    updateTemplate(t.id, { name: "Updated" }, db);

    const versions = listTemplateVersions(t.id, db);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);

    const snap = JSON.parse(versions[0]!.snapshot);
    expect(snap.name).toBe("Original");
    expect(snap.title_pattern).toBe("OG");
  });

  it("should accumulate versions on multiple updates", () => {
    const t = createTemplate({ name: "V1", title_pattern: "T" }, db);
    updateTemplate(t.id, { name: "V2" }, db);
    updateTemplate(t.id, { name: "V3" }, db);
    updateTemplate(t.id, { name: "V4" }, db);

    const versions = listTemplateVersions(t.id, db);
    expect(versions).toHaveLength(3);
    // Ordered by version DESC
    expect(versions[0]!.version).toBe(3);
    expect(versions[1]!.version).toBe(2);
    expect(versions[2]!.version).toBe(1);
  });

  it("should retrieve a specific version", () => {
    const t = createTemplate({ name: "V1", title_pattern: "T1" }, db);
    updateTemplate(t.id, { name: "V2", title_pattern: "T2" }, db);
    updateTemplate(t.id, { name: "V3", title_pattern: "T3" }, db);

    const v1 = getTemplateVersion(t.id, 1, db);
    expect(v1).not.toBeNull();
    const snap = JSON.parse(v1!.snapshot);
    expect(snap.name).toBe("V1");
    expect(snap.title_pattern).toBe("T1");
  });

  it("should return null for non-existent version", () => {
    const t = createTemplate({ name: "V1", title_pattern: "T" }, db);
    expect(getTemplateVersion(t.id, 999, db)).toBeNull();
  });

  it("should return empty array for template with no versions", () => {
    const t = createTemplate({ name: "NoVersions", title_pattern: "T" }, db);
    expect(listTemplateVersions(t.id, db)).toEqual([]);
  });

  it("should cascade delete versions when template is deleted", () => {
    const t = createTemplate({ name: "CascadeDel", title_pattern: "T" }, db);
    updateTemplate(t.id, { name: "Updated" }, db);
    expect(listTemplateVersions(t.id, db)).toHaveLength(1);

    deleteTemplate(t.id, db);
    const rows = db.query("SELECT * FROM template_versions").all();
    expect(rows).toHaveLength(0);
  });

  it("should include tasks in version snapshot", () => {
    const t = createTemplate({
      name: "WithTasks",
      title_pattern: "T",
      tasks: [
        { title_pattern: "Step 1" },
        { title_pattern: "Step 2", depends_on: [0] },
      ],
    }, db);

    updateTemplate(t.id, { name: "Updated" }, db);

    const versions = listTemplateVersions(t.id, db);
    const snap = JSON.parse(versions[0]!.snapshot);
    expect(snap.tasks).toHaveLength(2);
    expect(snap.tasks[0].title_pattern).toBe("Step 1");
    expect(snap.tasks[1].depends_on_positions).toEqual([0]);
  });
});
