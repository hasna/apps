-- Todos A1 pure-remote JSONB sync tables (idempotent)
CREATE TABLE IF NOT EXISTS todos_sync_records (
      service text NOT NULL,
      object_type text NOT NULL,
      object_id text NOT NULL,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL,
      deleted_at timestamptz,
      source_machine_id text,
      version integer,
      PRIMARY KEY (service, object_type, object_id)
    );

CREATE INDEX IF NOT EXISTS todos_sync_records_updated_idx ON todos_sync_records (service, updated_at);

CREATE TABLE IF NOT EXISTS todos_sync_cursors (
      service text NOT NULL,
      cursor_name text NOT NULL,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (service, cursor_name)
    );
