import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { resetConfig, updateConfig } from "./config.js";
import {
  getTaskWorkflowState,
  listWorkflowStates,
  migrateWorkflowStates,
  queryTasksByWorkflowState,
  resolveWorkflowState,
  setTaskWorkflowState,
} from "./workflow-states.js";

let db: Database;
let testHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  testHome = mkdtempSync(join(tmpdir(), "todos-workflow-states-home-"));
  process.env["HOME"] = testHome;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  resetConfig();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(testHome, { recursive: true, force: true });
  resetConfig();
});

describe("local workflow states", () => {
  test("keeps defaults simple and resolves aliases to canonical statuses", () => {
    expect(listWorkflowStates().map((state) => state.name)).toEqual([
      "pending",
      "in_progress",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(resolveWorkflowState("done").state).toMatchObject({
      name: "completed",
      canonical_status: "completed",
    });
  });

  test("sets custom workflow states in metadata while preserving canonical status", () => {
    updateConfig({
      workflow_states: {
        states: [
          { name: "review", canonical_status: "in_progress", aliases: ["pr"], transitions: ["released", "blocked"] },
          { name: "blocked", canonical_status: "pending", transitions: ["review"] },
          { name: "released", canonical_status: "completed", terminal: true },
        ],
      },
    });
    const task = createTask({ title: "Reviewable task" }, db);

    const updated = setTaskWorkflowState(task.id, "pr", { actor: "codex" }, db);
    expect(updated.task.status).toBe("in_progress");
    expect(updated.workflow_state.name).toBe("review");
    expect(getTaskWorkflowState(task.id, db).name).toBe("review");
    expect(queryTasksByWorkflowState({ state: "review" }, db).tasks.map((match) => match.id)).toEqual([task.id]);

    const stored = getTask(task.id, db)!;
    expect(stored.metadata.local_fields).toMatchObject({
      custom: { workflow_state: "review" },
    });
  });

  test("enforces configured transitions between custom states", () => {
    updateConfig({
      workflow_states: {
        states: [
          { name: "review", canonical_status: "in_progress", transitions: ["released"] },
          { name: "blocked", canonical_status: "pending", transitions: ["review"] },
          { name: "released", canonical_status: "completed", terminal: true },
        ],
      },
    });
    const task = createTask({ title: "Guarded task" }, db);
    setTaskWorkflowState(task.id, "review", {}, db);

    expect(() => setTaskWorkflowState(task.id, "blocked", {}, db)).toThrow(/Cannot transition/);
    expect(setTaskWorkflowState(task.id, "released", {}, db).workflow_state.name).toBe("released");
  });

  test("migrates existing tasks from canonical statuses into configured local states", () => {
    updateConfig({
      workflow_states: {
        states: [
          { name: "backlog", canonical_status: "pending" },
          { name: "doing", canonical_status: "in_progress" },
          { name: "released", canonical_status: "completed", terminal: true },
        ],
      },
    });
    const pending = createTask({ title: "Pending task" }, db);
    const active = createTask({ title: "Active task", status: "in_progress" }, db);
    createTask({ title: "Failed task", status: "failed" }, db);

    const preview = migrateWorkflowStates({ apply: false }, db);
    expect(preview.applied).toBe(false);
    expect(preview.migrated_count).toBe(0);
    expect(preview.pending_count).toBe(3);

    const applied = migrateWorkflowStates({ apply: true }, db);
    expect(applied.applied).toBe(true);
    expect(applied.migrated_count).toBe(3);
    expect(getTaskWorkflowState(pending.id, db).name).toBe("backlog");
    expect(getTaskWorkflowState(active.id, db).name).toBe("doing");
  });
});
