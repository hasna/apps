import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createDispatch,
  getDispatch,
  listDispatches,
  cancelDispatch,
  updateDispatchStatus,
  createDispatchLog,
  listDispatchLogs,
  getDueDispatches,
} from "./dispatches.js";
import { DispatchNotFoundError } from "../types/index.js";
import { createTaskList } from "./task-lists.js";

// Set in-memory DB for all tests
process.env["TODOS_DB_PATH"] = ":memory:";

describe("dispatch CRUD", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  it("creates a dispatch with task_ids", () => {
    const dispatch = createDispatch({
      target_window: "main",
      task_ids: ["abc-123", "def-456"],
    });
    expect(dispatch.id).toBeTruthy();
    expect(dispatch.target_window).toBe("main");
    expect(dispatch.task_ids).toEqual(["abc-123", "def-456"]);
    expect(dispatch.status).toBe("pending");
    expect(dispatch.sent_at).toBeNull();
    expect(dispatch.error).toBeNull();
  });

  it("creates a dispatch with task_list_id and schedule", () => {
    const list = createTaskList({ name: "My List", slug: "my-list" });
    const scheduled = new Date(Date.now() + 60_000).toISOString();
    const dispatch = createDispatch({
      target_window: "work:editor",
      task_list_id: list.id,
      scheduled_at: scheduled,
      delay_ms: 4000,
    });
    expect(dispatch.task_list_id).toBe(list.id);
    expect(dispatch.scheduled_at).toBe(scheduled);
    expect(dispatch.delay_ms).toBe(4000);
  });

  it("creates a dispatch with a pre-formatted message", () => {
    const dispatch = createDispatch({
      target_window: "main",
      message: "Hello tmux!",
    });
    expect(dispatch.message).toBe("Hello tmux!");
  });

  it("gets a dispatch by ID", () => {
    const created = createDispatch({ target_window: "main", task_ids: ["x"] });
    const fetched = getDispatch(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.task_ids).toEqual(["x"]);
  });

  it("throws DispatchNotFoundError for unknown ID", () => {
    expect(() => getDispatch("nonexistent-id")).toThrow(DispatchNotFoundError);
  });

  it("lists dispatches", () => {
    createDispatch({ target_window: "win1" });
    createDispatch({ target_window: "win2" });
    createDispatch({ target_window: "win3" });
    const all = listDispatches();
    expect(all.length).toBe(3);
  });

  it("filters dispatches by status", () => {
    const d1 = createDispatch({ target_window: "w1" });
    updateDispatchStatus(d1.id, "sent", { sent_at: new Date().toISOString() });
    createDispatch({ target_window: "w2" });

    const pending = listDispatches({ status: "pending" });
    expect(pending.length).toBe(1);
    expect(pending[0]!.target_window).toBe("w2");

    const sent = listDispatches({ status: "sent" });
    expect(sent.length).toBe(1);
    expect(sent[0]!.target_window).toBe("w1");
  });

  it("cancels a pending dispatch", () => {
    const d = createDispatch({ target_window: "main" });
    const cancelled = cancelDispatch(d.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("cannot cancel a sent dispatch", () => {
    const d = createDispatch({ target_window: "main" });
    updateDispatchStatus(d.id, "sent", { sent_at: new Date().toISOString() });
    expect(() => cancelDispatch(d.id)).toThrow("Cannot cancel");
  });

  it("cannot cancel an already-cancelled dispatch", () => {
    const d = createDispatch({ target_window: "main" });
    cancelDispatch(d.id);
    expect(() => cancelDispatch(d.id)).toThrow("Cannot cancel");
  });

  it("updateDispatchStatus updates status, error, sent_at", () => {
    const d = createDispatch({ target_window: "main" });
    const sentAt = new Date().toISOString();
    updateDispatchStatus(d.id, "sent", { sent_at: sentAt });
    const updated = getDispatch(d.id);
    expect(updated.status).toBe("sent");
    expect(updated.sent_at).toBe(sentAt);
  });

  it("updateDispatchStatus stores error on failure", () => {
    const d = createDispatch({ target_window: "main" });
    updateDispatchStatus(d.id, "failed", { error: "tmux not found" });
    const updated = getDispatch(d.id);
    expect(updated.status).toBe("failed");
    expect(updated.error).toBe("tmux not found");
  });
});

describe("dispatch logs", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  it("creates a dispatch log entry", () => {
    const d = createDispatch({ target_window: "main" });
    const log = createDispatchLog({
      dispatch_id: d.id,
      target_window: "main",
      message: "hello",
      delay_ms: 3000,
      status: "sent",
      error: null,
    });
    expect(log.id).toBeTruthy();
    expect(log.status).toBe("sent");
  });

  it("lists logs for a dispatch", () => {
    const d = createDispatch({ target_window: "main" });
    createDispatchLog({ dispatch_id: d.id, target_window: "main", message: "msg1", delay_ms: 3000, status: "sent", error: null });
    createDispatchLog({ dispatch_id: d.id, target_window: "main", message: "msg2", delay_ms: 3000, status: "failed", error: "oops" });

    const logs = listDispatchLogs(d.id);
    expect(logs.length).toBe(2);
  });
});

describe("getDueDispatches", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  it("returns immediate pending dispatches", () => {
    createDispatch({ target_window: "w1" });
    createDispatch({ target_window: "w2" });
    const due = getDueDispatches();
    expect(due.length).toBe(2);
  });

  it("returns scheduled dispatches that are past due", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createDispatch({ target_window: "w1", scheduled_at: past });
    const due = getDueDispatches();
    expect(due.length).toBe(1);
  });

  it("does not return future-scheduled dispatches", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createDispatch({ target_window: "w1", scheduled_at: future });
    const due = getDueDispatches();
    expect(due.length).toBe(0);
  });

  it("does not return already-sent dispatches", () => {
    const d = createDispatch({ target_window: "w1" });
    updateDispatchStatus(d.id, "sent", { sent_at: new Date().toISOString() });
    const due = getDueDispatches();
    expect(due.length).toBe(0);
  });

  it("does not return cancelled dispatches", () => {
    const d = createDispatch({ target_window: "w1" });
    cancelDispatch(d.id);
    const due = getDueDispatches();
    expect(due.length).toBe(0);
  });
});
