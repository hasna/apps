import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.ts";
import { createDispatch, getDispatch, listDispatchLogs, updateDispatchStatus } from "../db/dispatches.ts";
import { executeDispatch, runDueDispatches, dispatchToMultiple } from "./dispatch.ts";
import * as tmuxModule from "./tmux.ts";

process.env["TODOS_DB_PATH"] = ":memory:";

// Spy on sendToTmux so we never actually call tmux
function mockSendSuccess() {
  return spyOn(tmuxModule, "sendToTmux").mockImplementation(async () => {});
}

function mockSendFailure(message = "tmux: no server running") {
  return spyOn(tmuxModule, "sendToTmux").mockImplementation(async () => {
    throw new Error(message);
  });
}

describe("executeDispatch", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    mock.restore();
  });

  it("sends message and marks dispatch as sent", async () => {
    mockSendSuccess();
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "main", message: "hello", task_ids: [], delay_ms: 100 }, db);

    await executeDispatch(dispatch, {}, db);

    const updated = getDispatch(dispatch.id, db);
    expect(updated.status).toBe("sent");
    expect(updated.sent_at).not.toBeNull();
  });

  it("creates a dispatch log on success", async () => {
    mockSendSuccess();
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "main", message: "hello", task_ids: [], delay_ms: 100 }, db);

    await executeDispatch(dispatch, {}, db);

    const logs = listDispatchLogs(dispatch.id, db);
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe("sent");
    expect(logs[0]!.message).toBe("hello");
    expect(logs[0]!.delay_ms).toBe(100);
  });

  it("marks dispatch as failed and creates error log on tmux error", async () => {
    mockSendFailure("no server running");
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "bad-target", message: "hello", task_ids: [], delay_ms: 100 }, db);

    await expect(executeDispatch(dispatch, {}, db)).rejects.toThrow("no server running");

    const updated = getDispatch(dispatch.id, db);
    expect(updated.status).toBe("failed");
    expect(updated.error).toContain("no server running");

    const logs = listDispatchLogs(dispatch.id, db);
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe("failed");
    expect(logs[0]!.error).toContain("no server running");
  });

  it("does not update dispatch status in dry-run mode", async () => {
    const spy = spyOn(tmuxModule, "sendToTmux").mockImplementation(async () => {});
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "main", message: "hello", task_ids: [], delay_ms: 100 }, db);

    await executeDispatch(dispatch, { dryRun: true }, db);

    const updated = getDispatch(dispatch.id, db);
    // Status stays pending in dry-run
    expect(updated.status).toBe("pending");
    expect(updated.sent_at).toBeNull();

    // But a log entry is still created
    const logs = listDispatchLogs(dispatch.id, db);
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe("sent");

    // sendToTmux was called with dryRun=true
    expect(spy).toHaveBeenCalledWith("main", "hello", 100, true);
  });

  it("auto-calculates delay when delay_ms is null", async () => {
    const spy = mockSendSuccess();
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "main", message: "hello world", task_ids: [], delay_ms: null }, db);

    await executeDispatch(dispatch, {}, db);

    // Verify sendToTmux received a calculated delay (>= DELAY_MIN)
    const callArgs = spy.mock.calls[0]!;
    expect(callArgs[2]).toBeGreaterThanOrEqual(3000);
    expect(callArgs[2]).toBeLessThanOrEqual(5000);
  });

  it("formats message from task_ids when message is null", async () => {
    mockSendSuccess();
    const db = getDatabase();
    // Create a task to reference
    const { createTask } = await import("../db/tasks.ts");
    const task = createTask({ title: "Do something important", priority: "high", agent_id: "test" }, db);
    const dispatch = createDispatch({ target_window: "main", task_ids: [task.id], message: null }, db);

    await executeDispatch(dispatch, {}, db);

    const logs = listDispatchLogs(dispatch.id, db);
    expect(logs[0]!.message).toContain("Do something important");
  });

  it("uses empty message when no task_ids and no task_list_id", async () => {
    const spy = mockSendSuccess();
    const db = getDatabase();
    const dispatch = createDispatch({ target_window: "main", task_ids: [], message: null }, db);

    await executeDispatch(dispatch, {}, db);

    const callArgs = spy.mock.calls[0]!;
    expect(callArgs[1]).toBe("(no tasks)");
  });
});

describe("runDueDispatches", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    mock.restore();
  });

  it("returns 0 when no dispatches are due", async () => {
    mockSendSuccess();
    const db = getDatabase();
    const count = await runDueDispatches({}, db);
    expect(count).toBe(0);
  });

  it("fires all due dispatches and returns count", async () => {
    mockSendSuccess();
    const db = getDatabase();
    createDispatch({ target_window: "w1", message: "a", task_ids: [] }, db);
    createDispatch({ target_window: "w2", message: "b", task_ids: [] }, db);

    const count = await runDueDispatches({}, db);
    expect(count).toBe(2);
  });

  it("skips future-scheduled dispatches", async () => {
    mockSendSuccess();
    const db = getDatabase();
    const future = new Date(Date.now() + 60_000).toISOString();
    createDispatch({ target_window: "w1", message: "a", task_ids: [], scheduled_at: future }, db);
    createDispatch({ target_window: "w2", message: "b", task_ids: [] }, db);

    const count = await runDueDispatches({}, db);
    expect(count).toBe(1);
  });

  it("continues on individual dispatch failure and returns successful count", async () => {
    let callCount = 0;
    spyOn(tmuxModule, "sendToTmux").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("tmux error");
    });
    const db = getDatabase();
    createDispatch({ target_window: "fail", message: "a", task_ids: [] }, db);
    createDispatch({ target_window: "ok", message: "b", task_ids: [] }, db);

    const count = await runDueDispatches({}, db);
    expect(count).toBe(1); // only the second succeeded
  });

  it("supports dry_run mode", async () => {
    const spy = mockSendSuccess();
    const db = getDatabase();
    createDispatch({ target_window: "w1", message: "hello", task_ids: [] }, db);

    const count = await runDueDispatches({ dryRun: true }, db);
    expect(count).toBe(1);
    expect(spy).toHaveBeenCalledWith("w1", "hello", expect.any(Number), true);
  });
});

describe("dispatchToMultiple", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    mock.restore();
  });

  it("creates and executes a dispatch per target", async () => {
    const spy = mockSendSuccess();
    const db = getDatabase();

    const dispatches = await dispatchToMultiple(
      { targets: ["win1", "win2", "win3"], message: "hello", task_ids: [], stagger_ms: 0 },
      {},
      db,
    );

    expect(dispatches.length).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(dispatches.map((d) => d.target_window)).toEqual(["win1", "win2", "win3"]);
  });

  it("marks all dispatches as sent on success", async () => {
    mockSendSuccess();
    const db = getDatabase();

    const dispatches = await dispatchToMultiple(
      { targets: ["w1", "w2"], message: "msg", task_ids: [], stagger_ms: 0 },
      {},
      db,
    );

    for (const d of dispatches) {
      const updated = getDispatch(d.id, db);
      expect(updated.status).toBe("sent");
    }
  });

  it("throws on first target failure and stops", async () => {
    let callCount = 0;
    spyOn(tmuxModule, "sendToTmux").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first target failed");
    });
    const db = getDatabase();

    await expect(
      dispatchToMultiple(
        { targets: ["bad", "good"], message: "msg", task_ids: [], stagger_ms: 0 },
        {},
        db,
      ),
    ).rejects.toThrow("first target failed");

    // Only 1 call was made
    expect(callCount).toBe(1);
  });

  it("passes task_ids through to each dispatch", async () => {
    mockSendSuccess();
    const db = getDatabase();

    const dispatches = await dispatchToMultiple(
      { targets: ["w1", "w2"], task_ids: ["abc", "def"], stagger_ms: 0 },
      {},
      db,
    );

    for (const d of dispatches) {
      expect(d.task_ids).toEqual(["abc", "def"]);
    }
  });
});
