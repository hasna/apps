import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask, getTask } from "../db/tasks.js";
import { createTaskList } from "../db/task-lists.js";
import { getTaskRouteState, setTaskWorkflowPointers } from "./task-routing.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("task route state", () => {
  test("fails closed until a task or task list opts into routing", () => {
    const task = createTask({ title: "Unrouted task" });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(false);
    expect(state.reasons).toContain("route_not_enabled");
    expect(state.gates.route_enabled).toBe(false);
  });

  test("marks a pending unblocked route-enabled task as eligible", () => {
    const task = createTask({
      title: "Route me",
      metadata: { route_enabled: true },
    });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(true);
    expect(state.reasons).toEqual([]);
    expect(state.route.concurrency_key).toBe(`task:${task.id}`);
  });

  test("treats auto route tags as explicit opt-in before task-list defaults", () => {
    const project = createProject({ name: "open-events", path: "/home/hasna/workspace/hasna/opensource/open-events" });
    const taskList = createTaskList({
      name: "open-events",
      slug: "todos-open-events",
      project_id: project.id,
      metadata: { route_enabled: false },
    });
    const task = createTask({ title: "Tag routed", project_id: project.id, task_list_id: taskList.id, tags: ["auto:route"] });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(true);
    expect(state.gates.tag_opt_in).toBe(true);
    expect(state.gates.route_enabled).toBe(true);
  });

  test("inherits route-enabled defaults from the task list", () => {
    const project = createProject({ name: "open-loops", path: "/home/hasna/workspace/hasna/opensource/open-loops" });
    const taskList = createTaskList({
      name: "open-loops",
      slug: "todos-open-loops",
      project_id: project.id,
      metadata: { route_enabled: true, automation: { no_auto: false } },
    });
    const task = createTask({ title: "Inherited route", project_id: project.id, task_list_id: taskList.id });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(true);
    expect(state.gates.route_enabled).toBe(true);
    expect(state.route.project_kind).toBe("open-source");
    expect(state.route.task_list_slug).toBe("todos-open-loops");
    expect(state.route.concurrency_key).toBe(`project:${project.id}`);
  });

  test("blocks automation for manual no-auto and approval gates", () => {
    const noAuto = createTask({
      title: "No auto",
      metadata: { route_enabled: true, automation: { no_auto: true } },
    });
    const approval = createTask({
      title: "Approval",
      metadata: { route_enabled: true },
      requires_approval: true,
    });

    expect(getTaskRouteState(noAuto.id).reasons).toContain("no_auto");
    expect(getTaskRouteState(approval.id).reasons).toContain("requires_approval");
  });

  test("does not let task metadata bypass task-list denial gates", () => {
    const project = createProject({ name: "open-hooks", path: "/home/hasna/workspace/hasna/opensource/open-hooks" });
    const taskList = createTaskList({
      name: "open-hooks",
      slug: "todos-open-hooks",
      project_id: project.id,
      metadata: { route_enabled: true, automation: { no_auto: true, manual_required: true } },
    });
    const task = createTask({
      title: "Attempted bypass",
      project_id: project.id,
      task_list_id: taskList.id,
      metadata: { route_enabled: true, automation: { no_auto: false, manual_required: false } },
    });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(false);
    expect(state.reasons).toEqual(expect.arrayContaining(["no_auto", "manual_required"]));
    expect(state.automation).toMatchObject({ no_auto: true, manual_required: true });
  });

  test("updates compact workflow invocation pointers through task metadata", () => {
    const task = createTask({ title: "Routed task", metadata: { route_enabled: true } });

    const updated = setTaskWorkflowPointers(task.id, {
      current_workflow_invocation_id: "inv_123",
      current_run_id: "run_456",
      latest_manifest_path: "/home/hasna/.hasna/loops/runs/open-codewith/task/run_456/manifest.json",
      latest_evaluation_path: "/home/hasna/.hasna/loops/runs/open-codewith/task/run_456/evaluation.md",
      workflow_state: "working",
      actor: "route-test",
    });

    expect(updated.version).toBe(task.version + 1);
    const persisted = getTask(task.id)!;
    expect(persisted.metadata.current_workflow_invocation_id).toBe("inv_123");
    expect((persisted.metadata.workflow_invocation as Record<string, unknown>).updated_by).toBe("route-test");
    expect(getTaskRouteState(task.id).pointers).toMatchObject({
      current_workflow_invocation_id: "inv_123",
      current_run_id: "run_456",
      workflow_state: "working",
    });

    const cleared = setTaskWorkflowPointers(task.id, {
      current_workflow_invocation_id: null,
      current_run_id: null,
      latest_manifest_path: null,
      latest_evaluation_path: null,
      workflow_state: "cancelled",
      actor: "route-test",
    });
    expect(cleared.metadata.current_workflow_invocation_id).toBeUndefined();
    expect(cleared.metadata.current_run_id).toBeUndefined();
    expect(getTaskRouteState(task.id).pointers).toEqual({ workflow_state: "cancelled" });
  });
});
