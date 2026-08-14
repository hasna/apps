import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { createProject } from "./projects.js";
import {
  createLabel,
  assignLabelToTask,
  getTaskLabels,
  listLabels,
} from "./labels.js";
import {
  createCustomFieldDefinition,
  setTaskCustomField,
  getTaskCustomFields,
  setTaskPriorityMeta,
  exportTaskFields,
} from "./custom-fields.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("labels and custom fields", () => {
  it("creates labels and assigns to tasks with tag sync", () => {
    const project = createProject({ name: "fields-proj", path: "/tmp/fields" });
    const task = createTask({ title: "Labeled", project_id: project.id });
    const label = createLabel({ name: "bug", color: "#ff0000", project_id: project.id });
    assignLabelToTask(task.id, label.id);

    expect(getTaskLabels(task.id)).toHaveLength(1);
    expect(listLabels(project.id)).toHaveLength(1);
  });

  it("validates custom field types and enum options", () => {
    const project = createProject({ name: "fields-proj", path: "/tmp/fields2" });
    const task = createTask({ title: "Custom", project_id: project.id });
    const field = createCustomFieldDefinition({
      name: "Severity",
      project_id: project.id,
      field_type: "enum",
      options: ["low", "high"],
    });

    setTaskCustomField(task.id, field.slug, "high");
    expect(getTaskCustomFields(task.id)[0]?.value).toBe("high");
    expect(() => setTaskCustomField(task.id, field.slug, "invalid")).toThrow(/one of/);
  });

  it("stores priority metadata and exports task fields", () => {
    const project = createProject({ name: "fields-proj", path: "/tmp/fields3" });
    const task = createTask({ title: "Priority", project_id: project.id, priority: "high" });
    setTaskPriorityMeta(task.id, { priority_score: 90, priority_reason: "customer blocker" });

    const exported = exportTaskFields(task.id);
    expect(exported.priority_score).toBe(90);
    expect(exported.priority_reason).toBe("customer blocker");
  });

  it("migration 53 tables exist on fresh database", () => {
    const db = getDatabase();
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('labels','custom_field_definitions','task_custom_field_values')").all() as { name: string }[];
    expect(tables.length).toBe(3);
  });
});
