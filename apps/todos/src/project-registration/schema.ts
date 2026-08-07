export function sqliteTodosProjectRegistrationSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS todos_project_registration_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'todos'),
      route TEXT NOT NULL,
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('project', 'task_list')),
      direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
      target_selector TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      normalized_call_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN (
        'accepted', 'duplicate_of_accepted', 'terminal_nonacceptance'
      )),
      reason TEXT,
      target_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      duplicate_of_receipt_id TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todos_project_registration_receipts_lookup
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction, idempotency_key
      );
    CREATE INDEX IF NOT EXISTS idx_todos_project_registration_receipts_step
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction, outcome
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_project_registration_receipts_accepted_step
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction
      )
      WHERE outcome = 'accepted';
    CREATE INDEX IF NOT EXISTS idx_todos_project_registration_receipts_target
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, resource_kind, target_id
      );

    CREATE TABLE IF NOT EXISTS todos_project_registration_bindings (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('project', 'task_list')),
      target_selector TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction = 'forward'),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      normalized_call_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN (
        'pending', 'accepted', 'terminal_nonacceptance', 'removed'
      )),
      target_id TEXT,
      accepted_receipt_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      removed_receipt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(
        authority_id, tenant_id, corpus_id, resource_kind, target_selector
      ),
      UNIQUE(accepted_receipt_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_project_registration_binding_target
      ON todos_project_registration_bindings(
        authority_id, tenant_id, corpus_id, resource_kind, target_id
      )
      WHERE target_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS todos_project_registration_receipts_immutable_update
    BEFORE UPDATE ON todos_project_registration_receipts
    BEGIN
      SELECT RAISE(ABORT, 'todos project registration receipts are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS todos_project_registration_receipts_immutable_delete
    BEFORE DELETE ON todos_project_registration_receipts
    BEGIN
      SELECT RAISE(ABORT, 'todos project registration receipts are immutable');
    END;
  `;
}

export function postgresTodosProjectRegistrationSchemaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS todos_project_registration_receipts (
      receipt_id text PRIMARY KEY,
      authority text NOT NULL CHECK(authority = 'todos'),
      route text NOT NULL,
      package_version text NOT NULL,
      authority_id text NOT NULL,
      tenant_id text NOT NULL,
      corpus_id text NOT NULL,
      operation_id text NOT NULL,
      step_id text NOT NULL,
      resource_kind text NOT NULL CHECK(resource_kind IN ('project', 'task_list')),
      direction text NOT NULL CHECK(direction IN ('forward', 'inverse')),
      target_selector text NOT NULL,
      idempotency_key text NOT NULL,
      request_digest text NOT NULL,
      precondition_digest text NOT NULL,
      normalized_call_digest text NOT NULL,
      outcome text NOT NULL CHECK(outcome IN (
        'accepted', 'duplicate_of_accepted', 'terminal_nonacceptance'
      )),
      reason text,
      target_id text,
      result_revision text,
      result_digest text,
      duplicate_of_receipt_id text,
      accepted_receipt_id text,
      created_by_operation boolean NOT NULL,
      created_at timestamptz NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS todos_project_registration_receipts_lookup_idx
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction, idempotency_key
      )`,
    `CREATE INDEX IF NOT EXISTS todos_project_registration_receipts_step_idx
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction, outcome
      )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS todos_project_registration_receipts_accepted_step_uidx
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        resource_kind, direction
      )
      WHERE outcome = 'accepted'`,
    `CREATE INDEX IF NOT EXISTS todos_project_registration_receipts_target_idx
      ON todos_project_registration_receipts (
        authority_id, tenant_id, corpus_id, resource_kind, target_id
      )`,
    `CREATE TABLE IF NOT EXISTS todos_project_registration_bindings (
      authority_id text NOT NULL,
      tenant_id text NOT NULL,
      corpus_id text NOT NULL,
      resource_kind text NOT NULL CHECK(resource_kind IN ('project', 'task_list')),
      target_selector text NOT NULL,
      operation_id text NOT NULL,
      step_id text NOT NULL,
      direction text NOT NULL CHECK(direction = 'forward'),
      idempotency_key text NOT NULL,
      request_digest text NOT NULL,
      precondition_digest text NOT NULL,
      normalized_call_digest text NOT NULL,
      state text NOT NULL CHECK(state IN (
        'pending', 'accepted', 'terminal_nonacceptance', 'removed'
      )),
      target_id text,
      accepted_receipt_id text UNIQUE,
      result_revision text,
      result_digest text,
      removed_receipt_id text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY(
        authority_id, tenant_id, corpus_id, resource_kind, target_selector
      )
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS todos_project_registration_binding_target_uidx
      ON todos_project_registration_bindings(
        authority_id, tenant_id, corpus_id, resource_kind, target_id
      )
      WHERE target_id IS NOT NULL`,
    `CREATE OR REPLACE FUNCTION todos_project_registration_receipts_immutable()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'todos project registration receipts are immutable';
      END;
      $$`,
    `DROP TRIGGER IF EXISTS todos_project_registration_receipts_immutable
      ON todos_project_registration_receipts`,
    `CREATE TRIGGER todos_project_registration_receipts_immutable
      BEFORE UPDATE OR DELETE ON todos_project_registration_receipts
      FOR EACH ROW EXECUTE FUNCTION todos_project_registration_receipts_immutable()`,
  ];
}
