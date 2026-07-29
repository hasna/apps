import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFeedbackStore } from "./storage.js";
import type { FeedbackTaskRef } from "./types.js";
import type { FeedbackTaskSink } from "./tasks.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-tasks-"));
}

function okSink(taskId = "task-1"): FeedbackTaskSink & { calls: number } {
  const sink = {
    provider: "todos",
    calls: 0,
    async createTask(): Promise<FeedbackTaskRef> {
      sink.calls += 1;
      return { provider: "todos", taskId, shortId: "APP-00001", createdAt: new Date().toISOString() };
    },
  };
  return sink;
}

function failingSink(message = "todos exited 1: boom"): FeedbackTaskSink & { calls: number } {
  const sink = {
    provider: "todos",
    calls: 0,
    async createTask(): Promise<FeedbackTaskRef> {
      sink.calls += 1;
      throw new Error(message);
    },
  };
  return sink;
}

describe("feedback → task linkage", () => {
  test("submitting feedback creates a task and returns the link", async () => {
    const store = new LocalFeedbackStore({ dataDir: await tempDir(), eventSink: null, taskSink: okSink("task-42") });
    const item = await store.createFeedback({ appId: "app-a", message: "broken export" });
    expect(item.taskRef?.taskId).toBe("task-42");
    expect(item.taskError).toBeUndefined();
  });

  test("the link is PERSISTED, not just returned — re-read from the file, not from the CLI's own memory", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: okSink("task-persisted") });
    const item = await store.createFeedback({ appId: "app-a", message: "broken export" });

    // Read through a brand-new store instance so nothing is served from memory.
    const reread = await new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null }).getFeedback(item.id);
    expect(reread?.taskRef?.taskId).toBe("task-persisted");
    expect(reread?.taskRef?.shortId).toBe("APP-00001");

    // And prove it survived the zod round-trip by checking the raw bytes too.
    const raw = await readFile(join(dataDir, "feedback.jsonl"), "utf8");
    expect(raw).toContain("task-persisted");
  });

  test("feedback is never lost when task creation fails — the report persists and the failure is recorded", async () => {
    const dataDir = await tempDir();
    const sink = failingSink("todos exited 1: Project not found");
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: sink });

    const item = await store.createFeedback({ appId: "app-a", message: "still must be stored" });
    expect(sink.calls).toBe(1);
    expect(item.taskRef).toBeUndefined();
    expect(item.taskError).toContain("Project not found");

    const reread = await new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null }).getFeedback(item.id);
    expect(reread?.message).toBe("still must be stored");
    expect(reread?.taskError).toContain("Project not found");
  });

  test("with no sink configured nothing is added to the item", async () => {
    const store = new LocalFeedbackStore({ dataDir: await tempDir(), eventSink: null, taskSink: null });
    const item = await store.createFeedback({ appId: "app-a", message: "no sink" });
    expect(item.taskRef).toBeUndefined();
    expect(item.taskError).toBeUndefined();
  });
});

describe("syncTasks", () => {
  test("retries only the items that never got a task", async () => {
    const dataDir = await tempDir();
    const failing = failingSink();
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: failing });
    await store.createFeedback({ appId: "app-a", message: "one" });
    await store.createFeedback({ appId: "app-a", message: "two" });

    const linked = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: okSink("task-late") });
    const result = await linked.syncTasks();
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);

    const items = await linked.listFeedback();
    expect(items.every((entry) => entry.taskRef?.taskId === "task-late")).toBe(true);
    expect(items.every((entry) => entry.taskError === undefined)).toBe(true);

    // A second sync must be a no-op: already-linked items are not re-filed.
    const again = await linked.syncTasks();
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);
  });

  test("reports failures instead of claiming success", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null });
    await store.createFeedback({ appId: "app-a", message: "unlinked" });

    const broken = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: failingSink("nope") });
    const result = await broken.syncTasks();
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("nope");
  });

  test("syncing with no sink is an explicit no-op, not a silent success", async () => {
    const store = new LocalFeedbackStore({ dataDir: await tempDir(), eventSink: null, taskSink: null });
    await store.createFeedback({ appId: "app-a", message: "unlinked" });
    const result = await store.syncTasks();
    expect(result.created).toBe(0);
    expect(result.sinkConfigured).toBe(false);
  });
});
