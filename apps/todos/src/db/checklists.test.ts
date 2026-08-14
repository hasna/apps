import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { createProject } from "./projects.js";
import {
  addChecklistItem,
  checkChecklistItem,
  updateChecklistItemText,
  removeChecklistItem,
  clearChecklist,
  getChecklist,
  getChecklistStats,
} from "./checklists.js";
import { getTaskWithRelations } from "./tasks.js";

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

describe("addChecklistItem", () => {
  it("should add items appended to end", () => {
    const task = createTask({ title: "Cancel subscriptions" }, db);
    const i1 = addChecklistItem({ task_id: task.id, text: "Slack" }, db);
    const i2 = addChecklistItem({ task_id: task.id, text: "GitHub" }, db);
    const i3 = addChecklistItem({ task_id: task.id, text: "Notion" }, db);
    expect(i1.position).toBe(0);
    expect(i2.position).toBe(1);
    expect(i3.position).toBe(2);
    expect(i1.checked).toBe(false);
  });

  it("should respect explicit position", () => {
    const task = createTask({ title: "T" }, db);
    const item = addChecklistItem({ task_id: task.id, text: "Step 5", position: 5 }, db);
    expect(item.position).toBe(5);
  });
});

describe("checkChecklistItem", () => {
  it("should check and uncheck items", () => {
    const task = createTask({ title: "T" }, db);
    const item = addChecklistItem({ task_id: task.id, text: "Do it" }, db);
    expect(item.checked).toBe(false);

    const checked = checkChecklistItem(item.id, true, db);
    expect(checked!.checked).toBe(true);

    const unchecked = checkChecklistItem(item.id, false, db);
    expect(unchecked!.checked).toBe(false);
  });

  it("should return null for nonexistent item", () => {
    expect(checkChecklistItem("nonexistent", true, db)).toBeNull();
  });
});

describe("updateChecklistItemText", () => {
  it("should update text", () => {
    const task = createTask({ title: "T" }, db);
    const item = addChecklistItem({ task_id: task.id, text: "Old text" }, db);
    const updated = updateChecklistItemText(item.id, "New text", db);
    expect(updated!.text).toBe("New text");
  });
});

describe("removeChecklistItem", () => {
  it("should remove an item", () => {
    const task = createTask({ title: "T" }, db);
    const item = addChecklistItem({ task_id: task.id, text: "Removable" }, db);
    expect(getChecklist(task.id, db).length).toBe(1);
    expect(removeChecklistItem(item.id, db)).toBe(true);
    expect(getChecklist(task.id, db).length).toBe(0);
  });

  it("should return false for nonexistent item", () => {
    expect(removeChecklistItem("nope", db)).toBe(false);
  });
});

describe("clearChecklist", () => {
  it("should remove all items for a task", () => {
    const task = createTask({ title: "T" }, db);
    addChecklistItem({ task_id: task.id, text: "A" }, db);
    addChecklistItem({ task_id: task.id, text: "B" }, db);
    addChecklistItem({ task_id: task.id, text: "C" }, db);
    const removed = clearChecklist(task.id, db);
    expect(removed).toBe(3);
    expect(getChecklist(task.id, db).length).toBe(0);
  });
});

describe("getChecklistStats", () => {
  it("should return total and checked counts", () => {
    const task = createTask({ title: "T" }, db);
    const i1 = addChecklistItem({ task_id: task.id, text: "A" }, db);
    const i2 = addChecklistItem({ task_id: task.id, text: "B" }, db);
    addChecklistItem({ task_id: task.id, text: "C" }, db);
    checkChecklistItem(i1.id, true, db);
    checkChecklistItem(i2.id, true, db);

    const stats = getChecklistStats(task.id, db);
    expect(stats.total).toBe(3);
    expect(stats.checked).toBe(2);
  });

  it("should return zeros for task with no checklist", () => {
    const task = createTask({ title: "T" }, db);
    const stats = getChecklistStats(task.id, db);
    expect(stats.total).toBe(0);
    expect(stats.checked).toBe(0);
  });
});

describe("cascade delete", () => {
  it("should delete checklist items when task is deleted", () => {
    const task = createTask({ title: "T" }, db);
    addChecklistItem({ task_id: task.id, text: "A" }, db);
    addChecklistItem({ task_id: task.id, text: "B" }, db);
    db.run("DELETE FROM tasks WHERE id = ?", [task.id]);
    expect(getChecklist(task.id, db).length).toBe(0);
  });
});

describe("getTaskWithRelations includes checklist", () => {
  it("should embed checklist items in task relations", () => {
    const project = createProject({ name: "P", path: "/tmp/checklist-test" }, db);
    const task = createTask({ title: "Cancel all", project_id: project.id }, db);
    addChecklistItem({ task_id: task.id, text: "Slack" }, db);
    addChecklistItem({ task_id: task.id, text: "GitHub" }, db);
    const checked = addChecklistItem({ task_id: task.id, text: "Notion" }, db);
    checkChecklistItem(checked.id, true, db);

    const full = getTaskWithRelations(task.id, db);
    expect(full!.checklist).toHaveLength(3);
    expect(full!.checklist.filter(i => i.checked)).toHaveLength(1);
    expect(full!.checklist[0]!.text).toBe("Slack");
  });
});
