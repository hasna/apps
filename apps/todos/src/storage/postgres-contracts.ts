/** Dependency-light Postgres SQL and error contracts. No client or runtime imports. */

export const DEFAULT_TODOS_POSTGRES_SYNC_TABLE = "todos_sync_records";
export const DEFAULT_TODOS_POSTGRES_CURSOR_TABLE = "todos_sync_cursors";

function assertSafeIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`);
  }
}

export function postgresTodosSyncSchemaSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  cursorTableName = DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
): string[] {
  assertSafeIdentifier(tableName);
  assertSafeIdentifier(cursorTableName);
  return [
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      service text NOT NULL,
      object_type text NOT NULL,
      object_id text NOT NULL,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL,
      deleted_at timestamptz,
      source_machine_id text,
      version integer,
      PRIMARY KEY (service, object_type, object_id)
    )`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_updated_idx ON ${tableName} (service, updated_at)`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_task_status_idx ON ${tableName} ((payload->>'status')) WHERE object_type = 'tasks' AND deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_task_project_idx ON ${tableName} ((payload->>'project_id')) WHERE object_type = 'tasks' AND deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_payload_gin ON ${tableName} USING gin (payload jsonb_path_ops)`,
    `CREATE TABLE IF NOT EXISTS ${cursorTableName} (
      service text NOT NULL,
      cursor_name text NOT NULL,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (service, cursor_name)
    )`,
  ];
}

export interface PostgresScopedSlugConflict {
  service: string;
  object_type: "projects" | "task_lists";
  scope: string;
  slug: string;
  object_ids: string[];
  duplicate_count: number;
  issue: "duplicate" | "invalid";
}

export interface PostgresScopedSlugIndexStatus {
  index_name: string;
  is_valid: boolean;
  is_ready: boolean;
}

export class PostgresScopedSlugMigrationConflictError extends Error {
  constructor(public readonly conflicts: PostgresScopedSlugConflict[]) {
    const preview = conflicts.slice(0, 5).map((conflict) =>
      `${conflict.object_type}:${conflict.scope || "global"}:${conflict.slug} [${conflict.object_ids.join(", ")}]`
    ).join("; ");
    super(
      `Scoped slug unique-index preflight found ${conflicts.length} invalid or duplicate slug conflict(s): ${preview}. `
      + "Resolve these records explicitly without deleting history, then rerun todos-serve migrate.",
    );
    this.name = "PostgresScopedSlugMigrationConflictError";
  }
}

export class PostgresScopedSlugIndexBuildError extends Error {
  constructor(public readonly index_name: string, cause: unknown) {
    super(
      `Concurrent scoped-slug index build failed for ${index_name} after a clean duplicate audit. `
      + "No records were rewritten; inspect pg_index for an invalid index, resolve any concurrent duplicate, and rerun todos-serve migrate.",
      { cause },
    );
    this.name = "PostgresScopedSlugIndexBuildError";
  }
}

export function postgresTodosScopedSlugPreflightSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string {
  assertSafeIdentifier(tableName);
  return `/* todos:scoped-slug-duplicate-audit */ WITH candidates AS (
    SELECT service, object_type, COALESCE(payload->>'project_id', '') AS scope,
      jsonb_typeof(payload->'project_id') AS scope_type,
      payload->>'slug' AS slug, jsonb_typeof(payload->'slug') AS slug_type, object_id
    FROM ${tableName}
    WHERE object_type = 'task_lists' AND deleted_at IS NULL
    UNION ALL
    SELECT service, object_type, '' AS scope, NULL::text AS scope_type, payload->>'task_list_id' AS slug,
      jsonb_typeof(payload->'task_list_id') AS slug_type, object_id
    FROM ${tableName}
    WHERE object_type = 'projects' AND deleted_at IS NULL
  ), annotated AS (
    SELECT *, trim(both '-' from regexp_replace(lower(COALESCE(slug, '')), '[^a-z0-9]+', '-', 'g')) AS normalized_slug
    FROM candidates
  ), invalid AS (
    SELECT service, object_type, scope, COALESCE(slug, '<null>') AS slug,
      ARRAY[object_id] AS object_ids, 1::integer AS duplicate_count, 'invalid'::text AS issue
    FROM annotated
    WHERE slug_type IS DISTINCT FROM 'string'
      OR slug IS NULL OR slug = '' OR normalized_slug = '' OR slug IS DISTINCT FROM normalized_slug
      OR (object_type = 'task_lists' AND (
        (scope_type IS NOT NULL AND scope_type NOT IN ('string', 'null'))
        OR (scope_type = 'string' AND btrim(scope) = '')
      ))
  ), duplicates AS (
    SELECT service, object_type, scope, slug,
      array_agg(object_id ORDER BY object_id) AS object_ids,
      count(*)::integer AS duplicate_count, 'duplicate'::text AS issue
    FROM annotated
    WHERE slug = normalized_slug AND slug <> ''
    GROUP BY service, object_type, scope, slug
    HAVING count(*) > 1
  ) SELECT * FROM invalid
    UNION ALL SELECT * FROM duplicates
    ORDER BY service, object_type, scope, slug`;
}

export function postgresTodosScopedSlugUniqueIndexSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string[] {
  assertSafeIdentifier(tableName);
  return [
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${tableName}_task_list_scope_slug_uidx
      ON ${tableName} (service, COALESCE(payload->>'project_id', ''), (payload->>'slug'))
      WHERE object_type = 'task_lists' AND deleted_at IS NULL AND COALESCE(payload->>'slug', '') <> ''`,
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${tableName}_project_task_list_slug_uidx
      ON ${tableName} (service, (payload->>'task_list_id'))
      WHERE object_type = 'projects' AND deleted_at IS NULL AND COALESCE(payload->>'task_list_id', '') <> ''`,
  ];
}

export function postgresTodosScopedSlugIndexStatusSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string {
  assertSafeIdentifier(tableName);
  return `/* todos:scoped-slug-index-status */ SELECT index_class.relname AS index_name,
      index_meta.indisvalid AS is_valid, index_meta.indisready AS is_ready
    FROM pg_index index_meta
    JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
    WHERE index_meta.indrelid = to_regclass('${tableName}')
      AND index_class.relname IN (
        '${tableName}_task_list_scope_slug_uidx',
        '${tableName}_project_task_list_slug_uidx'
      )`;
}

export function postgresTodosCommentCursorIndexSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string {
  assertSafeIdentifier(tableName);
  return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${tableName}_comment_task_created_idx
    ON ${tableName} (service, (payload->>'task_id'), (payload->>'created_at'), object_id)
    WHERE object_type = 'comments' AND deleted_at IS NULL`;
}
