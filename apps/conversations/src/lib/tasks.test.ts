import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createTask,
  getTask,
  listTasks,
  startTask,
  completeTask,
  cancelTask,
  blockTask,
  unblockTask,
  reopenTask,
  assignTask,
  setTaskPriority,
  addComment,
  getComments,
  getSubtasks,
  getTaskTree,
  addDependency,
  removeDependency,
  getDependencies,
  getDependents,
  getTaskActivity,
  deleteTask,
  getDueTasks,
  getTaskSummary,
  searchTasks,
} from "./tasks";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-tasks-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
});

describe("createTask", () => {
  test("creates a task with minimal fields", () => {
    const task = createTask({ subject: "Fix bug", reporter: "agent-1" });
    expect(task.subject).toBe("Fix bug");
    expect(task.reporter).toBe("agent-1");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.assignee).toBeNull();
    expect(task.parent_id).toBeNull();
    expect(task.uuid).toBeTruthy();
  });

  test("creates a task with all fields", () => {
    const task = createTask({
      subject: "Full task",
      description: "Do the thing",
      reporter: "agent-1",
      assignee: "agent-2",
      priority: "high",
      project_id: "proj-1",
      channel: "general",
      tags: ["sdk", "tasks"],
      metadata: { key: "value" },
      due_at: "2026-05-01T00:00:00Z",
    });
    expect(task.description).toBe("Do the thing");
    expect(task.assignee).toBe("agent-2");
    expect(task.priority).toBe("high");
    expect(task.project_id).toBe("proj-1");
    expect(task.channel).toBe("general");
    expect(task.tags).toEqual(["sdk", "tasks"]);
    expect(task.metadata).toEqual({ key: "value" });
    expect(task.due_at).toBe("2026-05-01T00:00:00Z");
  });

  test("creates a subtask with parent_id", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    const child = createTask({ subject: "Child", reporter: "agent-1", parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);
  });
});

describe("getTask", () => {
  test("returns null for nonexistent task", () => {
    expect(getTask(99999)).toBeNull();
  });

  test("gets task by id", () => {
    const task = createTask({ subject: "Lookup", reporter: "agent-1" });
    const found = getTask(task.id);
    expect(found).not.toBeNull();
    expect(found!.subject).toBe("Lookup");
  });

  test("gets task by uuid", () => {
    const task = createTask({ subject: "Uuid lookup", reporter: "agent-1" });
    const found = getTask(task.uuid);
    expect(found).not.toBeNull();
    expect(found!.subject).toBe("Uuid lookup");
  });

  test("returns enriched TaskInfo with counts", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    createTask({ subject: "Child", reporter: "agent-1", parent_id: parent.id });
    addComment(parent.id, "agent-1", "a comment");

    const info = getTask(parent.id);
    expect(info).not.toBeNull();
    expect(info!.subtask_count).toBe(1);
    expect(info!.comment_count).toBe(1);
  });
});

describe("listTasks", () => {
  test("lists all tasks when no filters", () => {
    createTask({ subject: "A", reporter: "agent-1" });
    createTask({ subject: "B", reporter: "agent-1" });
    const tasks = listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", () => {
    createTask({ subject: "Pending", reporter: "agent-1" });
    const t2 = createTask({ subject: "Started", reporter: "agent-1" });
    startTask(t2.id, "agent-1");
    const pending = listTasks({ status: "pending" });
    expect(pending.every(t => t.status === "pending")).toBe(true);
  });

  test("filters by assignee", () => {
    createTask({ subject: "A", reporter: "agent-1", assignee: "bob" });
    createTask({ subject: "B", reporter: "agent-1", assignee: "alice" });
    const tasks = listTasks({ assignee: "bob" });
    expect(tasks.every(t => t.assignee === "bob")).toBe(true);
  });

  test("filters by project_id", () => {
    createTask({ subject: "A", reporter: "agent-1", project_id: "p1" });
    createTask({ subject: "B", reporter: "agent-1", project_id: "p2" });
    const tasks = listTasks({ project_id: "p1" });
    expect(tasks.every(t => t.project_id === "p1")).toBe(true);
  });

  test("filters by tag", () => {
    createTask({ subject: "A", reporter: "agent-1", tags: ["sdk"] });
    createTask({ subject: "B", reporter: "agent-1", tags: ["test"] });
    const tasks = listTasks({ tag: "sdk" });
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by multiple tags (AND logic)", () => {
    createTask({ subject: "AB", reporter: "agent-1", tags: ["sdk", "tasks"] });
    createTask({ subject: "A", reporter: "agent-1", tags: ["sdk"] });
    createTask({ subject: "B", reporter: "agent-1", tags: ["tasks"] });
    const tasks = listTasks({ tags: ["sdk", "tasks"] });
    // Only AB has both tags
    const abTask = tasks.find(t => t.subject === "AB");
    expect(abTask).toBeDefined();
    // A and B should NOT be in results
    expect(tasks.find(t => t.subject === "A")).toBeUndefined();
    expect(tasks.find(t => t.subject === "B")).toBeUndefined();
  });

  test("filters by metadata key/value", () => {
    createTask({ subject: "Task with metadata", reporter: "agent-1", metadata: { env: "prod", region: "us" } });
    createTask({ subject: "Other", reporter: "agent-1", metadata: { env: "staging" } });
    const tasks = listTasks({ metadata: { env: "prod" } });
    expect(tasks.find(t => t.subject === "Task with metadata")).toBeDefined();
    expect(tasks.find(t => t.subject === "Other")).toBeUndefined();
  });

  test("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      createTask({ subject: `Task ${i}`, reporter: "agent-1" });
    }
    const tasks = listTasks({ limit: 3 });
    expect(tasks).toHaveLength(3);
  });

  test("orders by priority then date", () => {
    createTask({ subject: "Low", reporter: "agent-1", priority: "low" });
    createTask({ subject: "Critical", reporter: "agent-1", priority: "critical" });
    createTask({ subject: "High", reporter: "agent-1", priority: "high" });
    const tasks = listTasks({ limit: 10 });
    expect(tasks[0].priority).toBe("critical");
  });

  test("excludes cancelled by default", () => {
    const t = createTask({ subject: "Cancel me", reporter: "agent-1" });
    cancelTask(t.id, "agent-1");
    const tasks = listTasks();
    expect(tasks.some(t => t.subject === "Cancel me")).toBe(false);
  });

  test("includes cancelled when include_archived is true", () => {
    const t = createTask({ subject: "Cancel me", reporter: "agent-1" });
    cancelTask(t.id, "agent-1");
    const tasks = listTasks({ include_archived: true });
    expect(tasks.some(t => t.subject === "Cancel me")).toBe(true);
  });

  test("filters by parent_id", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    createTask({ subject: "Child 1", reporter: "agent-1", parent_id: parent.id });
    createTask({ subject: "Child 2", reporter: "agent-1", parent_id: parent.id });
    createTask({ subject: "Orphan", reporter: "agent-1" });

    const subtasks = listTasks({ parent_id: parent.id });
    expect(subtasks).toHaveLength(2);

    const topLevel = listTasks({ parent_id: null });
    expect(topLevel.some(t => t.subject === "Parent")).toBe(true);
  });
});

describe("startTask", () => {
  test("starts a pending task", () => {
    const task = createTask({ subject: "Start me", reporter: "agent-1" });
    const started = startTask(task.id, "agent-1");
    expect(started!.status).toBe("in_progress");
    expect(started!.started_at).not.toBeNull();
  });

  test("fails if dependency is not completed", () => {
    const dep = createTask({ subject: "Dependency", reporter: "agent-1" });
    const task = createTask({ subject: "Blocked", reporter: "agent-1", depends_on: [dep.id] });
    expect(task.status).toBe("blocked");
    expect(() => startTask(task.id, "agent-1")).toThrow(/blocked by/);
  });
});

describe("completeTask", () => {
  test("completes a task", () => {
    const task = createTask({ subject: "Complete me", reporter: "agent-1" });
    startTask(task.id, "agent-1");
    const completed = completeTask(task.id, "agent-1");
    expect(completed!.status).toBe("completed");
    expect(completed!.completed_at).not.toBeNull();
  });
});

describe("auto-unblock", () => {
  test("auto-unblocks dependent task when dependency completes", () => {
    const dep = createTask({ subject: "Dependency", reporter: "agent-1" });
    const task = createTask({ subject: "Dependent", reporter: "agent-1", depends_on: [dep.id] });
    expect(task.status).toBe("blocked");

    startTask(dep.id, "agent-1");
    completeTask(dep.id, "agent-1");

    const updated = getTask(task.id);
    expect(updated!.status).toBe("pending");
  });

  test("does not unblock if multiple deps and one is still incomplete", () => {
    const dep1 = createTask({ subject: "Dep 1", reporter: "agent-1" });
    const dep2 = createTask({ subject: "Dep 2", reporter: "agent-1" });
    const task = createTask({ subject: "Double dep", reporter: "agent-1", depends_on: [dep1.id, dep2.id] });
    expect(task.status).toBe("blocked");

    completeTask(dep1.id, "agent-1");
    const updated = getTask(task.id);
    expect(updated!.status).toBe("blocked");

    completeTask(dep2.id, "agent-1");
    const updated2 = getTask(task.id);
    expect(updated2!.status).toBe("pending");
  });
});

describe("cancelTask", () => {
  test("cancels a task", () => {
    const task = createTask({ subject: "Cancel me", reporter: "agent-1" });
    const cancelled = cancelTask(task.id, "agent-1", { reason: "no longer needed" });
    expect(cancelled!.status).toBe("cancelled");
    expect(cancelled!.cancelled_at).not.toBeNull();
  });
});

describe("blockTask / unblockTask", () => {
  test("manually blocks a task", () => {
    const task = createTask({ subject: "Block me", reporter: "agent-1" });
    const blocked = blockTask(task.id, "agent-1", { reason: "external blocker" });
    expect(blocked!.status).toBe("blocked");
  });

  test("unblocks a task when no dependency blocks it", () => {
    const task = createTask({ subject: "Unblock me", reporter: "agent-1" });
    blockTask(task.id, "agent-1");
    const unblocked = unblockTask(task.id, "agent-1");
    expect(unblocked!.status).toBe("pending");
  });
});

describe("reopenTask", () => {
  test("reopens a completed task", () => {
    const task = createTask({ subject: "Reopen me", reporter: "agent-1" });
    startTask(task.id, "agent-1");
    completeTask(task.id, "agent-1");
    const reopened = reopenTask(task.id, "agent-1");
    expect(reopened!.status).toBe("pending");
    expect(reopened!.completed_at).toBeNull();
  });

  test("re-checks dependencies on reopen", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const task = createTask({ subject: "Reopen dep", reporter: "agent-1", depends_on: [dep.id] });
    completeTask(dep.id, "agent-1");
    startTask(task.id, "agent-1");
    completeTask(task.id, "agent-1");

    reopenTask(task.id, "agent-1");
    // dep is still completed so task should be pending
    const updated = getTask(task.id);
    expect(updated!.status).toBe("pending");
  });
});

describe("assignTask", () => {
  test("assigns a task to an agent", () => {
    const task = createTask({ subject: "Assign me", reporter: "agent-1" });
    const assigned = assignTask(task.id, "agent-2", "agent-1");
    expect(assigned!.assignee).toBe("agent-2");
  });
});

describe("setTaskPriority", () => {
  test("changes task priority", () => {
    const task = createTask({ subject: "Priority", reporter: "agent-1" });
    expect(task.priority).toBe("medium");
    const updated = setTaskPriority(task.id, "critical", "agent-1");
    expect(updated!.priority).toBe("critical");
  });
});

describe("comments", () => {
  test("adds and retrieves comments", () => {
    const task = createTask({ subject: "Commented", reporter: "agent-1" });
    addComment(task.id, "agent-1", "First comment");
    addComment(task.id, "agent-2", "Second comment");

    const comments = getComments(task.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].content).toBe("First comment");
    expect(comments[0].agent).toBe("agent-1");
  });

  test("throws if task not found", () => {
    expect(() => addComment(99999, "agent-1", "orphan")).toThrow(/not found/);
  });
});

describe("subtasks", () => {
  test("gets subtasks of a parent", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    createTask({ subject: "Child 1", reporter: "agent-1", parent_id: parent.id });
    createTask({ subject: "Child 2", reporter: "agent-1", parent_id: parent.id });

    const subtasks = getSubtasks(parent.id);
    expect(subtasks).toHaveLength(2);
  });

  test("builds a task tree", () => {
    const root = createTask({ subject: "Root", reporter: "agent-1" });
    const child1 = createTask({ subject: "Child 1", reporter: "agent-1", parent_id: root.id });
    const child2 = createTask({ subject: "Child 2", reporter: "agent-1", parent_id: root.id });
    createTask({ subject: "Grandchild", reporter: "agent-1", parent_id: child1.id });

    const tree = getTaskTree(root.id);
    expect(tree.subject).toBe("Root");
    expect(tree.children).toHaveLength(2);
    const child0 = tree.children[0] as typeof tree;
    expect(child0.children).toHaveLength(1);
  });

  test("respects maxDepth", () => {
    const root = createTask({ subject: "Root", reporter: "agent-1" });
    createTask({ subject: "Child", reporter: "agent-1", parent_id: root.id });

    const tree = getTaskTree(root.id, 0);
    expect(tree.children).toHaveLength(0);
  });
});

describe("dependencies", () => {
  test("adds a dependency", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const task = createTask({ subject: "Task", reporter: "agent-1" });

    addDependency(task.id, dep.id);
    const deps = getDependencies(task.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(dep.id);
  });

  test("auto-blocks task when dependency is not completed", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const task = createTask({ subject: "Task", reporter: "agent-1" });
    addDependency(task.id, dep.id);

    const updated = getTask(task.id);
    expect(updated!.status).toBe("blocked");
  });

  test("prevents circular dependency", () => {
    const a = createTask({ subject: "A", reporter: "agent-1" });
    const b = createTask({ subject: "B", reporter: "agent-1" });

    addDependency(b.id, a.id);
    expect(() => addDependency(a.id, b.id)).toThrow(/circular/i);
  });

  test("prevents self-dependency", () => {
    const task = createTask({ subject: "Self", reporter: "agent-1" });
    expect(() => addDependency(task.id, task.id)).toThrow(/itself/);
  });

  test("removes a dependency", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const task = createTask({ subject: "Task", reporter: "agent-1" });
    addDependency(task.id, dep.id);
    removeDependency(task.id, dep.id);

    const deps = getDependencies(task.id);
    expect(deps).toHaveLength(0);
  });

  test("getDependents returns tasks that depend on a given task", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const a = createTask({ subject: "A", reporter: "agent-1" });
    const b = createTask({ subject: "B", reporter: "agent-1" });
    addDependency(a.id, dep.id);
    addDependency(b.id, dep.id);

    const dependents = getDependents(dep.id);
    expect(dependents).toHaveLength(2);
  });

  test("throws if dependency task not found", () => {
    const task = createTask({ subject: "Task", reporter: "agent-1" });
    expect(() => addDependency(task.id, 99999)).toThrow(/not found/);
  });
});

describe("activity", () => {
  test("logs activity on task creation", () => {
    const task = createTask({ subject: "Activity", reporter: "agent-1" });
    const activity = getTaskActivity(task.id);
    expect(activity.length).toBeGreaterThanOrEqual(1);
    expect(activity[0].action).toBe("created");
  });

  test("accumulates activity through transitions", () => {
    const task = createTask({ subject: "Lifecycle", reporter: "agent-1" });
    startTask(task.id, "agent-1");
    completeTask(task.id, "agent-1", { evidence: "done" });
    reopenTask(task.id, "agent-1");

    const activity = getTaskActivity(task.id);
    const actions = activity.map(a => a.action);
    expect(actions).toContain("created");
    expect(actions).toContain("started");
    expect(actions).toContain("completed");
    expect(actions).toContain("reopened");
  });

  test("respects limit", () => {
    const task = createTask({ subject: "Limit", reporter: "agent-1" });
    for (let i = 0; i < 10; i++) addComment(task.id, "agent-1", `comment ${i}`);
    const activity = getTaskActivity(task.id, 3);
    expect(activity).toHaveLength(3);
  });
});

describe("deleteTask", () => {
  test("deletes a task", () => {
    const task = createTask({ subject: "Delete me", reporter: "agent-1" });
    const deleted = deleteTask(task.id, "agent-1");
    expect(deleted).toBe(true);
    expect(getTask(task.id)).toBeNull();
  });

  test("fails if subtasks exist", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    createTask({ subject: "Child", reporter: "agent-1", parent_id: parent.id });
    expect(() => deleteTask(parent.id)).toThrow(/subtask/);
  });
});

describe("getDueTasks", () => {
  function hoursFromNow(hours: number): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  test("returns empty when no tasks have due dates", () => {
    createTask({ subject: "No due", reporter: "agent-1" });
    const due = getDueTasks();
    expect(due).toHaveLength(0);
  });

  test("excludes completed and cancelled tasks", () => {
    const t1 = createTask({ subject: "Done", reporter: "agent-1", due_at: hoursFromNow(-1) });
    const t2 = createTask({ subject: "Cancelled", reporter: "agent-1", due_at: hoursFromNow(-1) });
    startTask(t1.id, "agent-1");
    completeTask(t1.id, "agent-1");
    cancelTask(t2.id, "agent-1", { reason: "nope" });
    const due = getDueTasks();
    expect(due.some(d => d.task.subject === "Done")).toBe(false);
    expect(due.some(d => d.task.subject === "Cancelled")).toBe(false);
  });

  test("marks overdue tasks", () => {
    createTask({ subject: "Late", reporter: "agent-1", due_at: hoursFromNow(-2) });
    const due = getDueTasks();
    expect(due).toHaveLength(1);
    expect(due[0].urgency).toBe("overdue");
    expect(due[0].due_in_hours).toBeLessThan(0);
  });

  test("marks tasks due within 24h as due_today", () => {
    createTask({ subject: "Soon", reporter: "agent-1", due_at: hoursFromNow(5) });
    const due = getDueTasks();
    expect(due).toHaveLength(1);
    expect(due[0].urgency).toBe("due_today");
    expect(due[0].due_in_hours).toBeGreaterThan(0);
  });

  test("marks tasks beyond 24h as due_soon with larger window", () => {
    createTask({ subject: "Later", reporter: "agent-1", due_at: hoursFromNow(36) });
    // Default 24h window should NOT include a 36h task
    const defaultDue = getDueTasks();
    expect(defaultDue).toHaveLength(0);
    // 48h window should include it
    const wideDue = getDueTasks({ window_hours: 48 });
    expect(wideDue).toHaveLength(1);
    expect(wideDue[0].urgency).toBe("due_soon");
    expect(wideDue[0].due_in_hours).toBeGreaterThan(24);
  });

  test("orders by due_at ascending", () => {
    createTask({ subject: "First", reporter: "agent-1", due_at: hoursFromNow(2) });
    createTask({ subject: "Second", reporter: "agent-1", due_at: hoursFromNow(4) });
    createTask({ subject: "Third", reporter: "agent-1", due_at: hoursFromNow(6) });
    const due = getDueTasks();
    expect(due).toHaveLength(3);
    expect(due[0].task.subject).toBe("First");
    expect(due[1].task.subject).toBe("Second");
    expect(due[2].task.subject).toBe("Third");
  });

  test("respects custom window_hours", () => {
    createTask({ subject: "1h", reporter: "agent-1", due_at: hoursFromNow(1) });
    createTask({ subject: "3h", reporter: "agent-1", due_at: hoursFromNow(3) });
    createTask({ subject: "6h", reporter: "agent-1", due_at: hoursFromNow(6) });
    const due = getDueTasks({ window_hours: 2 });
    // Only tasks with due_at <= now + 2h are included
    expect(due).toHaveLength(1);
    expect(due.some(d => d.task.subject === "1h")).toBe(true);
    expect(due.some(d => d.task.subject === "3h")).toBe(false);
    expect(due.some(d => d.task.subject === "6h")).toBe(false);
  });

  test("includes in_progress and blocked tasks", () => {
    const t1 = createTask({ subject: "InProgress", reporter: "agent-1", due_at: hoursFromNow(-1) });
    const t2 = createTask({ subject: "Blocked", reporter: "agent-1", due_at: hoursFromNow(-1) });
    startTask(t1.id, "agent-1");
    blockTask(t2.id, "agent-1");
    const due = getDueTasks();
    expect(due.some(d => d.task.subject === "InProgress")).toBe(true);
    expect(due.some(d => d.task.subject === "Blocked")).toBe(true);
  });
});

describe("getTaskSummary", () => {
  test("returns null for nonexistent task", () => {
    expect(getTaskSummary(99999)).toBeNull();
  });

  test("returns summary for a task with no subtasks or deps", () => {
    const task = createTask({ subject: "Standalone", reporter: "agent-1" });
    const summary = getTaskSummary(task.id);
    expect(summary).not.toBeNull();
    expect(summary!.task.subject).toBe("Standalone");
    expect(summary!.progress.total_subtasks).toBe(0);
    expect(summary!.progress.total_dependencies).toBe(0);
    expect(summary!.progress.completion_pct).toBe(0);
    expect(summary!.blockers).toHaveLength(0);
  });

  test("includes subtask progress", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    const child1 = createTask({ subject: "Child 1", reporter: "agent-1", parent_id: parent.id });
    const child2 = createTask({ subject: "Child 2", reporter: "agent-1", parent_id: parent.id });
    startTask(child1.id, "agent-1");
    completeTask(child1.id, "agent-1");

    const summary = getTaskSummary(parent.id);
    expect(summary!.progress.total_subtasks).toBe(2);
    expect(summary!.progress.completed_subtasks).toBe(1);
  });

  test("includes dependency progress and blockers", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const task = createTask({ subject: "Task", reporter: "agent-1" });
    addDependency(task.id, dep.id);

    const summary = getTaskSummary(task.id);
    expect(summary!.progress.total_dependencies).toBe(1);
    expect(summary!.progress.completed_dependencies).toBe(0);
    expect(summary!.blockers).toHaveLength(1);
    expect(summary!.blockers[0].subject).toBe("Dep");

    completeTask(dep.id, "agent-1");
    const summary2 = getTaskSummary(task.id);
    expect(summary2!.progress.completed_dependencies).toBe(1);
    expect(summary2!.blockers).toHaveLength(0);
  });

  test("includes dependents", () => {
    const dep = createTask({ subject: "Dep", reporter: "agent-1" });
    const a = createTask({ subject: "A", reporter: "agent-1" });
    const b = createTask({ subject: "B", reporter: "agent-1" });
    addDependency(a.id, dep.id);
    addDependency(b.id, dep.id);

    const summary = getTaskSummary(dep.id);
    expect(summary!.dependents).toHaveLength(2);
  });

  test("includes recent activity", () => {
    const task = createTask({ subject: "Active", reporter: "agent-1" });
    startTask(task.id, "agent-1");
    addComment(task.id, "agent-1", "on it");

    const summary = getTaskSummary(task.id);
    const actions = summary!.recent_activity.map(a => a.action);
    expect(actions).toContain("started");
    expect(actions).toContain("comment");
  });

  test("100% completion when task is completed with no subtasks/deps", () => {
    const task = createTask({ subject: "Done", reporter: "agent-1" });
    startTask(task.id, "agent-1");
    completeTask(task.id, "agent-1");

    const summary = getTaskSummary(task.id);
    expect(summary!.progress.completion_pct).toBe(100);
  });

  test("partial completion with mixed subtasks", () => {
    const parent = createTask({ subject: "Parent", reporter: "agent-1" });
    createTask({ subject: "C1", reporter: "agent-1", parent_id: parent.id });
    createTask({ subject: "C2", reporter: "agent-1", parent_id: parent.id });
    const c3 = createTask({ subject: "C3", reporter: "agent-1", parent_id: parent.id });
    startTask(c3.id, "agent-1");
    completeTask(c3.id, "agent-1");

    const summary = getTaskSummary(parent.id);
    // 1 of 3 subtasks completed
    expect(summary!.progress.completed_subtasks).toBe(1);
    expect(summary!.progress.completion_pct).toBe(33); // round(1/3 * 100)
  });
});

describe("searchTasks", () => {
  test("returns empty for no matches", () => {
    createTask({ subject: "Hello world", reporter: "agent-1" });
    const results = searchTasks({ query: "nonexistent" });
    expect(results).toHaveLength(0);
  });

  test("finds task by subject match", () => {
    createTask({ subject: "Fix auth bug", reporter: "agent-1" });
    createTask({ subject: "Update docs", reporter: "agent-1" });
    const results = searchTasks({ query: "auth" });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("Fix auth bug");
  });

  test("finds task by description match", () => {
    createTask({ subject: "Task A", description: "Implement OAuth2 flow", reporter: "agent-1" });
    const results = searchTasks({ query: "OAuth" });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("Task A");
  });

  test("finds task by tag match", () => {
    createTask({ subject: "Tagged task", reporter: "agent-1", tags: ["sdk", "backend"] });
    const results = searchTasks({ query: "backend" });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("Tagged task");
  });

  test("filters by status", () => {
    createTask({ subject: "Pending task", reporter: "agent-1" });
    const t2 = createTask({ subject: "Started task", reporter: "agent-1" });
    startTask(t2.id, "agent-1");
    const results = searchTasks({ query: "task", status: "pending" });
    expect(results.every(r => r.status === "pending")).toBe(true);
  });

  test("excludes cancelled by default", () => {
    createTask({ subject: "Active", reporter: "agent-1" });
    const t2 = createTask({ subject: "Gone", reporter: "agent-1" });
    cancelTask(t2.id, "agent-1");
    const results = searchTasks({ query: "task" });
    expect(results.some(r => r.subject === "Gone")).toBe(false);
  });

  test("includes cancelled with include_archived", () => {
    createTask({ subject: "Active task", reporter: "agent-1" });
    const t2 = createTask({ subject: "Cancelled task", reporter: "agent-1" });
    cancelTask(t2.id, "agent-1");
    // Without include_archived, cancelled tasks are excluded
    const withoutArchived = searchTasks({ query: "task" });
    expect(withoutArchived.some(r => r.subject === "Cancelled task")).toBe(false);
    // With include_archived, cancelled tasks are included
    const withArchived = searchTasks({ query: "task", include_archived: true });
    expect(withArchived.some(r => r.subject === "Cancelled task")).toBe(true);
  });

  test("returns snippet and relevance score", () => {
    createTask({ subject: "Search test", reporter: "agent-1" });
    const results = searchTasks({ query: "Search" });
    expect(results).toHaveLength(1);
    expect(results[0].relevance_score).toBeGreaterThanOrEqual(0);
  });

  test("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      createTask({ subject: `Searchable task ${i}`, reporter: "agent-1" });
    }
    const results = searchTasks({ query: "Searchable", limit: 3 });
    expect(results).toHaveLength(3);
  });
});
