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
  parseTodosTaskManifest,
  parseTodosTaskManifestCompensation,
  type TodosTaskManifest,
} from "./index.js";

const PROJECT_ID = "3583f012-71bb-40e5-997f-05dfdb2c2542";
const TENANT_ID = "tenant-receipt-recovery";

function manifest(operationId = "email-triage-graph-v1"): TodosTaskManifest {
  return {
    version: 1,
    operation_id: operationId,
    idempotency_key: `${operationId}:apply`,
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
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_receipts").get()).toEqual({ count: 1 });
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox").get()).toEqual({ count: 2 });
    expect(() => db.run("UPDATE todos_task_manifest_receipts SET result_digest = 'changed'"))
      .toThrow(/immutable/);
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
      state: "applied",
    });
    expect(Object.keys(recovered).sort()).toEqual([
      "apply_receipt_id",
      "authority",
      "binding_version",
      "plan_id",
      "route",
      "schema_version",
      "state",
      "tenant_id",
    ]);
    const serialized = JSON.stringify(recovered);
    expect(serialized).not.toContain(fakeToken);
    expect(serialized).not.toContain(sensitive.idempotency_key);
    expect(serialized).not.toContain(sensitive.plan.name);
    expect(serialized).not.toContain(sensitive.tasks[0]!.title);

    await authority.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "receipt-recovery:compensate",
      if_binding_version: applied.receipt.binding_version,
    });
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
    await expect(authority.compensate({
      receipt_id: delivered.receipt.receipt_id,
      idempotency_key: "delivered:compensate",
      if_binding_version: delivered.receipt.binding_version,
    })).rejects.toThrow(/delivered outbox/i);

    const referenced = await authority.apply(manifest("foreign-reference"));
    const foreignId = "f0000000-0000-4000-8000-000000000001";
    db.run("INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)", [foreignId, PROJECT_ID, "Foreign"]);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [foreignId, referenced.graph.task_ids.design]);
    await expect(authority.compensate({
      receipt_id: referenced.receipt.receipt_id,
      idempotency_key: "foreign-reference:compensate",
      if_binding_version: referenced.receipt.binding_version,
    })).rejects.toThrow(/foreign reference/i);

    const clean = await authority.apply(manifest("clean-compensation"));
    const result = await authority.compensate({
      receipt_id: clean.receipt.receipt_id,
      idempotency_key: "clean-compensation:compensate",
      if_binding_version: clean.receipt.binding_version,
    });
    expect(result.absent).toBe(true);
    expect(result.readback).toEqual({ plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true });
    expect(db.query("SELECT count(*) AS count FROM todos_task_manifest_outbox WHERE apply_receipt_id = ? AND status = 'cancelled'").get(clean.receipt.receipt_id)).toEqual({ count: 2 });
    const duplicate = await authority.compensate({
      receipt_id: clean.receipt.receipt_id,
      idempotency_key: "clean-compensation:compensate",
      if_binding_version: clean.receipt.binding_version,
    });
    expect(duplicate.duplicate).toBe(true);
  });

  test("refuses before a supported checklist CASCADE can delete the foreign row", async () => {
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const applied = await authority.apply(manifest("foreign-checklist-reference"));
    const checklist = addChecklistItem({
      task_id: applied.graph.task_ids.design,
      text: "Foreign checklist evidence",
    }, db);

    await expect(authority.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "foreign-checklist-reference:compensate",
      if_binding_version: applied.receipt.binding_version,
    })).rejects.toThrow(/foreign reference at task_checklists\.task_id would be changed by CASCADE/i);

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

    await expect(authority.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "foreign-set-null-references:task-compensate",
      if_binding_version: applied.receipt.binding_version,
    })).rejects.toThrow(/foreign reference at context_snapshots\.task_id would be changed by SET NULL/i);
    expect(db.query("SELECT task_id FROM context_snapshots WHERE id = ?").get(snapshotId))
      .toEqual({ task_id: applied.graph.task_ids.design });

    db.run("DELETE FROM context_snapshots WHERE id = ?", [snapshotId]);
    await expect(authority.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "foreign-set-null-references:plan-compensate",
      if_binding_version: applied.receipt.binding_version,
    })).rejects.toThrow(/foreign reference at task_boards\.plan_id would be changed by SET NULL/i);
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
    await expect(authority.compensate({
      receipt_id: applied.receipt.receipt_id,
      idempotency_key: "managed-mutation:compensate",
      if_binding_version: applied.receipt.binding_version,
    })).rejects.toThrow(/comment changed/);
  });

  test("applies the package pre-write secret boundary before graph persistence", async () => {
    const fakeToken = ["ghp", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].join("_");
    const authority = createSqliteTodosTaskManifestAuthority({ database: db });
    const sensitive = manifest("prewrite-redaction");
    sensitive.tasks[0]!.title = `Investigate ${fakeToken}`;
    sensitive.tasks[0]!.comments = [{ content: `Observed ${fakeToken}` }];
    sensitive.effects = [{ topic: "task-manifest.redaction", payload: { note: fakeToken } }];
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
