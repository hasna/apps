import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { logTaskChange } from "../db/audit.js";
import { addComment } from "../db/comments.js";
import {
  ACTIVITY_LOG_SCHEMA,
  logActivity,
  listActivity,
  getActivityTimeline,
  exportActivityLog,
  importActivityLog,
  redactActivityRecord,
  formatActivityRecordText,
} from "./activity-audit.js";

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

describe("activity audit", () => {
  it("logs activity with actor and session attribution", () => {
    const record = logActivity({
      entity_type: "plan",
      entity_id: "plan-1",
      action: "create",
      actor_id: "agent-a",
      session_id: "sess-1",
    }, db);

    expect(record.schema_version).toBe(ACTIVITY_LOG_SCHEMA);
    expect(record.actor_id).toBe("agent-a");
    expect(record.machine_id).toBeTruthy();
  });

  it("mirrors task_history via logTaskChange", () => {
    const task = createTask({ title: "Audit task" }, db);
    logTaskChange(task.id, "start", "status", "pending", "in_progress", "agent-b", db);

    const timeline = getActivityTimeline("task", task.id, db);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]!.action).toBe("start");
  });

  it("preserves chronological ordering in timeline", () => {
    const task = createTask({ title: "Order test" }, db);
    const t0 = "2026-01-01T00:00:00.000Z";
    logActivity({ entity_type: "task", entity_id: task.id, action: "a", created_at: t0 }, db);
    logActivity({ entity_type: "task", entity_id: task.id, action: "b", created_at: "2026-01-01T00:00:01.000Z" }, db);
    logActivity({ entity_type: "task", entity_id: task.id, action: "c", created_at: "2026-01-01T00:00:02.000Z" }, db);

    const timeline = getActivityTimeline("task", task.id, db);
    const actions = timeline.filter((r) => ["a", "b", "c"].includes(r.action)).map((r) => r.action);
    expect(actions).toEqual(["a", "b", "c"]);
  });

  it("redacts secrets in activity values", () => {
    const redacted = redactActivityRecord({
      schema_version: ACTIVITY_LOG_SCHEMA,
      id: "1",
      entity_type: "task",
      entity_id: "t1",
      action: "comment",
      field: null,
      old_value: null,
      new_value: "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      actor_id: null,
      session_id: null,
      machine_id: null,
      metadata: {},
      created_at: now(),
    });
    expect(redacted.new_value).toContain("[REDACTED]");
  });

  it("exports and imports activity bundle", () => {
    const task = createTask({ title: "Export test" }, db);
    logActivity({ entity_type: "task", entity_id: task.id, action: "export_me" }, db);

    const bundle = exportActivityLog({ entity_id: task.id }, db);
    expect(bundle.records.length).toBeGreaterThan(0);

    const result = importActivityLog(bundle, { skip_existing: true }, db);
    expect(result.skipped).toBe(bundle.records.length);
    expect(result.imported).toBe(0);
  });

  it("logs comment activity type", () => {
    const task = createTask({ title: "Comment task" }, db);
    const comment = addComment({ task_id: task.id, content: "note", agent_id: "a1" }, db);
    logActivity({
      entity_type: "comment",
      entity_id: comment.id,
      action: "create",
      actor_id: "a1",
      metadata: { task_id: task.id },
    }, db);

    const records = listActivity({ entity_type: "comment", entity_id: comment.id }, db);
    expect(records).toHaveLength(1);
    expect(formatActivityRecordText(records[0]!)).toContain("create");
  });
});

function now(): string {
  return new Date().toISOString();
}
