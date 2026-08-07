import type { Database } from "bun:sqlite";
import { now, uuid } from "../db/database.js";
import {
  currentStorageMachineId,
  recordStorageTombstone,
} from "../db/storage-tombstones.js";
import { normalizeSlug } from "../lib/slugs.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type {
  CreateProjectInput,
  CreateTaskListInput,
  Project,
  TaskList,
  TaskListRow,
} from "../types/index.js";
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
const SQLITE_TRANSACTION_RETRY_LIMIT = 8;

class SqliteRegistrationOptimisticConflict extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "SqliteRegistrationOptimisticConflict";
  }
}

function sameSqliteValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function taskListFromRow(row: TaskListRow): TaskList {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

function selectProject(db: Database, id: string): Project | null {
  return db.query("SELECT * FROM projects WHERE id = ? LIMIT 1").get(id) as Project | null;
}

function selectTaskList(db: Database, id: string): TaskList | null {
  const row = db.query("SELECT * FROM task_lists WHERE id = ? LIMIT 1")
    .get(id) as TaskListRow | null;
  return row ? taskListFromRow(row) : null;
}

function selectProjectConflict(
  db: Database,
  path: string,
  taskListSlug: string,
): Project | null {
  return db.query(`
    SELECT * FROM projects
    WHERE path = ? OR task_list_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(path, taskListSlug) as Project | null;
}

function selectTaskListConflict(
  db: Database,
  projectId: string,
  slug: string,
): TaskList | null {
  const row = db.query(`
    SELECT * FROM task_lists
    WHERE project_id = ? AND slug = ?
    LIMIT 1
  `).get(projectId, slug) as TaskListRow | null;
  return row ? taskListFromRow(row) : null;
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function hasSqliteDependents(
  db: Database,
  resourceKind: TodosProjectRegistrationResourceKind,
  targetId: string,
): boolean {
  const targetTable = resourceKind === "project" ? "projects" : "task_lists";
  const semanticColumns = resourceKind === "project"
    ? PROJECT_REFERENCE_COLUMNS
    : TASK_LIST_REFERENCE_COLUMNS;
  const tables = db.query(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;

  for (const { name: tableName } of tables) {
    const quotedTable = quoteSqliteIdentifier(tableName);
    const columns = db.query(`PRAGMA table_info(${quotedTable})`)
      .all() as Array<{ name: string }>;
    const foreignKeys = db.query(`PRAGMA foreign_key_list(${quotedTable})`)
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
      const row = db.query(`
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
    return hasSqliteDependents(this.db, resourceKind, targetId);
  }

  async deleteProject(id: string): Promise<boolean> {
    return await this.storage.projects.delete(id);
  }

  async deleteTaskList(id: string): Promise<boolean> {
    return await this.storage.taskLists.delete(id);
  }
}

/**
 * SQLite cannot isolate an async callback on a shared connection: every
 * ordinary write issued while that callback awaits would silently join its
 * transaction. Stage authority mutations in memory, validate the ordinary
 * records that informed the decision, then apply only the staged mutations in
 * one synchronous transaction. The authority queue serializes these plans;
 * optimistic retries cover a relevant ordinary write between plan and commit.
 */
class StagedSqliteTodosProjectRegistrationTransaction
implements TodosProjectRegistrationBackendTransaction {
  private readonly direct: SqliteTodosProjectRegistrationTransaction;
  private readonly validators: Array<() => boolean> = [];
  private readonly mutations: Array<() => void> = [];
  private readonly receipts = new Map<string, TodosProjectRegistrationReceiptRow>();
  private readonly bindings = new Map<string, TodosProjectRegistrationBindingRow>();
  private readonly projects = new Map<string, Project | null>();
  private readonly taskLists = new Map<string, TaskList | null>();

  constructor(private readonly db: Database) {
    this.direct = new SqliteTodosProjectRegistrationTransaction(db);
  }

  commit(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const validate of this.validators) {
        if (!validate()) {
          throw new SqliteRegistrationOptimisticConflict(
            "Todos project registration input changed before SQLite commit",
          );
        }
      }
      for (const mutate of this.mutations) mutate();
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the operation or optimistic-conflict error.
      }
      throw error;
    }
  }

  async lockStep(_identity: TodosProjectRegistrationStepIdentity): Promise<void> {
    // The per-Database authority queue serializes staged SQLite plans.
  }

  async getReceiptForLookup(
    identity: TodosProjectRegistrationCallIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const staged = [...this.receipts.values()]
      .filter((receipt) =>
        receipt.authority_id === identity.authority_id
        && receipt.tenant_id === identity.tenant_id
        && receipt.corpus_id === identity.corpus_id
        && receipt.operation_id === identity.operation_id
        && receipt.step_id === identity.step_id
        && receipt.resource_kind === identity.resource_kind
        && receipt.direction === identity.direction
        && receipt.idempotency_key === identity.idempotency_key
        && receipt.target_selector === identity.target_selector
      );
    const stored = await this.direct.getReceiptForLookup(identity);
    if (stored) staged.push(stored);
    const outcomeRank = (receipt: TodosProjectRegistrationReceiptRow): number =>
      receipt.outcome === "terminal_nonacceptance"
        ? 0
        : receipt.outcome === "duplicate_of_accepted" ? 1 : 2;
    return staged.sort((left, right) =>
      outcomeRank(left) - outcomeRank(right)
      || right.created_at.localeCompare(left.created_at)
      || right.receipt_id.localeCompare(left.receipt_id)
    )[0] ?? null;
  }

  async getReceiptById(
    receiptId: string,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    return this.receipts.get(receiptId)
      ?? this.direct.getReceiptById(receiptId);
  }

  async getAcceptedReceiptForStep(
    identity: TodosProjectRegistrationStepIdentity,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const staged = [...this.receipts.values()]
      .filter((receipt) =>
        receipt.authority_id === identity.authority_id
        && receipt.tenant_id === identity.tenant_id
        && receipt.corpus_id === identity.corpus_id
        && receipt.operation_id === identity.operation_id
        && receipt.step_id === identity.step_id
        && receipt.resource_kind === identity.resource_kind
        && receipt.direction === identity.direction
        && receipt.outcome === "accepted"
      );
    const stored = await this.direct.getAcceptedReceiptForStep(identity);
    if (stored) staged.push(stored);
    return staged.sort((left, right) =>
      left.created_at.localeCompare(right.created_at)
      || left.receipt_id.localeCompare(right.receipt_id)
    )[0] ?? null;
  }

  async insertReceipt(receipt: TodosProjectRegistrationReceiptRow): Promise<boolean> {
    if (this.receipts.has(receipt.receipt_id)) return false;
    if (await this.direct.getReceiptById(receipt.receipt_id)) return false;
    const planned = { ...receipt };
    this.receipts.set(planned.receipt_id, planned);
    this.mutations.push(() => {
      try {
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
          planned.receipt_id,
          planned.authority,
          planned.route,
          planned.package_version,
          planned.authority_id,
          planned.tenant_id,
          planned.corpus_id,
          planned.operation_id,
          planned.step_id,
          planned.resource_kind,
          planned.direction,
          planned.target_selector,
          planned.idempotency_key,
          planned.request_digest,
          planned.precondition_digest,
          planned.normalized_call_digest,
          planned.outcome,
          planned.reason,
          planned.target_id,
          planned.result_revision,
          planned.result_digest,
          planned.duplicate_of_receipt_id,
          planned.accepted_receipt_id,
          planned.created_by_operation ? 1 : 0,
          planned.created_at,
        );
        if (result.changes !== 1) {
          throw new SqliteRegistrationOptimisticConflict(
            "Todos project registration receipt changed before SQLite commit",
          );
        }
      } catch (error) {
        if (error instanceof SqliteRegistrationOptimisticConflict) throw error;
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project registration receipt conflicted at SQLite commit",
          { cause: error },
        );
      }
    });
    return true;
  }

  async getBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): Promise<TodosProjectRegistrationBindingRow | null> {
    const key = this.bindingKey(scope, resourceKind, targetSelector);
    return this.bindings.get(key)
      ?? this.direct.getBinding(scope, resourceKind, targetSelector);
  }

  async claimBinding(binding: TodosProjectRegistrationBindingRow): Promise<boolean> {
    const key = this.bindingKey(binding, binding.resource_kind, binding.target_selector);
    if (this.bindings.has(key)) return false;
    if (await this.direct.getBinding(binding, binding.resource_kind, binding.target_selector)) {
      return false;
    }
    const planned = { ...binding };
    this.bindings.set(key, planned);
    this.mutations.push(() => {
      try {
        const result = this.db.query(`
          INSERT OR IGNORE INTO todos_project_registration_bindings (
            authority_id, tenant_id, corpus_id, resource_kind, target_selector,
            operation_id, step_id, direction, idempotency_key, request_digest,
            precondition_digest, normalized_call_digest, state, target_id,
            accepted_receipt_id, result_revision, result_digest, removed_receipt_id,
            created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          planned.authority_id,
          planned.tenant_id,
          planned.corpus_id,
          planned.resource_kind,
          planned.target_selector,
          planned.operation_id,
          planned.step_id,
          planned.direction,
          planned.idempotency_key,
          planned.request_digest,
          planned.precondition_digest,
          planned.normalized_call_digest,
          planned.state,
          planned.target_id,
          planned.accepted_receipt_id,
          planned.result_revision,
          planned.result_digest,
          planned.removed_receipt_id,
          planned.created_at,
          planned.updated_at,
        );
        if (result.changes !== 1) {
          throw new SqliteRegistrationOptimisticConflict(
            "Todos project registration binding changed before SQLite commit",
          );
        }
      } catch (error) {
        if (error instanceof SqliteRegistrationOptimisticConflict) throw error;
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project registration binding conflicted at SQLite commit",
          { cause: error },
        );
      }
    });
    return true;
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
    const binding = await this.requireBinding(scope, resourceKind, targetSelector, "pending");
    this.bindings.set(this.bindingKey(scope, resourceKind, targetSelector), {
      ...binding,
      state: "accepted",
      target_id: update.target_id,
      accepted_receipt_id: update.accepted_receipt_id,
      result_revision: update.result_revision,
      result_digest: update.result_digest,
      updated_at: update.updated_at,
    });
    this.mutations.push(() => {
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
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project registration binding was no longer pending at SQLite commit",
        );
      }
    });
  }

  async setBindingTerminal(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    updatedAt: string,
  ): Promise<void> {
    const binding = await this.requireBinding(scope, resourceKind, targetSelector, "pending");
    this.bindings.set(this.bindingKey(scope, resourceKind, targetSelector), {
      ...binding,
      state: "terminal_nonacceptance",
      updated_at: updatedAt,
    });
    this.mutations.push(() => {
      const result = this.db.query(`
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
      if (result.changes !== 1) {
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project registration binding was no longer pending at SQLite commit",
        );
      }
    });
  }

  async setBindingRemoved(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    removedReceiptId: string,
    updatedAt: string,
  ): Promise<void> {
    const binding = await this.requireBinding(scope, resourceKind, targetSelector, "accepted");
    this.bindings.set(this.bindingKey(scope, resourceKind, targetSelector), {
      ...binding,
      state: "removed",
      removed_receipt_id: removedReceiptId,
      updated_at: updatedAt,
    });
    this.mutations.push(() => {
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
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project registration binding was no longer accepted at SQLite commit",
        );
      }
    });
  }

  async findProjectConflict(path: string, taskListSlug: string): Promise<Project | null> {
    const planned = [...this.projects.values()]
      .find((project) => project?.path === path || project?.task_list_id === taskListSlug);
    if (planned) return planned;
    const observed = selectProjectConflict(this.db, path, taskListSlug);
    this.validators.push(() => sameSqliteValue(
      selectProjectConflict(this.db, path, taskListSlug),
      observed,
    ));
    return observed;
  }

  async findTaskListConflict(projectId: string, slug: string): Promise<TaskList | null> {
    const planned = [...this.taskLists.values()]
      .find((taskList) => taskList?.project_id === projectId && taskList.slug === slug);
    if (planned) return planned;
    const observed = selectTaskListConflict(this.db, projectId, slug);
    this.validators.push(() => sameSqliteValue(
      selectTaskListConflict(this.db, projectId, slug),
      observed,
    ));
    return observed;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const derivedSlug = normalizeSlug(input.name);
    const taskListId = input.task_list_id === undefined
      ? `todos-${derivedSlug}`
      : normalizeSlug(input.task_list_id);
    if (!derivedSlug || !taskListId) {
      throw new Error("Project name and task-list slug must be non-empty");
    }
    const project: Project = {
      id: uuid(),
      name: input.name,
      path: input.path,
      description: input.description || null,
      task_list_id: taskListId,
      task_prefix: input.task_prefix ?? this.availableProjectPrefix(input.name),
      task_counter: 0,
      created_at: now(),
      updated_at: now(),
      machine_id: currentStorageMachineId(this.db),
    };
    project.updated_at = project.created_at;
    this.projects.set(project.id, project);
    this.mutations.push(() => {
      try {
        const result = this.db.run(
          `INSERT INTO projects (
             id, name, path, description, task_list_id, task_prefix,
             task_counter, created_at, updated_at, machine_id
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [
            project.id,
            project.name,
            project.path,
            project.description,
            project.task_list_id,
            project.task_prefix,
            project.created_at,
            project.updated_at,
            project.machine_id ?? null,
          ],
        );
        if (result.changes < 1) {
          throw new SqliteRegistrationOptimisticConflict(
            "Todos project changed before SQLite registration commit",
          );
        }
      } catch (error) {
        if (error instanceof SqliteRegistrationOptimisticConflict) throw error;
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project conflicted at SQLite registration commit",
          { cause: error },
        );
      }
    });
    return project;
  }

  async createTaskList(input: CreateTaskListInput): Promise<TaskList> {
    const slug = normalizeSlug(input.slug === undefined ? input.name : input.slug);
    if (!slug) throw new Error("Invalid task-list slug — must be non-empty kebab-case");
    const taskList: TaskList = {
      id: uuid(),
      project_id: input.project_id || null,
      slug,
      name: input.name,
      description: input.description || null,
      metadata: input.metadata ?? {},
      created_at: now(),
      updated_at: now(),
      machine_id: currentStorageMachineId(this.db),
    };
    taskList.updated_at = taskList.created_at;
    this.taskLists.set(taskList.id, taskList);
    this.mutations.push(() => {
      try {
        const result = this.db.run(
          `INSERT INTO task_lists (
             id, project_id, slug, name, description, metadata,
             created_at, updated_at, machine_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskList.id,
            taskList.project_id,
            taskList.slug,
            taskList.name,
            taskList.description,
            JSON.stringify(taskList.metadata),
            taskList.created_at,
            taskList.updated_at,
            taskList.machine_id ?? null,
          ],
        );
        if (result.changes < 1) {
          throw new SqliteRegistrationOptimisticConflict(
            "Todos task list changed before SQLite registration commit",
          );
        }
      } catch (error) {
        if (error instanceof SqliteRegistrationOptimisticConflict) throw error;
        throw new SqliteRegistrationOptimisticConflict(
          "Todos task list conflicted at SQLite registration commit",
          { cause: error },
        );
      }
    });
    return taskList;
  }

  async getProject(id: string): Promise<Project | null> {
    if (this.projects.has(id)) return this.projects.get(id) ?? null;
    const observed = selectProject(this.db, id);
    this.validators.push(() => sameSqliteValue(selectProject(this.db, id), observed));
    return observed;
  }

  async getTaskList(id: string): Promise<TaskList | null> {
    if (this.taskLists.has(id)) return this.taskLists.get(id) ?? null;
    const observed = selectTaskList(this.db, id);
    this.validators.push(() => sameSqliteValue(selectTaskList(this.db, id), observed));
    return observed;
  }

  async lockCompensationWrites(): Promise<void> {
    // Relevant readbacks are revalidated under BEGIN IMMEDIATE at commit.
  }

  async hasDependents(
    resourceKind: TodosProjectRegistrationResourceKind,
    targetId: string,
  ): Promise<boolean> {
    const observed = hasSqliteDependents(this.db, resourceKind, targetId);
    this.validators.push(() =>
      hasSqliteDependents(this.db, resourceKind, targetId) === observed
    );
    return observed;
  }

  async deleteProject(id: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) return false;
    this.projects.set(id, null);
    this.mutations.push(() => {
      recordStorageTombstone({
        object_type: "projects",
        object_id: id,
        payload: project as unknown as Record<string, unknown>,
      }, this.db);
      if (this.db.run("DELETE FROM projects WHERE id = ?", [id]).changes < 1) {
        throw new SqliteRegistrationOptimisticConflict(
          "Todos project changed before SQLite compensation commit",
        );
      }
    });
    return true;
  }

  async deleteTaskList(id: string): Promise<boolean> {
    const taskList = await this.getTaskList(id);
    if (!taskList) return false;
    this.taskLists.set(id, null);
    this.mutations.push(() => {
      recordStorageTombstone({
        object_type: "task_lists",
        object_id: id,
        payload: taskList as unknown as Record<string, unknown>,
      }, this.db);
      if (this.db.run("DELETE FROM task_lists WHERE id = ?", [id]).changes < 1) {
        throw new SqliteRegistrationOptimisticConflict(
          "Todos task list changed before SQLite compensation commit",
        );
      }
    });
    return true;
  }

  private bindingKey(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
  ): string {
    return JSON.stringify([
      scope.authority_id,
      scope.tenant_id,
      scope.corpus_id,
      resourceKind,
      targetSelector,
    ]);
  }

  private async requireBinding(
    scope: TodosProjectRegistrationAuthorityScope,
    resourceKind: TodosProjectRegistrationResourceKind,
    targetSelector: string,
    state: TodosProjectRegistrationBindingRow["state"],
  ): Promise<TodosProjectRegistrationBindingRow> {
    const binding = await this.getBinding(scope, resourceKind, targetSelector);
    if (!binding || binding.state !== state) {
      throw new Error(`Todos project registration binding was not ${state}`);
    }
    return binding;
  }

  private availableProjectPrefix(name: string): string {
    const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
    const prefix = words.length >= 3
      ? words.slice(0, 3).map((word) => word[0]!.toUpperCase()).join("")
      : words.length === 2
        ? (words[0]!.slice(0, 2) + words[1]![0]!).toUpperCase()
        : words[0]!.slice(0, 3).toUpperCase();
    let candidate = prefix;
    let suffix = 1;
    while (
      this.db.query("SELECT id FROM projects WHERE task_prefix = ? LIMIT 1").get(candidate)
      || [...this.projects.values()].some((project) => project?.task_prefix === candidate)
    ) {
      suffix += 1;
      candidate = `${prefix}${suffix}`;
    }
    return candidate;
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
      for (let attempt = 0; attempt < SQLITE_TRANSACTION_RETRY_LIMIT; attempt += 1) {
        const transaction = new StagedSqliteTodosProjectRegistrationTransaction(this.db);
        const result = await fn(transaction);
        try {
          transaction.commit();
          return result;
        } catch (error) {
          if (
            !(error instanceof SqliteRegistrationOptimisticConflict)
            || attempt === SQLITE_TRANSACTION_RETRY_LIMIT - 1
          ) {
            throw error;
          }
        }
      }
      throw new SqliteRegistrationOptimisticConflict(
        "Todos project registration exhausted SQLite optimistic retries",
      );
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
