import type { Database } from "bun:sqlite";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqliteTodosTaskManifestSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS todos_task_manifest_receipts (
      receipt_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
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
      tenant_id TEXT NOT NULL,
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

function sqliteTableHasColumn(db: Database, tableName: string, columnName: string): boolean {
  const columns = db.query(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

export function ensureSqliteTodosTaskManifestSchema(db: Database, tenantId: string): void {
  db.exec(sqliteTodosTaskManifestSchemaSql());
  const tenantDefault = sqlString(tenantId);
  for (const tableName of [
    "todos_task_manifest_receipts",
    "todos_task_manifest_bindings",
  ]) {
    if (!sqliteTableHasColumn(db, tableName, "tenant_id")) {
      db.exec(
        `ALTER TABLE "${tableName}" ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ${tenantDefault}`,
      );
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_todos_task_manifest_receipts_tenant
      ON todos_task_manifest_receipts(tenant_id, receipt_id, kind);
    CREATE INDEX IF NOT EXISTS idx_todos_task_manifest_bindings_tenant_plan
      ON todos_task_manifest_bindings(
        tenant_id,
        json_extract(result_json, '$.graph.plan_id')
      );
  `);
}

export function postgresTodosTaskManifestSchemaSql(tenantId = "default"): string[] {
  const tenantDefault = sqlString(tenantId);
  return [
    `CREATE TABLE IF NOT EXISTS todos_task_manifest_receipts (
      receipt_id text PRIMARY KEY,
      tenant_id text NOT NULL,
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
    `ALTER TABLE todos_task_manifest_receipts
      ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT ${tenantDefault}`,
    `ALTER TABLE todos_task_manifest_receipts
      ALTER COLUMN tenant_id DROP DEFAULT`,
    `CREATE TABLE IF NOT EXISTS todos_task_manifest_bindings (
      operation_id text PRIMARY KEY,
      tenant_id text NOT NULL,
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
    `ALTER TABLE todos_task_manifest_bindings
      ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT ${tenantDefault}`,
    `ALTER TABLE todos_task_manifest_bindings
      ALTER COLUMN tenant_id DROP DEFAULT`,
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
    `CREATE INDEX IF NOT EXISTS todos_task_manifest_receipts_tenant_idx
      ON todos_task_manifest_receipts(tenant_id, receipt_id, kind)`,
    `CREATE INDEX IF NOT EXISTS todos_task_manifest_bindings_tenant_plan_idx
      ON todos_task_manifest_bindings(
        tenant_id,
        ((result_json #>> '{graph,plan_id}'))
      )`,
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
