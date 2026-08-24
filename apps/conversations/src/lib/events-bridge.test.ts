import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "./db.js";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";
import { sendMessage } from "./messages.js";
import {
  assignTask,
  blockTask,
  cancelTask,
  completeTask,
  createTask,
  reopenTask,
  setTaskPriority,
  startTask,
  unblockTask,
} from "./tasks.js";
import {
  countEventOutboxByStatus,
  insertEventOutboxRow,
  listPendingEventOutbox,
} from "./events-outbox.js";
import {
  drainConversationEventOutbox,
  MESSAGE_CREATED_TYPE,
  TASK_CREATED_TYPE,
  TASK_UPDATED_TYPE,
} from "./events-bridge.js";

const TEST_DB = join(tmpdir(), `conversations-test-events-bridge-${Date.now()}.db`);
const EVENTS_DIR = mkdtempSync(join(tmpdir(), "conversations-events-bridge-spool-"));

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  restoreStoreEnv();
  rmSync(EVENTS_DIR, { recursive: true, force: true });
  rmSync(TEST_DB, { force: true });
  rmSync(`${TEST_DB}-wal`, { force: true });
  rmSync(`${TEST_DB}-shm`, { force: true });
});

describe("Conversations → Events source outbox", () => {
  test("every committed message mutation has exactly one matching outbox event", () => {
    const db = getDb();
    const dm = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const second = sendMessage({ from: "bob", to: "alice", content: "second dm" });
    const reply = sendMessage({ from: "bob", to: "alice", content: "re: hello", reply_to: dm.id, reply_to_uuid: dm.uuid });

    const pending = listPendingEventOutbox(db, 100);
    const messageEvents = pending.filter((row) => row.type === MESSAGE_CREATED_TYPE);
    expect(messageEvents).toHaveLength(3);
    expect(messageEvents.map((row) => row.id)).toEqual([
      `conversations:message:${dm.uuid}:created`,
      `conversations:message:${second.uuid}:created`,
      `conversations:message:${reply.uuid}:created`,
    ]);

    const dmEnvelope = JSON.parse(messageEvents[0]!.envelope_json) as Record<string, unknown>;
    expect(dmEnvelope).toMatchObject({
      id: `conversations:message:${dm.uuid}:created`,
      source: "conversations",
      type: MESSAGE_CREATED_TYPE,
      dedupeKey: `conversations:message:${dm.uuid}:created`,
      schemaVersion: "1.0",
      data: {
        uuid: dm.uuid,
        from: "alice",
        to: "bob",
        channel: null,
        content_preview: "hello",
      },
    });

    const replyEnvelope = JSON.parse(messageEvents[2]!.envelope_json) as { data: { reply_to_uuid: string | null } };
    expect(replyEnvelope.data.reply_to_uuid).toBe(dm.uuid);
  });

  test("every task creation and transition has exactly one matching outbox event with a stable transition identity", () => {
    const db = getDb();
    const task = createTask({ subject: "wire the outbox", reporter: "alice", priority: "high" });
    const created = listPendingEventOutbox(db, 100).filter((row) => row.type === TASK_CREATED_TYPE);
    expect(created).toHaveLength(1);
    expect(created[0]!.id).toMatch(new RegExp(`^conversations:task:${task.uuid}:activity:[0-9a-f-]+$`));

    startTask(task.id, "alice");
    completeTask(task.id, "alice");
    cancelTask(task.id, "alice");
    reopenTask(task.id, "alice");
    blockTask(task.id, "alice");
    unblockTask(task.id, "alice");
    assignTask(task.id, "bob", "alice");
    setTaskPriority(task.id, "high", "alice");

    const updates = listPendingEventOutbox(db, 100).filter((row) => row.type === TASK_UPDATED_TYPE);
    // start, complete, cancel, reopen, block, unblock, assign, priority = 8 transitions
    expect(updates).toHaveLength(8);
    const ids = new Set(updates.map((row) => row.id));
    expect(ids.size).toBe(8);
    const actions = updates.map((row) => (JSON.parse(row.envelope_json) as { data: { action: string } }).data.action);
    // Same-millisecond transitions share a created_at (ms-precision
    // toISOString), and listPendingEventOutbox's ORDER BY created_at, id then
    // falls through to the randomUUID id tiebreak — so drain order within a
    // millisecond is arbitrary (BUG f5b705aa: CI flake where same-ms rows came
    // back swapped). The drain contract is count + stable unique identity, both
    // asserted above (length 8, 8 unique ids) — order within a millisecond is
    // not part of it. Compare the action SET, not the sequence.
    expect([...actions].sort()).toEqual([
      "assigned",
      "blocked",
      "cancelled",
      "completed",
      "priority_changed",
      "reopened",
      "started",
      "unblocked",
    ]);
  });

  test("same-millisecond outbox rows drain completely; order within a millisecond is arbitrary, count and identity are not", () => {
    const db = getDb();
    // Deterministic reproduction of the BUG f5b705aa collision shape: two
    // transitions whose rows share one created_at (ms precision). The drain's
    // ORDER BY created_at, id tiebreaks on the randomUUID id, so no insertion
    // order is promised — what IS promised is that both rows drain with their
    // distinct stable identities.
    const sameMs = new Date().toISOString();
    const actions = ["started", "completed"];
    const ids = new Set<string>();
    for (const action of actions) {
      const transitionUuid = randomUUID();
      ids.add(`conversations:task:same-ms:activity:${transitionUuid}`);
      insertEventOutboxRow(db, {
        id: `conversations:task:same-ms:activity:${transitionUuid}`,
        source: "conversations",
        type: TASK_UPDATED_TYPE,
        envelope_json: JSON.stringify({ data: { action } }),
        created_at: sameMs,
        status: "pending",
        attempts: 0,
      });
    }
    const drained = listPendingEventOutbox(db, 100).filter((row) => row.type === TASK_UPDATED_TYPE);
    expect(drained).toHaveLength(2);
    expect(new Set(drained.map((row) => row.id))).toEqual(ids);
    expect(
      drained
        .map((row) => (JSON.parse(row.envelope_json) as { data: { action: string } }).data.action)
        .sort(),
    ).toEqual([...actions].sort());
  });

  test("a repeated blocked -> unblocked -> blocked sequence produces two distinct events (never task_uuid + action alone)", () => {
    const db = getDb();
    const task = createTask({ subject: "flapping", reporter: "alice" });
    blockTask(task.id, "alice");
    unblockTask(task.id, "alice");
    blockTask(task.id, "alice");

    const blockedEvents = listPendingEventOutbox(db, 100)
      .filter((row) => row.type === TASK_UPDATED_TYPE)
      .map((row) => JSON.parse(row.envelope_json) as { data: { action: string; transition_uuid: string } })
      .filter((envelope) => envelope.data.action === "blocked");
    expect(blockedEvents).toHaveLength(2);
    expect(blockedEvents[0]!.data.transition_uuid).not.toBe(blockedEvents[1]!.data.transition_uuid);
  });

  test("drain transports pending outbox rows into the Events durable spool and marks them spooled", async () => {
    const db = getDb();
    sendMessage({ from: "alice", to: "bob", content: "drain me" });
    createTask({ subject: "drain me too", reporter: "alice" });

    expect(countEventOutboxByStatus(db)).toMatchObject({ pending: 2 });
    const result = await drainConversationEventOutbox(db, { dataDir: EVENTS_DIR });
    expect(result).toMatchObject({ scanned: 2, transported: 2, skipped: 0, spooled: 2 });
    expect(countEventOutboxByStatus(db)).toMatchObject({ pending: 0, spooled: 2 });

    const inboxFiles = readdirSync(join(EVENTS_DIR, "spool", "inbox")).filter((name) => name.endsWith(".json"));
    expect(inboxFiles).toHaveLength(2);

    // Idempotent: re-drain does not duplicate spooled rows.
    const again = await drainConversationEventOutbox(db, { dataDir: EVENTS_DIR });
    expect(again).toMatchObject({ scanned: 0, transported: 0, spooled: 0 });
    expect(readdirSync(join(EVENTS_DIR, "spool", "inbox")).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  test("malformed outbox envelopes are dead-lettered, not left pending forever", async () => {
    const db = getDb();
    insertEventOutboxRow(db, {
      id: "conversations:task:malformed:activity:1",
      source: "conversations",
      type: TASK_UPDATED_TYPE,
      envelope_json: "{ not valid json",
      created_at: "2026-08-06T10:00:00.000Z",
      status: "pending",
      attempts: 0,
    });
    expect(countEventOutboxByStatus(db)).toMatchObject({ pending: 1 });
    const result = await drainConversationEventOutbox(db, { dataDir: EVENTS_DIR });
    expect(result).toMatchObject({ scanned: 1, transported: 0, skipped: 1, spooled: 0 });
    // The malformed row is dead-lettered rather than stuck 'pending' forever.
    expect(countEventOutboxByStatus(db)).toMatchObject({ pending: 0, dead: 1 });
    // A later drain does not re-scan the dead row.
    const again = await drainConversationEventOutbox(db, { dataDir: EVENTS_DIR });
    expect(again.scanned).toBe(0);
  });
});
