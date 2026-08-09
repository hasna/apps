import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createTask, getTask, handoffStaleTaskLock } from "./tasks.js";
import { getTaskHistory } from "./audit.js";
import { receiptFromStaleLockHandoffHistory } from "../lib/stale-lock-handoff.js";
import { StaleLockHandoffError } from "../types/index.js";

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
