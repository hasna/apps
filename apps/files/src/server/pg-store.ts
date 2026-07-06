/**
 * PURE REMOTE (Amendment A1) Postgres data layer for the open-files service.
 *
 * The HTTP `/v1` surface reads AND writes cloud Postgres directly through the
 * vendored storage kit — there is no local SQLite cache or sync engine in the
 * running service. A missing/invalid DATABASE_URL is a hard, explicit error
 * (never a silent no-op).
 */
import { nanoid } from "nanoid";
import { createCloudPoolFromEnv } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { sanitizeSourceConfig } from "../db/sources.js";
import type {
  Collection,
  FileWithTags,
  Machine,
  Project,
  Source,
  SourceType,
  Tag,
} from "../types/index.js";

const APP = "files";

let cached: { client: TypedQueryClient; connectionSource: string } | null = null;

/** Lazily build (and memoize) the cloud pool. Throws when not in cloud mode. */
export function getCloudClient(): TypedQueryClient {
  if (cached) return cached.client;
  const pool = createCloudPoolFromEnv(APP, { applicationName: "files-serve", max: 5 });
  cached = { client: pool.client, connectionSource: pool.connectionSource };
  return cached.client;
}

/** True when the service is configured for cloud (RDS) mode. */
export function cloudEnabled(): boolean {
  const token = "FILES";
  const mode = process.env[`HASNA_${token}_STORAGE_MODE`] ?? process.env[`${token}_STORAGE_MODE`];
  const url = process.env[`HASNA_${token}_DATABASE_URL`] ?? process.env[`${token}_DATABASE_URL`];
  return (mode === "cloud" || mode === "remote" || mode === "hybrid") && Boolean(url);
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

// ── Machines ────────────────────────────────────────────────────────────────
function toMachine(r: Record<string, unknown>): Machine {
  return {
    id: String(r.id),
    name: String(r.name),
    hostname: String(r.hostname),
    platform: String(r.platform),
    arch: String(r.arch),
    is_current: Boolean(r.is_current),
    last_seen: String(r.last_seen),
    created_at: String(r.created_at),
  };
}

export async function listMachines(client: TypedQueryClient): Promise<Machine[]> {
  const rows = await client.many<Record<string, unknown>>("SELECT * FROM machines ORDER BY created_at DESC");
  return rows.map(toMachine);
}

/** Ensure a service-side machine row exists (sources reference machine_id). */
export async function ensureServiceMachine(client: TypedQueryClient): Promise<Machine> {
  const existing = await client.get<Record<string, unknown>>(
    "SELECT * FROM machines WHERE id = $1",
    ["files-serve"],
  );
  if (existing) return toMachine(existing);
  await client.execute(
    `INSERT INTO machines (id, name, hostname, platform, arch, is_current)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
    ["files-serve", "files-serve", "files-serve", "linux", "arm64", false],
  );
  const row = await client.get<Record<string, unknown>>("SELECT * FROM machines WHERE id = $1", ["files-serve"]);
  return toMachine(row!);
}

// ── Sources ───────────────────────────────────────────────────────────────
function toSource(r: Record<string, unknown>): Source {
  return {
    id: String(r.id),
    name: String(r.name),
    type: String(r.type) as SourceType,
    path: r.path == null ? undefined : String(r.path),
    bucket: r.bucket == null ? undefined : String(r.bucket),
    prefix: r.prefix == null ? undefined : String(r.prefix),
    region: r.region == null ? undefined : String(r.region),
    config: sanitizeSourceConfig(parseJson(r.config, {})),
    machine_id: String(r.machine_id),
    enabled: Boolean(r.enabled),
    last_indexed_at: r.last_indexed_at == null ? undefined : String(r.last_indexed_at),
    file_count: Number(r.file_count ?? 0),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listSources(client: TypedQueryClient, machineId?: string): Promise<Source[]> {
  const rows = machineId
    ? await client.many<Record<string, unknown>>("SELECT * FROM sources WHERE machine_id = $1 ORDER BY created_at DESC", [machineId])
    : await client.many<Record<string, unknown>>("SELECT * FROM sources ORDER BY created_at DESC");
  return rows.map(toSource);
}

export async function getSource(client: TypedQueryClient, id: string): Promise<Source | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM sources WHERE id = $1", [id]);
  return row ? toSource(row) : null;
}

export interface CreateSourceInput {
  name?: string;
  type?: SourceType;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  config?: Record<string, unknown>;
  machine_id?: string;
}

export async function createSource(client: TypedQueryClient, input: CreateSourceInput): Promise<Source> {
  const type = input.type ?? "local";
  const machine = input.machine_id ?? (await ensureServiceMachine(client)).id;
  const id = `src_${nanoid(10)}`;
  const name = input.name ?? input.bucket ?? input.path ?? id;
  // Never persist static S3 credentials (contract: cloud runtime credentials only).
  const config = sanitizeSourceConfig(input.config ?? {});
  await client.execute(
    `INSERT INTO sources (id, name, type, path, bucket, prefix, region, config, machine_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, name, type, input.path ?? null, input.bucket ?? null, input.prefix ?? null,
     input.region ?? null, JSON.stringify(config), machine],
  );
  return (await getSource(client, id))!;
}

export async function deleteSource(client: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getSource(client, id);
  if (!existing) return false;
  await client.execute("DELETE FROM sources WHERE id = $1", [id]);
  return true;
}

// ── Files ─────────────────────────────────────────────────────────────────
async function fileTags(client: TypedQueryClient, fileId: string): Promise<string[]> {
  const rows = await client.many<{ name: string }>(
    `SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id = t.id WHERE ft.file_id = $1 ORDER BY t.name`,
    [fileId],
  );
  return rows.map((r) => r.name);
}

function toFile(r: Record<string, unknown>, tags: string[]): FileWithTags {
  return {
    id: String(r.id),
    source_id: String(r.source_id),
    machine_id: String(r.machine_id),
    path: String(r.path),
    name: String(r.name),
    original_name: r.original_name == null ? undefined : String(r.original_name),
    canonical_name: r.canonical_name == null ? undefined : String(r.canonical_name),
    ext: String(r.ext ?? ""),
    size: Number(r.size ?? 0),
    mime: String(r.mime ?? "application/octet-stream"),
    description: r.description == null ? undefined : String(r.description),
    hash: r.hash == null ? undefined : String(r.hash),
    status: String(r.status) as FileWithTags["status"],
    indexed_at: String(r.indexed_at),
    modified_at: r.modified_at == null ? undefined : String(r.modified_at),
    created_at: String(r.created_at),
    tags,
  };
}

export interface ListFilesQuery {
  source_id?: string;
  machine_id?: string;
  ext?: string;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listFiles(client: TypedQueryClient, opts: ListFilesQuery): Promise<FileWithTags[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace("$?", `$${params.length}`)); };
  add("status = $?", opts.status ?? "active");
  if (opts.source_id) add("source_id = $?", opts.source_id);
  if (opts.machine_id) add("machine_id = $?", opts.machine_id);
  if (opts.ext) add("ext = $?", opts.ext);
  if (opts.q) add("(name ILIKE $? OR path ILIKE $?)".replace("$?", `$${params.length + 1}`).replace("$?", `$${params.length + 1}`), `%${opts.q}%`);
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 500);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const sql = `SELECT * FROM files WHERE ${where.join(" AND ")} ORDER BY indexed_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const rows = await client.many<Record<string, unknown>>(sql, params);
  const out: FileWithTags[] = [];
  for (const r of rows) out.push(toFile(r, await fileTags(client, String(r.id))));
  return out;
}

export async function getFile(client: TypedQueryClient, id: string): Promise<FileWithTags | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM files WHERE id = $1", [id]);
  if (!row) return null;
  return toFile(row, await fileTags(client, id));
}

// ── Tags ────────────────────────────────────────────────────────────────────
export async function listTags(client: TypedQueryClient): Promise<Tag[]> {
  const rows = await client.many<Record<string, unknown>>("SELECT * FROM tags ORDER BY name");
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), color: String(r.color ?? "#6366f1"), created_at: String(r.created_at) }));
}

async function getOrCreateTag(client: TypedQueryClient, name: string): Promise<string> {
  const existing = await client.get<{ id: string }>("SELECT id FROM tags WHERE name = $1", [name]);
  if (existing) return existing.id;
  const id = `tag_${nanoid(10)}`;
  await client.execute("INSERT INTO tags (id, name) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING", [id, name]);
  const row = await client.get<{ id: string }>("SELECT id FROM tags WHERE name = $1", [name]);
  return row!.id;
}

export async function tagFile(client: TypedQueryClient, fileId: string, name: string): Promise<void> {
  const tagId = await getOrCreateTag(client, name);
  await client.execute("INSERT INTO file_tags (file_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [fileId, tagId]);
}

export async function untagFile(client: TypedQueryClient, fileId: string, name: string): Promise<void> {
  await client.execute(
    "DELETE FROM file_tags WHERE file_id = $1 AND tag_id = (SELECT id FROM tags WHERE name = $2)",
    [fileId, name],
  );
}

// ── Collections ──────────────────────────────────────────────────────────────
function toCollection(r: Record<string, unknown>): Collection {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ""),
    parent_id: r.parent_id == null ? undefined : String(r.parent_id),
    auto_rules: parseJson(r.auto_rules, undefined),
    metadata: parseJson(r.metadata, undefined),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listCollections(client: TypedQueryClient): Promise<Collection[]> {
  const rows = await client.many<Record<string, unknown>>("SELECT * FROM collections ORDER BY created_at DESC");
  return rows.map(toCollection);
}

export async function createCollection(client: TypedQueryClient, name: string, description?: string): Promise<Collection> {
  const id = `col_${nanoid(10)}`;
  await client.execute("INSERT INTO collections (id, name, description) VALUES ($1,$2,$3)", [id, name, description ?? ""]);
  return (await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE id = $1", [id]).then((r) => toCollection(r!)));
}

export async function addToCollection(client: TypedQueryClient, collectionId: string, fileId: string): Promise<void> {
  await client.execute("INSERT INTO collection_files (collection_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [collectionId, fileId]);
}

export async function removeFromCollection(client: TypedQueryClient, collectionId: string, fileId: string): Promise<void> {
  await client.execute("DELETE FROM collection_files WHERE collection_id = $1 AND file_id = $2", [collectionId, fileId]);
}

// ── Projects ─────────────────────────────────────────────────────────────────
function toProject(r: Record<string, unknown>): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ""),
    status: (r.status == null ? undefined : String(r.status)) as Project["status"],
    metadata: parseJson(r.metadata, undefined),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listProjects(client: TypedQueryClient): Promise<Project[]> {
  const rows = await client.many<Record<string, unknown>>("SELECT * FROM projects ORDER BY created_at DESC");
  return rows.map(toProject);
}

export async function createProject(client: TypedQueryClient, name: string, description?: string): Promise<Project> {
  const id = `prj_${nanoid(10)}`;
  await client.execute("INSERT INTO projects (id, name, description) VALUES ($1,$2,$3)", [id, name, description ?? ""]);
  return (await client.get<Record<string, unknown>>("SELECT * FROM projects WHERE id = $1", [id]).then((r) => toProject(r!)));
}

export async function addToProject(client: TypedQueryClient, projectId: string, fileId: string): Promise<void> {
  await client.execute("INSERT INTO project_files (project_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [projectId, fileId]);
}

export async function removeFromProject(client: TypedQueryClient, projectId: string, fileId: string): Promise<void> {
  await client.execute("DELETE FROM project_files WHERE project_id = $1 AND file_id = $2", [projectId, fileId]);
}

// ── Stats ─────────────────────────────────────────────────────────────────
export async function stats(client: TypedQueryClient): Promise<Record<string, unknown>> {
  const totals = await client.get<Record<string, unknown>>(
    "SELECT COUNT(*)::int AS total_files, COALESCE(SUM(size),0)::bigint AS total_size FROM files WHERE status='active'",
  );
  const byExt = await client.many<Record<string, unknown>>(
    "SELECT ext, COUNT(*)::int AS count FROM files WHERE status='active' GROUP BY ext ORDER BY count DESC LIMIT 20",
  );
  const bySource = await client.many<Record<string, unknown>>(
    "SELECT f.source_id, s.name, COUNT(*)::int AS count FROM files f JOIN sources s ON s.id=f.source_id WHERE f.status='active' GROUP BY f.source_id, s.name ORDER BY count DESC",
  );
  return {
    total_files: Number(totals?.total_files ?? 0),
    total_size: Number(totals?.total_size ?? 0),
    by_ext: byExt,
    by_source: bySource,
  };
}
