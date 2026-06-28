import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventsClient } from "@hasna/events";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import type { Task } from "../types/index.js";
import { emitSharedTaskEvent, shouldEmitSharedTaskEvents } from "./shared-events.js";

let tempDir = "";
const originalHome = process.env["HOME"];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-shared-events-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["HASNA_EVENTS_DIR"] = join(tempDir, "events");
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_EVENTS_DIR"];
  delete process.env["HASNA_EVENTS_HOME"];
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("shared task events", () => {
  test("enriches task.created events with project and task-list routing metadata", async () => {
    const db = getDatabase();
    const project = createProject({
      name: "open-events",
      path: "/home/hasna/workspace/hasna/opensource/open-events",
      task_list_id: "todos-open-events",
    }, db);
    const taskList = createTaskList({
      name: "open-events",
      slug: "todos-open-events",
      project_id: project.id,
    }, db);
    const task = makeTask({
      project_id: project.id,
      task_list_id: taskList.id,
      working_dir: null,
      short_id: "OEV-1",
      metadata: { route_enabled: true, automation: { no_auto: false } },
    });

    await emitSharedTaskEvent({ type: "task.created", task });

    const events = await new EventsClient().listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      package: "@hasna/todos",
      todos_event_schema_version: 1,
      task_id: task.id,
      task_short_id: "OEV-1",
      project_id: project.id,
      project_name: "open-events",
      project_path: "/home/hasna/workspace/hasna/opensource/open-events",
      project_canonical_path: "/home/hasna/workspace/hasna/opensource/open-events",
      project_default_task_list_slug: "todos-open-events",
      project_kind: "open-source",
      route_enabled: true,
      automation: { no_auto: false },
      working_dir: "/home/hasna/workspace/hasna/opensource/open-events",
      root_project_id: project.id,
      task_list_id: taskList.id,
      task_list_slug: "todos-open-events",
      task_list_name: "open-events",
      task_list_project_id: project.id,
      task_list_is_project_default: true,
    });
  });

  test("promotes approval and routing-safe automation fields into task.created events", async () => {
    const task = makeTask({
      requires_approval: true,
      metadata: {
        route_enabled: "true",
        automation: {
          noAuto: "true",
          manualRequired: "false",
        },
      },
    });

    await emitSharedTaskEvent({ type: "task.created", task });

    const [event] = await new EventsClient().listEvents();
    expect(event.data.requires_approval).toBe(true);
    expect(event.metadata.route_enabled).toBe(true);
    expect(event.metadata.automation).toEqual({
      no_auto: true,
      manual_required: false,
      requires_approval: true,
    });
  });

  test("does not leak routeable temp-db tasks into the default shared event store", async () => {
    closeDatabase();
    resetDatabase();
    delete process.env["HASNA_EVENTS_DIR"];
    process.env["HOME"] = join(tempDir, "home");
    process.env["TODOS_DB_PATH"] = join(tempDir, "scratch", "todos.db");

    expect(shouldEmitSharedTaskEvents()).toBe(false);

    process.env["HASNA_EVENTS_HOME"] = join(tempDir, "events-home");
    expect(shouldEmitSharedTaskEvents()).toBe(true);
    delete process.env["HASNA_EVENTS_HOME"];
    expect(shouldEmitSharedTaskEvents()).toBe(false);

    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({
        title: "Routeable task",
        working_dir: "/home/hasna/workspace/hasna/opensource/open-todos",
        metadata: { route_enabled: true, fingerprint: "route:cli:1" },
      }),
    });
  });

  test("metadata can drive positive and negative open-source route delivery", async () => {
    const db = getDatabase();
    const outputPath = join(tempDir, "captured-events.jsonl");
    const receiverPath = join(tempDir, "receiver.js");
    writeFileSync(receiverPath, `const fs = require("node:fs"); fs.appendFileSync(${JSON.stringify(outputPath)}, process.env.HASNA_EVENT_JSON + "\\n");\n`);
    const events = new EventsClient();
    await events.addChannel({
      id: "open-source-route",
      enabled: true,
      transport: "command",
      command: { command: "bun", args: [receiverPath], timeoutMs: 5000 },
      filters: [{
        source: "todos",
        type: "task.created",
        metadata: {
          project_kind: "open-source",
          route_enabled: true,
          "automation.no_auto": { not: true },
          "automation.requires_approval": { not: true },
          "automation.approval_required": { not: true },
          "automation.manual_required": { not: true },
        },
      }],
    });

    const openProject = createProject({ name: "open-loops", path: "/home/hasna/workspace/hasna/opensource/open-loops" }, db);
    const privateProject = createProject({ name: "private-app", path: "/home/hasna/workspace/hasna/private/private-app" }, db);

    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({ project_id: openProject.id, working_dir: openProject.path, title: "Open-source routed task", metadata: { route_enabled: true } }),
    });
    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({
        project_id: openProject.id,
        working_dir: openProject.path,
        title: "Open-source task without route opt-in",
      }),
    });
    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({
        project_id: openProject.id,
        working_dir: openProject.path,
        title: "Open-source task with no-auto metadata",
        metadata: { route_enabled: true, automation: { no_auto: true } },
      }),
    });
    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({
        project_id: openProject.id,
        working_dir: openProject.path,
        title: "Open-source task requiring approval",
        metadata: { route_enabled: true },
        requires_approval: true,
      }),
    });
    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({ project_id: privateProject.id, working_dir: privateProject.path, title: "Private unrouted task", metadata: { route_enabled: true } }),
    });

    for (let attempt = 0; attempt < 20 && !existsSync(outputPath); attempt += 1) {
      await Bun.sleep(50);
    }
    expect(existsSync(outputPath)).toBe(true);
    const delivered = readFileSync(outputPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(delivered).toHaveLength(1);
    expect(delivered[0].data.title).toBe("Open-source routed task");
    expect(delivered[0].metadata.project_kind).toBe("open-source");
  });

  test("omits route_enabled by default so broad routes fail closed", async () => {
    const db = getDatabase();
    const generic = createProject({ name: "open-events", path: "/home/hasna/workspace/hasna/opensource/open-events" }, db);

    await emitSharedTaskEvent({ type: "task.created", task: makeTask({ project_id: generic.id }) });

    const events = await new EventsClient().listEvents();
    expect(events[0].metadata.route_enabled).toBeUndefined();
  });

  test("resolves legacy task_list_id slugs without claiming they are ids", async () => {
    const db = getDatabase();
    const project = createProject({
      name: "open-events",
      path: "/home/hasna/workspace/hasna/opensource/open-events",
      task_list_id: "todos-open-events",
    }, db);
    const taskList = createTaskList({ name: "open-events", slug: "todos-open-events", project_id: project.id }, db);

    await emitSharedTaskEvent({
      type: "task.created",
      task: makeTask({ project_id: project.id, task_list_id: "todos-open-events" }),
    });

    const [event] = await new EventsClient().listEvents();
    expect(event.metadata.task_list_id).toBe(taskList.id);
    expect(event.metadata.task_list_slug).toBe("todos-open-events");
  });

  test("marks worktree paths without inventing a root project id", async () => {
    const db = getDatabase();
    const project = createProject({
      name: "macos-worktree",
      path: "/home/hasna/workspace/hasna/opensource/open-codewith/.codewith/worktrees/macos",
    }, db);

    await emitSharedTaskEvent({ type: "task.created", task: makeTask({ project_id: project.id }) });

    const [event] = await new EventsClient().listEvents();
    expect(event.metadata.project_is_worktree).toBe(true);
    expect(event.metadata.root_project_id).toBe(null);
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  const timestamp = new Date().toISOString();
  return {
    id: randomUUID(),
    short_id: null,
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: "Shared event task",
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    started_at: null,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 3,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    ...overrides,
  };
}
