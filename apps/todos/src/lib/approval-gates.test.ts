import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTaskHistory } from "../db/audit.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { getTaskRunLedger, startTaskRun } from "../db/task-runs.js";
import { createTask } from "../db/tasks.js";
import {
  approveApprovalGate,
  assertApprovalGate,
  checkApprovalGate,
  expireApprovalGate,
  listApprovalGates,
  rejectApprovalGate,
  requestApprovalGate,
} from "./approval-gates.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local approval gates", () => {
  test("requires and approves a manual checkpoint with task and run audit evidence", () => {
    const db = getDatabase();
    const task = createTask({ title: "Risky task" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "deploy run" }, db);

    const pending = requestApprovalGate({
      task_id: task.id,
      gate: "deploy",
      requester: "codex",
      reviewer: "reviewer",
      reason: "production-affecting action",
      plan_id: "plan-1",
      run_id: run.id,
    }, db);
    expect(pending.status).toBe("pending");
    expect(checkApprovalGate(task.id, "deploy", db).allowed).toBe(false);

    const approved = approveApprovalGate({ task_id: task.id, gate: "deploy", reviewer: "reviewer", note: "safe to proceed" }, db);
    expect(approved.status).toBe("approved");
    expect(assertApprovalGate(task.id, "deploy", db).reviewer).toBe("reviewer");

    const history = getTaskHistory(task.id, db);
    expect(history.map((item) => item.action)).toEqual(expect.arrayContaining([
      "approval_gate.requested",
      "approval_gate.approved",
    ]));
    const runEvents = getTaskRunLedger(run.id, db).events.map((event) => event.message);
    expect(runEvents).toEqual(expect.arrayContaining([
      "approval gate requested: deploy",
      "approval gate approved: deploy",
    ]));
  });

  test("denies rejected gates and prevents approval bypass", () => {
    const db = getDatabase();
    const task = createTask({ title: "Blocked task" }, db);
    requestApprovalGate({ task_id: task.id, gate: "secrets", requester: "codex" }, db);
    const rejected = rejectApprovalGate({ task_id: task.id, gate: "secrets", reviewer: "reviewer", reason: "unsafe" }, db);

    expect(rejected.status).toBe("rejected");
    const check = checkApprovalGate(task.id, "secrets", db);
    expect(check.allowed).toBe(false);
    expect(check.reasons).toContain("approval gate secrets is rejected");
    expect(() => assertApprovalGate(task.id, "secrets", db)).toThrow("approval gate secrets is rejected");
    expect(() => approveApprovalGate({ task_id: task.id, gate: "secrets", reviewer: "late" }, db)).toThrow("already rejected");
  });

  test("detects and records expired approval gates", () => {
    const db = getDatabase();
    const task = createTask({ title: "Expiring task" }, db);
    requestApprovalGate({
      task_id: task.id,
      gate: "release",
      requester: "codex",
      expires_at: "2000-01-01T00:00:00.000Z",
    }, db);

    const check = checkApprovalGate(task.id, "release", db);
    expect(check.allowed).toBe(false);
    expect(check.reasons).toEqual(expect.arrayContaining([
      "approval gate release is pending",
      "approval gate release is expired",
    ]));
    expect(() => approveApprovalGate({ task_id: task.id, gate: "release", reviewer: "reviewer" }, db)).toThrow("expired");

    const expired = expireApprovalGate({ task_id: task.id, gate: "release", reviewer: "codex", reason: "deadline elapsed" }, db);
    expect(expired.status).toBe("expired");
    expect(listApprovalGates(task.id, db)[0]!.status).toBe("expired");
  });

  test("requires an existing approved gate before risky work can proceed", () => {
    const db = getDatabase();
    const task = createTask({ title: "Needs explicit gate" }, db);

    const missing = checkApprovalGate(task.id, "deploy", db);
    expect(missing.allowed).toBe(false);
    expect(missing.reasons).toContain("approval gate is required: deploy");
    expect(() => assertApprovalGate(task.id, "deploy", db)).toThrow("approval gate is required");
  });
});
