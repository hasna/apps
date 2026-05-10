import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getRemoteApiConfig, normalizeApiUrl } from "./config.js";
import { getPackageVersion } from "./package-version.js";

export const LOCAL_TO_CLOUD_TABLES = [
  "projects",
  "task_lists",
  "plans",
  "agents",
  "sessions",
  "tasks",
  "task_tags",
  "task_dependencies",
  "task_comments",
  "task_history",
  "task_templates",
  "template_tasks",
  "template_versions",
  "dispatches",
  "dispatch_logs",
  "task_checkpoints",
  "task_heartbeats",
  "task_files",
  "task_commits",
  "task_checklists",
  "task_relationships",
  "project_sources",
  "project_agent_roles",
  "handoffs",
  "context_snapshots",
  "task_traces",
  "cycles",
] as const;

export type LocalToCloudTable = typeof LOCAL_TO_CLOUD_TABLES[number];
export type LocalToCloudConflictStrategy = "skip" | "upsert" | "fail";

export interface CreateLocalCloudExportOptions {
  db?: Database;
  tables?: readonly LocalToCloudTable[];
  includeEmptyTables?: boolean;
  generatedAt?: string;
}

export interface LocalCloudExportManifest {
  schemaVersion: 1;
  kind: "hasna.todos.local-sqlite.export";
  package: {
    packageName: "@hasna/todos";
    version: string;
  };
  generatedAt: string;
  mode: "copy-only";
  safety: {
    deletesLocalData: false;
    mutatesLocalData: false;
    localRemainsSource: true;
  };
  tables: Record<string, {
    count: number;
    rows: Record<string, unknown>[];
  }>;
  counts: Record<string, number>;
  totals: {
    tables: number;
    rows: number;
  };
}

export interface PushLocalCloudExportOptions extends CreateLocalCloudExportOptions {
  apiUrl?: string;
  apiKey?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  conflictStrategy?: LocalToCloudConflictStrategy;
  fetchImpl?: typeof fetch;
}

export interface LocalCloudMigrationResult {
  dryRun: boolean;
  endpoint: string | null;
  idempotencyKey: string;
  conflictStrategy: LocalToCloudConflictStrategy;
  manifest: LocalCloudExportManifest;
  response: unknown | null;
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | null;
  return Boolean(row);
}

function stableManifestId(manifest: LocalCloudExportManifest): string {
  const basis = `${manifest.generatedAt}:${manifest.totals.rows}:${Object.entries(manifest.counts).map(([table, count]) => `${table}:${count}`).join(",")}`;
  return `todos-local-${Bun.hash(basis).toString(16)}`;
}

function normalizeConflictStrategy(strategy: string | undefined): LocalToCloudConflictStrategy {
  if (strategy === undefined) return "skip";
  if (strategy === "skip" || strategy === "upsert" || strategy === "fail") return strategy;
  throw new Error("Conflict strategy must be one of: skip, upsert, fail.");
}

export function createLocalCloudExport(
  options: CreateLocalCloudExportOptions = {},
): LocalCloudExportManifest {
  const db = options.db ?? getDatabase();
  const tables = options.tables ?? LOCAL_TO_CLOUD_TABLES;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const tableData: LocalCloudExportManifest["tables"] = {};
  const counts: Record<string, number> = {};

  for (const table of tables) {
    if (!tableExists(db, table)) continue;
    const rows = db.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0 && !options.includeEmptyTables) {
      counts[table] = 0;
      continue;
    }
    tableData[table] = { count: rows.length, rows };
    counts[table] = rows.length;
  }

  const rowCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    schemaVersion: 1,
    kind: "hasna.todos.local-sqlite.export",
    package: {
      packageName: "@hasna/todos",
      version: getPackageVersion(import.meta.url),
    },
    generatedAt,
    mode: "copy-only",
    safety: {
      deletesLocalData: false,
      mutatesLocalData: false,
      localRemainsSource: true,
    },
    tables: tableData,
    counts,
    totals: {
      tables: Object.keys(tableData).length,
      rows: rowCount,
    },
  };
}

export async function pushLocalCloudExport(
  options: PushLocalCloudExportOptions = {},
): Promise<LocalCloudMigrationResult> {
  const manifest = createLocalCloudExport(options);
  const conflictStrategy = normalizeConflictStrategy(options.conflictStrategy);
  const idempotencyKey = options.idempotencyKey ?? stableManifestId(manifest);
  const remote = getRemoteApiConfig();
  const apiUrl = normalizeApiUrl(options.apiUrl) ?? remote.apiUrl;
  const endpoint = apiUrl ? `${apiUrl}/api/imports/local-sqlite` : null;

  if (options.dryRun ?? true) {
    return {
      dryRun: true,
      endpoint,
      idempotencyKey,
      conflictStrategy,
      manifest,
      response: null,
    };
  }

  if (!endpoint) {
    throw new Error("Remote migration requires TODOS_API_URL, config apiUrl, or --api-url.");
  }

  const apiKey = options.apiKey ?? remote.apiKey;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: "copy-only",
      conflictStrategy,
      manifest,
    }),
  });

  const body = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) {
    throw new Error(typeof body === "object" && body && "error" in body ? String(body.error) : `Migration import failed: ${response.status}`);
  }

  return {
    dryRun: false,
    endpoint,
    idempotencyKey,
    conflictStrategy,
    manifest,
    response: body,
  };
}
