import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { runMigrations } from "../db/schema.js";
import { finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { completeTask, createTask, startTask } from "../db/tasks.js";
import { approveApprovalGate, requestApprovalGate } from "./approval-gates.js";
import { resetConfig } from "./config.js";
import {
  emitLocalEventHooks,
  listLocalEventHooks,
  removeLocalEventHook,
  testLocalEventHook,
  upsertLocalEventHook,
} from "./event-hooks.js";
import { shouldDeliverLocalLifecycleHooks } from "./event-emission-safety.js";
import { approveReviewItem, claimReviewItem, requestReviewQueue } from "./review-queues.js";

let home: string;
let previousHome: string | undefined;

function makeNonTempHome(prefix: string): string {
  return mkdtempSync(join(process.cwd(), `.tmp-${prefix}-`));
}

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-event-hooks-home-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  delete process.env["TODOS_DB_PATH"];
  rmSync(home, { recursive: true, force: true });
});

describe("local event hooks", () => {
  test("suppresses quiet lifecycle hooks for temp databases using a non-isolated todos home", () => {
    const previousHome = process.env["HOME"];
    const previousDbPath = process.env["TODOS_DB_PATH"];
    try {
      process.env["HOME"] = "/var/empty/todos-home";
      process.env["TODOS_DB_PATH"] = join(tmpdir(), "todos-ephemeral-hooks.db");

      expect(shouldDeliverLocalLifecycleHooks()).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
      else process.env["TODOS_DB_PATH"] = previousDbPath;
    }
  });

  test("suppresses quiet lifecycle hooks for explicit in-memory databases using a non-isolated todos home", async () => {
    const previousHome = process.env["HOME"];
    const previousDbPath = process.env["TODOS_DB_PATH"];
    const nonTempHome = makeNonTempHome("todos-event-hooks-home");
    const filePath = join(home, "explicit-lifecycle.jsonl");
    const explicitDb = new Database(":memory:");
    explicitDb.run("PRAGMA foreign_keys = ON");
    runMigrations(explicitDb);
    try {
      process.env["HOME"] = nonTempHome;
      delete process.env["TODOS_DB_PATH"];
      resetConfig();
      upsertLocalEventHook({
        name: "explicit-lifecycle",
        events: ["task.created"],
        target: "file",
        file_path: filePath,
      });

      createTask({ title: "Explicit lifecycle" }, explicitDb);
      await Bun.sleep(50);

      expect(existsSync(filePath)).toBe(false);
    } finally {
      explicitDb.close();
      resetConfig();
      rmSync(nonTempHome, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
      else process.env["TODOS_DB_PATH"] = previousDbPath;
    }
  });

  test("suppresses quiet run hooks for explicit in-memory databases using a non-isolated todos home", async () => {
    const previousHome = process.env["HOME"];
    const previousDbPath = process.env["TODOS_DB_PATH"];
    const nonTempHome = makeNonTempHome("todos-run-hooks-home");
    const filePath = join(home, "explicit-run.jsonl");
    const explicitDb = new Database(":memory:");
    explicitDb.run("PRAGMA foreign_keys = ON");
    runMigrations(explicitDb);
    try {
      process.env["HOME"] = nonTempHome;
      delete process.env["TODOS_DB_PATH"];
      resetConfig();
      upsertLocalEventHook({
        name: "explicit-run",
        events: ["run.started", "run.completed", "run.failed"],
        target: "file",
        file_path: filePath,
      });

      const task = createTask({ title: "Explicit run hooks" }, explicitDb);
      const completed = startTaskRun({ task_id: task.id, title: "Completed run" }, explicitDb);
      finishTaskRun({ run_id: completed.id, status: "completed" }, explicitDb);
      const failed = startTaskRun({ task_id: task.id, title: "Failed run" }, explicitDb);
      finishTaskRun({ run_id: failed.id, status: "failed" }, explicitDb);
      await Bun.sleep(50);

      expect(existsSync(filePath)).toBe(false);
    } finally {
      explicitDb.close();
      resetConfig();
      rmSync(nonTempHome, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
      else process.env["TODOS_DB_PATH"] = previousDbPath;
    }
  });

  test("suppresses quiet approval and review hooks for explicit in-memory databases using a non-isolated todos home", async () => {
    const previousHome = process.env["HOME"];
    const previousDbPath = process.env["TODOS_DB_PATH"];
    const nonTempHome = makeNonTempHome("todos-review-hooks-home");
    const filePath = join(home, "explicit-review.jsonl");
    const explicitDb = new Database(":memory:");
    explicitDb.run("PRAGMA foreign_keys = ON");
    runMigrations(explicitDb);
    try {
      process.env["HOME"] = nonTempHome;
      delete process.env["TODOS_DB_PATH"];
      resetConfig();
      upsertLocalEventHook({
        name: "explicit-review",
        events: ["approval.decided", "review.requested", "review.claimed", "review.approved"],
        target: "file",
        file_path: filePath,
      });

      const approvalTask = createTask({ title: "Explicit approval hooks" }, explicitDb);
      requestApprovalGate({ task_id: approvalTask.id, gate: "publish", requester: "agent" }, explicitDb);
      approveApprovalGate({ task_id: approvalTask.id, gate: "publish", reviewer: "reviewer" }, explicitDb);
      const reviewTask = createTask({ title: "Explicit review hooks" }, explicitDb);
      requestReviewQueue({ task_id: reviewTask.id, requester: "agent", reviewer: "reviewer" }, explicitDb);
      claimReviewItem({ task_id: reviewTask.id, reviewer: "reviewer" }, explicitDb);
      approveReviewItem({ task_id: reviewTask.id, reviewer: "reviewer" }, explicitDb);
      await Bun.sleep(50);

      expect(existsSync(filePath)).toBe(false);
    } finally {
      explicitDb.close();
      resetConfig();
      rmSync(nonTempHome, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
      else process.env["TODOS_DB_PATH"] = previousDbPath;
    }
  });

  test("stores local hook config and appends redacted signed JSONL events", async () => {
    const filePath = join(home, "events", "audit.jsonl");
    const hook = upsertLocalEventHook({
      name: "audit",
      events: ["task.completed"],
      target: "file",
      file_path: filePath,
    });

    expect(hook.enabled).toBe(true);
    expect(listLocalEventHooks()).toHaveLength(1);

    const results = await emitLocalEventHooks({
      type: "task.completed",
      payload: { id: "task-1", api_key: "abcdefghijklmnopqrstuvwxyz" },
      timestamp: "2026-01-02T03:04:05.000Z",
    });

    expect(results[0]).toMatchObject({ hook: "audit", status: "delivered", target: "file", attempts: 1 });
    const line = readFileSync(filePath, "utf-8").trim();
    const event = JSON.parse(line);
    expect(event.type).toBe("task.completed");
    expect(event.payload.api_key).toBe("[REDACTED]");
    expect(event.integrity.algorithm).toBe("sha256");
    expect(event.integrity.digest).toHaveLength(64);
  });

  test("runs script hooks with retry and event environment", async () => {
    const outputPath = join(home, "script-output.txt");
    upsertLocalEventHook({
      name: "script",
      events: ["run.failed"],
      target: "script",
      command: "printf '%s:%s:%s' \"$TODOS_HOOK_NAME\" \"$TODOS_EVENT_TYPE\" \"$TODOS_EVENT_INTEGRITY\" > \"$OUT_FILE\"",
      env: { OUT_FILE: outputPath },
      retry: { attempts: 2, backoff_ms: 0 },
    });

    const results = await testLocalEventHook("script", { type: "run.failed", payload: { run_id: "run-1" } });

    expect(results[0]!.status).toBe("delivered");
    const output = readFileSync(outputPath, "utf-8");
    expect(output).toContain("script:run.failed:");
  });

  test("delivers socket hooks over a local Unix socket", async () => {
    const socketPath = join(home, "events.sock");
    let ready!: Promise<void>;
    const received = new Promise<string>((resolveReceived) => {
      const server = createServer((socket) => {
        let body = "";
        socket.on("data", (chunk) => { body += chunk.toString(); });
        socket.on("end", () => {
          server.close();
          resolveReceived(body);
        });
      });
      ready = new Promise((resolveReady) => server.on("listening", resolveReady));
      server.listen(socketPath);
    });
    upsertLocalEventHook({
      name: "socket",
      events: ["plan.updated"],
      target: "socket",
      socket_path: socketPath,
    });

    await ready;
    const results = await testLocalEventHook("socket", { type: "plan.updated", payload: { id: "plan-1" } });
    const message = await received;

    expect(results[0]!.status).toBe("delivered");
    expect(JSON.parse(message.trim()).type).toBe("plan.updated");
  });

  test("reports failed script retries without throwing", async () => {
    upsertLocalEventHook({
      name: "failing",
      events: ["task.failed"],
      target: "script",
      command: "name=TOKEN; echo \"$name=abcdefghijklmnopqrstuvwxyz123\" >&2; exit 7",
      retry: { attempts: 2, backoff_ms: 0 },
    });

    const results = await testLocalEventHook("failing", { type: "task.failed", payload: { id: "task-1" } });

    expect(results[0]).toMatchObject({ hook: "failing", status: "failed", attempts: 2 });
    expect(results[0]!.error).not.toContain("abcdefghijklmnopqrstuvwxyz123");
  });

  test("emits lifecycle task events without hosted webhooks", async () => {
    const filePath = join(home, "lifecycle.jsonl");
    upsertLocalEventHook({
      name: "lifecycle",
      events: ["task.created", "task.started", "task.completed"],
      target: "file",
      file_path: filePath,
    });
    const db = getDatabase();
    const task = createTask({ title: "Lifecycle" }, db);

    startTask(task.id, "codex", db);
    completeTask(task.id, "codex", db);

    expect(existsSync(filePath)).toBe(true);
    const events = readFileSync(filePath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(["task.created", "task.started", "task.completed"]);
    expect(events[0]!.payload.title).toBe("Lifecycle");
  });

  test("removes configured hooks", () => {
    upsertLocalEventHook({ name: "remove-me", events: ["*"], target: "stdout" });
    expect(removeLocalEventHook("remove-me")).toBe(true);
    expect(removeLocalEventHook("remove-me")).toBe(false);
  });
});
