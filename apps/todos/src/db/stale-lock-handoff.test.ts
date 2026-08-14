import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createTask, getTask, handoffStaleTaskLock } from "./tasks.js";
import { getTaskHistory } from "./audit.js";
import { receiptFromStaleLockHandoffHistory } from "../lib/stale-lock-handoff.js";
import { importSqliteTodosStorageSnapshot } from "../storage/sqlite-snapshot.js";
import type { TodosStorageSnapshot } from "../storage/interfaces.js";
import { StaleLockHandoffError, type TaskHistory } from "../types/index.js";

const STALE_LOCK_VERSION = "2020-01-01T00:00:00.000Z";
const HOLDER = "holder-a";
const NEW_HOLDER = "nausicaa";

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

function setLock(taskId: string, holder: string, lockVersion: string): void {
  db.run(
    "UPDATE tasks SET locked_by = ?, locked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    [holder, lockVersion, lockVersion, taskId],
  );
}

function historyCount(taskId: string): number {
  return getTaskHistory(taskId, db).length;
}

function input(taskId: string, overrides: Partial<Parameters<typeof handoffStaleTaskLock>[0]> = {}) {
  return {
    task_id: taskId,
    actor: NEW_HOLDER,
    expected_holder: HOLDER,
    expected_lock_version: STALE_LOCK_VERSION,
    stale_after_seconds: 3_600,
    new_holder: NEW_HOLDER,
    reason: "Previous holder stopped reporting and its exact lock is stale.",
    ...overrides,
  };
}

function expectHandoffCode(fn: () => unknown, code: StaleLockHandoffError["code"]): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StaleLockHandoffError);
    expect((error as StaleLockHandoffError).code).toBe(code);
  }
}

function emptySnapshot(overrides: Record<string, unknown> = {}): TodosStorageSnapshot {
  return {
    exportedAt: "2026-08-09T12:00:00.000Z",
    source: "sqlite",
    tasks: [],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [],
    templates: [],
    templateTasks: [],
    auditHistory: [],
    tombstones: [],
    ...overrides,
  } as TodosStorageSnapshot;
}

function protectedHandoffState() {
  const transferred = createTask({ title: "immutable handoff receipt" }, db);
  const control = createTask({ title: "unrelated import control" }, db);
  setLock(transferred.id, HOLDER, STALE_LOCK_VERSION);
  const receipt = handoffStaleTaskLock(input(transferred.id), db);
  const audit = getTaskHistory(transferred.id, db).find((entry) => entry.id === receipt.receipt_id);
  if (!audit) throw new Error("stale-lock handoff receipt history is missing");
  return { transferred, control, receipt, audit };
}

function protectedStateBytes(taskId: string, receiptId: string, controlId: string): string {
  return JSON.stringify({
    receipt: getTaskHistory(taskId, db).find((entry) => entry.id === receiptId) ?? null,
    transferred: getTask(taskId, db),
    control: getTask(controlId, db),
    controlHistory: getTaskHistory(controlId, db),
  });
}

describe("handoffStaleTaskLock — exact SQLite CAS", () => {
  test("transfers one known-stale exact lock and persists a read-back task_history receipt", () => {
    const task = createTask({ title: "stale exact lock" }, db);
    const sibling = createTask({ title: "sibling control" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    setLock(sibling.id, "sibling-holder", STALE_LOCK_VERSION);
    const taskHistoryBefore = historyCount(task.id);
    const siblingBefore = getTask(sibling.id, db);
    const siblingHistoryBefore = historyCount(sibling.id);

    const receipt = handoffStaleTaskLock(input(task.id), db);

    expect(receipt).toMatchObject({
      schema_version: "todos.stale-lock-handoff.v1",
      task_id: task.id,
      actor: NEW_HOLDER,
      previous_holder: HOLDER,
      previous_lock_version: STALE_LOCK_VERSION,
      new_holder: NEW_HOLDER,
      stale_after_seconds: 3_600,
    });
    expect(receipt.receipt_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.new_lock_version).toBe(receipt.created_at);
    expect(receipt.stale_cutoff).toBe(
      new Date(Date.parse(receipt.created_at) - 3_600_000).toISOString(),
    );

    const stored = getTask(task.id, db);
    expect(stored?.locked_by).toBe(NEW_HOLDER);
    expect(stored?.locked_at).toBe(receipt.new_lock_version);

    const history = getTaskHistory(task.id, db);
    expect(history).toHaveLength(taskHistoryBefore + 1);
    const event = history.find((entry) => entry.id === receipt.receipt_id);
    expect(event).toBeDefined();
    expect(receiptFromStaleLockHandoffHistory(event!)).toEqual(receipt);

    // Exact-id control: no project-wide or sibling redistribution.
    expect(getTask(sibling.id, db)).toEqual(siblingBefore);
    expect(historyCount(sibling.id)).toBe(siblingHistoryBefore);
  });

  test("refreshes a same-name stale holder only through exact CAS and a new audit receipt", () => {
    const task = createTask({ title: "same-name stale session" }, db);
    setLock(task.id, NEW_HOLDER, STALE_LOCK_VERSION);
    const historyBefore = historyCount(task.id);

    const receipt = handoffStaleTaskLock(input(task.id, {
      expected_holder: NEW_HOLDER,
    }), db);

    expect(receipt).toMatchObject({
      task_id: task.id,
      actor: NEW_HOLDER,
      previous_holder: NEW_HOLDER,
      previous_lock_version: STALE_LOCK_VERSION,
      new_holder: NEW_HOLDER,
    });
    expect(receipt.new_lock_version).not.toBe(STALE_LOCK_VERSION);
    expect(getTask(task.id, db)).toMatchObject({
      locked_by: NEW_HOLDER,
      locked_at: receipt.new_lock_version,
    });
    expect(historyCount(task.id)).toBe(historyBefore + 1);

    const afterSuccess = getTask(task.id, db);
    const historyAfterSuccess = historyCount(task.id);
    expectHandoffCode(
      () => handoffStaleTaskLock(input(task.id, {
        expected_holder: NEW_HOLDER,
      }), db),
      "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
    );
    expect(getTask(task.id, db)).toEqual(afterSuccess);
    expect(historyCount(task.id)).toBe(historyAfterSuccess);
  });

  test("rejects a known-live lock with the same holder/version shape and changes neither row nor audit", () => {
    const task = createTask({ title: "live exact lock" }, db);
    const liveVersion = new Date().toISOString();
    setLock(task.id, HOLDER, liveVersion);
    const before = getTask(task.id, db);
    const auditBefore = historyCount(task.id);

    expectHandoffCode(
      () => handoffStaleTaskLock(input(task.id, {
        expected_lock_version: liveVersion,
      }), db),
      "STALE_LOCK_HANDOFF_NOT_STALE",
    );

    expect(getTask(task.id, db)).toEqual(before);
    expect(historyCount(task.id)).toBe(auditBefore);
  });

  test("fails closed on holder mismatch, version mismatch, and duplicate replay", () => {
    const task = createTask({ title: "CAS mismatch controls" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    const initial = getTask(task.id, db);
    const initialAudit = historyCount(task.id);

    expectHandoffCode(
      () => handoffStaleTaskLock(input(task.id, { expected_holder: "wrong-holder" }), db),
      "STALE_LOCK_HANDOFF_HOLDER_MISMATCH",
    );
    expect(getTask(task.id, db)).toEqual(initial);
    expect(historyCount(task.id)).toBe(initialAudit);

    expectHandoffCode(
      () => handoffStaleTaskLock(input(task.id, {
        expected_lock_version: "2020-01-01T00:00:01.000Z",
      }), db),
      "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
    );
    expect(getTask(task.id, db)).toEqual(initial);
    expect(historyCount(task.id)).toBe(initialAudit);

    const receipt = handoffStaleTaskLock(input(task.id), db);
    const afterSuccess = getTask(task.id, db);
    const afterSuccessAudit = historyCount(task.id);
    expect(afterSuccess?.locked_at).toBe(receipt.new_lock_version);

    expectHandoffCode(
      () => handoffStaleTaskLock(input(task.id), db),
      "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
    );
    expect(getTask(task.id, db)).toEqual(afterSuccess);
    expect(historyCount(task.id)).toBe(afterSuccessAudit);
  });
});

describe("SQLite snapshot import — immutable stale-lock handoff receipts", () => {
  test("rejects a divergent same-ID audit row before any snapshot mutation", () => {
    const state = protectedHandoffState();
    const before = protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);
    const divergent: TaskHistory = {
      ...state.audit,
      new_value: `${state.audit.new_value ?? ""}\nATTACK_OVERWRITE`,
    };

    const result = importSqliteTodosStorageSnapshot(emptySnapshot({
      auditHistory: [divergent],
    }), db);

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [
        `AUDIT_HISTORY_DIVERGENT_REPLAY: immutable audit_history row ${state.receipt.receipt_id} differs from stored row`,
      ],
    });
    expect(protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });

  test("rejects every audit_history tombstone before any snapshot mutation", () => {
    const state = protectedHandoffState();
    const before = protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);

    const result = importSqliteTodosStorageSnapshot(emptySnapshot({
      tombstones: [{
        object_type: "audit_history",
        object_id: state.receipt.receipt_id,
        deleted_at: "2026-08-09T12:01:00.000Z",
        updated_at: "2026-08-09T12:01:00.000Z",
      }],
    }), db);

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [
        `AUDIT_HISTORY_TOMBSTONE_FORBIDDEN: audit_history tombstone ${state.receipt.receipt_id} is not allowed`,
      ],
    });
    expect(protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });

  test("treats a field-identical audit row replay as an idempotent skip", () => {
    const state = protectedHandoffState();
    const before = protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);

    const result = importSqliteTodosStorageSnapshot(emptySnapshot({
      auditHistory: [{ ...state.audit }],
    }), db);

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
      errors: [],
    });
    expect(protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });
});
