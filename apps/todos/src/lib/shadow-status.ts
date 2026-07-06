import type { TodosPostgresQueryClient } from "../storage/postgres-sync.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";

/**
 * Divergence report for the dual-write shadow: how many live rows exist locally
 * versus in the remote Postgres sync tables, and how stale the last mirror is.
 * This is the ONLY place that reads from the remote store, and it is a
 * read-only diagnostic — never a runtime read path.
 */
export interface ShadowStatusObjectCount {
  object_type: string;
  local: number;
  cloud: number;
  cloud_tombstones: number;
  diff: number;
}

export interface ShadowStatusReport {
  service: string;
  cloud_reachable: boolean;
  in_sync: boolean;
  objects: ShadowStatusObjectCount[];
  totals: { local: number; cloud: number; diff: number; cloud_tombstones: number };
  last_mirror_at: string | null;
  last_mirror_lag_ms: number | null;
  error: string | null;
}

const OBJECT_TYPES = [
  "tasks",
  "projects",
  "plans",
  "agents",
  "task_lists",
  "templates",
  "audit_history",
] as const;

interface CloudCountRow {
  object_type: string;
  live: string | number;
  tombstones: string | number;
  last_updated: string | Date | null;
}

async function localCounts(adapter: TodosStorageAdapter): Promise<Record<string, number>> {
  const [tasks, projects, plans, agents, taskLists, templates] = await Promise.all([
    Promise.resolve(adapter.tasks.count({})),
    Promise.resolve(adapter.projects.list()).then((rows) => rows.length),
    Promise.resolve(adapter.plans.list()).then((rows) => rows.length),
    Promise.resolve(adapter.agents.list()).then((rows) => rows.length),
    Promise.resolve(adapter.taskLists.list()).then((rows) => rows.length),
    Promise.resolve(adapter.templates.list()).then((rows) => rows.length),
  ]);
  return {
    tasks,
    projects,
    plans,
    agents,
    task_lists: taskLists,
    templates,
    // audit_history is append-only and not enumerated here; left at 0 locally.
    audit_history: 0,
  };
}

export interface GetTodosShadowStatusOptions {
  local: TodosStorageAdapter;
  cloud: TodosPostgresQueryClient;
  service?: string;
  now?: number;
}

export async function getTodosShadowStatus(
  options: GetTodosShadowStatusOptions,
): Promise<ShadowStatusReport> {
  const service = options.service ?? "todos";
  const now = options.now ?? Date.now();
  const local = await localCounts(options.local);

  const report: ShadowStatusReport = {
    service,
    cloud_reachable: false,
    in_sync: false,
    objects: [],
    totals: { local: 0, cloud: 0, diff: 0, cloud_tombstones: 0 },
    last_mirror_at: null,
    last_mirror_lag_ms: null,
    error: null,
  };

  const cloud: Record<string, { live: number; tombstones: number }> = {};
  try {
    const result = await options.cloud.query<CloudCountRow>(
      `SELECT object_type,
              count(*) FILTER (WHERE deleted_at IS NULL) AS live,
              count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstones,
              max(updated_at) AS last_updated
         FROM todos_sync_records
        WHERE service = $1
        GROUP BY object_type`,
      [service],
    );
    report.cloud_reachable = true;
    let lastUpdated: number | null = null;
    for (const row of result.rows) {
      cloud[row.object_type] = {
        live: toInt(row.live),
        tombstones: toInt(row.tombstones),
      };
      const updatedMs = toMillis(row.last_updated);
      if (updatedMs !== null && (lastUpdated === null || updatedMs > lastUpdated)) {
        lastUpdated = updatedMs;
      }
    }
    if (lastUpdated !== null) {
      report.last_mirror_at = new Date(lastUpdated).toISOString();
      report.last_mirror_lag_ms = Math.max(0, now - lastUpdated);
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }

  for (const objectType of OBJECT_TYPES) {
    const localCount = local[objectType] ?? 0;
    const cloudEntry = cloud[objectType] ?? { live: 0, tombstones: 0 };
    const entry: ShadowStatusObjectCount = {
      object_type: objectType,
      local: localCount,
      cloud: cloudEntry.live,
      cloud_tombstones: cloudEntry.tombstones,
      diff: localCount - cloudEntry.live,
    };
    report.objects.push(entry);
    report.totals.local += entry.local;
    report.totals.cloud += entry.cloud;
    report.totals.cloud_tombstones += entry.cloud_tombstones;
  }
  report.totals.diff = report.totals.local - report.totals.cloud;
  // audit_history has no local enumeration, so exclude it from the in-sync gate.
  report.in_sync = report.objects
    .filter((entry) => entry.object_type !== "audit_history")
    .every((entry) => entry.diff === 0);
  return report;
}

function toInt(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMillis(value: string | Date | null): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
