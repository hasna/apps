import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import {
  postgresTodosSyncSchemaSql,
  type TodosPostgresQueryClient,
} from "../storage/postgres-sync.js";
import type { Project, TaskList } from "../types/index.js";
import type {
  TodosProjectRegistrationBackend,
  TodosProjectRegistrationBackendTransaction,
  TodosProjectRegistrationAuthorityScope,
  TodosProjectRegistrationBindingRow,
  TodosProjectRegistrationCallIdentity,
  TodosProjectRegistrationReceiptRow,
  TodosProjectRegistrationStepIdentity,
} from "./backend.js";
import { postgresTodosProjectRegistrationSchemaSql } from "./schema.js";
import {
  TodosProjectRegistrationError,
  type TodosProjectRegistrationResourceKind,
} from "./types.js";

export interface TodosProjectRegistrationPostgresClient
extends TodosPostgresQueryClient {
  transaction<T>(
    fn: (client: TodosPostgresQueryClient) => Promise<T>,
  ): Promise<T>;
}

export interface PostgresTodosProjectRegistrationBackendOptions {
  service?: string;
  tableName?: string;
  cursorTableName?: string;
}

function safeIdentifier(value: string, field: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      `${field} must be a safe PostgreSQL identifier`,
    );
  }
  return value;
}

function normalizeTimestamp(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function parsePayload<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function receiptFromRow(row: Record<string, unknown>): TodosProjectRegistrationReceiptRow {
  return {
    ...row,
    authority: "todos",
    created_by_operation: Boolean(row["created_by_operation"]),
    created_at: normalizeTimestamp(row["created_at"]),
  } as unknown as TodosProjectRegistrationReceiptRow;
}

function bindingFromRow(row: Record<string, unknown>): TodosProjectRegistrationBindingRow {
  return {
    ...row,
    created_at: normalizeTimestamp(row["created_at"]),
    updated_at: normalizeTimestamp(row["updated_at"]),
  } as unknown as TodosProjectRegistrationBindingRow;
}

class PostgresTodosProjectRegistrationTransaction
implements TodosProjectRegistrationBackendTransaction {
  private readonly storage;

  constructor(
    private readonly client: TodosPostgresQueryClient,
    private readonly service: string,
    private readonly tableName: string,
    cursorTableName: string,
  ) {
    this.storage = createPostgresTodosStorageAdapter({
      client,
      service,
      tableName,
      cursorTableName,
    });
  }

  async lockStep(identity: TodosProjectRegistrationStepIdentity): Promise<void> {
    const key = [
      identity.authority_id,
      identity.tenant_id,
      identity.corpus_id,
      identity.operation_id,
      identity.step_id,
      identity.resource_kind,
      identity.direction,
    ].join("\u001f");
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
  }

  async getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const result = await this.client.query<Record<string, unknown>>(`
      SELECT * FROM todos_project_registration_receipts
      WHERE authority_id = $1 AND tenant_id = $2 AND corpus_id = $3
        AND operation_id = $4 AND step_id = $5 AND resource_kind = $6
        AND direction = $7 AND idempotency_key = $8 AND target_selector = $9
      ORDER BY CASE outcome
        WHEN 'terminal_nonacceptance' THEN 0
        WHEN 'duplicate_of_accepted' THEN 1
        ELSE 2
      END, created_at DESC, receipt_id DESC
      LIMIT 1
    `, [
      identity.authority_id,
      identity.tenant_id,
      identity.corpus_id,
      identity.operation_id,
      identity.step_id,
      identity.resource_kind,
      identity.direction,
      identity.idempotency_key,
      identity.target_selector,
    ]);
    return result.rows[0] ? receiptFromRow(result.rows[0]) : null;
  }

  async getReceiptById(receiptId: string): Promise<TodosProjectRegistrationReceiptRow | null> {
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM todos_project_registration_receipts WHERE receipt_id = $1 LIMIT 1",
      [receiptId],
    );
    return result.rows[0] ? receiptFromRow(result.rows[0]) : null;
  }

  async getAcceptedReceiptForStep(
    identity: TodosProjectRegistrationStepIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const result = await this.client.query<Record<string, unknown>>(`
      SELECT * FROM todos_project_registration_receipts
      WHERE authority_id = $1 AND tenant_id = $2 AND corpus_id = $3
        AND operation_id = $4 AND step_id = $5 AND resource_kind = $6
        AND direction = $7 AND outcome = 'accepted'
      ORDER BY created_at ASC, receipt_id ASC
      LIMIT 1
      FOR UPDATE
    `, [
      identity.authority_id,
      identity.tenant_id,
      identity.corpus_id,
      identity.operation_id,
      identity.step_id,
      identity.resource_kind,
      identity.direction,
    ]);
    return result.rows[0] ? receiptFromRow(result.rows[0]) : null;
  }

  async insertReceipt(receipt: TodosProjectRegistrationReceiptRow): Promise<boolean> {
    const result = await this.client.query<{ receipt_id: string }>(`
      INSERT INTO todos_project_registration_receipts (
        receipt_id, authority, route, package_version, authority_id, tenant_id,
        corpus_id, operation_id, step_id, resource_kind, direction,
        target_selector, idempotency_key, request_digest, precondition_digest,
        normalized_call_digest, outcome, reason, target_id, result_revision,
        result_digest, duplicate_of_receipt_id, accepted_receipt_id,
        created_by_operation, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25
      )
      ON CONFLICT (receipt_id) DO NOTHING
      RETURNING receipt_id
    `, [
      receipt.receipt_id,
      receipt.authority,
      receipt.route,
      receipt.package_version,
      receipt.authority_id,
      receipt.tenant_id,
      receipt.corpus_id,
      receipt.operation_id,
      receipt.step_id,
      receipt.resource_kind,
      receipt.direction,
      receipt.target_selector,
      receipt.idempotency_key,
      receipt.request_digest,
      receipt.precondition_digest,
      receipt.normalized_call_digest,
      receipt.outcome,
      receipt.reason,
      receipt.target_id,
      receipt.result_revision,
      receipt.result_digest,
      receipt.duplicate_of_receipt_id,
      receipt.accepted_receipt_id,
      receipt.created_by_operation,
      receipt.created_at,
    ]);
    return result.rows.length === 1;
  }

  async getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null> {
    const result = await this.client.query<Record<string, unknown>>(`
      SELECT * FROM todos_project_registration_bindings
      WHERE authority_id = $1 AND tenant_id = $2 AND corpus_id = $3
        AND resource_kind = $4 AND target_selector = $5
      LIMIT 1
      FOR UPDATE
    `, [
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ]);
    return result.rows[0] ? bindingFromRow(result.rows[0]) : null;
  }

  async claimBinding(binding: TodosProjectRegistrationBindingRow): Promise<boolean> {
    const result = await this.client.query<{ target_selector: string }>(`
      INSERT INTO todos_project_registration_bindings (
        authority_id, tenant_id, corpus_id, resource_kind, target_selector,
        operation_id, step_id, direction, idempotency_key, request_digest,
        precondition_digest, normalized_call_digest, state, target_id,
        accepted_receipt_id, result_revision, result_digest, removed_receipt_id,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20
      )
      ON CONFLICT (
        authority_id, tenant_id, corpus_id, resource_kind, target_selector
      ) DO NOTHING
      RETURNING target_selector
    `, [
      binding.authority_id,
      binding.tenant_id,
      binding.corpus_id,
      binding.resource_kind,
      binding.target_selector,
      binding.operation_id,
      binding.step_id,
      binding.direction,
      binding.idempotency_key,
      binding.request_digest,
      binding.precondition_digest,
      binding.normalized_call_digest,
      binding.state,
      binding.target_id,
      binding.accepted_receipt_id,
      binding.result_revision,
      binding.result_digest,
      binding.removed_receipt_id,
      binding.created_at,
      binding.updated_at,
    ]);
    return result.rows.length === 1;
  }

  async setBindingAccepted(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    update: {
      target_id: string;
      accepted_receipt_id: string;
      result_revision: string;
      result_digest: string;
      updated_at: string;
    },
  ): Promise<void> {
    const result = await this.client.query<{ target_selector: string }>(`
      UPDATE todos_project_registration_bindings
      SET state = 'accepted', target_id = $1, accepted_receipt_id = $2,
        result_revision = $3, result_digest = $4, updated_at = $5
      WHERE authority_id = $6 AND tenant_id = $7 AND corpus_id = $8
        AND resource_kind = $9 AND target_selector = $10 AND state = 'pending'
      RETURNING target_selector
    `, [
      update.target_id,
      update.accepted_receipt_id,
      update.result_revision,
      update.result_digest,
      update.updated_at,
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ]);
    if (result.rows.length !== 1) {
      throw new Error("Todos project registration binding was not pending at acceptance");
    }
  }

  async setBindingTerminal(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    updatedAt: string,
  ): Promise<void> {
    await this.client.query(`
      UPDATE todos_project_registration_bindings
      SET state = 'terminal_nonacceptance', updated_at = $1
      WHERE authority_id = $2 AND tenant_id = $3 AND corpus_id = $4
        AND resource_kind = $5 AND target_selector = $6 AND state = 'pending'
    `, [
      updatedAt,
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ]);
  }

  async setBindingRemoved(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    removedReceiptId: string,
    updatedAt: string,
  ): Promise<void> {
    const result = await this.client.query<{ target_selector: string }>(`
      UPDATE todos_project_registration_bindings
      SET state = 'removed', removed_receipt_id = $1, updated_at = $2
      WHERE authority_id = $3 AND tenant_id = $4 AND corpus_id = $5
        AND resource_kind = $6 AND target_selector = $7 AND state = 'accepted'
      RETURNING target_selector
    `, [
      removedReceiptId,
      updatedAt,
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ]);
    if (result.rows.length !== 1) {
      throw new Error("Todos project registration binding was not accepted at removal");
    }
  }

  async findProjectConflict(path: string, taskListSlug: string): Promise<Project | null> {
    const result = await this.client.query<{ payload: unknown }>(`
      SELECT payload FROM ${this.tableName}
      WHERE service = $1 AND object_type = 'projects' AND deleted_at IS NULL
        AND (payload->>'path' = $2 OR payload->>'task_list_id' = $3)
      ORDER BY payload->>'created_at' ASC, object_id ASC
      LIMIT 1
    `, [this.service, path, taskListSlug]);
    return result.rows[0] ? parsePayload<Project>(result.rows[0].payload) : null;
  }

  async findTaskListConflict(projectId: string, slug: string): Promise<TaskList | null> {
    const result = await this.client.query<{ payload: unknown }>(`
      SELECT payload FROM ${this.tableName}
      WHERE service = $1 AND object_type = 'task_lists' AND deleted_at IS NULL
        AND payload->>'project_id' = $2 AND payload->>'slug' = $3
      ORDER BY payload->>'created_at' ASC, object_id ASC
      LIMIT 1
    `, [this.service, projectId, slug]);
    return result.rows[0] ? parsePayload<TaskList>(result.rows[0].payload) : null;
  }

  async createProject(
    input: Parameters<typeof this.storage.projects.create>[0],
  ): Promise<Project> {
    return await this.storage.projects.create(input);
  }

  async createTaskList(
    input: Parameters<typeof this.storage.taskLists.create>[0],
  ): Promise<TaskList> {
    return await this.storage.taskLists.create(input);
  }

  async getProject(id: string): Promise<Project | null> {
    return await this.storage.projects.get(id);
  }

  async getTaskList(id: string): Promise<TaskList | null> {
    return await this.storage.taskLists.get(id);
  }

  async lockCompensationWrites(): Promise<void> {
    await this.client.query(
      `LOCK TABLE ${this.tableName} IN SHARE ROW EXCLUSIVE MODE`,
    );
  }

  async hasDependents(
    resourceKind: TodosProjectRegistrationResourceKind,
    targetId: string,
  ): Promise<boolean> {
    const referencePredicate = resourceKind === "project"
      ? `(
          payload->>'project_id' = $2
          OR payload->>'active_project_id' = $2
          OR payload->>'assigned_from_project' = $2
          OR payload->>'external_project_id' = $2
        )`
      : "payload->>'task_list_id' = $2";
    const result = await this.client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM ${this.tableName}
        WHERE service = $1 AND deleted_at IS NULL
          AND ${referencePredicate}
        LIMIT 1
      ) AS exists
    `, [this.service, targetId]);
    return result.rows[0]?.exists === true;
  }

  async deleteProject(id: string): Promise<boolean> {
    return await this.storage.projects.delete(id);
  }

  async deleteTaskList(id: string): Promise<boolean> {
    return await this.storage.taskLists.delete(id);
  }
}

export class PostgresTodosProjectRegistrationBackend
implements TodosProjectRegistrationBackend {
  readonly kind = "postgresql" as const;
  private readonly service: string;
  private readonly tableName: string;
  private readonly cursorTableName: string;
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly client: TodosProjectRegistrationPostgresClient,
    options: PostgresTodosProjectRegistrationBackendOptions = {},
  ) {
    this.service = options.service ?? "todos";
    this.tableName = safeIdentifier(options.tableName ?? "todos_sync_records", "tableName");
    this.cursorTableName = safeIdentifier(
      options.cursorTableName ?? "todos_sync_cursors",
      "cursorTableName",
    );
  }

  async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const statement of postgresTodosSyncSchemaSql(
        this.tableName,
        this.cursorTableName,
      )) {
        await this.client.query(statement);
      }
      for (const statement of postgresTodosProjectRegistrationSchemaSql()) {
        await this.client.query(statement);
      }
    })();
    await this.schemaReady;
  }

  async transaction<T>(
    fn: (transaction: TodosProjectRegistrationBackendTransaction) => Promise<T>,
  ): Promise<T> {
    await this.ensureSchema();
    if (typeof this.client.transaction !== "function") {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE",
        "PostgreSQL project registration requires an authoritative transaction",
      );
    }
    return this.client.transaction((transaction) => fn(
      new PostgresTodosProjectRegistrationTransaction(
        transaction,
        this.service,
        this.tableName,
        this.cursorTableName,
      ),
    ));
  }

  private async direct(): Promise<PostgresTodosProjectRegistrationTransaction> {
    await this.ensureSchema();
    return new PostgresTodosProjectRegistrationTransaction(
      this.client,
      this.service,
      this.tableName,
      this.cursorTableName,
    );
  }

  async getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    return (await this.direct()).getReceiptForLookup(identity);
  }

  async getReceiptById(
    receiptId: string,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    return (await this.direct()).getReceiptById(receiptId);
  }

  async getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null> {
    return (await this.direct()).getBinding(scope, resourceKind, targetSelector);
  }

  async getProject(id: string): Promise<Project | null> {
    return (await this.direct()).getProject(id);
  }

  async getTaskList(id: string): Promise<TaskList | null> {
    return (await this.direct()).getTaskList(id);
  }
}
