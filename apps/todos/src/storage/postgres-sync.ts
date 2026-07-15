import type { TaskHistory } from "../types/index.js";
import type {
  TodosStorageContext,
  TodosStorageSnapshot,
} from "./interfaces.js";
import { isCanonicalSlug } from "../lib/slugs.js";

export type TodosPostgresSyncRecordType =
  | "tasks"
  | "projects"
  | "project_machine_paths"
  | "plans"
  | "agents"
  | "task_lists"
  | "templates"
  | "audit_history";

export interface TodosPostgresQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface TodosPostgresQueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<TodosPostgresQueryResult<T>>;
}

export interface CreatePostgresTodosSyncStoreOptions {
  service?: string;
  sourceMachineId?: string;
  tableName?: string;
  cursorTableName?: string;
}

export interface PullPostgresTodosSnapshotOptions {
  since?: string;
  objectTypes?: TodosPostgresSyncRecordType[];
}

export interface PostgresTodosSyncPushResult {
  records: number;
  objectTypes: Partial<Record<TodosPostgresSyncRecordType, number>>;
}

export interface TodosPostgresSyncRecordRow {
  object_type: TodosPostgresSyncRecordType;
  object_id?: string;
  payload: unknown;
  updated_at?: string | Date;
  deleted_at?: string | Date | null;
  source_machine_id?: string | null;
  version?: number | null;
}

export const DEFAULT_TODOS_POSTGRES_SYNC_TABLE = "todos_sync_records";
export const DEFAULT_TODOS_POSTGRES_CURSOR_TABLE = "todos_sync_cursors";

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
    // Push task list/count/stats filtering down to Postgres instead of loading the
    // whole tasks table into JS on every request (the O(n) heap load that OOM
    // crash-looped the serve task). These accelerate the jsonb predicates emitted
    // by the postgres adapter's buildTaskFilterSql (status/project_id equality and
    // tags/eq containment via GIN).
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
      `Scoped slug unique-index preflight found ${conflicts.length} invalid or duplicate slug conflict(s): ${preview}. ` +
      "Resolve these records explicitly without deleting history, then rerun todos-serve migrate.",
    );
    this.name = "PostgresScopedSlugMigrationConflictError";
  }
}

export class PostgresScopedSlugIndexBuildError extends Error {
  constructor(public readonly index_name: string, cause: unknown) {
    super(
      `Concurrent scoped-slug index build failed for ${index_name} after a clean duplicate audit. ` +
      "No records were rewritten; inspect pg_index for an invalid index, resolve any concurrent duplicate, and rerun todos-serve migrate.",
      { cause },
    );
    this.name = "PostgresScopedSlugIndexBuildError";
  }
}

/** Read-only duplicate audit used before the predeploy unique-index migration. */
export function postgresTodosScopedSlugPreflightSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string {
  assertSafeIdentifier(tableName);
  return `/* todos:scoped-slug-duplicate-audit */ WITH candidates AS (
    SELECT service, object_type, COALESCE(payload->>'project_id', '') AS scope,
      payload->>'slug' AS slug, jsonb_typeof(payload->'slug') AS slug_type, object_id
    FROM ${tableName}
    WHERE object_type = 'task_lists' AND deleted_at IS NULL
    UNION ALL
    SELECT service, object_type, '' AS scope, payload->>'task_list_id' AS slug,
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

/** Predeploy-only unique indexes. CONCURRENTLY keeps request writes available. */
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

/** Verify IF NOT EXISTS did not hide an invalid index left by an interrupted concurrent build. */
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

/** Audit first, then build both invariants outside any transaction. Never rewrites rows. */
export async function ensurePostgresScopedSlugUniqueIndexes(
  client: TodosPostgresQueryClient,
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): Promise<void> {
  const audit = await client.query<PostgresScopedSlugConflict>(postgresTodosScopedSlugPreflightSql(tableName));
  if (audit.rows.length > 0) throw new PostgresScopedSlugMigrationConflictError(audit.rows);
  for (const sql of postgresTodosScopedSlugUniqueIndexSql(tableName)) {
    try {
      await client.query(sql);
    } catch (error) {
      const indexName = sql.match(/INDEX CONCURRENTLY IF NOT EXISTS ([a-zA-Z0-9_]+)/)?.[1] ?? "unknown_index";
      throw new PostgresScopedSlugIndexBuildError(indexName, error);
    }
  }
  const expected = new Set([
    `${tableName}_task_list_scope_slug_uidx`,
    `${tableName}_project_task_list_slug_uidx`,
  ]);
  const status = await client.query<PostgresScopedSlugIndexStatus>(postgresTodosScopedSlugIndexStatusSql(tableName));
  for (const indexName of expected) {
    const row = status.rows.find((candidate) => candidate.index_name === indexName);
    if (!row?.is_valid || !row.is_ready) {
      throw new PostgresScopedSlugIndexBuildError(indexName, new Error("index is missing, invalid, or not ready"));
    }
  }
}

/**
 * Predeploy-only comment cursor index. CONCURRENTLY avoids blocking writes on
 * the shared sync table and must run outside a transaction before app rollout;
 * it is deliberately excluded from request-path `ensureSchema()`.
 */
export function postgresTodosCommentCursorIndexSql(
  tableName = DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
): string {
  assertSafeIdentifier(tableName);
  return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${tableName}_comment_task_created_idx
    ON ${tableName} (service, (payload->>'task_id'), (payload->>'created_at'), object_id)
    WHERE object_type = 'comments' AND deleted_at IS NULL`;
}

export class PostgresTodosSyncStore {
  private readonly service: string;
  private readonly sourceMachineId?: string;
  private readonly tableName: string;
  private readonly cursorTableName: string;

  constructor(
    private readonly client: TodosPostgresQueryClient,
    options: CreatePostgresTodosSyncStoreOptions = {},
  ) {
    this.service = options.service ?? "todos";
    this.sourceMachineId = options.sourceMachineId;
    this.tableName = options.tableName ?? DEFAULT_TODOS_POSTGRES_SYNC_TABLE;
    this.cursorTableName = options.cursorTableName ?? DEFAULT_TODOS_POSTGRES_CURSOR_TABLE;
    assertSafeIdentifier(this.tableName);
    assertSafeIdentifier(this.cursorTableName);
  }

  async ensureSchema(): Promise<void> {
    for (const sql of postgresTodosSyncSchemaSql(this.tableName, this.cursorTableName)) {
      await this.client.query(sql);
    }
  }

  async pushSnapshot(
    snapshot: TodosStorageSnapshot,
    context: TodosStorageContext = {},
  ): Promise<PostgresTodosSyncPushResult> {
    const result: PostgresTodosSyncPushResult = { records: 0, objectTypes: {} };
    const sourceMachineId = context.requestId ?? this.sourceMachineId ?? null;
    for (const entry of snapshotEntries(snapshot)) {
      if (entry.deletedAt === null) assertCanonicalScopedSlugEntry(entry);
      await this.client.query(
        `INSERT INTO ${this.tableName} (
          service, object_type, object_id, payload, updated_at,
          deleted_at, source_machine_id, version
        ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7, $8)
        ON CONFLICT (service, object_type, object_id) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          source_machine_id = EXCLUDED.source_machine_id,
          version = EXCLUDED.version
        WHERE ${this.tableName}.updated_at < EXCLUDED.updated_at
           OR (${this.tableName}.updated_at = EXCLUDED.updated_at
               AND COALESCE(${this.tableName}.version, 0) <= COALESCE(EXCLUDED.version, 0))`,
        [
          this.service,
          entry.type,
          entry.id,
          // Bind the object directly — the driver serializes it to jsonb. Pre-
          // encoding with JSON.stringify makes Bun.SQL double-encode into a jsonb
          // string scalar (breaks server-side payload->>'field' filters).
          entry.payload,
          entry.updatedAt,
          entry.deletedAt,
          sourceMachineId,
          entry.version,
        ],
      );
      result.records += 1;
      result.objectTypes[entry.type] = (result.objectTypes[entry.type] ?? 0) + 1;
    }
    return result;
  }

  async pullSnapshot(options: PullPostgresTodosSnapshotOptions = {}): Promise<TodosStorageSnapshot> {
    const params: unknown[] = [this.service];
    const filters = ["service = $1"];
    if (options.since) {
      params.push(options.since);
      filters.push(`updated_at > $${params.length}::timestamptz`);
    }
    if (options.objectTypes?.length) {
      params.push(options.objectTypes);
      filters.push(`object_type = ANY($${params.length}::text[])`);
    }

    const response = await this.client.query<TodosPostgresSyncRecordRow>(
      `SELECT object_type, object_id, payload, updated_at, deleted_at, source_machine_id, version FROM ${this.tableName}
       WHERE ${filters.join(" AND ")}
       ORDER BY updated_at ASC, object_type ASC, object_id ASC`,
      params,
    );

    return rowsToSnapshot(response.rows);
  }

  async getCursor(name: string): Promise<string | null> {
    const result = await this.client.query<{ value: string }>(
      `SELECT value FROM ${this.cursorTableName} WHERE service = $1 AND cursor_name = $2`,
      [this.service, name],
    );
    return result.rows[0]?.value ?? null;
  }

  async setCursor(name: string, value: string): Promise<void> {
    await this.client.query(
      `INSERT INTO ${this.cursorTableName} (service, cursor_name, value, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (service, cursor_name) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at`,
      [this.service, name, value],
    );
  }
}

export function createPostgresTodosSyncStore(
  client: TodosPostgresQueryClient,
  options: CreatePostgresTodosSyncStoreOptions = {},
): PostgresTodosSyncStore {
  return new PostgresTodosSyncStore(client, options);
}

function snapshotEntries(snapshot: TodosStorageSnapshot): Array<{
  type: TodosPostgresSyncRecordType;
  id: string;
  payload: unknown;
  updatedAt: string;
  deletedAt: string | null;
  version: number | null;
}> {
  return [
    ...snapshot.tasks.map((payload) => entry("tasks", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.projects.map((payload) => entry("projects", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...(snapshot.projectMachinePaths ?? []).map((payload) => entry("project_machine_paths", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.plans.map((payload) => entry("plans", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.agents.map((payload) => entry("agents", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.taskLists.map((payload) => entry("task_lists", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.templates.map((payload) => entry("templates", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...snapshot.auditHistory.map((payload) => entry("audit_history", payload as unknown as Record<string, unknown>, snapshot.exportedAt)),
    ...(snapshot.tombstones ?? []).map((tombstone) => ({
      type: tombstone.object_type,
      id: tombstone.object_id,
      payload: tombstone.payload ?? { id: tombstone.object_id, deleted_at: tombstone.deleted_at },
      updatedAt: tombstone.updated_at || tombstone.deleted_at,
      deletedAt: tombstone.deleted_at,
      version: tombstone.version ?? null,
    })),
  ];
}

function assertCanonicalScopedSlugEntry(entry: { type: TodosPostgresSyncRecordType; payload: unknown }): void {
  if (!entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return;
  const payload = entry.payload as Record<string, unknown>;
  if (entry.type === "projects" && !isCanonicalSlug(payload["task_list_id"])) {
    throw new Error("Invalid project task-list slug — sync requires non-empty canonical kebab-case");
  }
  if (entry.type === "task_lists" && !isCanonicalSlug(payload["slug"])) {
    throw new Error("Invalid task-list slug — sync requires non-empty canonical kebab-case");
  }
}

function entry(type: TodosPostgresSyncRecordType, payload: Record<string, unknown>, fallbackUpdatedAt: string) {
  const id = payload["id"];
  if (typeof id !== "string" || !id) throw new Error(`${type} record is missing a stable id`);
  return {
    type,
    id,
    payload,
    updatedAt: stringValue(payload["updated_at"]) ?? stringValue(payload["created_at"]) ?? fallbackUpdatedAt,
    deletedAt: stringValue(payload["deleted_at"]),
    version: numberValue(payload["version"]),
  };
}

function rowsToSnapshot(rows: TodosPostgresSyncRecordRow[]): TodosStorageSnapshot {
  const snapshot: TodosStorageSnapshot = {
    exportedAt: new Date().toISOString(),
    source: "postgres",
    tasks: [],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [],
    templates: [],
    auditHistory: [],
    tombstones: [],
  };

  for (const row of rows) {
    const payload = payloadRecord(row.payload);
    const deletedAt = stringValue(row.deleted_at);
    if (deletedAt) {
      snapshot.tombstones ??= [];
      snapshot.tombstones.push({
        object_type: row.object_type,
        object_id: stringValue(row.object_id) ?? stringValue(payload["id"]) ?? "",
        deleted_at: deletedAt,
        updated_at: stringValue(row.updated_at) ?? deletedAt,
        source_machine_id: stringValue(row.source_machine_id),
        payload,
        version: numberValue(row.version),
      });
      continue;
    }
    if (row.object_type === "tasks") snapshot.tasks.push(payload as unknown as TodosStorageSnapshot["tasks"][number]);
    else if (row.object_type === "projects") snapshot.projects.push(payload as unknown as TodosStorageSnapshot["projects"][number]);
    else if (row.object_type === "project_machine_paths") {
      snapshot.projectMachinePaths ??= [];
      snapshot.projectMachinePaths.push(payload as unknown as NonNullable<TodosStorageSnapshot["projectMachinePaths"]>[number]);
    }
    else if (row.object_type === "plans") snapshot.plans.push(payload as unknown as TodosStorageSnapshot["plans"][number]);
    else if (row.object_type === "agents") snapshot.agents.push(payload as unknown as TodosStorageSnapshot["agents"][number]);
    else if (row.object_type === "task_lists") snapshot.taskLists.push(payload as unknown as TodosStorageSnapshot["taskLists"][number]);
    else if (row.object_type === "templates") snapshot.templates.push(payload as unknown as TodosStorageSnapshot["templates"][number]);
    else if (row.object_type === "audit_history") snapshot.auditHistory.push(payload as unknown as TaskHistory);
  }
  return snapshot;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("Postgres sync payload must be a JSON object");
}

function stringValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function assertSafeIdentifier(value: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe Postgres identifier: ${value}`);
}
