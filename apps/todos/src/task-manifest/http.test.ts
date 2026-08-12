import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import {
  TODOS_TASK_MANIFEST_BOUNDS,
  TODOS_TASK_MANIFEST_ROUTE,
  TodosTaskManifestError,
  createSqliteTodosTaskManifestAuthority,
  createTodosTaskManifestHttpClient,
  deriveTodosTaskManifestApplyPreconditionDigest,
  deriveTodosTaskManifestCompensationPreconditionDigest,
  deriveTodosTaskManifestIdempotencyKey,
  handleTodosTaskManifestHttpRequest,
  taskManifestRequestDigest,
  taskManifestCompensationRequestDigest,
  supportsIdempotentOutboxDelivery,
  type TodosTaskManifest,
} from "./index.js";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const TENANT_ID = "tenant-http-receipt-recovery";

function input(): TodosTaskManifest {
  const base = {
    version: 1,
    operation_id: "http-task-manifest-v1",
    step_id: "apply",
    idempotency_key: "",
    precondition_digest: "",
    project_id: PROJECT_ID,
    plan: { key: "http", name: "HTTP graph" },
    tasks: [{ key: "one", title: "One" }],
    effects: [{ topic: "task-manifest.http-test", payload: { phase: "two-row" } }],
  };
  const precondition_digest = deriveTodosTaskManifestApplyPreconditionDigest(base);
  const request_digest = taskManifestRequestDigest({ ...base, precondition_digest });
  return {
    ...base,
    precondition_digest,
    idempotency_key: deriveTodosTaskManifestIdempotencyKey({
      operation_id: base.operation_id,
      step_id: base.step_id,
      direction: "apply",
      target_selector: base.project_id,
      request_digest,
      precondition_digest,
    }),
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
    const authority = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: TENANT_ID,
      now: () => "2026-08-07T00:00:00.000Z",
    });
    const fetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(request, init);
      return await handleTodosTaskManifestHttpRequest(req, new URL(req.url), authority)
        ?? new Response("not found", { status: 404 });
    };
    const client = createTodosTaskManifestHttpClient({ baseUrl: "https://todos.example.invalid", fetch });
    const capability = await client.capability();
    expect(capability).toMatchObject({
      backend: "sqlite",
      transcript_safe: false,
      exact_bounded_readback: true,
      idempotent_outbox_delivery: true,
    });
    expect(supportsIdempotentOutboxDelivery(capability)).toBe(true);
    const applied = await client.apply(input());
    const changed = input();
    changed.plan.name = "Changed HTTP graph";
    await expect(client.apply(changed)).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
      details: expect.objectContaining({
        receipt: expect.objectContaining({
          outcome: "terminal_nonacceptance",
          reason: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
        }),
      }),
    }));
    expect(db.query("SELECT count(*) AS count FROM plans").get()).toEqual({ count: 1 });
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox").get()).toEqual({ count: 2 });
    expect(await client.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      max_items: 1,
    })).toEqual({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      operation_id: applied.receipt.operation_id,
      step_id: applied.receipt.step_id,
      apply_receipt_id: applied.receipt.receipt_id,
      binding_version: 1,
      state: "applied",
    });
    expect((await client.readExact(applied.receipt.receipt_id)).graph).toEqual(applied.graph);
    await client.markOutboxDelivered(applied.outbox_ids[0]!);
    await client.markOutboxDelivered(applied.outbox_ids[0]!);
    await client.markOutboxDelivered(applied.outbox_ids[1]!);
    const compensationStepId = "compensate";
    const compensationPrecondition = deriveTodosTaskManifestCompensationPreconditionDigest({
      receipt_id: applied.receipt.receipt_id,
      operation_id: applied.receipt.operation_id,
      step_id: compensationStepId,
      if_binding_version: 1,
    });
    const compensationRequestDigest = taskManifestCompensationRequestDigest({
      receipt_id: applied.receipt.receipt_id,
      operation_id: applied.receipt.operation_id,
      step_id: compensationStepId,
      precondition_digest: compensationPrecondition,
      if_binding_version: 1,
    });
    expect(db.query(
      "SELECT status, attempts FROM todos_task_manifest_outbox WHERE id IN (?, ?) ORDER BY id",
    ).all(applied.outbox_ids[0]!, applied.outbox_ids[1]!)).toEqual([
      { status: "delivered", attempts: 1 },
      { status: "delivered", attempts: 1 },
    ]);
    await expect(client.compensate({
      receipt_id: applied.receipt.receipt_id,
      operation_id: applied.receipt.operation_id,
      step_id: compensationStepId,
      idempotency_key: deriveTodosTaskManifestIdempotencyKey({
        operation_id: applied.receipt.operation_id,
        step_id: compensationStepId,
        direction: "compensate",
        target_selector: applied.receipt.receipt_id,
        request_digest: compensationRequestDigest,
        precondition_digest: compensationPrecondition,
      }),
      precondition_digest: compensationPrecondition,
      if_binding_version: 1,
    })).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
    }));
    await expect(client.readExact("missing")).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND",
    }));
    await expect(client.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: crypto.randomUUID(),
      max_items: 1,
    })).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
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
