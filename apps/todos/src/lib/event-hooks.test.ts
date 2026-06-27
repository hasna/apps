import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { completeTask, createTask, startTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import {
  emitLocalEventHooks,
  listLocalEventHooks,
  removeLocalEventHook,
  testLocalEventHook,
  upsertLocalEventHook,
} from "./event-hooks.js";

let home: string;
let previousHome: string | undefined;

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
