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

  test("records auto route tags as task intent without standalone authorization", () => {
    const project = createProject({ name: "events", path: "/workspace/events" });
    const taskList = createTaskList({
      name: "events",
      slug: "todos-events",
      project_id: project.id,
      metadata: { route_enabled: false },
    });
    const task = createTask({ title: "Tag routed", project_id: project.id, task_list_id: taskList.id, tags: ["auto:route"] });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(false);
    expect(state.reasons).toContain("route_not_enabled");
    expect(state.gates.tag_opt_in).toBe(true);
    expect(state.gates.route_enabled).toBe(false);
  });

  test("inherits route-enabled defaults from the task list", () => {
    const project = createProject({ name: "loops", path: "/workspace/loops" });
    const taskList = createTaskList({
      name: "loops",
      slug: "todos-loops",
      project_id: project.id,
      metadata: { route_enabled: true, project_kind: "repository", automation: { no_auto: false } },
    });
    const task = createTask({ title: "Inherited route", project_id: project.id, task_list_id: taskList.id });

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(true);
    expect(state.gates.route_enabled).toBe(true);
    expect(state.route.project_kind).toBe("repository");
    expect(state.route.task_list_slug).toBe("todos-loops");
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
    const project = createProject({ name: "hooks", path: "/workspace/hooks" });
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

  test("auto:route tag authorizes routing when route_enabled is unset (matches the drain)", () => {
    const task = createTask({ title: "Tag routed", tags: ["auto:route"] });

    const state = getTaskRouteState(task.id);

    expect(state.gates.tag_opt_in).toBe(true);
    expect(state.gates.route_enabled).toBe(true);
    expect(state.eligible).toBe(true);
    expect(state.reasons).toEqual([]);
    expect(state.route_class).toBe("eligible");
  });

  test("explicit route_enabled:false denies even when the auto:route tag is present", () => {
    const task = createTask({
      title: "Explicit deny",
      tags: ["auto:route"],
      metadata: { route_enabled: false },
    });

    const state = getTaskRouteState(task.id);

    expect(state.gates.tag_opt_in).toBe(true);
    expect(state.gates.route_enabled).toBe(false);
    expect(state.eligible).toBe(false);
    expect(state.reasons).toContain("route_not_enabled");
    expect(state.route_class).toBe("unroutable");
  });

  test("auto:route plus no-auto TAGS is never a silent normal candidate", () => {
    // Real-world contradiction: the fleet gates with the no-auto TAG, not only
    // automation metadata. auto:route must not override it.
    const task = createTask({
      title: "Contradictory tags",
      tags: ["auto:route", "no-auto"],
    });

    const state = getTaskRouteState(task.id);

    expect(state.gates.tag_opt_in).toBe(true);
    expect(state.gates.route_enabled).toBe(true);
    expect(state.gates.no_auto).toBe(true);
    expect(state.eligible).toBe(false);
    expect(state.reasons).toContain("no_auto");
    expect(state.route_class).toBe("unroutable");
  });

  test("stale in_progress routed task exposes owner and run evidence", () => {
    const task = createTask({
      title: "In flight",
      tags: ["auto:route"],
      status: "in_progress",
      assigned_to: "cli",
    });
    setTaskWorkflowPointers(task.id, {
      current_workflow_invocation_id: "inv_stale",
      current_run_id: "run_stale",
      workflow_state: "working",
      actor: "route-test",
    });
    getDatabase().query("UPDATE tasks SET updated_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", task.id);

    const state = getTaskRouteState(task.id);

    expect(state.eligible).toBe(false);
    expect(state.reasons).toContain("task_not_pending");
    expect(state.route_class).toBe("in_progress");
    expect(state.evidence.owner).toBe("cli");
    expect(state.evidence.current_run_id).toBe("run_stale");
    expect(state.evidence.current_workflow_invocation_id).toBe("inv_stale");
    expect(state.evidence.stale).toBe(true);
  });

  test("verifyProjectRoot surfaces a missing project root before admission", () => {
    const task = createTask({
      title: "Missing root",
      tags: ["auto:route"],
      working_dir: "/nonexistent/route-state/missing-root",
    });

    const withoutCheck = getTaskRouteState(task.id);
    expect(withoutCheck.eligible).toBe(true);
    expect(withoutCheck.gates.missing_project_root).toBe(false);
    expect(withoutCheck.evidence.project_root_exists).toBeNull();

    const withCheck = getTaskRouteState(task.id, undefined, { verifyProjectRoot: true });
    expect(withCheck.eligible).toBe(false);
    expect(withCheck.gates.missing_project_root).toBe(true);
    expect(withCheck.reasons).toContain("missing_project_root");
    expect(withCheck.route_class).toBe("missing_metadata");
    expect(withCheck.evidence.project_root_verified).toBe(true);
    expect(withCheck.evidence.project_root_exists).toBe(false);
  });

  test("distinguishes an in-flight dedupe from a terminal requeue for eligible tasks", () => {
    const active = createTask({ title: "Active work", tags: ["auto:route"] });
    setTaskWorkflowPointers(active.id, {
      current_workflow_invocation_id: "inv_active",
      workflow_state: "working",
      actor: "route-test",
    });
    const stale = createTask({ title: "Dead work", tags: ["auto:route"] });
    setTaskWorkflowPointers(stale.id, {
      current_workflow_invocation_id: "inv_dead",
      workflow_state: "failed",
      actor: "route-test",
    });

    const activeState = getTaskRouteState(active.id);
    expect(activeState.eligible).toBe(true);
    expect(activeState.gates.workflow_pointer_active).toBe(true);
    expect(activeState.route_class).toBe("deduped_active");

    const staleState = getTaskRouteState(stale.id);
    expect(staleState.eligible).toBe(true);
    expect(staleState.gates.workflow_pointer_terminal).toBe(true);
    expect(staleState.route_class).toBe("terminal_requeue_needed");
  });
});
