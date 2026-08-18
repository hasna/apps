import type { Database } from "bun:sqlite";

export function sqliteTodosTaskSubtreeTransferSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS todos_task_subtree_transfer_receipts (
      receipt_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('apply', 'rollback')),
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      result_digest TEXT NOT NULL,
      apply_receipt_id TEXT,
      request_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(tenant_id, kind, operation_id, step_id),
      UNIQUE(tenant_id, kind, idempotency_key)
    );
    CREATE TRIGGER IF NOT EXISTS todos_task_subtree_transfer_receipts_immutable_update
      BEFORE UPDATE ON todos_task_subtree_transfer_receipts BEGIN
        SELECT RAISE(ABORT, 'todos task subtree transfer receipts are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS todos_task_subtree_transfer_receipts_immutable_delete
      BEFORE DELETE ON todos_task_subtree_transfer_receipts BEGIN
        SELECT RAISE(ABORT, 'todos task subtree transfer receipts are immutable');
      END;
  `;
}

export function ensureSqliteTodosTaskSubtreeTransferSchema(db: Database): void {
  db.exec(sqliteTodosTaskSubtreeTransferSchemaSql());
}

export function postgresTodosTaskSubtreeTransferSchemaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS todos_task_subtree_transfer_receipts (
      receipt_id text PRIMARY KEY,
      tenant_id text NOT NULL,
      kind text NOT NULL CHECK(kind IN ('apply', 'rollback')),
      operation_id text NOT NULL,
      step_id text NOT NULL,
      idempotency_key text NOT NULL,
      request_digest text NOT NULL,
      precondition_digest text NOT NULL,
      result_digest text NOT NULL,
      apply_receipt_id text,
      request_json jsonb NOT NULL,
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      UNIQUE(tenant_id, kind, operation_id, step_id),
      UNIQUE(tenant_id, kind, idempotency_key)
    )`,
    `CREATE OR REPLACE FUNCTION reject_todos_task_subtree_transfer_receipt_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'todos task subtree transfer receipts are immutable';
      END $$`,
    `DROP TRIGGER IF EXISTS todos_task_subtree_transfer_receipts_immutable_update
      ON todos_task_subtree_transfer_receipts`,
    `CREATE TRIGGER todos_task_subtree_transfer_receipts_immutable_update
      BEFORE UPDATE OR DELETE ON todos_task_subtree_transfer_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_todos_task_subtree_transfer_receipt_mutation()`,
  ];
}
