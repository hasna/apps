/**
 * MON-V2-06 — Todos native adapter regression tests.
 *
 * The gate: tests use `TodosV1Client.createTask`, `createTaskComment`, and
 * `completeTask`; repeated effect keys do not create duplicate tasks;
 * non-required failure is recorded and the run continues.
 *
 * The tests construct the REAL `TodosV1Client` from `@hasna/todos/sdk` and
 * stub only the fetch transport, so every assertion exercises the generated
 * client's request path end to end.
 */

import { describe, expect, it } from "bun:test";
import { TodosV1Client } from "@hasna/todos/sdk";
import type { AlertRow } from "../db/schema.js";
import {
  TodosAdapter,
  createTaskForAlert,
  type TodosAdapterOptions,
  type TodosEffectStore,
} from "./todos.js";

// ── Test transport ─────────────────────────────────────────────────────────

interface CallRecord {
  url: string;
  method: string;
  body?: unknown;
}

/** Records every request and serves scripted responses by URL shape. */
function makeTransport(handlers: {
  [pattern: string]: {
    status: number;
    body?: unknown;
  };
}): {
  calls: CallRecord[];
  fetch: typeof fetch;
} {
  const calls: CallRecord[] = [];
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    // Most specific pattern wins: "/v1/tasks/t1/comments" must match before
    // the shorter "/v1/tasks" pattern.
    const matches = Object.keys(handlers)
      .filter((pattern) => url.includes(pattern))
      .sort((a, b) => b.length - a.length);
    const handler =
      matches.length > 0
        ? (handlers[matches[0]!] as { status: number; body?: unknown })
        : { status: 200, body: {} };
    return new Response(
      handler.body === undefined ? "" : JSON.stringify(handler.body),
      {
        status: handler.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function makeClient(transport: ReturnType<typeof makeTransport>): TodosV1Client {
  return new TodosV1Client({
    baseUrl: "http://todos.test",
    fetch: transport.fetch,
  });
}

function makeAdapter(
  client: TodosV1Client,
  store?: TodosEffectStore,
  required = false
): TodosAdapter {
  const options: TodosAdapterOptions = { client };
  if (store !== undefined) options.effectStore = store;
  if (required) options.required = true;
  return new TodosAdapter(options);
}

function makeAlert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: 1,
    machine_id: "linux-node-a",
    triggered_at: Math.floor(Date.parse("2026-08-18T09:00:00Z") / 1000),
    resolved_at: null,
    severity: "critical",
    check_name: "cpu_high",
    message: "cpu at 98%",
    auto_resolved: 0,
    ...overrides,
  };
}

// ── createTask ─────────────────────────────────────────────────────────────

describe("TodosAdapter.createTask", () => {
  it("creates a task through TodosV1Client.createTask and records the pointer", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 201, body: { task: { id: "task-1", title: "X" } } },
    });
    const adapter = makeAdapter(makeClient(transport));

    const out = await adapter.createTask("run-1:alert:cpu", {
      title: "cpu high on linux-node-a",
      projectId: "proj-1",
      tags: ["monitor", "alert"],
    });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.method).toBe("POST");
    expect(transport.calls[0]!.url).toContain("/v1/tasks");
    expect(transport.calls[0]!.body).toMatchObject({
      title: "cpu high on linux-node-a",
      project_id: "proj-1",
      tags: ["monitor", "alert"],
    });
    expect(out.ok).toBe(true);
    expect(out.applied).toBe(true);
    expect(out.result).toEqual({ taskId: "task-1" });
  });

  it("repeated effect keys replay the recorded task and never call the client again", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 201, body: { task: { id: "task-1", title: "X" } } },
    });
    const adapter = makeAdapter(makeClient(transport));

    const first = await adapter.createTask("run-1:alert:cpu", { title: "X" });
    const second = await adapter.createTask("run-1:alert:cpu", { title: "X" });

    expect(transport.calls).toHaveLength(1);
    expect(second.ok).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.result).toEqual(first.result);
  });

  it("distinct effect keys create distinct tasks", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 201, body: { task: { id: "task-N", title: "X" } } },
    });
    const adapter = makeAdapter(makeClient(transport));

    await adapter.createTask("run-1:alert:cpu", { title: "A" });
    await adapter.createTask("run-1:alert:mem", { title: "B" });

    expect(transport.calls).toHaveLength(2);
  });

  it("non-required failure is recorded and the run continues", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 500, body: { error: "boom" } },
      "/v1/tasks/t1/comments": {
        status: 201,
        body: { comment: { id: "c1", content: "evidence" } },
      },
    });
    const adapter = makeAdapter(makeClient(transport));

    const failed = await adapter.createTask("run-1:alert:cpu", { title: "X" });
    expect(failed.ok).toBe(false);
    expect(failed.applied).toBe(true);
    expect(failed.error).toContain("500");

    // The run continues: a subsequent, unrelated effect still executes.
    const later = await adapter.commentTask("run-1:comment:ev", {
      taskId: "t1",
      content: "evidence",
    });
    expect(later.ok).toBe(true);
    expect(transport.calls).toHaveLength(2);
  });

  it("required failure rejects with the recorded error", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 500, body: { error: "boom" } },
    });
    const adapter = makeAdapter(makeClient(transport), undefined, true);

    await expect(adapter.createTask("run-1:alert:cpu", { title: "X" })).rejects.toThrow(
      /500/
    );
  });

  it("a repeated failed effect key replays the failure without a second call", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 500, body: { error: "boom" } },
    });
    const adapter = makeAdapter(makeClient(transport));

    const first = await adapter.createTask("run-1:alert:cpu", { title: "X" });
    const second = await adapter.createTask("run-1:alert:cpu", { title: "X" });

    expect(transport.calls).toHaveLength(1);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(second.applied).toBe(false);
  });
});

// ── commentTask ────────────────────────────────────────────────────────────

describe("TodosAdapter.commentTask", () => {
  it("posts evidence through TodosV1Client.createTaskComment", async () => {
    const transport = makeTransport({
      "/v1/tasks/t1/comments": {
        status: 201,
        body: { comment: { id: "c1", content: "evidence" } },
      },
    });
    const adapter = makeAdapter(makeClient(transport));

    const out = await adapter.commentTask("run-1:comment:ev", {
      taskId: "t1",
      content: "evidence",
      type: "progress",
    });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.method).toBe("POST");
    expect(transport.calls[0]!.url).toContain("/v1/tasks/t1/comments");
    expect(transport.calls[0]!.body).toMatchObject({
      content: "evidence",
      type: "progress",
    });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ commentId: "c1" });
  });

  it("repeated comment effect keys post once", async () => {
    const transport = makeTransport({
      "/v1/tasks/t1/comments": {
        status: 201,
        body: { comment: { id: "c1", content: "evidence" } },
      },
    });
    const adapter = makeAdapter(makeClient(transport));

    await adapter.commentTask("run-1:comment:ev", { taskId: "t1", content: "evidence" });
    await adapter.commentTask("run-1:comment:ev", { taskId: "t1", content: "evidence" });

    expect(transport.calls).toHaveLength(1);
  });
});

// ── completeTask ───────────────────────────────────────────────────────────

describe("TodosAdapter.completeTask", () => {
  it("completes a task through TodosV1Client.completeTask", async () => {
    const transport = makeTransport({
      "/v1/tasks/t1/complete": { status: 200, body: { task: { id: "t1" } } },
    });
    const adapter = makeAdapter(makeClient(transport));

    const out = await adapter.completeTask("run-1:complete:alert", "t1", {
      test_results: "pass",
    });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.method).toBe("POST");
    expect(transport.calls[0]!.url).toContain("/v1/tasks/t1/complete");
    expect(transport.calls[0]!.body).toMatchObject({ test_results: "pass" });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ taskId: "t1" });
  });

  it("repeated complete effect keys post once", async () => {
    const transport = makeTransport({
      "/v1/tasks/t1/complete": { status: 200, body: { task: { id: "t1" } } },
    });
    const adapter = makeAdapter(makeClient(transport));

    await adapter.completeTask("run-1:complete:alert", "t1");
    await adapter.completeTask("run-1:complete:alert", "t1");

    expect(transport.calls).toHaveLength(1);
  });
});

// ── createTaskForAlert (transitional alert glue) ───────────────────────────

describe("createTaskForAlert", () => {
  it("skips creation when an open task already exists for the machine+check", async () => {
    const transport = makeTransport({
      "/v1/tasks": {
        status: 200,
        body: {
          tasks: [
            {
              id: "open-1",
              title: "ALERT: linux-node-a cpu_high — cpu at 98%",
              status: "pending",
            },
          ],
        },
      },
    });
    const client = makeClient(transport);

    // Distinct alert row id from the sibling test below, so the two glue tests
    // never collide on the shared alert effect store.
    await createTaskForAlert(makeAlert({ id: 10 }), {
      enabled: true,
      project_id: "proj-1",
      base_url: "http://todos.test",
      client,
    });

    const createCalls = transport.calls.filter(
      (c) => c.method === "POST" && c.url.includes("/v1/tasks")
    );
    expect(createCalls).toHaveLength(0);
  });

  it("creates a task through the native client when none is open, and dedupes by effect key", async () => {
    const transport = makeTransport({
      "/v1/tasks": { status: 201, body: { task: { id: "task-1", title: "T" } } },
    });
    const client = makeClient(transport);

    const alert = makeAlert({ id: 11 });
    await createTaskForAlert(alert, {
      enabled: true,
      project_id: "proj-1",
      base_url: "http://todos.test",
      client,
    });
    await createTaskForAlert(alert, {
      enabled: true,
      project_id: "proj-1",
      base_url: "http://todos.test",
      client,
    });

    const createCalls = transport.calls.filter(
      (c) => c.method === "POST" && c.url.includes("/v1/tasks")
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!.body).toMatchObject({
      title: expect.stringContaining("ALERT"),
      project_id: "proj-1",
    });
  });
});
