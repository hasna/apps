import type { TaskHistory } from "../types/index.js";
import type {
  TodosStorageContext,
  TodosStorageSnapshot,
} from "./interfaces.js";

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
          JSON.stringify(entry.payload),
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
