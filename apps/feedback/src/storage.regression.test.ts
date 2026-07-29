import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFeedbackStore } from "./storage.js";
import type { FeedbackTaskRef } from "./types.js";
import type { FeedbackTaskSink } from "./tasks.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-regression-"));
}

/**
 * Let the first (durable) append through and fail every later one, so the test
 * exercises a lost LINKAGE write rather than a store that cannot write at all.
 */
function failLinkageWriteOnly(store: LocalFeedbackStore): void {
  const target = store as unknown as { appendItem: (item: unknown) => Promise<void> };
  const real = target.appendItem.bind(store);
  let appends = 0;
  target.appendItem = async (item: unknown) => {
    appends += 1;
    if (appends > 1) throw new Error("disk full");
    return real(item);
  };
}

function sinkThatFailsWith(message: string): FeedbackTaskSink {
  return {
    provider: "todos",
    createTask(): Promise<FeedbackTaskRef> {
      return Promise.reject(new Error(message));
    },
  };
}

/**
 * P0-1: `taskError` was written unbounded but read through a schema capped at
 * 4096 chars. One verbose `todos` crash made every subsequent read AND write
 * fail zod `too_big` forever, with no delete verb to recover.
 */
describe("regression: an oversized task error must not brick the store", () => {
  test("a huge failure message is stored truncated, and the store stays readable", async () => {
    const dataDir = await tempDir();
    const huge = `todos exploded: ${"E".repeat(20_000)}`;
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: sinkThatFailsWith(huge) });

    const item = await store.createFeedback({ appId: "app-a", message: "first" });
    expect(item.taskError).toBeTruthy();

    // Everything that reads must still work.
    await expect(store.listFeedback()).resolves.toHaveLength(1);
    await expect(store.stats()).resolves.toMatchObject({ total: 1 });
    await expect(store.exportJsonl()).resolves.toContain("first");
    await expect(store.getFeedback(item.id)).resolves.toBeTruthy();

    // And a later submit must not be poisoned by the earlier row.
    const second = await store.createFeedback({ appId: "app-a", message: "second" });
    expect(second.id).toBeTruthy();
    expect(await store.listFeedback()).toHaveLength(2);

    // Read back through a fresh store: the persisted bytes must be valid too.
    const reread = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null });
    expect(await reread.listFeedback()).toHaveLength(2);
  });

  test("a file already poisoned by an over-long value is readable, not fatal", async () => {
    const dataDir = await tempDir();
    const filePath = join(dataDir, "feedback.jsonl");
    const poisoned = {
      id: "poisoned-1",
      appId: "app-a",
      message: "already on disk",
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      status: "new",
      source: "cli",
      kind: "other",
      tags: [],
      taskError: "X".repeat(50_000),
    };
    await writeFile(filePath, `${JSON.stringify(poisoned)}\n`, "utf8");

    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null });
    const items = await store.listFeedback();
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toBe("already on disk");
  });
});

/**
 * P0-2: task linkage was written with a full read-all + write-all inside the
 * file lock, on every create. Under concurrency that O(n) rewrite blew the 2s
 * lock deadline and DROPPED reports (19 of 30 measured). The create path must
 * stay append-only.
 */
describe("regression: concurrent submits must not be dropped", () => {
  test("40 concurrent creates with a task sink all persist", async () => {
    const dataDir = await tempDir();
    const slowSink: FeedbackTaskSink = {
      provider: "todos",
      async createTask(): Promise<FeedbackTaskRef> {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { provider: "todos", taskId: "t", createdAt: new Date().toISOString() };
      },
    };
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: slowSink });

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => store.createFeedback({ appId: "app-a", message: `concurrent ${i}` })),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);

    const items = await new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null }).listFeedback({ limit: 500 });
    expect(items).toHaveLength(40);
    expect(new Set(items.map((entry) => entry.id)).size).toBe(40);
  });

  test("seeded rows survive concurrent creates (no clobbering)", async () => {
    const dataDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null });
    for (let i = 0; i < 25; i += 1) await seed.createFeedback({ appId: "seed", message: `seed ${i}` });

    const store = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => ({ provider: "todos", taskId: "t", createdAt: new Date().toISOString() }),
      },
    });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.createFeedback({ appId: "new", message: `new ${i}` })));

    const items = await store.listFeedback({ limit: 500 });
    expect(items.filter((entry) => entry.appId === "seed")).toHaveLength(25);
    expect(items.filter((entry) => entry.appId === "new")).toHaveLength(20);
  });
});

/**
 * P0-3: the linkage write sat outside the try/catch, so a failure there
 * rejected out of `createFeedback` — losing the id from stdout and leaving a
 * row with neither `taskRef` nor `taskError`, while the task HAD been created.
 * `syncTasks` then filed a duplicate.
 */
describe("regression: a lost task link must never become a silent duplicate", () => {
  test("createFeedback still resolves when the linkage write fails", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => ({ provider: "todos", taskId: "created-but-unlinkable", createdAt: new Date().toISOString() }),
      },
    });
    failLinkageWriteOnly(store);

    const item = await store.createFeedback({ appId: "app-a", message: "must still return an id" });
    expect(item.id).toBeTruthy();
    expect(item.message).toBe("must still return an id");
  });

  test("an attempt whose outcome is unknown is reported as uncertain, not re-filed", async () => {
    const dataDir = await tempDir();
    let calls = 0;
    const store = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => {
          calls += 1;
          return { provider: "todos", taskId: `t-${calls}`, createdAt: new Date().toISOString() };
        },
      },
    });
    failLinkageWriteOnly(store);
    await store.createFeedback({ appId: "app-a", message: "attempted" });
    expect(calls).toBe(1);

    // A fresh store, working normally, must NOT blindly re-file: the previous
    // attempt may already have created a task.
    const repair = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => {
          calls += 1;
          return { provider: "todos", taskId: `t-${calls}`, createdAt: new Date().toISOString() };
        },
      },
    });
    const result = await repair.syncTasks();
    expect(result.uncertain).toBe(1);
    expect(result.created).toBe(0);
    expect(calls).toBe(1);

    // Forcing it is allowed, but must be explicit.
    const forced = await repair.syncTasks({ retryUncertain: true });
    expect(forced.created).toBe(1);
  });

  test("a KNOWN failure is safe to retry without forcing", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: sinkThatFailsWith("todos exited 1: nope") });
    await store.createFeedback({ appId: "app-a", message: "known failure" });

    const repair = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => ({ provider: "todos", taskId: "retried", createdAt: new Date().toISOString() }),
      },
    });
    const result = await repair.syncTasks();
    expect(result.created).toBe(1);
    expect(result.uncertain).toBe(0);
  });
});

/** P3: `--limit` left unprocessed items in no bucket, so output read as complete. */
describe("regression: syncTasks accounting must add up", () => {
  test("limit reports what it did not process", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null });
    for (let i = 0; i < 3; i += 1) await store.createFeedback({ appId: "app-a", message: `m${i}` });

    const repair = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => ({ provider: "todos", taskId: "t", createdAt: new Date().toISOString() }),
      },
    });
    const result = await repair.syncTasks({ limit: 1 });
    expect(result.created).toBe(1);
    expect(result.remaining).toBe(2);
  });
});

/** The append-only log must fold to one logical item per id. */
describe("append-only linkage log", () => {
  test("re-reading folds duplicate records by id, keeping the newest", async () => {
    const dataDir = await tempDir();
    const store = new LocalFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: {
        provider: "todos",
        createTask: async () => ({ provider: "todos", taskId: "folded", createdAt: new Date().toISOString() }),
      },
    });
    const item = await store.createFeedback({ appId: "app-a", message: "folds" });

    const raw = await readFile(join(dataDir, "feedback.jsonl"), "utf8");
    expect(raw.trim().split("\n").length).toBeGreaterThan(1); // append-only: more physical lines
    expect(await store.listFeedback()).toHaveLength(1); // ...but one logical item
    expect((await store.getFeedback(item.id))!.taskRef?.taskId).toBe("folded");
    expect(await store.stats()).toMatchObject({ total: 1 });
  });
});
