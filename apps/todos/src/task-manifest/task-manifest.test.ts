import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../db/schema.js";
import { addChecklistItem } from "../db/checklists.js";
import {
  TODOS_TASK_MANIFEST_ROUTE,
  TodosTaskManifestError,
  createSqliteTodosTaskManifestAuthority,
  deriveTodosTaskManifestApplyPreconditionDigest,
  deriveTodosTaskManifestCompensationPreconditionDigest,
  deriveTodosTaskManifestIdempotencyKey,
  parseTodosTaskManifest,
  parseTodosTaskManifestCompensation,
  taskManifestCompensationRequestDigest,
  taskManifestRequestDigest,
  supportsIdempotentOutboxDelivery,
  type TodosTaskManifest,
} from "./index.js";
import { sqliteLegacyTaskManifestPlanSlug, taskManifestPlanSlug } from "./plan-slug.js";

const PROJECT_ID = "3583f012-71bb-40e5-997f-05dfdb2c2542";
const TENANT_ID = "tenant-receipt-recovery";

function manifest(operationId = "email-triage-graph-v1"): TodosTaskManifest {
  const base = {
    version: 1,
    operation_id: operationId,
    step_id: "apply",
    idempotency_key: "",
    precondition_digest: "",
    project_id: PROJECT_ID,
    plan: {
      key: "email-triage",
      name: "Email Triage",
      description: "Closed task graph",
      status: "active",
    },
    tasks: [
      {
        key: "design",
        title: "Design the graph",
        priority: "high",
        tags: ["email-triage"],
        metadata: { native_node_id: "bf3f9774-91fe-4b72-8a20-a286a68661a8" },
        comments: [{ content: "native_node_id=bf3f9774-91fe-4b72-8a20-a286a68661a8" }],
        verifications: [{ command: "manifest/readback design", status: "passed" }],
      },
      {
        key: "events_emails",
        title: "Add email events",
        comments: [{ content: "native_node_id=c7901124-0c66-4300-bdab-1915d4340418" }],
        verifications: [{ command: "manifest/readback events_emails", status: "passed" }],
      },
    ],
    dependencies: [{ task: "events_emails", depends_on: "design" }],
    effects: [{ topic: "email-triage.graph-created", payload: { graph: operationId } }],
  };
  const precondition_digest = deriveTodosTaskManifestApplyPreconditionDigest(base);
  const request_digest = taskManifestRequestDigest({
    ...base,
    precondition_digest,
  });
  const idempotency_key = deriveTodosTaskManifestIdempotencyKey({
    operation_id: operationId,
    step_id: base.step_id,
    direction: "apply",
    target_selector: PROJECT_ID,
    request_digest,
    precondition_digest,
  });
  return {
    ...base,
    precondition_digest,
    idempotency_key,
  };
}

function refreshManifestIdentity(manifestValue: TodosTaskManifest): TodosTaskManifest {
  const { idempotency_key: _idempotencyKey, ...request } = manifestValue;
  const request_digest = taskManifestRequestDigest(request);
  manifestValue.idempotency_key = deriveTodosTaskManifestIdempotencyKey({
    operation_id: manifestValue.operation_id,
    step_id: manifestValue.step_id,
    direction: "apply",
    target_selector: manifestValue.project_id,
    request_digest,
    precondition_digest: manifestValue.precondition_digest,
  });
  return manifestValue;
}

function compensationRequest(
  applied: { receipt: { receipt_id: string; binding_version: number } },
  suffix = "compensate",
) {
  void suffix;
  const operation_id = applied.receipt.operation_id;
  const step_id = "compensate";
  const precondition_digest = deriveTodosTaskManifestCompensationPreconditionDigest({
    receipt_id: applied.receipt.receipt_id,
    operation_id,
    step_id,
    if_binding_version: applied.receipt.binding_version,
  });
  const request_digest = taskManifestCompensationRequestDigest({
    receipt_id: applied.receipt.receipt_id,
    operation_id,
    step_id,
    precondition_digest,
    if_binding_version: applied.receipt.binding_version,
  });
  return {
    receipt_id: applied.receipt.receipt_id,
    operation_id,
    step_id,
    idempotency_key: deriveTodosTaskManifestIdempotencyKey({
      operation_id,
      step_id,
      direction: "compensate",
      target_selector: applied.receipt.receipt_id,
      request_digest,
      precondition_digest,
    }),
    precondition_digest,
    if_binding_version: applied.receipt.binding_version,
  };
}

describe("task-manifest SQLite authority", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.run(
      `INSERT INTO projects (id, name, path, task_prefix, task_counter, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [PROJECT_ID, "Email Triage", `/disposable/${crypto.randomUUID()}`, "EMA", "2026-08-07T00:00:00.000Z", "2026-08-07T00:00:00.000Z"],
    );
  });

  afterEach(() => db.close());

  test("rejects unknown fields and foreign dependency references before writes", () => {
    expect(() => parseTodosTaskManifest({ ...manifest(), surprise: true }))
      .toThrow(TodosTaskManifestError);
    expect(() => parseTodosTaskManifest({
      ...manifest(),
      tasks: [{ ...manifest().tasks[0], status: "blocked" }],
    })).toThrow(/tasks\.0\.status/);
    expect(() => parseTodosTaskManifest({
      ...manifest(),
      tasks: [{ ...manifest().tasks[0], priority: "urgent" }],
    })).toThrow(/tasks\.0\.priority/);
    expect(() => parseTodosTaskManifest({
      ...manifest(),
      dependencies: [{ task: "events_emails", depends_on: "outside" }],
    })).toThrow(/foreign task key/);
    expect(() => parseTodosTaskManifest({
      ...manifest(),
      dependencies: [
        { task: "events_emails", depends_on: "design" },
        { task: "design", depends_on: "events_emails" },
      ],
    })).toThrow(/cycle/);
    expect(() => parseTodosTaskManifestCompensation({
      receipt_id: crypto.randomUUID(),
      idempotency_key: "compensate:strict",
      if_binding_version: 1,
      surprise: true,
    })).toThrow(TodosTaskManifestError);
    expect(() => parseTodosTaskManifestCompensation({
      receipt_id: crypto.randomUUID(),
      idempotency_key: `compensate:${"x".repeat(201)}`,
      if_binding_version: 1,
    })).toThrow(TodosTaskManifestError);
    expect(db.query("SELECT count(*) AS count FROM plans").get()).toEqual({ count: 0 });
  });

  test("accepts and persists the canonical terminal status and critical priority", async () => {
    const input = manifest("canonical-task-enums");
    input.tasks[0] = {
      ...input.tasks[0]!,
      status: "failed",
      priority: "critical",
    };
    refreshManifestIdentity(input);
    const parsed = parseTodosTaskManifest(input);
    expect(parsed.tasks[0]?.status).toBe("failed");
    expect(parsed.tasks[0]?.priority).toBe("critical");

    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const applied = await authority.apply(parsed);
    expect(db.query("SELECT status, priority FROM tasks WHERE id = ?").get(applied.graph.task_ids.design))
      .toEqual({ status: "failed", priority: "critical" });
  });

  test("creates the closed graph with deterministic IDs, exact readback, receipts, and outbox", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db, now: () => "2026-08-07T00:00:00.000Z" });
    const first = await authority.apply(manifest());
    const second = await authority.apply(manifest());

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.receipt.receipt_id).toBe(first.receipt.receipt_id);
    expect(second.graph).toEqual(first.graph);
    expect(first.readback).toEqual({ plans: 1, tasks: 2, dependencies: 1, comments: 2, verifications: 2, complete: true });
    expect(first.graph.task_ids).toEqual({
      design: expect.stringMatching(/^[0-9a-f-]{36}$/),
      events_emails: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(first.outbox_ids).toHaveLength(2);
    const plan = db.query("SELECT slug FROM plans WHERE id = ?").get(first.graph.plan_id) as { slug: string } | null;
    expect(plan?.slug).toBe(taskManifestPlanSlug(manifest(), first.graph.plan_id));
    expect(plan?.slug.endsWith(first.graph.plan_id)).toBe(true);
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_receipts").get()).toEqual({ count: 1 });
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox").get()).toEqual({ count: 2 });
    expect(() => db.run("UPDATE todos_task_manifest_receipts SET result_digest = 'changed'"))
      .toThrow(/immutable/);
  });

  test("terminally records a changed replay before rejecting an arbitrary new-operation key", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const original = manifest("terminal-replay");
    const accepted = await authority.apply(original);
    const plansBefore = db.query("SELECT count(*) AS count FROM plans").get();
    const outboxBefore = db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox").get();

    const changedReplay = { ...original, plan: { ...original.plan, name: "Changed replay" } };
    let terminalError: TodosTaskManifestError | undefined;
    try {
      await authority.apply(changedReplay);
    } catch (error) {
      terminalError = error as TodosTaskManifestError;
    }
    expect(terminalError).toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
      details: expect.objectContaining({
        receipt: expect.objectContaining({
          outcome: "terminal_nonacceptance",
          reason: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
        }),
      }),
    }));
    const terminalReceiptId = (terminalError?.details["receipt"] as { receipt_id?: string } | undefined)?.receipt_id;
    expect(terminalReceiptId).toBeTruthy();
    expect(await authority.readExact(String(terminalReceiptId))).toMatchObject({
      receipt: {
        receipt_id: terminalReceiptId,
        outcome: "terminal_nonacceptance",
        reason: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
      },
    });
    expect(db.query("SELECT count(*) AS count FROM plans").get()).toEqual(plansBefore);
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox").get()).toEqual(outboxBefore);
    expect(db.query(
      "SELECT count(*) AS count FROM todos_task_manifest_terminal_receipts WHERE operation_id = ?",
    ).get(original.operation_id)).toEqual({ count: 1 });

    await expect(authority.apply(changedReplay)).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
    }));
    expect(db.query(
      "SELECT count(*) AS count FROM todos_task_manifest_terminal_receipts WHERE operation_id = ?",
    ).get(original.operation_id)).toEqual({ count: 1 });
    expect(accepted.receipt.outcome).toBe("accepted");

    const arbitrary = manifest("arbitrary-new-operation-key");
    arbitrary.idempotency_key = `tmk_${"f".repeat(48)}`;
    await expect(authority.apply(arbitrary)).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_MISMATCH",
      details: expect.objectContaining({
        receipt: expect.objectContaining({
          outcome: "terminal_nonacceptance",
          reason: "TODOS_TASK_MANIFEST_IDEMPOTENCY_MISMATCH",
        }),
      }),
    }));
    expect(db.query(
      "SELECT count(*) AS count FROM todos_task_manifest_terminal_receipts WHERE operation_id = ?",
    ).get(arbitrary.operation_id)).toEqual({ count: 1 });
  });

  test("requires fresh operation, step, key, and precondition after terminal nonacceptance", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const rejected = manifest("terminal-retry-identity");
    rejected.idempotency_key = `tmk_${"f".repeat(48)}`;

    await expect(authority.apply(rejected)).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_MISMATCH",
      details: expect.objectContaining({
        receipt: expect.objectContaining({
          operation_id: rejected.operation_id,
          step_id: rejected.step_id,
          idempotency_key: rejected.idempotency_key,
          outcome: "terminal_nonacceptance",
        }),
      }),
    }));

    const changedKey = { ...rejected };
    refreshManifestIdentity(changedKey);
    await expect(authority.apply(changedKey)).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_IDEMPOTENCY_MISMATCH",
      details: expect.objectContaining({
        receipt: expect.objectContaining({
          operation_id: rejected.operation_id,
          step_id: rejected.step_id,
          idempotency_key: rejected.idempotency_key,
          outcome: "terminal_nonacceptance",
        }),
      }),
    }));
    expect(db.query(
      "SELECT count(*) AS count FROM todos_task_manifest_terminal_receipts WHERE operation_id = ? AND step_id = ?",
    ).get(rejected.operation_id, rejected.step_id)).toEqual({ count: 1 });

    const fresh = manifest("terminal-retry-fresh-operation");
    fresh.step_id = "apply-retry";
    fresh.precondition_digest = deriveTodosTaskManifestApplyPreconditionDigest(fresh);
    refreshManifestIdentity(fresh);
    const accepted = await authority.apply(fresh);
    expect(accepted.receipt.outcome).toBe("accepted");
    expect(accepted.receipt.operation_id).toBe(fresh.operation_id);
    expect(accepted.receipt.step_id).toBe(fresh.step_id);
    expect(accepted.receipt.precondition_digest).toBe(fresh.precondition_digest);
  });

  test("advertises retry-safe outbox delivery without changing task-manifest schema v1", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const capability = await authority.capability();
    expect(capability).toMatchObject({
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      idempotent_outbox_delivery: true,
    });
    expect(supportsIdempotentOutboxDelivery(capability)).toBe(true);
    expect(supportsIdempotentOutboxDelivery({
      ...capability,
      idempotent_outbox_delivery: false,
    })).toBe(false);
    const {
      idempotent_outbox_delivery: _idempotentOutboxDelivery,
      ...legacyCapability
    } = capability;
    expect(supportsIdempotentOutboxDelivery(legacyCapability)).toBe(false);
  });

  test("retries the first delivered row before acknowledging the second without weakening integrity", async () => {
    const timestamps = [
      "2026-08-07T00:00:00.000Z",
      "2026-08-07T00:01:00.000Z",
      "2026-08-07T00:02:00.000Z",
      "2026-08-07T00:03:00.000Z",
      "2026-08-07T00:04:00.000Z",
      "2026-08-07T00:05:00.000Z",
    ];
    let timestampIndex = 0;
    const authority = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: TENANT_ID,
      now: () => timestamps[timestampIndex++] ?? "2026-08-07T00:06:00.000Z",
    });
    const applied = await authority.apply(manifest("partial-delivery-retry"));
    const firstOutboxId = applied.outbox_ids[0]!;
    const secondOutboxId = applied.outbox_ids[1]!;

    await authority.markOutboxDelivered(firstOutboxId);
    const firstDelivery = db.query(
      "SELECT status, attempts, delivered_at FROM todos_task_manifest_outbox WHERE id = ?",
    ).get(firstOutboxId);

    await authority.markOutboxDelivered(firstOutboxId);
    expect(db.query(
      "SELECT status, attempts, delivered_at FROM todos_task_manifest_outbox WHERE id = ?",
    ).get(firstOutboxId)).toEqual(firstDelivery);

    await authority.markOutboxDelivered(secondOutboxId);
    expect(db.query(
      "SELECT status, attempts FROM todos_task_manifest_outbox WHERE id IN (?, ?) ORDER BY id",
    ).all(firstOutboxId, secondOutboxId)).toEqual([
      { status: "delivered", attempts: 1 },
      { status: "delivered", attempts: 1 },
    ]);

    const wrongTenantAuthority = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: "another-tenant",
    });
    await expect(wrongTenantAuthority.markOutboxDelivered(firstOutboxId))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_GRAPH_CONFLICT",
      }));
    await expect(authority.markOutboxDelivered(crypto.randomUUID()))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_GRAPH_CONFLICT",
      }));

    const cancelled = await authority.apply(manifest("cancelled-delivery-retry"));
    await authority.compensate(compensationRequest(cancelled, "cancelled-delivery-retry"));
    await expect(authority.markOutboxDelivered(cancelled.outbox_ids[0]!))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_GRAPH_CONFLICT",
      }));
  });

  test("recovers one exact managed binding by plan id without returning manifest or request content", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: TENANT_ID,
      now: () => "2026-08-08T00:00:00.000Z",
    });
    const sensitive = manifest("receipt-recovery");
    const fakeToken = ["ghp", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"].join("_");
    sensitive.plan.name = `Sensitive plan ${fakeToken}`;
    sensitive.tasks[0]!.title = `Sensitive task ${fakeToken}`;
    refreshManifestIdentity(sensitive);
    const applied = await authority.apply(sensitive);

    const recovered = await authority.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      max_items: 1,
    });

    expect(recovered).toEqual({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      apply_receipt_id: applied.receipt.receipt_id,
      binding_version: 1,
      operation_id: "receipt-recovery",
      step_id: "apply",
      state: "applied",
    });
    expect(Object.keys(recovered).sort()).toEqual([
      "apply_receipt_id",
      "authority",
      "binding_version",
      "operation_id",
      "plan_id",
      "route",
      "schema_version",
      "state",
      "step_id",
      "tenant_id",
    ]);
    const serialized = JSON.stringify(recovered);
    expect(serialized).not.toContain(fakeToken);
    expect(serialized).not.toContain(sensitive.idempotency_key);
    expect(serialized).not.toContain(sensitive.plan.name);
    expect(serialized).not.toContain(sensitive.tasks[0]!.title);

    await authority.compensate(compensationRequest(applied, "receipt-recovery"));
    expect(await authority.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      max_items: 1,
    })).toMatchObject({
      apply_receipt_id: applied.receipt.receipt_id,
      binding_version: 2,
      state: "compensated",
    });
  });

  test("does not recover another tenant's binding from the same SQLite store", async () => {
    const tenantA = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: "tenant-a",
    });
    const applied = await tenantA.apply(manifest("tenant-isolated-lookup"));
    const tenantB = createSqliteTodosTaskManifestAuthority({
      database: db,
      tenantId: "tenant-b",
    });

    await expect(tenantB.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: "tenant-b",
      plan_id: applied.graph.plan_id,
      max_items: 1,
    })).rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
      code: "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
    }));
  });

  test("backfills legacy SQLite receipt and binding rows to the configured tenant", async () => {
    const legacy = new Database(":memory:");
    const planId = "a0000000-0000-4000-8000-000000000071";
    const receiptId = "b0000000-0000-4000-8000-000000000071";
    const resultJson = JSON.stringify({ graph: { plan_id: planId } });
    try {
      legacy.exec(`
        CREATE TABLE todos_task_manifest_receipts (
          receipt_id TEXT PRIMARY KEY,
          authority TEXT NOT NULL,
          route TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          kind TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_digest TEXT NOT NULL,
          result_digest TEXT NOT NULL,
          binding_version INTEGER NOT NULL,
          apply_receipt_id TEXT,
          manifest_json TEXT,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(kind, idempotency_key)
        );
        CREATE TABLE todos_task_manifest_bindings (
          operation_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_digest TEXT NOT NULL,
          result_digest TEXT NOT NULL,
          apply_receipt_id TEXT NOT NULL UNIQUE REFERENCES todos_task_manifest_receipts(receipt_id),
          manifest_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          state TEXT NOT NULL,
          version INTEGER NOT NULL,
          compensation_receipt_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TRIGGER todos_task_manifest_receipts_immutable_update
          BEFORE UPDATE ON todos_task_manifest_receipts BEGIN
            SELECT RAISE(ABORT, 'todos task manifest receipts are immutable');
          END;
      `);
      legacy.query(`INSERT INTO todos_task_manifest_receipts (
        receipt_id, authority, route, schema_version, kind, operation_id, idempotency_key,
        request_digest, result_digest, binding_version, apply_receipt_id, manifest_json,
        result_json, created_at
      ) VALUES (?, 'todos', ?, 1, 'apply', ?, ?, ?, ?, 1, NULL, '{}', ?, ?)`).run(
        receiptId,
        TODOS_TASK_MANIFEST_ROUTE,
        "legacy-tenant-upgrade",
        "legacy-tenant-upgrade:apply",
        "request-digest",
        "result-digest",
        resultJson,
        "2026-08-08T00:00:00.000Z",
      );
      legacy.query(`INSERT INTO todos_task_manifest_bindings (
        operation_id, idempotency_key, request_digest, result_digest, apply_receipt_id,
        manifest_json, result_json, state, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, 'applied', 1, ?, ?)`).run(
        "legacy-tenant-upgrade",
        "legacy-tenant-upgrade:apply",
        "request-digest",
        "result-digest",
        receiptId,
        resultJson,
        "2026-08-08T00:00:00.000Z",
        "2026-08-08T00:00:00.000Z",
      );

      const authority = createSqliteTodosTaskManifestAuthority({
        database: legacy,
        tenantId: "tenant-upgrade",
      });
      expect(await authority.lookupBinding({
        authority: "todos",
        route: TODOS_TASK_MANIFEST_ROUTE,
        schema_version: 1,
        tenant_id: "tenant-upgrade",
        plan_id: planId,
        max_items: 1,
      })).toMatchObject({
        apply_receipt_id: receiptId,
        tenant_id: "tenant-upgrade",
      });
      expect(legacy.query(
        "SELECT tenant_id FROM todos_task_manifest_receipts WHERE receipt_id = ?",
      ).get(receiptId)).toEqual({ tenant_id: "tenant-upgrade" });
      expect(legacy.query(
        "SELECT tenant_id FROM todos_task_manifest_bindings WHERE operation_id = ?",
      ).get("legacy-tenant-upgrade")).toEqual({ tenant_id: "tenant-upgrade" });
      expect(() => legacy.run(
        "UPDATE todos_task_manifest_receipts SET result_digest = 'changed'",
      )).toThrow(/immutable/);
    } finally {
      legacy.close();
    }
  });

  test("fails closed for missing, non-managed, ambiguous, conflicting, or foreign lookup identity", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db, tenantId: TENANT_ID });
    const applied = await authority.apply(manifest("lookup-fail-closed"));
    const request = {
      authority: "todos" as const,
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1 as const,
      tenant_id: TENANT_ID,
      plan_id: applied.graph.plan_id,
      max_items: 1 as const,
    };

    const unmanagedPlanId = crypto.randomUUID();
    db.run(
      "INSERT INTO plans (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      [unmanagedPlanId, PROJECT_ID, "Unmanaged", "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z"],
    );
    await expect(authority.lookupBinding({ ...request, plan_id: unmanagedPlanId }))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
      }));
    await expect(authority.lookupBinding({ ...request, plan_id: crypto.randomUUID() }))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
      }));

    for (const mismatch of [
      { authority: "projects" },
      { route: "todos.task-manifest.v2" },
      { schema_version: 2 },
      { tenant_id: "tenant-foreign" },
    ]) {
      await expect(authority.lookupBinding({ ...request, ...mismatch } as never))
        .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
          code: "TODOS_TASK_MANIFEST_CAPABILITY_MISMATCH",
        }));
    }
    await expect(authority.lookupBinding({ ...request, max_items: 2 } as never))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
      }));
    await expect(authority.lookupBinding({ ...request, plan_id: `${applied.graph.plan_id.slice(0, 8)}` } as never))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_INVALID_INPUT",
      }));

    db.run(
      "UPDATE todos_task_manifest_bindings SET result_json = json_set(result_json, '$.graph.plan_id', ?) WHERE operation_id = ?",
      [crypto.randomUUID(), "lookup-fail-closed"],
    );
    await expect(authority.lookupBinding(request))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
      }));

    db.run(
      "UPDATE todos_task_manifest_bindings SET result_json = json_set(result_json, '$.graph.plan_id', ?) WHERE operation_id = ?",
      [request.plan_id, "lookup-fail-closed"],
    );
    const conflictingPlanId = crypto.randomUUID();
    db.run(
      "UPDATE todos_task_manifest_bindings SET result_json = json_set(result_json, '$.graph.plan_id', ?) WHERE operation_id = ?",
      [conflictingPlanId, "lookup-fail-closed"],
    );
    await expect(authority.lookupBinding({ ...request, plan_id: conflictingPlanId }))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_LOOKUP_CONFLICT",
      }));
    db.run(
      "UPDATE todos_task_manifest_bindings SET result_json = json_set(result_json, '$.graph.plan_id', ?) WHERE operation_id = ?",
      [request.plan_id, "lookup-fail-closed"],
    );

    const second = await authority.apply(manifest("lookup-ambiguous"));
    db.run(
      "UPDATE todos_task_manifest_bindings SET result_json = json_set(result_json, '$.graph.plan_id', ?) WHERE operation_id = ?",
      [request.plan_id, second.receipt.operation_id],
    );
    await expect(authority.lookupBinding(request))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_LOOKUP_CONFLICT",
      }));
  });

  test("serializes concurrent duplicates and applies the graph exactly once", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const results = await Promise.all([
      authority.apply(manifest("concurrent")),
      authority.apply(manifest("concurrent")),
      authority.apply(manifest("concurrent")),
    ]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(2);
    expect(db.query("SELECT count(*) AS count FROM plans").get()).toEqual({ count: 1 });
    expect(db.query("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 2 });
  });

  test("rolls back every graph row when a staged late verification fault fires", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({
      database: db,
      faultInjector: async (point) => point === "after_verification_write",
    });
    await expect(authority.apply(manifest("late-fault"))).rejects.toThrow(/fault.*after_verification_write/i);
    for (const table of ["plans", "tasks", "task_dependencies", "task_comments", "task_verifications", "todos_task_manifest_receipts", "todos_task_manifest_outbox"]) {
      expect(db.query(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  test("compensates only the exact untouched graph and refuses delivered effects or foreign references", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });

    const delivered = await authority.apply(manifest("delivered"));
    await authority.markOutboxDelivered(delivered.outbox_ids[0]!);
    await expect(authority.compensate(compensationRequest(delivered, "delivered")))
      .rejects.toThrow(/delivered outbox/i);

    const referenced = await authority.apply(manifest("foreign-reference"));
    const foreignId = "f0000000-0000-4000-8000-000000000001";
    db.run("INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)", [foreignId, PROJECT_ID, "Foreign"]);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [foreignId, referenced.graph.task_ids.design]);
    await expect(authority.compensate(compensationRequest(referenced, "foreign-reference")))
      .rejects.toThrow(/foreign reference/i);

    const clean = await authority.apply(manifest("clean-compensation"));
    const cleanCompensation = compensationRequest(clean, "clean-compensation");
    const result = await authority.compensate(cleanCompensation);
    expect(result.absent).toBe(true);
    expect(result.readback).toEqual({ plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true });
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox WHERE apply_receipt_id = ? AND status = 'cancelled'").get(clean.receipt.receipt_id)).toEqual({ count: 2 });
    const duplicate = await authority.compensate(cleanCompensation);
    expect(duplicate.duplicate).toBe(true);
  });

  test("compensates valid pre-0.15.26 SQLite slug states and refuses unknown legacy slugs", async () => {
    const markProvenance = (receiptId: string, operationId: string, provenance: string | null): void => {
      db.exec("DROP TRIGGER todos_task_manifest_receipts_immutable_update");
      db.run("UPDATE todos_task_manifest_receipts SET slug_provenance = ? WHERE receipt_id = ?", [provenance, receiptId]);
      db.run("UPDATE todos_task_manifest_bindings SET slug_provenance = ? WHERE operation_id = ?", [provenance, operationId]);
      db.exec(`
        CREATE TRIGGER todos_task_manifest_receipts_immutable_update
          BEFORE UPDATE ON todos_task_manifest_receipts BEGIN
            SELECT RAISE(ABORT, 'todos task manifest receipts are immutable');
        END;
      `);
    };
    const markLegacyReceipt = (receiptId: string, operationId: string): void =>
      markProvenance(receiptId, operationId, null);
    const legacyNull = await createSqliteTodosTaskManifestAuthority({ database: db }).apply(manifest("legacy-slug-null"));
    db.run("UPDATE plans SET slug = NULL WHERE id = ?", [legacyNull.graph.plan_id]);
    markLegacyReceipt(legacyNull.receipt.receipt_id, legacyNull.receipt.operation_id);
    await expect(createSqliteTodosTaskManifestAuthority({ database: db }).compensate(compensationRequest(legacyNull)))
      .resolves.toMatchObject({ absent: true });

    const legacyBasePlanId = "f0000000-0000-4000-8000-000000000001";
    db.run(
      `INSERT INTO plans (id, project_id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [legacyBasePlanId, PROJECT_ID, "Email Triage", "email-triage", "2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z"],
    );
    const legacyAllocated = await createSqliteTodosTaskManifestAuthority({ database: db }).apply(manifest("legacy-slug-allocated"));
    const legacyManifest = manifest("legacy-slug-allocated");
    const allocatedSlug = sqliteLegacyTaskManifestPlanSlug(
      db.query("SELECT id, project_id, name, slug, created_at FROM plans WHERE project_id IS ? ORDER BY created_at ASC, id ASC")
        .all(PROJECT_ID) as Array<{ id: string; project_id: string | null; name: string; slug: string | null; created_at: string }>,
      legacyAllocated.graph.plan_id,
      legacyManifest.plan.key,
    );
    expect(allocatedSlug).toBe("email-triage-2");
    db.run("UPDATE plans SET slug = ? WHERE id = ?", [allocatedSlug, legacyAllocated.graph.plan_id]);
    markLegacyReceipt(legacyAllocated.receipt.receipt_id, legacyAllocated.receipt.operation_id);
    await expect(createSqliteTodosTaskManifestAuthority({ database: db }).compensate(compensationRequest(legacyAllocated)))
      .resolves.toMatchObject({ absent: true });

    const unknown = await createSqliteTodosTaskManifestAuthority({ database: db }).apply(manifest("legacy-slug-unknown"));
    db.run("UPDATE plans SET slug = 'not-produced-by-legacy-allocator' WHERE id = ?", [unknown.graph.plan_id]);
    markLegacyReceipt(unknown.receipt.receipt_id, unknown.receipt.operation_id);
    await expect(createSqliteTodosTaskManifestAuthority({ database: db }).compensate(compensationRequest(unknown)))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
      }));

    const conflicting = await createSqliteTodosTaskManifestAuthority({ database: db }).apply(manifest("legacy-slug-conflicting-provenance"));
    markProvenance(conflicting.receipt.receipt_id, conflicting.receipt.operation_id, "legacy-v0.15.25");
    await expect(createSqliteTodosTaskManifestAuthority({ database: db }).compensate(compensationRequest(conflicting)))
      .rejects.toEqual(expect.objectContaining<TodosTaskManifestError>({
        code: "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
      }));
  });

  test("refuses before a supported checklist CASCADE can delete the foreign row", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const applied = await authority.apply(manifest("foreign-checklist-reference"));
    const checklist = addChecklistItem({
      task_id: applied.graph.task_ids.design,
      text: "Foreign checklist evidence",
    }, db);

    await expect(authority.compensate(compensationRequest(applied, "foreign-checklist-reference")))
      .rejects.toThrow(/foreign reference at task_checklists\.task_id would be changed by CASCADE/i);

    expect(db.query("SELECT task_id FROM task_checklists WHERE id = ?").get(checklist.id))
      .toEqual({ task_id: applied.graph.task_ids.design });
    expect(db.query("SELECT count(*) AS count FROM tasks WHERE id IN (?, ?)").get(
      applied.graph.task_ids.design,
      applied.graph.task_ids.events_emails,
    )).toEqual({ count: 2 });
  });

  test("refuses before task and plan SET NULL surfaces can detach foreign rows", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const applied = await authority.apply(manifest("foreign-set-null-references"));
    const snapshotId = crypto.randomUUID();
    db.run(
      "INSERT INTO context_snapshots (id, task_id, snapshot_type) VALUES (?, ?, 'checkpoint')",
      [snapshotId, applied.graph.task_ids.design],
    );
    const boardId = crypto.randomUUID();
    db.run(
      "INSERT INTO task_boards (id, name, plan_id) VALUES (?, ?, ?)",
      [boardId, `foreign-board-${boardId}`, applied.graph.plan_id],
    );

    await expect(authority.compensate(compensationRequest(applied, "foreign-set-null-task")))
      .rejects.toThrow(/foreign reference at context_snapshots\.task_id would be changed by SET NULL/i);
    expect(db.query("SELECT task_id FROM context_snapshots WHERE id = ?").get(snapshotId))
      .toEqual({ task_id: applied.graph.task_ids.design });

    db.run("DELETE FROM context_snapshots WHERE id = ?", [snapshotId]);
    await expect(authority.compensate(compensationRequest(applied, "foreign-set-null-plan")))
      .rejects.toThrow(/foreign reference at task_boards\.plan_id would be changed by SET NULL/i);
    expect(db.query("SELECT plan_id FROM task_boards WHERE id = ?").get(boardId))
      .toEqual({ plan_id: applied.graph.plan_id });
    expect(db.query("SELECT count(*) AS count FROM tasks WHERE id IN (?, ?)").get(
      applied.graph.task_ids.design,
      applied.graph.task_ids.events_emails,
    )).toEqual({ count: 2 });
  });

  test("refuses compensation after a same-count managed-row mutation", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const applied = await authority.apply(manifest("managed-mutation"));
    db.run("UPDATE task_comments SET content = ? WHERE id = ?", ["changed", applied.graph.comment_ids[0]!]);
    await expect(authority.compensate(compensationRequest(applied, "managed-mutation")))
      .rejects.toThrow(/comment changed/);
  });

  test("applies the package pre-write secret boundary before graph persistence", async () => {
    const fakeToken = ["ghp", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].join("_");
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const sensitive = manifest("prewrite-redaction");
    sensitive.tasks[0]!.title = `Investigate ${fakeToken}`;
    sensitive.tasks[0]!.comments = [{ content: `Observed ${fakeToken}` }];
    sensitive.effects = [{ topic: "task-manifest.redaction", payload: { note: fakeToken } }];
    refreshManifestIdentity(sensitive);
    const applied = await authority.apply(sensitive);
    const persisted = JSON.stringify({
      task: db.query("SELECT title FROM tasks WHERE id = ?").get(applied.graph.task_ids.design),
      comment: db.query("SELECT content FROM task_comments WHERE id = ?").get(applied.graph.comment_ids[0]!),
      outbox: db.query("SELECT payload FROM todos_task_manifest_outbox WHERE apply_receipt_id = ? ORDER BY id").all(applied.receipt.receipt_id),
      binding: db.query("SELECT manifest_json FROM todos_task_manifest_bindings WHERE operation_id = ?").get(sensitive.operation_id),
    });
    expect(persisted).not.toContain(fakeToken);
    expect(persisted).toContain("[REDACTED");
  });

  test("never opens the ambient/default store when an explicit disposable Database is supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "manifest-default-guard-"));
    const ambientPath = join(root, "must-not-exist.db");
    const previous = process.env["HASNA_TODOS_DB_PATH"];
    process.env["HASNA_TODOS_DB_PATH"] = ambientPath;
    try {
      const authority = createSqliteTodosTaskManifestAuthority({ database: db });
      await authority.apply(manifest("explicit-store-only"));
      expect(existsSync(ambientPath)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env["HASNA_TODOS_DB_PATH"];
      else process.env["HASNA_TODOS_DB_PATH"] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
