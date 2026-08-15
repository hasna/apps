import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask, handoffStaleTaskLock } from "../db/tasks.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import type { TaskHistory } from "../types/index.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

const STALE_LOCK_VERSION = "2020-01-01T00:00:00.000Z";
const HOLDER = "holder-a";
const ACTOR = "nausicaa";

let db: Database;
let store: TodosStorageAdapter;
let principal: { agent: string | null; scopes: string[] };
let dependencies: V1RequestDependencies;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
  store = createLocalSqliteTodosStorageAdapter({ db });
  principal = { agent: ACTOR, scopes: ["todos:write", "todos:read"] };
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function setLock(taskId: string, holder: string, lockedAt: string): void {
  db.run(
    "UPDATE tasks SET locked_by = ?, locked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    [holder, lockedAt, lockedAt, taskId],
  );
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expected_holder: HOLDER,
    expected_lock_version: STALE_LOCK_VERSION,
    stale_after_seconds: 3_600,
    new_holder: ACTOR,
    reason: "Exact holder stopped reporting and this lock is stale.",
    ...overrides,
  };
}

async function request(id: string, payload = body()): Promise<Response> {
  const url = new URL(`https://todos.example.test/v1/tasks/${id}/stale-lock-handoff`);
  const response = await handleV1Request(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), url, dependencies);
  if (!response) throw new Error("v1 route returned null");
  return response;
}

async function importRequest(payload: Record<string, unknown>): Promise<Response> {
  const url = new URL("https://todos.example.test/v1/import");
  const response = await handleV1Request(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), url, dependencies);
  if (!response) throw new Error("v1 import route returned null");
  return response;
}

async function protectedImportState() {
  const transferred = createTask({ title: "server immutable handoff receipt" }, db);
  const control = createTask({ title: "server unrelated import control" }, db);
  setLock(transferred.id, HOLDER, STALE_LOCK_VERSION);
  const receipt = handoffStaleTaskLock({
    task_id: transferred.id,
    actor: ACTOR,
    expected_holder: HOLDER,
    expected_lock_version: STALE_LOCK_VERSION,
    stale_after_seconds: 3_600,
    new_holder: ACTOR,
    reason: "Create a protected receipt for import attack coverage.",
  }, db);
  const audit = (await store.audit.getTaskHistory(transferred.id))
    .find((entry) => entry.id === receipt.receipt_id);
  if (!audit) throw new Error("server stale-lock handoff receipt history is missing");
  return { transferred, control, receipt, audit };
}

async function protectedStateBytes(taskId: string, receiptId: string, controlId: string): Promise<string> {
  return JSON.stringify({
    receipt: (await store.audit.getTaskHistory(taskId)).find((entry) => entry.id === receiptId) ?? null,
    transferred: getTask(taskId, db),
    control: getTask(controlId, db),
    controlHistory: await store.audit.getTaskHistory(controlId),
  });
}

describe("POST /v1/tasks/:id/stale-lock-handoff", () => {
  test("binds the new holder to the authenticated actor and returns a persisted receipt", async () => {
    const task = createTask({ title: "server stale lock" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    const historyBefore = await store.audit.getTaskHistory(task.id);

    const response = await request(task.id);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      receipt: {
        receipt_id: string;
        task_id: string;
        actor: string;
        new_holder: string;
        new_lock_version: string;
      };
    };
    expect(payload.receipt).toMatchObject({
      task_id: task.id,
      actor: ACTOR,
      new_holder: ACTOR,
    });
    expect(getTask(task.id, db)).toMatchObject({
      locked_by: ACTOR,
      locked_at: payload.receipt.new_lock_version,
    });
    const history = await store.audit.getTaskHistory(task.id);
    expect(history).toHaveLength(historyBefore.length + 1);
    expect(history.some((entry) => entry.id === payload.receipt.receipt_id)).toBe(true);
  });

  test("refreshes a same-name stale holder while preserving exact CAS and audit evidence", async () => {
    principal.agent = HOLDER;
    const task = createTask({ title: "same-name remote session" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    const historyBefore = await store.audit.getTaskHistory(task.id);

    const response = await request(task.id, body({ new_holder: HOLDER }));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      receipt: {
        receipt_id: string;
        previous_holder: string;
        previous_lock_version: string;
        new_holder: string;
        new_lock_version: string;
      };
    };
    expect(payload.receipt).toMatchObject({
      previous_holder: HOLDER,
      previous_lock_version: STALE_LOCK_VERSION,
      new_holder: HOLDER,
    });
    expect(payload.receipt.new_lock_version).not.toBe(STALE_LOCK_VERSION);
    expect(getTask(task.id, db)).toMatchObject({
      locked_by: HOLDER,
      locked_at: payload.receipt.new_lock_version,
    });
    expect(await store.audit.getTaskHistory(task.id)).toHaveLength(historyBefore.length + 1);
  });

  test("rejects impersonation with 403 and zero mutation even for todos:write", async () => {
    const task = createTask({ title: "auth binding" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    const before = getTask(task.id, db);
    const historyBefore = await store.audit.getTaskHistory(task.id);

    const response = await request(task.id, body({ new_holder: "other-agent" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_ACTOR_MISMATCH",
      conflict: false,
    });
    expect(getTask(task.id, db)).toEqual(before);
    expect(await store.audit.getTaskHistory(task.id)).toEqual(historyBefore);
  });

  test("maps a live/current lock to structured 409 and preserves row plus audit population", async () => {
    const task = createTask({ title: "live server lock" }, db);
    const liveVersion = new Date().toISOString();
    setLock(task.id, HOLDER, liveVersion);
    const before = getTask(task.id, db);
    const historyBefore = await store.audit.getTaskHistory(task.id);

    const response = await request(task.id, body({ expected_lock_version: liveVersion }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_NOT_STALE",
      conflict: true,
      task_id: task.id,
      current_lock_version: liveVersion,
    });
    expect(getTask(task.id, db)).toEqual(before);
    expect(await store.audit.getTaskHistory(task.id)).toEqual(historyBefore);
  });

  test("maps holder/version mismatch and replay to structured 409 errors", async () => {
    const task = createTask({ title: "server CAS controls" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);

    const holderMismatch = await request(task.id, body({ expected_holder: "wrong-holder" }));
    expect(holderMismatch.status).toBe(409);
    expect(await holderMismatch.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_HOLDER_MISMATCH",
      conflict: true,
    });

    const versionMismatch = await request(task.id, body({
      expected_lock_version: "2020-01-01T00:00:01.000Z",
    }));
    expect(versionMismatch.status).toBe(409);
    expect(await versionMismatch.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
      conflict: true,
    });

    const success = await request(task.id);
    expect(success.status).toBe(200);
    const replay = await request(task.id);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
      conflict: true,
    });
  });

  test("rejects a short id before lookup and reports a missing exact task as 404", async () => {
    const task = createTask({ title: "exact id only" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);
    const before = getTask(task.id, db);

    const shortResponse = await request(task.id.slice(0, 8));
    expect(shortResponse.status).toBe(400);
    expect(await shortResponse.json()).toMatchObject({
      code: "STALE_LOCK_HANDOFF_INVALID_TASK_ID",
    });
    expect(getTask(task.id, db)).toEqual(before);

    const missingResponse = await request("ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  test("invalid stale threshold and reason fail with structured 400 responses and zero mutation", async () => {
    const task = createTask({ title: "invalid handoff input" }, db);
    setLock(task.id, HOLDER, STALE_LOCK_VERSION);

    for (const invalid of [
      { stale_after_seconds: 0 },
      { reason: "   " },
    ]) {
      const before = getTask(task.id, db);
      const historyBefore = await store.audit.getTaskHistory(task.id);
      const response = await request(task.id, body(invalid));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "STALE_LOCK_HANDOFF_INVALID_INPUT",
        conflict: false,
      });
      expect(getTask(task.id, db)).toEqual(before);
      expect(await store.audit.getTaskHistory(task.id)).toEqual(historyBefore);
    }
  });
});

describe("POST /v1/import — immutable stale-lock handoff receipts", () => {
  test("rejects a divergent same-ID audit row with 409 and zero mutation", async () => {
    const state = await protectedImportState();
    const before = await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);
    const divergent: TaskHistory = {
      ...state.audit,
      new_value: `${state.audit.new_value ?? ""}\nATTACK_OVERWRITE`,
    };

    const response = await importRequest({ auditHistory: [divergent] });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `AUDIT_HISTORY_DIVERGENT_REPLAY: immutable audit_history row ${state.receipt.receipt_id} differs from stored row`,
      code: "AUDIT_HISTORY_DIVERGENT_REPLAY",
      conflict: true,
      audit_history_id: state.receipt.receipt_id,
    });
    expect(await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });

  test("rejects every audit_history tombstone with 400 and zero mutation", async () => {
    const state = await protectedImportState();
    const before = await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);

    const response = await importRequest({
      tombstones: [{
        object_type: "audit_history",
        object_id: state.receipt.receipt_id,
        deleted_at: "2026-08-09T12:01:00.000Z",
        updated_at: "2026-08-09T12:01:00.000Z",
      }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `AUDIT_HISTORY_TOMBSTONE_FORBIDDEN: audit_history tombstone ${state.receipt.receipt_id} is not allowed`,
      code: "AUDIT_HISTORY_TOMBSTONE_FORBIDDEN",
      conflict: false,
      audit_history_id: state.receipt.receipt_id,
    });
    expect(await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });

  test("accepts a field-identical audit row replay as an idempotent skip", async () => {
    const state = await protectedImportState();
    const before = await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id);

    const response = await importRequest({ auditHistory: [{ ...state.audit }] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: {
        inserted: 0,
        updated: 0,
        deleted: 0,
        skipped: 1,
        errors: [],
      },
      received: 1,
    });
    expect(await protectedStateBytes(state.transferred.id, state.receipt.receipt_id, state.control.id)).toBe(before);
  });
});
