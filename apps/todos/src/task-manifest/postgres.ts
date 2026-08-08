import { canonicalDigest, canonicalJson } from "./canonical.js";
import {
  validateTaskManifestBindingLookupRows,
  type NormalizedTaskManifest,
  type PreparedTaskManifestFaults,
  type TaskManifestBindingLookupRow,
  type TodosTaskManifestBackend,
} from "./backend.js";
import { postgresTaskManifestForeignReferenceSql } from "./reference-guard.js";
import { postgresTodosTaskManifestSchemaSql } from "./schema-sql.js";
import { DEFAULT_TODOS_POSTGRES_SYNC_TABLE, postgresTodosSyncSchemaSql, type TodosPostgresQueryClient } from "../storage/postgres-sync.js";
import {
  TodosTaskManifestError,
  type PostgresTodosTaskManifestAuthorityOptions,
  type TodosTaskManifest,
  type TodosTaskManifestApplyResult,
  type TodosTaskManifestCompensateRequest,
  type TodosTaskManifestCompensationResult,
  type TodosTaskManifestFaultPoint,
  type TodosTaskManifestPostgresClient,
  type TodosTaskManifestReceipt,
  type TodosTaskManifestTask,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function safeIdentifier(value: string, field: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", `${field} must be a safe PostgreSQL identifier`);
  }
  return value;
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function fault(faults: PreparedTaskManifestFaults, point: TodosTaskManifestFaultPoint): void {
  if (faults.points.has(point)) throw new Error(`Injected task-manifest fault at ${point}`);
}

function receiptFromRow(row: JsonRecord): TodosTaskManifestReceipt {
  return {
    receipt_id: String(row["receipt_id"]), authority: "todos", route: "todos.task-manifest.v1",
    schema_version: 1, kind: row["kind"] as "apply" | "compensate",
    operation_id: String(row["operation_id"]), idempotency_key: String(row["idempotency_key"]),
    request_digest: String(row["request_digest"]), result_digest: String(row["result_digest"]),
    binding_version: Number(row["binding_version"]),
    apply_receipt_id: row["apply_receipt_id"] == null ? null : String(row["apply_receipt_id"]),
    created_at: timestamp(row["created_at"]),
  };
}

function taskPayload(
  manifest: TodosTaskManifest,
  task: TodosTaskManifestTask,
  taskId: string,
  planId: string,
  now: string,
): JsonRecord {
  return {
    id: taskId, short_id: null, project_id: manifest.project_id, parent_id: null,
    plan_id: planId, task_list_id: manifest.task_list_id ?? null, title: task.title,
    description: task.description ?? null, status: task.status ?? "pending",
    priority: task.priority ?? "medium", agent_id: null,
    assigned_to: task.assigned_to ?? null, session_id: null, working_dir: null,
    tags: task.tags ?? [], metadata: task.metadata ?? {}, version: 1, locked_by: null,
    locked_at: null, created_at: now, updated_at: now, started_at: null,
    completed_at: null, due_at: null, estimated_minutes: null, actual_minutes: null,
    requires_approval: false, approved_by: null, approved_at: null, recurrence_rule: null,
    recurrence_parent_id: null, spawns_template_id: null, confidence: null, reason: null,
    spawned_from_session: null, assigned_by: null,
    created_by: task.created_by ?? null, assigned_from_project: null, task_type: null,
    cost_tokens: 0, cost_usd: 0, delegated_from: null, delegation_depth: 0,
    retry_count: 0, max_retries: 0, retry_after: null, sla_minutes: null,
    runner_id: null, runner_started_at: null, runner_completed_at: null,
    current_step: null, total_steps: null, machine_id: null, synced_at: null, archived_at: null,
  };
}

function planPayload(input: Pick<NormalizedTaskManifest, "manifest" | "graph" | "now">): JsonRecord {
  return {
    id: input.graph.plan_id, slug: null, project_id: input.manifest.project_id,
    task_list_id: input.manifest.task_list_id ?? null, agent_id: null,
    name: input.manifest.plan.name, description: input.manifest.plan.description ?? null,
    status: input.manifest.plan.status ?? "active", created_at: input.now,
    updated_at: input.now, machine_id: null, synced_at: null,
  };
}

function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(",");
}

export class PostgresTodosTaskManifestBackend implements TodosTaskManifestBackend {
  readonly kind = "postgresql" as const;
  private readonly service: string;
  private readonly tableName: string;
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly client: TodosTaskManifestPostgresClient,
    options: PostgresTodosTaskManifestAuthorityOptions = {},
  ) {
    this.service = options.service ?? "todos";
    this.tableName = safeIdentifier(options.tableName ?? DEFAULT_TODOS_POSTGRES_SYNC_TABLE, "tableName");
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const sql of postgresTodosSyncSchemaSql(this.tableName)) await this.client.query(sql);
      for (const sql of postgresTodosTaskManifestSchemaSql()) await this.client.query(sql);
    })();
    await this.schemaReady;
  }

  private async insertSync(
    tx: TodosPostgresQueryClient,
    objectType: string,
    objectId: string,
    payload: JsonRecord,
    now: string,
  ): Promise<void> {
    await tx.query(`INSERT INTO ${this.tableName} (
      service, object_type, object_id, payload, updated_at, deleted_at, source_machine_id, version
    ) VALUES ($1, $2, $3, $4::jsonb, $5, NULL, NULL, 1)`, [
      this.service, objectType, objectId, canonicalJson(payload), now,
    ]);
  }

  async apply(input: NormalizedTaskManifest, faults: PreparedTaskManifestFaults): Promise<TodosTaskManifestApplyResult> {
    await this.ensureSchema();
    return this.client.transaction(async (tx) => {
      const { manifest } = input;
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.service}\u001f${manifest.operation_id}`]);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.service}\u001fidempotency\u001f${manifest.idempotency_key}`]);
      const existing = await tx.query<JsonRecord>(
        "SELECT * FROM todos_task_manifest_bindings WHERE operation_id = $1 LIMIT 1 FOR UPDATE",
        [manifest.operation_id],
      );
      if (existing.rows[0]) {
        const binding = existing.rows[0];
        if (binding["idempotency_key"] !== manifest.idempotency_key || binding["request_digest"] !== input.request_digest) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Operation is already bound to a different request");
        }
        if (binding["state"] !== "applied") {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", "Operation was already compensated");
        }
        return { ...parseJson<TodosTaskManifestApplyResult>(binding["result_json"]), duplicate: true };
      }
      const reused = await tx.query<JsonRecord>(
        "SELECT operation_id FROM todos_task_manifest_bindings WHERE idempotency_key = $1 LIMIT 1",
        [manifest.idempotency_key],
      );
      if (reused.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Idempotency key is already used");
      if (manifest.if_binding_version !== undefined && manifest.if_binding_version !== 0) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "New manifest binding version must be 0");
      }
      const project = await tx.query(`SELECT 1 AS found FROM ${this.tableName}
        WHERE service = $1 AND object_type = 'projects' AND object_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [this.service, manifest.project_id]);
      if (!project.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_FOREIGN_REFERENCE", "Project does not exist");
      if (manifest.task_list_id) {
        const taskList = await tx.query<JsonRecord>(`SELECT payload FROM ${this.tableName}
          WHERE service = $1 AND object_type = 'task_lists' AND object_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [this.service, manifest.task_list_id]);
        const payload = taskList.rows[0] ? parseJson<JsonRecord>(taskList.rows[0]["payload"]) : null;
        if (!payload || payload["project_id"] !== manifest.project_id) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_FOREIGN_REFERENCE", "Task list does not belong to the project");
        }
      }
      const objectIds = [input.graph.plan_id, ...Object.values(input.graph.task_ids), ...input.graph.comment_ids, ...input.graph.verification_ids, ...input.graph.dependency_ids];
      const conflict = await tx.query(`SELECT object_id FROM ${this.tableName}
        WHERE service = $1 AND object_id IN (${placeholders(2, objectIds.length)}) LIMIT 1`, [this.service, ...objectIds]);
      if (conflict.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", "A deterministic graph id already exists");

      await this.insertSync(tx, "plans", input.graph.plan_id, planPayload(input), input.now);
      fault(faults, "after_plan_write");
      for (const task of manifest.tasks) {
        await this.insertSync(tx, "tasks", input.graph.task_ids[task.key]!, taskPayload(manifest, task, input.graph.task_ids[task.key]!, input.graph.plan_id, input.now), input.now);
      }
      fault(faults, "after_task_write");
      for (const [index, edge] of (manifest.dependencies ?? []).entries()) {
        await this.insertSync(tx, "dependencies", input.graph.dependency_ids[index]!, {
          id: input.graph.dependency_ids[index]!, task_id: input.graph.task_ids[edge.task]!,
          depends_on: input.graph.task_ids[edge.depends_on]!, created_at: input.now, updated_at: input.now,
        }, input.now);
      }
      fault(faults, "after_dependency_write");
      let commentIndex = 0;
      for (const task of manifest.tasks) for (const comment of task.comments ?? []) {
        const id = input.graph.comment_ids[commentIndex++]!;
        await this.insertSync(tx, "comments", id, {
          id, task_id: input.graph.task_ids[task.key]!, agent_id: comment.agent_id ?? null,
          session_id: comment.session_id ?? null, content: comment.content,
          type: comment.type ?? "comment", progress_pct: comment.progress_pct ?? null, created_at: input.now,
        }, input.now);
      }
      fault(faults, "after_comment_write");
      let verificationIndex = 0;
      for (const task of manifest.tasks) for (const verification of task.verifications ?? []) {
        const id = input.graph.verification_ids[verificationIndex++]!;
        await this.insertSync(tx, "verifications", id, {
          id, task_id: input.graph.task_ids[task.key]!, command: verification.command,
          status: verification.status ?? "unknown", output_summary: verification.output_summary ?? null,
          artifact_path: verification.artifact_path ?? null, agent_id: verification.agent_id ?? null,
          run_at: input.now, created_at: input.now, updated_at: input.now,
        }, input.now);
      }
      fault(faults, "after_verification_write");

      const readback = await this.readback(tx, input.graph);
      const expected = {
        plans: 1, tasks: manifest.tasks.length, dependencies: manifest.dependencies?.length ?? 0,
        comments: input.graph.comment_ids.length, verifications: input.graph.verification_ids.length, complete: true as const,
      };
      if (canonicalJson(readback) !== canonicalJson(expected)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_READBACK_MISMATCH", "Exact PostgreSQL graph readback did not match", { expected, readback });
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
      const manifestJson = canonicalJson(manifest);
      const resultJson = canonicalJson(result);
      await tx.query(`INSERT INTO todos_task_manifest_receipts (
        receipt_id, authority, route, schema_version, kind, operation_id, idempotency_key,
        request_digest, result_digest, binding_version, apply_receipt_id, manifest_json, result_json, created_at
      ) VALUES ($1, 'todos', 'todos.task-manifest.v1', 1, 'apply', $2, $3, $4, $5, 1, NULL, $6::jsonb, $7::jsonb, $8)`, [
        input.receipt_id, manifest.operation_id, manifest.idempotency_key, input.request_digest,
        input.result_digest, manifestJson, resultJson, input.now,
      ]);
      for (const entry of input.outbox) {
        await tx.query(`INSERT INTO todos_task_manifest_outbox (
          id, apply_receipt_id, topic, payload, payload_digest, status, created_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, 'pending', $6)`, [
          entry.id, input.receipt_id, entry.topic, canonicalJson(entry.payload), entry.digest, input.now,
        ]);
      }
      fault(faults, "after_outbox_write");
      await tx.query(`INSERT INTO todos_task_manifest_bindings (
        operation_id, idempotency_key, request_digest, result_digest, apply_receipt_id,
        manifest_json, result_json, state, version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'applied', 1, $8, $8)`, [
        manifest.operation_id, manifest.idempotency_key, input.request_digest, input.result_digest,
        input.receipt_id, manifestJson, resultJson, input.now,
      ]);
      fault(faults, "after_receipt_write");
      return result;
    });
  }

  async readExact(receiptId: string): Promise<TodosTaskManifestApplyResult> {
    await this.ensureSchema();
    const result = await this.client.query<JsonRecord>(
      "SELECT result_json FROM todos_task_manifest_receipts WHERE receipt_id = $1 AND kind = 'apply' LIMIT 1",
      [receiptId],
    );
    if (!result.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND", `Apply receipt not found: ${receiptId}`);
    return { ...parseJson<TodosTaskManifestApplyResult>(result.rows[0]["result_json"]), duplicate: false };
  }

  async lookupBindingByPlanId(planId: string) {
    await this.ensureSchema();
    const result = await this.client.query<TaskManifestBindingLookupRow>(`
      SELECT
        b.apply_receipt_id AS apply_receipt_id,
        b.state AS state,
        b.version AS binding_version,
        b.operation_id AS binding_operation_id,
        b.result_json #>> '{graph,plan_id}' AS binding_plan_id,
        r.authority AS receipt_authority,
        r.route AS receipt_route,
        r.schema_version AS receipt_schema_version,
        r.kind AS receipt_kind,
        r.operation_id AS receipt_operation_id,
        r.result_json #>> '{graph,plan_id}' AS receipt_plan_id
      FROM todos_task_manifest_bindings b
      LEFT JOIN todos_task_manifest_receipts r
        ON r.receipt_id = b.apply_receipt_id
      WHERE b.result_json #>> '{graph,plan_id}' = $1
      LIMIT 2
    `, [planId]);
    return validateTaskManifestBindingLookupRows(result.rows, planId);
  }

  async markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<void> {
    await this.ensureSchema();
    await this.client.transaction(async (tx) => {
      const result = await tx.query(`UPDATE todos_task_manifest_outbox
        SET status = 'delivered', delivered_at = $1, attempts = attempts + 1
        WHERE id = $2 AND status = 'pending' RETURNING id`, [deliveredAt, outboxId]);
      if (!result.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_GRAPH_CONFLICT", `Pending outbox row not found: ${outboxId}`);
    });
  }

  async compensate(
    input: TodosTaskManifestCompensateRequest,
    receipt: TodosTaskManifestReceipt,
    compensationReceiptId: string,
    requestDigest: string,
    now: string,
  ): Promise<TodosTaskManifestCompensationResult> {
    await this.ensureSchema();
    return this.client.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.service}\u001f${receipt.operation_id}`]);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.service}\u001fcompensation-idempotency\u001f${input.idempotency_key}`]);
      const previous = await tx.query<JsonRecord>(
        "SELECT apply_receipt_id, request_digest, result_json FROM todos_task_manifest_receipts WHERE kind = 'compensate' AND idempotency_key = $1 LIMIT 1",
        [input.idempotency_key],
      );
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (row["apply_receipt_id"] !== input.receipt_id || row["request_digest"] !== requestDigest) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT", "Compensation idempotency key is already used");
        }
        return { ...parseJson<TodosTaskManifestCompensationResult>(row["result_json"]), duplicate: true };
      }
      const applyRows = await tx.query<JsonRecord>(
        "SELECT * FROM todos_task_manifest_receipts WHERE receipt_id = $1 AND kind = 'apply' LIMIT 1",
        [input.receipt_id],
      );
      const applyRow = applyRows.rows[0];
      if (!applyRow) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND", "Apply receipt not found");
      const bindingRows = await tx.query<JsonRecord>(
        "SELECT * FROM todos_task_manifest_bindings WHERE operation_id = $1 LIMIT 1 FOR UPDATE",
        [receipt.operation_id],
      );
      const binding = bindingRows.rows[0];
      if (!binding || Number(binding["version"]) !== input.if_binding_version) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "Binding version changed before compensation");
      }
      if (binding["state"] !== "applied") throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Graph is not applied");
      const delivered = await tx.query(
        "SELECT id FROM todos_task_manifest_outbox WHERE apply_receipt_id = $1 AND status = 'delivered' LIMIT 1",
        [input.receipt_id],
      );
      if (delivered.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: delivered outbox row exists");
      const applyResult = parseJson<TodosTaskManifestApplyResult>(applyRow["result_json"]);
      const manifest = parseJson<TodosTaskManifest>(applyRow["manifest_json"]);
      const expectedEffects = [
        {
          topic: "todos.task-manifest.applied",
          payload: { operation_id: manifest.operation_id, project_id: manifest.project_id } as Record<string, unknown>,
        },
        ...(manifest.effects ?? []).map((effect) => ({ topic: effect.topic, payload: effect.payload as Record<string, unknown> })),
      ];
      const outboxRows = await tx.query<JsonRecord>(`SELECT id, topic, payload, payload_digest, status, attempts, delivered_at
        FROM todos_task_manifest_outbox WHERE apply_receipt_id = $1 ORDER BY id`, [input.receipt_id]);
      if (outboxRows.rows.length !== expectedEffects.length) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: outbox changed since apply");
      }
      const outboxById = new Map(outboxRows.rows.map((entry) => [String(entry["id"]), entry]));
      for (const [index, expectedEffect] of expectedEffects.entries()) {
        const stored = outboxById.get(applyResult.outbox_ids[index]!);
        if (!stored || stored["topic"] !== expectedEffect.topic
          || canonicalJson(parseJson(stored["payload"])) !== canonicalJson(expectedEffect.payload)
          || stored["payload_digest"] !== canonicalDigest(expectedEffect)
          || stored["status"] !== "pending" || Number(stored["attempts"]) !== 0 || stored["delivered_at"] != null) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: outbox changed since apply");
        }
      }
      const taskIds = Object.values(applyResult.graph.task_ids);
      const foreignReference = await tx.query<JsonRecord>(
        postgresTaskManifestForeignReferenceSql(this.tableName),
        [
          this.service,
          applyResult.graph.plan_id,
          taskIds,
          applyResult.graph.dependency_ids,
          applyResult.graph.comment_ids,
          applyResult.graph.verification_ids,
          [applyResult.graph.plan_id, ...taskIds],
        ],
      );
      if (foreignReference.rows[0]) {
        const row = foreignReference.rows[0];
        throw new TodosTaskManifestError(
          "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
          `Compensation refused: foreign reference in ${String(row["object_type"])}:${String(row["object_id"])} would be changed`,
          row,
        );
      }
      const actualReadback = await this.readback(tx, applyResult.graph);
      if (canonicalJson(actualReadback) !== canonicalJson(applyResult.readback)) {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: graph changed since apply");
      }
      const appliedAt = receiptFromRow(applyRow).created_at;
      const expectedPayloads = new Map<string, { type: string; payload: string }>();
      expectedPayloads.set(applyResult.graph.plan_id, {
        type: "plans",
        payload: canonicalJson(planPayload({ manifest, graph: applyResult.graph, now: appliedAt })),
      });
      for (const task of manifest.tasks) expectedPayloads.set(applyResult.graph.task_ids[task.key]!, {
        type: "tasks",
        payload: canonicalJson(taskPayload(manifest, task, applyResult.graph.task_ids[task.key]!, applyResult.graph.plan_id, appliedAt)),
      });
      for (const [index, edge] of (manifest.dependencies ?? []).entries()) expectedPayloads.set(
        applyResult.graph.dependency_ids[index]!,
        {
          type: "dependencies",
          payload: canonicalJson({
            id: applyResult.graph.dependency_ids[index]!, task_id: applyResult.graph.task_ids[edge.task]!,
            depends_on: applyResult.graph.task_ids[edge.depends_on]!, created_at: appliedAt, updated_at: appliedAt,
          }),
        },
      );
      let expectedCommentIndex = 0;
      for (const task of manifest.tasks) for (const comment of task.comments ?? []) {
        const id = applyResult.graph.comment_ids[expectedCommentIndex++]!;
        expectedPayloads.set(id, {
          type: "comments",
          payload: canonicalJson({
            id, task_id: applyResult.graph.task_ids[task.key]!, agent_id: comment.agent_id ?? null,
            session_id: comment.session_id ?? null, content: comment.content,
            type: comment.type ?? "comment", progress_pct: comment.progress_pct ?? null, created_at: appliedAt,
          }),
        });
      }
      let expectedVerificationIndex = 0;
      for (const task of manifest.tasks) for (const verification of task.verifications ?? []) {
        const id = applyResult.graph.verification_ids[expectedVerificationIndex++]!;
        expectedPayloads.set(id, {
          type: "verifications",
          payload: canonicalJson({
            id, task_id: applyResult.graph.task_ids[task.key]!, command: verification.command,
            status: verification.status ?? "unknown", output_summary: verification.output_summary ?? null,
            artifact_path: verification.artifact_path ?? null, agent_id: verification.agent_id ?? null,
            run_at: appliedAt, created_at: appliedAt, updated_at: appliedAt,
          }),
        });
      }
      const managedIds = [...expectedPayloads.keys()];
      const stored = await tx.query<JsonRecord>(`SELECT object_type, object_id, payload FROM ${this.tableName}
        WHERE service = $1 AND object_id IN (${placeholders(2, managedIds.length)})`, [this.service, ...managedIds]);
      for (const row of stored.rows) {
        const expected = expectedPayloads.get(String(row["object_id"]));
        if (!expected || expected.type !== row["object_type"] || expected.payload !== canonicalJson(parseJson(row["payload"]))) {
          throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: managed graph values changed");
        }
      }
      if (stored.rows.length !== managedIds.length) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_COMPENSATION_REFUSED", "Compensation refused: managed graph is incomplete");

      await tx.query("UPDATE todos_task_manifest_outbox SET status = 'cancelled' WHERE apply_receipt_id = $1 AND status = 'pending'", [input.receipt_id]);
      const typedIds: Array<[string, string[]]> = [
        ["dependencies", applyResult.graph.dependency_ids], ["comments", applyResult.graph.comment_ids],
        ["verifications", applyResult.graph.verification_ids], ["tasks", taskIds], ["plans", [applyResult.graph.plan_id]],
      ];
      for (const [objectType, ids] of typedIds) {
        if (!ids.length) continue;
        await tx.query(`DELETE FROM ${this.tableName} WHERE service = $1 AND object_type = $2
          AND object_id IN (${placeholders(3, ids.length)})`, [this.service, objectType, ...ids]);
      }
      const readback = await this.readback(tx, applyResult.graph);
      const result: TodosTaskManifestCompensationResult = { duplicate: false, receipt, absent: true, readback };
      await tx.query(`INSERT INTO todos_task_manifest_receipts (
        receipt_id, authority, route, schema_version, kind, operation_id, idempotency_key,
        request_digest, result_digest, binding_version, apply_receipt_id, manifest_json, result_json, created_at
      ) VALUES ($1, 'todos', 'todos.task-manifest.v1', 1, 'compensate', $2, $3, $4, $5, $6, $7, NULL, $8::jsonb, $9)`, [
        compensationReceiptId, receipt.operation_id, input.idempotency_key, requestDigest,
        receipt.result_digest, receipt.binding_version, input.receipt_id, canonicalJson(result), now,
      ]);
      const updated = await tx.query(`UPDATE todos_task_manifest_bindings
        SET state = 'compensated', version = $1, compensation_receipt_id = $2, updated_at = $3
        WHERE operation_id = $4 AND state = 'applied' AND version = $5 RETURNING operation_id`, [
        receipt.binding_version, compensationReceiptId, now, receipt.operation_id, input.if_binding_version,
      ]);
      if (!updated.rows[0]) throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_CAS_CONFLICT", "Binding changed during compensation");
      return result;
    });
  }

  private async readback(tx: TodosPostgresQueryClient, graph: TodosTaskManifestApplyResult["graph"]): Promise<TodosTaskManifestApplyResult["readback"]> {
    const count = async (objectType: string, ids: string[]): Promise<number> => {
      if (!ids.length) return 0;
      const result = await tx.query<{ count: string | number }>(`SELECT count(*) AS count FROM ${this.tableName}
        WHERE service = $1 AND object_type = $2 AND deleted_at IS NULL
          AND object_id IN (${placeholders(3, ids.length)})`, [this.service, objectType, ...ids]);
      return Number(result.rows[0]?.count ?? 0);
    };
    return {
      plans: await count("plans", [graph.plan_id]), tasks: await count("tasks", Object.values(graph.task_ids)),
      dependencies: await count("dependencies", graph.dependency_ids), comments: await count("comments", graph.comment_ids),
      verifications: await count("verifications", graph.verification_ids), complete: true,
    };
  }
}
