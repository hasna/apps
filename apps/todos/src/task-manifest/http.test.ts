import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import {
  TODOS_TASK_MANIFEST_BOUNDS,
  TodosTaskManifestError,
  createSqliteTodosTaskManifestAuthority,
  createTodosTaskManifestHttpClient,
  handleTodosTaskManifestHttpRequest,
  type TodosTaskManifest,
} from "./index.js";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

function input(): TodosTaskManifest {
  return {
    version: 1,
    operation_id: "http-task-manifest-v1",
    idempotency_key: "http-task-manifest-v1:apply",
    project_id: PROJECT_ID,
    plan: { key: "http", name: "HTTP graph" },
    tasks: [{ key: "one", title: "One" }],
  };
}

describe("task-manifest HTTP authority", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [PROJECT_ID, "HTTP", "/disposable/http"]);
  });

  afterEach(() => db.close());

  test("round-trips capability, apply, exact receipt read, delivery, and authoritative errors", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db, now: () => "2026-08-07T00:00:00.000Z" });
    const fetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(request, init);
      return await handleTodosTaskManifestHttpRequest(req, new URL(req.url), authority)
        ?? new Response("not found", { status: 404 });
    };
    const client = createTodosTaskManifestHttpClient({ baseUrl: "https://todos.example.invalid", fetch });
    expect(await client.capability()).toMatchObject({ backend: "sqlite", transcript_safe: false, exact_bounded_readback: true });
    const applied = await client.apply(input());
    expect((await client.readExact(applied.receipt.receipt_id)).graph).toEqual(applied.graph);
    await client.markOutboxDelivered(applied.outbox_ids[0]!);
    await expect(client.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "http-task-manifest-v1:compensate",
      if_binding_version: 1,
    })).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
    }));
    await expect(client.readExact("missing")).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND",
    }));
  });

  test("enforces HTTP request and response byte bounds", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const request = new Request("https://todos.example.invalid/v1/task-manifest/apply", {
      method: "POST",
      headers: { "content-length": String(TODOS_TASK_MANIFEST_BOUNDS.request_bytes + 1) },
      body: "{}",
    });
    const response = await handleTodosTaskManifestHttpRequest(request, new URL(request.url), authority);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ code: "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED", authoritative: true });

    const client = createTodosTaskManifestHttpClient({
      baseUrl: "https://todos.example.invalid",
      fetch: async () => new Response("x".repeat(TODOS_TASK_MANIFEST_BOUNDS.response_bytes + 1)),
    });
    await expect(client.capability()).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
    }));
  });
});
