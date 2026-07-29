import { Database } from "bun:sqlite";
import { customAlphabet } from "nanoid";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECTS_HOME_ENV,
  assertProjectWorkspaceId,
  getProjectsHome as getCanonicalProjectsHome,
  projectDataStorePath,
} from "../lib/project-store-paths.js";
import type { JsonObject, Workspace } from "../types/workspace.js";

export { PROJECTS_HOME_ENV } from "../lib/project-store-paths.js";
export const PROJECT_STORE_SCHEMA_VERSION = 2 as const;
export const LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA = "hasna.projects_legacy_canvas_export.v1" as const;
export const PROJECT_STORE_TABLES = [
  "project_meta",
  "project_store_migrations",
  "project_data_models",
  "project_data_records",
  "project_loop_links",
] as const;
const LEGACY_PROJECT_CANVAS_TABLE = "project_canvases" as const;
const LOOPS_SDK_SPECIFIER: string = "@hasna/loops/sdk";

const nanoid = customAlphabet(`0123456789${"abcdefghijklmnopqrstuvwxyz"}`, 12);

export type ProjectStoreTable = (typeof PROJECT_STORE_TABLES)[number];
export type ProjectStoreProject = Pick<Workspace, "id" | "name" | "slug" | "status" | "kind" | "primary_path">;

export interface ProjectStorePaths extends JsonObject {
  project_id: string;
  home_dir: string;
  project_dir: string;
  db_path: string;
  assets_dir: string;
}

export interface LegacyProjectCanvasNode extends JsonObject {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: JsonObject;
  width?: number;
  height?: number;
}

export interface LegacyProjectCanvasEdge extends JsonObject {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  type?: string;
  data?: JsonObject;
}

export interface LegacyProjectCanvasMigrationRecord extends JsonObject {
  id: string;
  source_ref: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  layout_engine: string;
  viewport: JsonObject;
  nodes: LegacyProjectCanvasNode[];
  edges: LegacyProjectCanvasEdge[];
  data: JsonObject;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface LegacyProjectCanvasStorage extends JsonObject {
  state: "absent" | "present";
  read_only: true;
  table: typeof LEGACY_PROJECT_CANVAS_TABLE;
  table_exists: boolean;
  record_count: number;
  db_path: string;
  files_path: string;
  files_path_exists: boolean;
  export_schema: typeof LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA;
}

export interface LegacyProjectCanvasMigrationSource extends JsonObject {
  schema: typeof LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA;
  project_id: string;
  read_only: true;
  source: LegacyProjectCanvasStorage;
  canvases: LegacyProjectCanvasMigrationRecord[];
}

export interface ProjectDataModel extends JsonObject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  schema: JsonObject;
  ui_schema: JsonObject;
  render_spec: JsonObject | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectDataModelInput {
  name: string;
  slug?: string;
  description?: string;
  schema?: JsonObject;
  ui_schema?: JsonObject;
  render_spec?: JsonObject;
  metadata?: JsonObject;
}

export interface ProjectDataRecord extends JsonObject {
  id: string;
  model_id: string;
  key: string;
  title: string | null;
  data: JsonObject;
  render_spec: JsonObject | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectDataRecordInput {
  model_id: string;
  key?: string;
  title?: string;
  data?: JsonObject;
  render_spec?: JsonObject;
  metadata?: JsonObject;
}

export interface ProjectLoopLink extends JsonObject {
  id: string;
  loop_id: string;
  loop_name: string | null;
  role: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface LinkProjectLoopInput {
  loop_id: string;
  loop_name?: string;
  role?: string;
  metadata?: JsonObject;
}

export interface ProjectLoopRunSummary extends JsonObject {
  id: string;
  scheduled_for: string;
  attempt: number;
  status: string;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  duration_ms?: number;
  error?: string;
}

export interface ProjectLoopSummary extends JsonObject {
  link: ProjectLoopLink;
  status: "linked" | "missing" | "unavailable";
  loop: JsonObject | null;
  runs: ProjectLoopRunSummary[];
  error?: string;
}

export interface ProjectStoreSummary extends JsonObject {
  project_id: string;
  paths: ProjectStorePaths;
  exists: boolean;
  schema_version: number | null;
  counts: {
    data_models: number;
    data_records: number;
    loop_links: number;
  };
  legacy_canvas_storage: LegacyProjectCanvasStorage;
  loops?: ProjectLoopSummary[];
}

export interface LoopsClientLike {
  get(idOrName: string): unknown;
  runs(loopId?: string): unknown[];
  close?(): void;
}

interface LegacyProjectCanvasRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  layout_engine: string;
  viewport_json: string;
  nodes_json: string;
  edges_json: string;
  data_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ProjectDataModelRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  schema_json: string;
  ui_schema_json: string;
  render_spec_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ProjectDataRecordRow {
  id: string;
  model_id: string;
  key: string;
  title: string | null;
  data_json: string;
  render_spec_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ProjectLoopLinkRow {
  id: string;
  loop_id: string;
  loop_name: string | null;
  role: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString();
}

function projectIdOf(project: string | Pick<Workspace, "id">): string {
  const projectId = typeof project === "string" ? project : project.id;
  try {
    return assertProjectWorkspaceId(projectId);
  } catch {
    throw new Error(`Invalid project id for project store path: ${projectId}`);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function uniqueSlug(table: "project_data_models", base: string, db: Database): string {
  let candidate = slugify(base);
  let suffix = 1;
  while (true) {
    const row = db.query(`SELECT id FROM ${table} WHERE slug = ?`).get(candidate) as { id: string } | null;
    if (!row) return candidate;
    suffix++;
    candidate = `${slugify(base)}-${suffix}`;
  }
}

function rowToLegacyCanvas(projectId: string, row: LegacyProjectCanvasRow): LegacyProjectCanvasMigrationRecord {
  return {
    id: row.id,
    source_ref: `projects-legacy-canvas://${encodeURIComponent(projectId)}/${encodeURIComponent(row.id)}`,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    layout_engine: row.layout_engine,
    viewport: parseJson<JsonObject>(row.viewport_json, {}),
    nodes: parseJson<LegacyProjectCanvasNode[]>(row.nodes_json, []),
    edges: parseJson<LegacyProjectCanvasEdge[]>(row.edges_json, []),
    data: parseJson<JsonObject>(row.data_json, {}),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToDataModel(row: ProjectDataModelRow): ProjectDataModel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    schema: parseJson<JsonObject>(row.schema_json, {}),
    ui_schema: parseJson<JsonObject>(row.ui_schema_json, {}),
    render_spec: parseJson<JsonObject | null>(row.render_spec_json, null),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToDataRecord(row: ProjectDataRecordRow): ProjectDataRecord {
  return {
    id: row.id,
    model_id: row.model_id,
    key: row.key,
    title: row.title,
    data: parseJson<JsonObject>(row.data_json, {}),
    render_spec: parseJson<JsonObject | null>(row.render_spec_json, null),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToLoopLink(row: ProjectLoopLinkRow): ProjectLoopLink {
  return {
    id: row.id,
    loop_id: row.loop_id,
    loop_name: row.loop_name,
    role: row.role,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function closeIfOwned(db: Database, owned: boolean): void {
  if (owned) db.close();
}

function openDbForProject(project: string | Pick<Workspace, "id">, db?: Database): { db: Database; owned: boolean } {
  if (db) return { db, owned: false };
  return { db: getProjectDatabase(project), owned: true };
}

export function getProjectsHome(): string {
  return getCanonicalProjectsHome();
}

export function getProjectStorePaths(project: string | Pick<Workspace, "id">): ProjectStorePaths {
  const projectId = projectIdOf(project);
  const homeDir = getProjectsHome();
  const projectDir = projectDataStorePath(projectId);
  return {
    project_id: projectId,
    home_dir: homeDir,
    project_dir: projectDir,
    db_path: join(projectDir, "project.db"),
    assets_dir: join(projectDir, "assets"),
  };
}

export function ensureProjectStoreDirs(project: string | Pick<Workspace, "id">): ProjectStorePaths {
  const paths = getProjectStorePaths(project);
  mkdirSync(paths.project_dir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.assets_dir, { recursive: true, mode: 0o700 });
  return paths;
}

export function runProjectStoreMigrations(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS project_store_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrated = db.query("SELECT id FROM project_store_migrations WHERE id = 2").get();
  if (migrated) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_data_models (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      schema_json TEXT NOT NULL DEFAULT '{}',
      ui_schema_json TEXT NOT NULL DEFAULT '{}',
      render_spec_json TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_data_records (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES project_data_models(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      title TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      render_spec_json TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(model_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_project_data_records_model ON project_data_records(model_id);

    CREATE TABLE IF NOT EXISTS project_loop_links (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL UNIQUE,
      loop_name TEXT,
      role TEXT NOT NULL DEFAULT 'project-loop',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_loop_links_role ON project_loop_links(role);

    INSERT OR REPLACE INTO project_meta (key, value_json, updated_at)
      VALUES ('schema_version', '2', datetime('now'));
    INSERT OR IGNORE INTO project_store_migrations (id) VALUES (2);
  `);
}

export function getProjectDatabase(project: string | Pick<Workspace, "id">): Database {
  const paths = ensureProjectStoreDirs(project);
  const db = new Database(paths.db_path);
  db.run("PRAGMA busy_timeout=5000");
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  runProjectStoreMigrations(db);
  return db;
}

export function ensureProjectStore(project: string | Pick<Workspace, "id">): ProjectStoreSummary {
  const db = getProjectDatabase(project);
  try {
    return inspectProjectStore(project, { db });
  } finally {
    db.close();
  }
}

export function createProjectDataModel(project: string | Pick<Workspace, "id">, input: CreateProjectDataModelInput, db?: Database): ProjectDataModel {
  const opened = openDbForProject(project, db);
  try {
    const id = `pdm_${nanoid()}`;
    const ts = now();
    const slug = uniqueSlug("project_data_models", input.slug ?? input.name, opened.db);
    opened.db.run(
      `INSERT INTO project_data_models (
        id, slug, name, description, schema_json, ui_schema_json,
        render_spec_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        slug,
        input.name,
        input.description ?? null,
        json(input.schema ?? {}),
        json(input.ui_schema ?? {}),
        input.render_spec ? json(input.render_spec) : null,
        json(input.metadata ?? {}),
        ts,
        ts,
      ],
    );
    return getProjectDataModel(project, id, opened.db)!;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function listProjectDataModels(project: string | Pick<Workspace, "id">, db?: Database): ProjectDataModel[] {
  const opened = openDbForProject(project, db);
  try {
    const rows = opened.db
      .query<ProjectDataModelRow, []>("SELECT * FROM project_data_models ORDER BY updated_at DESC")
      .all();
    return rows.map(rowToDataModel);
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function getProjectDataModel(project: string | Pick<Workspace, "id">, idOrSlug: string, db?: Database): ProjectDataModel | null {
  const opened = openDbForProject(project, db);
  try {
    const row = opened.db
      .query<ProjectDataModelRow, [string, string]>("SELECT * FROM project_data_models WHERE id = ? OR slug = ? LIMIT 1")
      .get(idOrSlug, idOrSlug);
    return row ? rowToDataModel(row) : null;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function createProjectDataRecord(project: string | Pick<Workspace, "id">, input: CreateProjectDataRecordInput, db?: Database): ProjectDataRecord {
  const opened = openDbForProject(project, db);
  try {
    const id = `pdr_${nanoid()}`;
    const ts = now();
    const key = input.key ?? id;
    opened.db.run(
      `INSERT INTO project_data_records (
        id, model_id, key, title, data_json, render_spec_json,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.model_id,
        key,
        input.title ?? null,
        json(input.data ?? {}),
        input.render_spec ? json(input.render_spec) : null,
        json(input.metadata ?? {}),
        ts,
        ts,
      ],
    );
    return getProjectDataRecord(project, input.model_id, key, opened.db)!;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function listProjectDataRecords(project: string | Pick<Workspace, "id">, modelId: string, db?: Database): ProjectDataRecord[] {
  const opened = openDbForProject(project, db);
  try {
    const rows = opened.db
      .query<ProjectDataRecordRow, [string]>("SELECT * FROM project_data_records WHERE model_id = ? ORDER BY updated_at DESC")
      .all(modelId);
    return rows.map(rowToDataRecord);
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function getProjectDataRecord(project: string | Pick<Workspace, "id">, modelId: string, keyOrId: string, db?: Database): ProjectDataRecord | null {
  const opened = openDbForProject(project, db);
  try {
    const row = opened.db
      .query<ProjectDataRecordRow, [string, string, string]>(
        "SELECT * FROM project_data_records WHERE model_id = ? AND (id = ? OR key = ?) LIMIT 1",
      )
      .get(modelId, keyOrId, keyOrId);
    return row ? rowToDataRecord(row) : null;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function linkProjectLoop(project: string | Pick<Workspace, "id">, input: LinkProjectLoopInput, db?: Database): ProjectLoopLink {
  const opened = openDbForProject(project, db);
  try {
    const existing = opened.db
      .query<ProjectLoopLinkRow, [string]>("SELECT * FROM project_loop_links WHERE loop_id = ? LIMIT 1")
      .get(input.loop_id);
    const ts = now();
    if (existing) {
      opened.db.run(
        `UPDATE project_loop_links
         SET loop_name = ?, role = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.loop_name ?? existing.loop_name,
          input.role ?? existing.role,
          json({ ...parseJson<JsonObject>(existing.metadata_json, {}), ...(input.metadata ?? {}) }),
          ts,
          existing.id,
        ],
      );
      return getProjectLoopLink(project, input.loop_id, opened.db)!;
    }
    const id = `plp_${nanoid()}`;
    opened.db.run(
      `INSERT INTO project_loop_links (
        id, loop_id, loop_name, role, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.loop_id,
        input.loop_name ?? null,
        input.role ?? "project-loop",
        json(input.metadata ?? {}),
        ts,
        ts,
      ],
    );
    return getProjectLoopLink(project, input.loop_id, opened.db)!;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function getProjectLoopLink(project: string | Pick<Workspace, "id">, loopId: string, db?: Database): ProjectLoopLink | null {
  const opened = openDbForProject(project, db);
  try {
    const row = opened.db
      .query<ProjectLoopLinkRow, [string, string]>("SELECT * FROM project_loop_links WHERE loop_id = ? OR loop_name = ? LIMIT 1")
      .get(loopId, loopId);
    return row ? rowToLoopLink(row) : null;
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function listProjectLoopLinks(project: string | Pick<Workspace, "id">, db?: Database): ProjectLoopLink[] {
  const opened = openDbForProject(project, db);
  try {
    const rows = opened.db
      .query<ProjectLoopLinkRow, []>("SELECT * FROM project_loop_links ORDER BY role ASC, updated_at DESC")
      .all();
    return rows.map(rowToLoopLink);
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

export function listProjectLoopSummaries(
  project: string | Pick<Workspace, "id">,
  options: { db?: Database; loopsClient?: LoopsClientLike; includeRuns?: boolean; runLimit?: number } = {},
): Promise<ProjectLoopSummary[]> {
  const links = listProjectLoopLinks(project, options.db);
  return withLoopsClient(options.loopsClient, async (client) => {
    return links.map((link) => {
      try {
        const loop = client.get(link.loop_id) ?? (link.loop_name ? client.get(link.loop_name) : undefined);
        const runs = options.includeRuns
          ? client.runs(stringField(loop, "id")).slice(0, options.runLimit ?? 5).map(loopRunSummary)
          : [];
        return {
          link,
          status: "linked" as const,
          loop: loopSummary(loop),
          runs,
        };
      } catch (err) {
        return {
          link,
          status: "missing" as const,
          loop: null,
          runs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }).catch((err) => {
    return links.map((link) => ({
      link,
      status: "unavailable" as const,
      loop: null,
      runs: [],
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}

async function withLoopsClient<T>(provided: LoopsClientLike | undefined, fn: (client: LoopsClientLike) => Promise<T> | T): Promise<T> {
  if (provided) return fn(provided);
  const sdk = await import(LOOPS_SDK_SPECIFIER) as { loops?: () => LoopsClientLike };
  if (typeof sdk.loops !== "function") throw new Error("@hasna/loops/sdk does not export loops()");
  const client = sdk.loops();
  try {
    return await fn(client);
  } finally {
    client.close?.();
  }
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringField(value: unknown, key: string): string {
  const object = objectValue(value);
  const field = object[key];
  return typeof field === "string" ? field : "";
}

function numberField(value: unknown, key: string): number | undefined {
  const object = objectValue(value);
  const field = object[key];
  return typeof field === "number" ? field : undefined;
}

function loopSummary(loop: unknown): JsonObject {
  const object = objectValue(loop);
  return {
    id: stringField(object, "id"),
    name: stringField(object, "name"),
    description: stringField(object, "description") || undefined,
    status: stringField(object, "status"),
    schedule: object.schedule,
    target_type: objectValue(object.target).type,
    next_run_at: stringField(object, "nextRunAt") || undefined,
    retry_scheduled_for: stringField(object, "retryScheduledFor") || undefined,
    expires_at: stringField(object, "expiresAt") || undefined,
    updated_at: stringField(object, "updatedAt"),
  };
}

function loopRunSummary(run: unknown): ProjectLoopRunSummary {
  return {
    id: stringField(run, "id"),
    scheduled_for: stringField(run, "scheduledFor"),
    attempt: numberField(run, "attempt") ?? 0,
    status: stringField(run, "status"),
    started_at: stringField(run, "startedAt") || undefined,
    finished_at: stringField(run, "finishedAt") || undefined,
    exit_code: numberField(run, "exitCode"),
    duration_ms: numberField(run, "durationMs"),
    error: stringField(run, "error") || undefined,
  };
}

export function inspectProjectStore(
  project: string | Pick<Workspace, "id">,
  options: { db?: Database } = {},
): ProjectStoreSummary {
  const paths = getProjectStorePaths(project);
  const exists = existsSync(paths.db_path);
  const opened = openDbForProject(project, options.db);
  try {
    const schemaVersion = opened.db
      .query<{ value_json: string }, []>("SELECT value_json FROM project_meta WHERE key = 'schema_version'")
      .get();
    const counts = {
      data_models: tableCount(opened.db, "project_data_models"),
      data_records: tableCount(opened.db, "project_data_records"),
      loop_links: tableCount(opened.db, "project_loop_links"),
    };
    return {
      project_id: paths.project_id,
      paths,
      exists,
      schema_version: schemaVersion ? Number.parseInt(schemaVersion.value_json, 10) : null,
      counts,
      legacy_canvas_storage: inspectLegacyProjectCanvasStorage(project, opened.db),
    };
  } finally {
    closeIfOwned(opened.db, opened.owned);
  }
}

/**
 * Inventory the retired Projects-owned canvas store without creating, updating,
 * or deleting it. Existing rows and files remain in place until a separately
 * approved Canvases migration consumes the read-only source.
 */
export function inspectLegacyProjectCanvasStorage(
  project: string | Pick<Workspace, "id">,
  db?: Database,
): LegacyProjectCanvasStorage {
  const paths = getProjectStorePaths(project);
  const filesPath = join(paths.project_dir, "canvases");
  const tableExists = db ? hasTable(db, LEGACY_PROJECT_CANVAS_TABLE) : legacyCanvasTableExists(paths.db_path);
  const recordCount = tableExists
    ? db
      ? tableCount(db, LEGACY_PROJECT_CANVAS_TABLE)
      : legacyCanvasRecordCount(paths.db_path)
    : 0;
  const filesPathExists = existsSync(filesPath);
  return {
    state: tableExists || filesPathExists ? "present" : "absent",
    read_only: true,
    table: LEGACY_PROJECT_CANVAS_TABLE,
    table_exists: tableExists,
    record_count: recordCount,
    db_path: paths.db_path,
    files_path: filesPath,
    files_path_exists: filesPathExists,
    export_schema: LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA,
  };
}

/**
 * Read the complete legacy canvas payload for a future migration adapter.
 * This compatibility seam is deliberately read-only and performs no schema
 * migration, writes, remote calls, or Canvases product behavior.
 */
export function readLegacyProjectCanvasMigrationSource(
  project: string | Pick<Workspace, "id">,
): LegacyProjectCanvasMigrationSource {
  const projectId = projectIdOf(project);
  const source = inspectLegacyProjectCanvasStorage(project);
  if (!source.table_exists) {
    return {
      schema: LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA,
      project_id: projectId,
      read_only: true,
      source,
      canvases: [],
    };
  }
  const db = new Database(source.db_path, { readonly: true });
  try {
    const rows = db
      .query<LegacyProjectCanvasRow, []>(
        "SELECT * FROM project_canvases ORDER BY created_at ASC, id ASC",
      )
      .all();
    return {
      schema: LEGACY_PROJECT_CANVAS_EXPORT_SCHEMA,
      project_id: projectId,
      read_only: true,
      source,
      canvases: rows.map((row) => rowToLegacyCanvas(projectId, row)),
    };
  } finally {
    db.close();
  }
}

export async function inspectProjectStoreWithLoops(
  project: string | Pick<Workspace, "id">,
  options: { db?: Database; loopsClient?: LoopsClientLike; includeRuns?: boolean } = {},
): Promise<ProjectStoreSummary> {
  const summary = inspectProjectStore(project, { db: options.db });
  return {
    ...summary,
    loops: await listProjectLoopSummaries(project, {
      db: options.db,
      loopsClient: options.loopsClient,
      includeRuns: options.includeRuns,
    }),
  };
}

function tableCount(db: Database, table: string): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | null;
  return row?.count ?? 0;
}

function hasTable(db: Database, table: string): boolean {
  return Boolean(
    db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table),
  );
}

function legacyCanvasTableExists(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false;
  const db = new Database(dbPath, { readonly: true });
  try {
    return hasTable(db, LEGACY_PROJECT_CANVAS_TABLE);
  } finally {
    db.close();
  }
}

function legacyCanvasRecordCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return tableCount(db, LEGACY_PROJECT_CANVAS_TABLE);
  } finally {
    db.close();
  }
}
