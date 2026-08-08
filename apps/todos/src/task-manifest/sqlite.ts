import type { Database } from "bun:sqlite";
import { canonicalDigest, canonicalJson } from "./canonical.js";
import {
  validateTaskManifestBindingLookupRows,
  type NormalizedTaskManifest,
  type PreparedTaskManifestFaults,
  type TaskManifestBindingLookupRow,
  type TodosTaskManifestBackend,
} from "./backend.js";
import { findSqliteTaskManifestForeignReference } from "./reference-guard.js";
import { sqliteTodosTaskManifestSchemaSql } from "./schema-sql.js";
import {
  TodosTaskManifestError,
  type TodosTaskManifest,
  type TodosTaskManifestApplyResult,
  type TodosTaskManifestCompensateRequest,
  type TodosTaskManifestCompensationResult,
  type TodosTaskManifestFaultPoint,
  type TodosTaskManifestReceipt,
} from "./types.js";

const sqliteTails = new WeakMap<Database, Promise<void>>();

function fault(faults: PreparedTaskManifestFaults, point: TodosTaskManifestFaultPoint): void {
  if (faults.points.has(point)) throw new Error(`Injected task-manifest fault at ${point}`);
}

function parseApplyResult(value: string, duplicate: boolean): TodosTaskManifestApplyResult {
  return { ...(JSON.parse(value) as TodosTaskManifestApplyResult), duplicate };
}

export class SqliteTodosTaskManifestBackend implements TodosTaskManifestBackend {
  readonly kind = "sqlite" as const;

  constructor(private readonly db: Database) {
    db.exec(sqliteTodosTaskManifestSchemaSql());
  }

  private async serialized<T>(run: () => T): Promise<T> {
    const previous = sqliteTails.get(this.db) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    sqliteTails.set(this.db, tail);
    await previous;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      release();
      if (sqliteTails.get(this.db) === tail) sqliteTails.delete(this.db);
    }
  }

  async apply(input: NormalizedTaskManifest, faults: PreparedTaskManifestFaults): Promise<TodosTaskManifestApplyResult> {
    return this.serialized(() => {
      const { manifest } = input;
      const binding = this.db.query("SELECT * FROM todos_task_manifest_bindings WHERE operation_id = ? LIMIT 1").get(manifest.operation_id) as Record<string, unknown> | null;
      if (binding) {
        if (binding["idempotency_key"] !== manifest.idempotency_key || binding["request_digest"] !== input.request_digest) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Operation is already bound to a different request");
        }
        if (binding["state"] !== "applied") {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", "Operation was already compensated");
        }
        return parseApplyResult(String(binding["result_json"]), true);
      }
      const idempotency = this.db.query("SELECT operation_id, request_digest FROM todos_task_manifest_bindings WHERE idempotency_key = ? LIMIT 1").get(manifest.idempotency_key) as Record<string, unknown> | null;
      if (idempotency) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Idempotency key is already used by another operation");
      if (manifest.if_binding_version !== undefined && manifest.if_binding_version !== 0) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "New manifest binding version must be 0");
      }
      if (!this.db.query("SELECT 1 AS found FROM projects WHERE id = ? LIMIT 1").get(manifest.project_id)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_FOREIGN_REFERENCE", "Project does not exist");
      }
      if (manifest.task_list_id && !this.db.query("SELECT 1 AS found FROM task_lists WHERE id = ? AND project_id = ? LIMIT 1").get(manifest.task_list_id, manifest.project_id)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_FOREIGN_REFERENCE", "Task list does not belong to the project");
      }
      const allIds = [input.graph.plan_id, ...Object.values(input.graph.task_ids), ...input.graph.comment_ids, ...input.graph.verification_ids];
      for (const id of allIds) {
        for (const table of ["plans", "tasks", "task_comments", "task_verifications"] as const) {
          if (this.db.query(`SELECT 1 AS found FROM ${table} WHERE id = ? LIMIT 1`).get(id)) {
            throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", `Deterministic id already exists: ${id}`);
          }
        }
      }

      this.db.query(`INSERT INTO plans (id, project_id, name, description, status, task_list_id, slug, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.graph.plan_id, manifest.project_id, manifest.plan.name, manifest.plan.description ?? null,
        manifest.plan.status ?? "active", manifest.task_list_id ?? null, null, input.now, input.now,
      );
      fault(faults, "after_plan_write");

      for (const task of manifest.tasks) {
        const taskId = input.graph.task_ids[task.key]!;
        this.db.query(`INSERT INTO tasks (
          id, project_id, title, description, status, priority, assigned_to, tags, metadata,
          version, plan_id, task_list_id, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(
          taskId, manifest.project_id, task.title, task.description ?? null, task.status ?? "pending",
          task.priority ?? "medium", task.assigned_to ?? null, JSON.stringify(task.tags ?? []),
          canonicalJson(task.metadata ?? {}), input.graph.plan_id, manifest.task_list_id ?? null,
          input.now, input.now, task.created_by ?? null,
        );
        for (const tag of [...new Set(task.tags ?? [])].sort()) {
          this.db.query("INSERT INTO task_tags (task_id, tag) VALUES (?, ?)").run(taskId, tag);
        }
      }
      fault(faults, "after_task_write");

      for (const edge of manifest.dependencies ?? []) {
        this.db.query("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").run(
          input.graph.task_ids[edge.task]!, input.graph.task_ids[edge.depends_on]!,
        );
      }
      fault(faults, "after_dependency_write");

      let commentIndex = 0;
      for (const task of manifest.tasks) for (const comment of task.comments ?? []) {
        this.db.query(`INSERT INTO task_comments (id, task_id, agent_id, session_id, content, created_at, type, progress_pct)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          input.graph.comment_ids[commentIndex++]!, input.graph.task_ids[task.key]!, comment.agent_id ?? null,
          comment.session_id ?? null, comment.content, input.now, comment.type ?? "comment", comment.progress_pct ?? null,
        );
      }
      fault(faults, "after_comment_write");

      let verificationIndex = 0;
      for (const task of manifest.tasks) for (const verification of task.verifications ?? []) {
        this.db.query(`INSERT INTO task_verifications (
          id, task_id, command, status, output_summary, artifact_path, agent_id, run_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          input.graph.verification_ids[verificationIndex++]!, input.graph.task_ids[task.key]!, verification.command,
          verification.status ?? "unknown", verification.output_summary ?? null, verification.artifact_path ?? null,
          verification.agent_id ?? null, input.now, input.now,
        );
      }
      fault(faults, "after_verification_write");

      const readback = this.readback(input.graph);
      const expected = {
        plans: 1, tasks: manifest.tasks.length, dependencies: manifest.dependencies?.length ?? 0,
        comments: input.graph.comment_ids.length, verifications: input.graph.verification_ids.length, complete: true as const,
      };
      if (canonicalJson(readback) !== canonicalJson(expected)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_READBACK_MISMATCH", "Exact graph readback did not match", { expected, readback });
      }
      const receipt: TodosTaskManifestReceipt = {
        receipt_id: input.receipt_id, authority: "todos", route: "todos.task-manifest.v1", schema_version: 1,
        kind: "apply", operation_id: manifest.operation_id, idempotency_key: manifest.idempotency_key,
        request_digest: input.request_digest, result_digest: input.result_digest, binding_version: 1,
        apply_receipt_id: null, created_at: input.now,
      };
      const result: TodosTaskManifestApplyResult = {
        duplicate: false, receipt, graph: input.graph, readback,
        outbox_ids: input.outbox.map((entry) => entry.id), result_digest: input.result_digest,
      };
      const resultJson = canonicalJson(result);
      const manifestJson = canonicalJson(manifest);
      this.db.query(`INSERT INTO todos_task_manifest_receipts (
        receipt_id, authority, route, schema_version, kind, operation_id, idempotency_key,
        request_digest, result_digest, binding_version, apply_receipt_id, manifest_json, result_json, created_at
      ) VALUES (?, 'todos', 'todos.task-manifest.v1', 1, 'apply', ?, ?, ?, ?, 1, NULL, ?, ?, ?)`).run(
        input.receipt_id, manifest.operation_id, manifest.idempotency_key, input.request_digest,
        input.result_digest, manifestJson, resultJson, input.now,
      );
      for (const entry of input.outbox) {
        this.db.query(`INSERT INTO todos_task_manifest_outbox (
          id, apply_receipt_id, topic, payload, payload_digest, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(
          entry.id, input.receipt_id, entry.topic, canonicalJson(entry.payload), entry.digest, input.now,
        );
      }
      fault(faults, "after_outbox_write");
      this.db.query(`INSERT INTO todos_task_manifest_bindings (
        operation_id, idempotency_key, request_digest, result_digest, apply_receipt_id,
        manifest_json, result_json, state, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', 1, ?, ?)`).run(
        manifest.operation_id, manifest.idempotency_key, input.request_digest, input.result_digest,
        input.receipt_id, manifestJson, resultJson, input.now, input.now,
      );
      fault(faults, "after_receipt_write");
      return result;
    });
  }

  async readExact(receiptId: string): Promise<TodosTaskManifestApplyResult> {
    const row = this.db.query("SELECT result_json FROM todos_task_manifest_receipts WHERE receipt_id = ? AND kind = 'apply' LIMIT 1").get(receiptId) as { result_json: string } | null;
    if (!row) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND", `Apply receipt not found: ${receiptId}`);
    return parseApplyResult(row.result_json, false);
  }

  async lookupBindingByPlanId(planId: string) {
    const rows = this.db.query(`
      SELECT
        b.apply_receipt_id AS apply_receipt_id,
        b.state AS state,
        b.version AS binding_version,
        b.operation_id AS binding_operation_id,
        json_extract(b.result_json, '$.graph.plan_id') AS binding_plan_id,
        r.authority AS receipt_authority,
        r.route AS receipt_route,
        r.schema_version AS receipt_schema_version,
        r.kind AS receipt_kind,
        r.operation_id AS receipt_operation_id,
        json_extract(r.result_json, '$.graph.plan_id') AS receipt_plan_id
      FROM todos_task_manifest_bindings b
      LEFT JOIN todos_task_manifest_receipts r
        ON r.receipt_id = b.apply_receipt_id
      WHERE json_extract(b.result_json, '$.graph.plan_id') = ?
      LIMIT 2
    `).all(planId) as TaskManifestBindingLookupRow[];
    return validateTaskManifestBindingLookupRows(rows, planId);
  }

  async markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<void> {
    await this.serialized(() => {
      const result = this.db.query(`UPDATE todos_task_manifest_outbox
        SET status = 'delivered', delivered_at = ?, attempts = attempts + 1
        WHERE id = ? AND status = 'pending'`).run(deliveredAt, outboxId);
      if (result.changes !== 1) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", `Pending outbox row not found: ${outboxId}`);
      }
    });
  }

  async compensate(
    input: TodosTaskManifestCompensateRequest,
    receipt: TodosTaskManifestReceipt,
    compensationReceiptId: string,
    requestDigest: string,
    now: string,
  ): Promise<TodosTaskManifestCompensationResult> {
    return this.serialized(() => {
      const existing = this.db.query(`SELECT apply_receipt_id, request_digest, result_json
        FROM todos_task_manifest_receipts WHERE kind = 'compensate' AND idempotency_key = ? LIMIT 1`).get(input.idempotency_key) as {
        apply_receipt_id: string; request_digest: string; result_json: string;
      } | null;
      if (existing) {
        if (existing.apply_receipt_id !== input.receipt_id || existing.request_digest !== requestDigest) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Compensation idempotency key is already used");
        }
        return { ...(JSON.parse(existing.result_json) as TodosTaskManifestCompensationResult), duplicate: true };
      }
      const row = this.db.query("SELECT * FROM todos_task_manifest_receipts WHERE receipt_id = ? AND kind = 'apply' LIMIT 1").get(input.receipt_id) as Record<string, unknown> | null;
      if (!row) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND", "Apply receipt not found");
      const binding = this.db.query("SELECT * FROM todos_task_manifest_bindings WHERE operation_id = ? LIMIT 1").get(String(row["operation_id"])) as Record<string, unknown> | null;
      if (!binding || Number(binding["version"]) !== input.if_binding_version) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "Binding version changed before compensation");
      }
      if (binding["state"] !== "applied") throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Graph is not in applied state");
      const delivered = this.db.query("SELECT id FROM todos_task_manifest_outbox WHERE apply_receipt_id = ? AND status = 'delivered' LIMIT 1").get(input.receipt_id);
      if (delivered) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: delivered outbox row exists");
      const applyResult = parseApplyResult(String(row["result_json"]), false);
      const manifest = JSON.parse(String(row["manifest_json"])) as TodosTaskManifest;
      const expectedEffects = [
        {
          topic: "todos.task-manifest.applied",
          payload: { operation_id: manifest.operation_id, project_id: manifest.project_id } as Record<string, unknown>,
        },
        ...(manifest.effects ?? []).map((effect) => ({ topic: effect.topic, payload: effect.payload as Record<string, unknown> })),
      ];
      const storedOutbox = this.db.query(`SELECT id, topic, payload, payload_digest, status, attempts, delivered_at
        FROM todos_task_manifest_outbox WHERE apply_receipt_id = ? ORDER BY id`).all(input.receipt_id) as Array<Record<string, unknown>>;
      if (storedOutbox.length !== expectedEffects.length) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: outbox changed since apply");
      }
      const outboxById = new Map(storedOutbox.map((entry) => [String(entry["id"]), entry]));
      for (const [index, expectedEffect] of expectedEffects.entries()) {
        const stored = outboxById.get(applyResult.outbox_ids[index]!);
        const expectedPayload = canonicalJson(expectedEffect.payload);
        if (!stored || stored["topic"] !== expectedEffect.topic || stored["payload"] !== expectedPayload
          || stored["payload_digest"] !== canonicalDigest(expectedEffect)
          || stored["status"] !== "pending" || Number(stored["attempts"]) !== 0 || stored["delivered_at"] !== null) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: outbox changed since apply");
        }
      }
      const taskIds = Object.values(applyResult.graph.task_ids);
      const placeholders = taskIds.map(() => "?").join(",");
      const foreignReference = findSqliteTaskManifestForeignReference(this.db, {
        plan_id: applyResult.graph.plan_id,
        task_ids: taskIds,
        dependency_ids: applyResult.graph.dependency_ids,
        comment_ids: applyResult.graph.comment_ids,
        verification_ids: applyResult.graph.verification_ids,
      });
      if (foreignReference) {
        throw new TodosTaskManifestError(
          "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
          `Compensation refused: foreign reference at ${foreignReference.surface}.${foreignReference.field} would be changed by ${foreignReference.on_delete}`,
          { ...foreignReference },
        );
      }
      const actualReadback = this.readback(applyResult.graph);
      if (canonicalJson(actualReadback) !== canonicalJson(applyResult.readback)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: graph changed since apply", { actualReadback });
      }
      // Exact value checks protect against same-count mutations.
      const plan = this.db.query("SELECT project_id, name, description, status, task_list_id, slug FROM plans WHERE id = ? LIMIT 1").get(applyResult.graph.plan_id) as Record<string, unknown> | null;
      if (!plan || plan["project_id"] !== manifest.project_id || plan["name"] !== manifest.plan.name
        || plan["description"] !== (manifest.plan.description ?? null) || plan["status"] !== (manifest.plan.status ?? "active")
        || plan["task_list_id"] !== (manifest.task_list_id ?? null) || plan["slug"] !== null) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: plan changed since apply");
      }
      for (const task of manifest.tasks) {
        const stored = this.db.query("SELECT title, description, status, priority, assigned_to, tags, metadata, created_by FROM tasks WHERE id = ? LIMIT 1").get(applyResult.graph.task_ids[task.key]!) as Record<string, unknown> | null;
        if (!stored || stored["title"] !== task.title || stored["description"] !== (task.description ?? null)
          || stored["status"] !== (task.status ?? "pending") || stored["priority"] !== (task.priority ?? "medium")
          || stored["assigned_to"] !== (task.assigned_to ?? null) || stored["tags"] !== JSON.stringify(task.tags ?? [])
          || stored["metadata"] !== canonicalJson(task.metadata ?? {}) || stored["created_by"] !== (task.created_by ?? null)) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", `Compensation refused: task ${task.key} changed since apply`);
        }
        const storedTags = (this.db.query("SELECT tag FROM task_tags WHERE task_id = ? ORDER BY tag").all(applyResult.graph.task_ids[task.key]!) as Array<{ tag: string }>).map((row) => row.tag);
        const expectedTags = [...new Set(task.tags ?? [])].sort();
        if (canonicalJson(storedTags) !== canonicalJson(expectedTags)) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", `Compensation refused: task ${task.key} tags changed since apply`);
        }
      }
      const storedDependencies = (this.db.query(`SELECT task_id, depends_on FROM task_dependencies
        WHERE task_id IN (${placeholders}) AND depends_on IN (${placeholders}) ORDER BY task_id, depends_on`).all(
        ...taskIds, ...taskIds,
      ) as Array<{ task_id: string; depends_on: string }>);
      const expectedDependencies = (manifest.dependencies ?? []).map((edge) => ({
        task_id: applyResult.graph.task_ids[edge.task]!, depends_on: applyResult.graph.task_ids[edge.depends_on]!,
      })).sort((left, right) => left.task_id.localeCompare(right.task_id) || left.depends_on.localeCompare(right.depends_on));
      if (canonicalJson(storedDependencies) !== canonicalJson(expectedDependencies)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: dependencies changed since apply");
      }
      let expectedCommentIndex = 0;
      for (const task of manifest.tasks) for (const comment of task.comments ?? []) {
        const stored = this.db.query(`SELECT task_id, agent_id, session_id, content, type, progress_pct
          FROM task_comments WHERE id = ? LIMIT 1`).get(applyResult.graph.comment_ids[expectedCommentIndex]!) as Record<string, unknown> | null;
        const expected = {
          task_id: applyResult.graph.task_ids[task.key]!, agent_id: comment.agent_id ?? null,
          session_id: comment.session_id ?? null, content: comment.content,
          type: comment.type ?? "comment", progress_pct: comment.progress_pct ?? null,
        };
        if (!stored || canonicalJson(stored) !== canonicalJson(expected)) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: comment changed since apply");
        }
        expectedCommentIndex += 1;
      }
      let expectedVerificationIndex = 0;
      for (const task of manifest.tasks) for (const verification of task.verifications ?? []) {
        const stored = this.db.query(`SELECT task_id, command, status, output_summary, artifact_path, agent_id
          FROM task_verifications WHERE id = ? LIMIT 1`).get(applyResult.graph.verification_ids[expectedVerificationIndex]!) as Record<string, unknown> | null;
        const expected = {
          task_id: applyResult.graph.task_ids[task.key]!, command: verification.command,
          status: verification.status ?? "unknown", output_summary: verification.output_summary ?? null,
          artifact_path: verification.artifact_path ?? null, agent_id: verification.agent_id ?? null,
        };
        if (!stored || canonicalJson(stored) !== canonicalJson(expected)) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: verification changed since apply");
        }
        expectedVerificationIndex += 1;
      }
      this.db.query("UPDATE todos_task_manifest_outbox SET status = 'cancelled' WHERE apply_receipt_id = ? AND status = 'pending'").run(input.receipt_id);
      for (const table of ["task_tags", "task_dependencies", "task_comments", "task_verifications"] as const) {
        const column = table === "task_dependencies" ? "task_id" : "task_id";
        this.db.query(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...taskIds);
      }
      this.db.query(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...taskIds);
      this.db.query("DELETE FROM plans WHERE id = ?").run(applyResult.graph.plan_id);
      const readback = this.readback(applyResult.graph);
      const result: TodosTaskManifestCompensationResult = { duplicate: false, receipt, absent: true, readback };
      const resultJson = canonicalJson(result);
      this.db.query(`INSERT INTO todos_task_manifest_receipts (
        receipt_id, authority, route, schema_version, kind, operation_id, idempotency_key,
        request_digest, result_digest, binding_version, apply_receipt_id, manifest_json, result_json, created_at
      ) VALUES (?, 'todos', 'todos.task-manifest.v1', 1, 'compensate', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
        compensationReceiptId, receipt.operation_id, input.idempotency_key, requestDigest,
        receipt.result_digest, receipt.binding_version, input.receipt_id, resultJson, now,
      );
      const updated = this.db.query(`UPDATE todos_task_manifest_bindings SET state = 'compensated', version = ?, compensation_receipt_id = ?, updated_at = ?
        WHERE operation_id = ? AND state = 'applied' AND version = ?`).run(
        receipt.binding_version, compensationReceiptId, now, receipt.operation_id, input.if_binding_version,
      );
      if (updated.changes !== 1) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "Binding changed during compensation");
      }
      return result;
    });
  }

  private readback(graph: TodosTaskManifestApplyResult["graph"]): TodosTaskManifestApplyResult["readback"] {
    const taskIds = Object.values(graph.task_ids);
    const placeholders = taskIds.map(() => "?").join(",");
    const count = (sql: string, ...values: string[]): number => Number((this.db.query(sql).get(...values) as { count: number }).count);
    return {
      plans: count("SELECT count(*) AS count FROM plans WHERE id = ?", graph.plan_id),
      tasks: count(`SELECT count(*) AS count FROM tasks WHERE id IN (${placeholders})`, ...taskIds),
      dependencies: count(`SELECT count(*) AS count FROM task_dependencies WHERE task_id IN (${placeholders}) AND depends_on IN (${placeholders})`, ...taskIds, ...taskIds),
      comments: count(`SELECT count(*) AS count FROM task_comments WHERE id IN (${graph.comment_ids.map(() => "?").join(",") || "NULL"})`, ...graph.comment_ids),
      verifications: count(`SELECT count(*) AS count FROM task_verifications WHERE id IN (${graph.verification_ids.map(() => "?").join(",") || "NULL"})`, ...graph.verification_ids),
      complete: true,
    };
  }
}
