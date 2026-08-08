export function sqliteTodosTaskManifestSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS todos_task_manifest_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'todos'),
      route TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK(schema_version = 1),
      kind TEXT NOT NULL CHECK(kind IN ('apply', 'compensate')),
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
    CREATE TABLE IF NOT EXISTS todos_task_manifest_bindings (
      operation_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_digest TEXT NOT NULL,
      result_digest TEXT NOT NULL,
      apply_receipt_id TEXT NOT NULL UNIQUE REFERENCES todos_task_manifest_receipts(receipt_id),
      manifest_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('applied', 'compensated')),
      version INTEGER NOT NULL,
      compensation_receipt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todos_task_manifest_outbox (
      id TEXT PRIMARY KEY,
      apply_receipt_id TEXT NOT NULL REFERENCES todos_task_manifest_receipts(receipt_id),
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_task_manifest_outbox_receipt
      ON todos_task_manifest_outbox(apply_receipt_id, status);
    CREATE TRIGGER IF NOT EXISTS todos_task_manifest_receipts_immutable_update
      BEFORE UPDATE ON todos_task_manifest_receipts BEGIN
        SELECT RAISE(ABORT, 'todos task manifest receipts are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS todos_task_manifest_receipts_immutable_delete
      BEFORE DELETE ON todos_task_manifest_receipts BEGIN
        SELECT RAISE(ABORT, 'todos task manifest receipts are immutable');
      END;
  `;
}

export function postgresTodosTaskManifestSchemaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS todos_task_manifest_receipts (
      receipt_id text PRIMARY KEY,
      authority text NOT NULL CHECK(authority = 'todos'),
      route text NOT NULL,
      schema_version integer NOT NULL CHECK(schema_version = 1),
      kind text NOT NULL CHECK(kind IN ('apply', 'compensate')),
      operation_id text NOT NULL,
      idempotency_key text NOT NULL,
      request_digest text NOT NULL,
      result_digest text NOT NULL,
      binding_version integer NOT NULL,
      apply_receipt_id text,
      manifest_json jsonb,
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      UNIQUE(kind, idempotency_key)
    )`,
    `CREATE TABLE IF NOT EXISTS todos_task_manifest_bindings (
      operation_id text PRIMARY KEY,
      idempotency_key text NOT NULL UNIQUE,
      request_digest text NOT NULL,
      result_digest text NOT NULL,
      apply_receipt_id text NOT NULL UNIQUE REFERENCES todos_task_manifest_receipts(receipt_id),
      manifest_json jsonb NOT NULL,
      result_json jsonb NOT NULL,
      state text NOT NULL CHECK(state IN ('applied', 'compensated')),
      version integer NOT NULL,
      compensation_receipt_id text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS todos_task_manifest_outbox (
      id text PRIMARY KEY,
      apply_receipt_id text NOT NULL REFERENCES todos_task_manifest_receipts(receipt_id),
      topic text NOT NULL,
      payload jsonb NOT NULL,
      payload_digest text NOT NULL,
      status text NOT NULL CHECK(status IN ('pending', 'delivered', 'cancelled')),
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL,
      delivered_at timestamptz
    )`,
    `CREATE INDEX IF NOT EXISTS todos_task_manifest_outbox_receipt_idx
      ON todos_task_manifest_outbox(apply_receipt_id, status)`,
    `CREATE OR REPLACE FUNCTION todos_task_manifest_receipts_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'todos task manifest receipts are immutable';
      END; $$`,
    `DROP TRIGGER IF EXISTS todos_task_manifest_receipts_immutable ON todos_task_manifest_receipts`,
    `CREATE TRIGGER todos_task_manifest_receipts_immutable
      BEFORE UPDATE OR DELETE ON todos_task_manifest_receipts
      FOR EACH ROW EXECUTE FUNCTION todos_task_manifest_receipts_immutable()`,
  ];
}
