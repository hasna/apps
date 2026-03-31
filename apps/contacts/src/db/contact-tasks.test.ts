import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  createContactTask, getContactTask, listContactTasks, updateContactTask,
  deleteContactTask, listOverdueTasks, checkEscalations,
} from "./contact-tasks.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createContactTask", () => {
  it("creates a task with minimal fields", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Follow up", contact_id: c.id });
    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Follow up");
    expect(task.contact_id).toBe(c.id);
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.description).toBeNull();
    expect(task.assigned_by).toBeNull();
    expect(task.deadline).toBeNull();
    expect(task.entity_id).toBeNull();
    expect(task.linked_todos_task_id).toBeNull();
    expect(task.escalation_rules).toEqual([]);
    expect(task.created_at).toBeTruthy();
    expect(task.updated_at).toBeTruthy();
  });

  it("creates a task with all fields", () => {
    const c = createContact({ display_name: "Bob" });
    const escalationRules = [
      { after_days: 3, action: "notify", target: "manager@example.com" },
      { after_days: 7, action: "escalate", target: "vp@example.com" },
    ];
    const co = createCompany({ name: "Entity Co" });
    const task = createContactTask({
      title: "Important task",
      description: "Needs urgent attention",
      contact_id: c.id,
      assigned_by: "agent-001",
      deadline: "2026-04-15T10:00:00Z",
      status: "in_progress",
      priority: "high",
      entity_id: co.id,
      linked_todos_task_id: "todo-456",
      escalation_rules: escalationRules,
    });
    expect(task.title).toBe("Important task");
    expect(task.description).toBe("Needs urgent attention");
    expect(task.assigned_by).toBe("agent-001");
    expect(task.deadline).toBe("2026-04-15T10:00:00Z");
    expect(task.status).toBe("in_progress");
    expect(task.priority).toBe("high");
    expect(task.entity_id).toBe(co.id);
    expect(task.linked_todos_task_id).toBe("todo-456");
    expect(task.escalation_rules).toHaveLength(2);
    expect(task.escalation_rules[0]!.after_days).toBe(3);
  });
});

describe("getContactTask", () => {
  it("returns a task by id", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Test", contact_id: c.id });
    const found = getContactTask(task.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Test");
  });

  it("returns null for non-existent id", () => {
    expect(getContactTask("non-existent")).toBeNull();
  });
});

describe("listContactTasks", () => {
  it("lists all tasks", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({ title: "T1", contact_id: c.id });
    createContactTask({ title: "T2", contact_id: c.id });
    expect(listContactTasks()).toHaveLength(2);
  });

  it("returns empty when no tasks", () => {
    expect(listContactTasks()).toEqual([]);
  });

  it("filters by contact_id", () => {
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    createContactTask({ title: "T1", contact_id: c1.id });
    createContactTask({ title: "T2", contact_id: c2.id });
    const tasks = listContactTasks({ contact_id: c1.id });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("T1");
  });

  it("filters by status", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({ title: "Pending", contact_id: c.id, status: "pending" });
    createContactTask({ title: "Done", contact_id: c.id, status: "completed" });
    const tasks = listContactTasks({ status: "pending" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Pending");
  });

  it("filters by priority", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({ title: "High", contact_id: c.id, priority: "high" });
    createContactTask({ title: "Low", contact_id: c.id, priority: "low" });
    const tasks = listContactTasks({ priority: "high" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("High");
  });

  it("filters by entity_id", () => {
    const c = createContact({ display_name: "Alice" });
    const co1 = createCompany({ name: "Entity A" });
    const co2 = createCompany({ name: "Entity B" });
    createContactTask({ title: "T1", contact_id: c.id, entity_id: co1.id });
    createContactTask({ title: "T2", contact_id: c.id, entity_id: co2.id });
    const tasks = listContactTasks({ entity_id: co1.id });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("T1");
  });
});

describe("updateContactTask", () => {
  it("updates basic fields", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Old", contact_id: c.id });
    const updated = updateContactTask(task.id, { title: "New", status: "completed", priority: "critical" });
    expect(updated.title).toBe("New");
    expect(updated.status).toBe("completed");
    expect(updated.priority).toBe("critical");
  });

  it("clears nullable fields", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({
      title: "Test",
      contact_id: c.id,
      description: "Some desc",
      deadline: "2026-12-31",
      assigned_by: "agent",
    });
    const updated = updateContactTask(task.id, {
      description: null,
      deadline: null,
      assigned_by: null,
    });
    expect(updated.description).toBeNull();
    expect(updated.deadline).toBeNull();
    expect(updated.assigned_by).toBeNull();
  });

  it("updates escalation rules", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Test", contact_id: c.id });
    const rules = [{ after_days: 5, action: "notify", target: "boss@example.com" }];
    const updated = updateContactTask(task.id, { escalation_rules: rules });
    expect(updated.escalation_rules).toHaveLength(1);
    expect(updated.escalation_rules[0]!.after_days).toBe(5);
  });

  it("updates updated_at", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Test", contact_id: c.id });
    const updated = updateContactTask(task.id, { title: "Updated" });
    expect(updated.updated_at).not.toBe(task.created_at);
  });
});

describe("deleteContactTask", () => {
  it("deletes a task", () => {
    const c = createContact({ display_name: "Alice" });
    const task = createContactTask({ title: "Delete Me", contact_id: c.id });
    deleteContactTask(task.id);
    expect(getContactTask(task.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteContactTask("non-existent")).not.toThrow();
  });
});

describe("listOverdueTasks", () => {
  it("returns tasks past their deadline that are not completed or cancelled", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({ title: "Overdue", contact_id: c.id, deadline: "2020-01-01T00:00:00Z", status: "pending" });
    createContactTask({ title: "Future", contact_id: c.id, deadline: "2099-12-31T00:00:00Z", status: "pending" });
    createContactTask({ title: "Completed", contact_id: c.id, deadline: "2020-01-01T00:00:00Z", status: "completed" });
    createContactTask({ title: "Cancelled", contact_id: c.id, deadline: "2020-01-01T00:00:00Z", status: "cancelled" });
    const overdue = listOverdueTasks();
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.title).toBe("Overdue");
  });

  it("returns empty when no overdue tasks", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({ title: "Future", contact_id: c.id, deadline: "2099-12-31T00:00:00Z" });
    expect(listOverdueTasks()).toEqual([]);
  });
});

describe("checkEscalations", () => {
  it("returns triggered escalation rules for overdue tasks", () => {
    const c = createContact({ display_name: "Alice" });
    // Task overdue by many days with escalation rules
    createContactTask({
      title: "Urgent",
      contact_id: c.id,
      deadline: "2020-01-01T00:00:00Z",
      status: "pending",
      escalation_rules: [
        { after_days: 1, action: "notify", target: "manager@example.com" },
        { after_days: 365, action: "escalate", target: "ceo@example.com" },
      ],
    });
    const results = checkEscalations();
    expect(results).toHaveLength(1);
    // Both rules should be triggered since the task is years overdue
    expect(results[0]!.rules_triggered.length).toBeGreaterThanOrEqual(2);
  });

  it("does not trigger rules for tasks without escalation rules", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({
      title: "No Rules",
      contact_id: c.id,
      deadline: "2020-01-01T00:00:00Z",
      status: "pending",
    });
    const results = checkEscalations();
    expect(results).toEqual([]);
  });

  it("does not trigger rules for tasks without deadline", () => {
    const c = createContact({ display_name: "Alice" });
    createContactTask({
      title: "No Deadline",
      contact_id: c.id,
      status: "pending",
      escalation_rules: [{ after_days: 1, action: "notify", target: "x@example.com" }],
    });
    // listOverdueTasks requires deadline < now, so no deadline means not overdue
    const results = checkEscalations();
    expect(results).toEqual([]);
  });

  it("returns empty when no overdue tasks exist", () => {
    expect(checkEscalations()).toEqual([]);
  });
});
