import type { Database } from "bun:sqlite";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
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
import { sqliteTodosProjectRegistrationSchemaSql } from "./schema.js";
import type { TodosProjectRegistrationResourceKind } from "./types.js";

const sqliteTransactionTails = new WeakMap<Database, Promise<void>>();
const PROJECT_REFERENCE_COLUMNS = new Set([
  "project_id",
  "active_project_id",
  "assigned_from_project",
  "external_project_id",
]);
const TASK_LIST_REFERENCE_COLUMNS = new Set(["task_list_id"]);

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function receiptFromRow(row: Record<string, unknown>): TodosProjectRegistrationReceiptRow {
  return {
    ...row,
    authority: "todos",
    created_by_operation: Number(row["created_by_operation"]) === 1,
  } as unknown as TodosProjectRegistrationReceiptRow;
}

function bindingFromRow(row: Record<string, unknown>): TodosProjectRegistrationBindingRow {
  return row as unknown as TodosProjectRegistrationBindingRow;
}

class SqliteTodosProjectRegistrationTransaction
implements TodosProjectRegistrationBackendTransaction {
  private readonly storage;

  constructor(private readonly db: Database) {
    this.storage = createLocalSqliteTodosStorageAdapter({ db });
  }

  async lockStep(_identity: TodosProjectRegistrationStepIdentity): Promise<void> {
    // BEGIN IMMEDIATE plus the per-database queue serializes all authority steps.
  }

  async getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const row = this.db.query(`
      SELECT * FROM todos_project_registration_receipts
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND operation_id = ? AND step_id = ? AND resource_kind = ?
        AND direction = ? AND idempotency_key = ? AND target_selector = ?
      ORDER BY CASE outcome
        WHEN 'terminal_nonacceptance' THEN 0
        WHEN 'duplicate_of_accepted' THEN 1
        ELSE 2
      END, created_at DESC, receipt_id DESC
      LIMIT 1
    `).get(
      identity.authority_id,
      identity.tenant_id,
      identity.corpus_id,
      identity.operation_id,
      identity.step_id,
      identity.resource_kind,
      identity.direction,
      identity.idempotency_key,
      identity.target_selector,
    ) as Record<string, unknown> | null;
    return row ? receiptFromRow(row) : null;
  }

  async getReceiptById(receiptId: string): Promise<TodosProjectRegistrationReceiptRow | null> {
    const row = this.db.query(
      "SELECT * FROM todos_project_registration_receipts WHERE receipt_id = ? LIMIT 1",
    ).get(receiptId) as Record<string, unknown> | null;
    return row ? receiptFromRow(row) : null;
  }

  async getAcceptedReceiptForStep(
    identity: TodosProjectRegistrationStepIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const row = this.db.query(`
      SELECT * FROM todos_project_registration_receipts
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND operation_id = ? AND step_id = ? AND resource_kind = ?
        AND direction = ? AND outcome = 'accepted'
      ORDER BY created_at ASC, receipt_id ASC
      LIMIT 1
    `).get(
      identity.authority_id,
      identity.tenant_id,
      identity.corpus_id,
      identity.operation_id,
      identity.step_id,
      identity.resource_kind,
      identity.direction,
    ) as Record<string, unknown> | null;
    return row ? receiptFromRow(row) : null;
  }

  async insertReceipt(receipt: TodosProjectRegistrationReceiptRow): Promise<boolean> {
    const result = this.db.query(`
      INSERT OR IGNORE INTO todos_project_registration_receipts (
        receipt_id, authority, route, package_version, authority_id, tenant_id,
        corpus_id, operation_id, step_id, resource_kind, direction,
        target_selector, idempotency_key, request_digest, precondition_digest,
        normalized_call_digest, outcome, reason, target_id, result_revision,
        result_digest, duplicate_of_receipt_id, accepted_receipt_id,
        created_by_operation, created_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `).run(
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
      receipt.created_by_operation ? 1 : 0,
      receipt.created_at,
    );
    return result.changes === 1;
  }

  async getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null> {
    const row = this.db.query(`
      SELECT * FROM todos_project_registration_bindings
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND resource_kind = ? AND target_selector = ?
      LIMIT 1
    `).get(
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ) as Record<string, unknown> | null;
    return row ? bindingFromRow(row) : null;
  }

  async claimBinding(binding: TodosProjectRegistrationBindingRow): Promise<boolean> {
    const result = this.db.query(`
      INSERT OR IGNORE INTO todos_project_registration_bindings (
        authority_id, tenant_id, corpus_id, resource_kind, target_selector,
        operation_id, step_id, direction, idempotency_key, request_digest,
        precondition_digest, normalized_call_digest, state, target_id,
        accepted_receipt_id, result_revision, result_digest, removed_receipt_id,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
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
    );
    return result.changes === 1;
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
    const result = this.db.query(`
      UPDATE todos_project_registration_bindings
      SET state = 'accepted', target_id = ?, accepted_receipt_id = ?,
        result_revision = ?, result_digest = ?, updated_at = ?
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND resource_kind = ? AND target_selector = ? AND state = 'pending'
    `).run(
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
    );
    if (result.changes !== 1) {
      throw new Error("Todos project registration binding was not pending at acceptance");
    }
  }

  async setBindingTerminal(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    updatedAt: string,
  ): Promise<void> {
    this.db.query(`
      UPDATE todos_project_registration_bindings
      SET state = 'terminal_nonacceptance', updated_at = ?
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND resource_kind = ? AND target_selector = ? AND state = 'pending'
    `).run(
      updatedAt,
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    );
  }

  async setBindingRemoved(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    removedReceiptId: string,
    updatedAt: string,
  ): Promise<void> {
    const result = this.db.query(`
      UPDATE todos_project_registration_bindings
      SET state = 'removed', removed_receipt_id = ?, updated_at = ?
      WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
        AND resource_kind = ? AND target_selector = ? AND state = 'accepted'
    `).run(
      removedReceiptId,
      updatedAt,
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    );
    if (result.changes !== 1) {
      throw new Error("Todos project registration binding was not accepted at removal");
    }
  }

  async findProjectConflict(path: string, taskListSlug: string): Promise<Project | null> {
    const row = this.db.query(`
      SELECT * FROM projects
      WHERE path = ? OR task_list_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get(path, taskListSlug) as Project | null;
    return row ?? null;
  }

  async findTaskListConflict(projectId: string, slug: string): Promise<TaskList | null> {
    return await this.storage.taskLists.getBySlug(slug, projectId);
  }

  async createProject(input: Parameters<typeof this.storage.projects.create>[0]): Promise<Project> {
    return await this.storage.projects.create(input);
  }

  async createTaskList(input: Parameters<typeof this.storage.taskLists.create>[0]): Promise<TaskList> {
    return await this.storage.taskLists.create(input);
  }

  async getProject(id: string): Promise<Project | null> {
    return await this.storage.projects.get(id);
  }

  async getTaskList(id: string): Promise<TaskList | null> {
    return await this.storage.taskLists.get(id);
  }

  async lockCompensationWrites(): Promise<void> {
    // BEGIN IMMEDIATE already excludes concurrent writers before any readback.
  }

  async hasDependents(
    resourceKind: TodosProjectRegistrationResourceKind,
    targetId: string,
  ): Promise<boolean> {
    const targetTable = resourceKind === "project" ? "projects" : "task_lists";
    const semanticColumns = resourceKind === "project"
      ? PROJECT_REFERENCE_COLUMNS
      : TASK_LIST_REFERENCE_COLUMNS;
    const tables = this.db.query(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    for (const { name: tableName } of tables) {
      const quotedTable = quoteSqliteIdentifier(tableName);
      const columns = this.db.query(`PRAGMA table_info(${quotedTable})`)
        .all() as Array<{ name: string }>;
      const foreignKeys = this.db.query(`PRAGMA foreign_key_list(${quotedTable})`)
        .all() as Array<{ from: string; table: string }>;
      const referenceColumns = columns
        .map((column) => column.name)
        .filter((columnName) =>
          semanticColumns.has(columnName)
          || foreignKeys.some((foreignKey) =>
            foreignKey.from === columnName && foreignKey.table === targetTable
          )
        );

      for (const columnName of referenceColumns) {
        const row = this.db.query(`
          SELECT 1 AS found
          FROM ${quotedTable}
          WHERE ${quoteSqliteIdentifier(columnName)} = ?
          LIMIT 1
        `).get(targetId) as { found: number } | null;
        if (row) return true;
      }
    }
    return false;
  }

  async deleteProject(id: string): Promise<boolean> {
    return await this.storage.projects.delete(id);
  }

  async deleteTaskList(id: string): Promise<boolean> {
    return await this.storage.taskLists.delete(id);
  }
}

export class SqliteTodosProjectRegistrationBackend
implements TodosProjectRegistrationBackend {
  readonly kind = "sqlite" as const;
  private readonly direct: SqliteTodosProjectRegistrationTransaction;

  constructor(private readonly db: Database) {
    db.exec(sqliteTodosProjectRegistrationSchemaSql());
    this.direct = new SqliteTodosProjectRegistrationTransaction(db);
  }

  async transaction<T>(
    fn: (transaction: TodosProjectRegistrationBackendTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = sqliteTransactionTails.get(this.db) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    sqliteTransactionTails.set(this.db, current);
    await previous;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = await fn(new SqliteTodosProjectRegistrationTransaction(this.db));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the authoritative operation error.
      }
      throw error;
    } finally {
      release();
      if (sqliteTransactionTails.get(this.db) === current) {
        sqliteTransactionTails.delete(this.db);
      }
    }
  }

  getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    return this.direct.getReceiptForLookup(identity);
  }

  getReceiptById(receiptId: string): Promise<TodosProjectRegistrationReceiptRow | null> {
    return this.direct.getReceiptById(receiptId);
  }

  getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null> {
    return this.direct.getBinding(scope, resourceKind, targetSelector);
  }

  getProject(id: string): Promise<Project | null> {
    return this.direct.getProject(id);
  }

  getTaskList(id: string): Promise<TaskList | null> {
    return this.direct.getTaskList(id);
  }
}
