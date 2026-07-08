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
import { generateCanonicalName } from "../lib/normalize.js";
import type { ActionType, AutoRules } from "../types/index.js";
import type {
  Agent,
  AgentActivity,
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

/** The machine that "owns" the cloud client — the service row. */
export async function currentMachine(client: TypedQueryClient): Promise<Machine> {
  const current = await client.get<Record<string, unknown>>("SELECT * FROM machines WHERE is_current = true LIMIT 1");
  if (current) return toMachine(current);
  return ensureServiceMachine(client);
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

export interface UpdateSourceInput {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
}

export async function updateSource(
  client: TypedQueryClient,
  id: string,
  patch: UpdateSourceInput,
): Promise<Source | null> {
  const existing = await getSource(client, id);
  if (!existing) return null;
  const fields: string[] = ["updated_at = NOW()::text"];
  const values: unknown[] = [];
  let i = 1;
  const set = (col: string, val: unknown) => { fields.push(`${col} = $${i++}`); values.push(val); };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.enabled !== undefined) set("enabled", patch.enabled);
  // Never persist static S3 credentials (contract: cloud runtime credentials only).
  if (patch.config !== undefined) set("config", JSON.stringify(sanitizeSourceConfig(patch.config)));
  if (patch.path !== undefined) set("path", patch.path);
  if (patch.bucket !== undefined) set("bucket", patch.bucket);
  if (patch.prefix !== undefined) set("prefix", patch.prefix);
  if (patch.region !== undefined) set("region", patch.region);
  if (fields.length === 1) return existing;
  values.push(id);
  await client.execute(`UPDATE sources SET ${fields.join(", ")} WHERE id = $${i}`, values);
  return getSource(client, id);
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

export async function getFileByPath(client: TypedQueryClient, sourceId: string, path: string): Promise<FileWithTags | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM files WHERE source_id = $1 AND path = $2", [sourceId, path]);
  if (!row) return null;
  return toFile(row, await fileTags(client, String(row.id)));
}

/** Files most recently touched by agent activity. */
export async function recentFiles(client: TypedQueryClient, agentId?: string, limit = 20): Promise<FileWithTags[]> {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const rows = agentId
    ? await client.many<{ file_id: string; last_touched: string }>(
        "SELECT file_id, MAX(created_at) AS last_touched FROM agent_activity WHERE file_id IS NOT NULL AND agent_id = $1 GROUP BY file_id ORDER BY last_touched DESC LIMIT " + lim,
        [agentId],
      )
    : await client.many<{ file_id: string; last_touched: string }>(
        "SELECT file_id, MAX(created_at) AS last_touched FROM agent_activity WHERE file_id IS NOT NULL GROUP BY file_id ORDER BY last_touched DESC LIMIT " + lim,
      );
  const out: FileWithTags[] = [];
  for (const r of rows) {
    const f = await getFile(client, r.file_id);
    if (f) out.push({ ...f, last_touched: r.last_touched } as FileWithTags & { last_touched: string });
  }
  return out;
}

/** Group active files that share a hash (duplicates). */
export async function findDuplicates(client: TypedQueryClient, sourceId?: string): Promise<Array<{ hash: string; cnt: number; paths: string }>> {
  const filter = sourceId ? "AND source_id = $1" : "";
  const params = sourceId ? [sourceId] : [];
  return client.many<{ hash: string; cnt: number; paths: string }>(
    `SELECT hash, COUNT(*)::int AS cnt, STRING_AGG(path, ' | ') AS paths
     FROM files WHERE status='active' AND hash IS NOT NULL ${filter}
     GROUP BY hash HAVING COUNT(*) > 1 ORDER BY cnt DESC`,
    params,
  );
}

/** Files with a sync conflict. */
export async function listConflicts(client: TypedQueryClient, sourceId?: string, limit = 50): Promise<FileWithTags[]> {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const rows = sourceId
    ? await client.many<Record<string, unknown>>("SELECT * FROM files WHERE sync_status='conflict' AND source_id=$1 LIMIT " + lim, [sourceId])
    : await client.many<Record<string, unknown>>("SELECT * FROM files WHERE sync_status='conflict' LIMIT " + lim);
  const out: FileWithTags[] = [];
  for (const r of rows) out.push(toFile(r, await fileTags(client, String(r.id))));
  return out;
}

export async function resolveConflict(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("UPDATE files SET sync_status='synced', sync_version=sync_version+1 WHERE id=$1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function annotateFile(client: TypedQueryClient, id: string, description: string): Promise<FileWithTags | null> {
  const res = await client.query<Record<string, unknown>>("UPDATE files SET description=$1, sync_version=sync_version+1 WHERE id=$2", [description, id]);
  if ((res.rowCount ?? 0) === 0) return null;
  return getFile(client, id);
}

export async function moveFile(client: TypedQueryClient, id: string, destPath: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("UPDATE files SET path=$1, status='active', sync_version=sync_version+1 WHERE id=$2", [destPath, id]);
  return (res.rowCount ?? 0) > 0;
}

export async function renameFile(client: TypedQueryClient, id: string, newName: string, ext: string, canonical: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>(
    "UPDATE files SET name=$1, original_name=$2, canonical_name=$3, ext=$4, sync_version=sync_version+1 WHERE id=$5",
    [newName, newName, canonical, ext, id],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function softDeleteFile(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("UPDATE files SET status='deleted', sync_version=sync_version+1 WHERE id=$1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function restoreFile(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("UPDATE files SET status='active', sync_version=sync_version+1 WHERE id=$1 AND status='deleted'", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function purgeDeleted(client: TypedQueryClient, sourceId?: string, olderThan?: string): Promise<number> {
  const conditions = ["status='deleted'"];
  const params: unknown[] = [];
  if (sourceId) { params.push(sourceId); conditions.push(`source_id=$${params.length}`); }
  if (olderThan) { params.push(olderThan); conditions.push(`indexed_at<=$${params.length}`); }
  const res = await client.query<Record<string, unknown>>(`DELETE FROM files WHERE ${conditions.join(" AND ")}`, params);
  return res.rowCount ?? 0;
}

export async function normalizeSource(client: TypedQueryClient, sourceId: string): Promise<number> {
  const rows = await client.many<{ id: string; name: string }>(
    "SELECT id, name FROM files WHERE source_id=$1 AND canonical_name IS NULL AND status='active'",
    [sourceId],
  );
  let count = 0;
  for (const row of rows) {
    const canonical = generateCanonicalName(row.name);
    await client.execute("UPDATE files SET original_name=$1, canonical_name=$2 WHERE id=$3", [row.name, canonical, row.id]);
    count++;
  }
  return count;
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

export async function deleteTag(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("DELETE FROM tags WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
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

export async function getCollection(
  client: TypedQueryClient,
  id: string,
): Promise<(Collection & { file_count: number; children: Collection[] }) | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE id = $1", [id]);
  if (!row) return null;
  const count = await client.get<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM collection_files WHERE collection_id = $1", [id]);
  const children = await client.many<Record<string, unknown>>("SELECT * FROM collections WHERE parent_id = $1 ORDER BY name", [id]);
  return { ...toCollection(row), file_count: Number(count?.cnt ?? 0), children: children.map(toCollection) };
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string;
  parent_id?: string | null;
  auto_rules?: AutoRules;
  metadata?: Record<string, unknown>;
}

export async function updateCollection(client: TypedQueryClient, id: string, patch: UpdateCollectionInput): Promise<Collection | null> {
  const existing = await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE id = $1", [id]);
  if (!existing) return null;
  const name = patch.name ?? String(existing.name);
  const description = patch.description ?? String(existing.description ?? "");
  const parent_id = patch.parent_id !== undefined ? patch.parent_id : (existing.parent_id == null ? null : String(existing.parent_id));
  const auto_rules = patch.auto_rules !== undefined ? JSON.stringify(patch.auto_rules) : String(existing.auto_rules ?? "{}");
  const metadata = patch.metadata !== undefined ? JSON.stringify(patch.metadata) : String(existing.metadata ?? "{}");
  await client.execute(
    "UPDATE collections SET name=$1, description=$2, parent_id=$3, auto_rules=$4, metadata=$5, updated_at=NOW()::text WHERE id=$6",
    [name, description, parent_id, auto_rules, metadata, id],
  );
  return getCollectionRow(client, id);
}

async function getCollectionRow(client: TypedQueryClient, id: string): Promise<Collection | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE id = $1", [id]);
  return row ? toCollection(row) : null;
}

export async function deleteCollection(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("DELETE FROM collections WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function getOrCreateCollection(client: TypedQueryClient, name: string, description?: string): Promise<Collection> {
  const existing = await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE name = $1", [name]);
  if (existing) return toCollection(existing);
  return createCollection(client, name, description);
}

export async function autoPopulateCollection(client: TypedQueryClient, id: string): Promise<number> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM collections WHERE id = $1", [id]);
  if (!row) return 0;
  const rules = parseJson<AutoRules>(row.auto_rules, {});
  if (!rules.ext?.length && !rules.tags?.length && !rules.name_pattern && !rules.source_id) return 0;
  const conditions = ["f.status = 'active'"];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => { params.push(value); conditions.push(clause.replace("$?", `$${params.length}`)); };
  if (rules.source_id) add("f.source_id = $?", rules.source_id);
  if (rules.ext?.length) {
    const exts = rules.ext.map((e) => (e.startsWith(".") ? e : `.${e}`));
    const placeholders = exts.map((_, i) => `$${params.length + i + 1}`).join(",");
    params.push(...exts);
    conditions.push(`f.ext IN (${placeholders})`);
  }
  if (rules.name_pattern) add("f.name LIKE $?", rules.name_pattern.replace(/\*/g, "%"));
  let join = "";
  if (rules.tags?.length) {
    join = " JOIN file_tags ft ON ft.file_id = f.id JOIN tags t ON t.id = ft.tag_id";
    const placeholders = rules.tags.map((_, i) => `$${params.length + i + 1}`).join(",");
    params.push(...rules.tags);
    conditions.push(`t.name IN (${placeholders})`);
  }
  const files = await client.many<{ id: string }>(
    `SELECT DISTINCT f.id FROM files f ${join} WHERE ${conditions.join(" AND ")}`,
    params,
  );
  let added = 0;
  for (const f of files) {
    const res = await client.query<Record<string, unknown>>(
      "INSERT INTO collection_files (collection_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [id, f.id],
    );
    if ((res.rowCount ?? 0) > 0) added++;
  }
  return added;
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

export async function getProject(client: TypedQueryClient, id: string): Promise<(Project & { file_count: number }) | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM projects WHERE id = $1", [id]);
  if (!row) return null;
  const count = await client.get<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM project_files WHERE project_id = $1", [id]);
  return { ...toProject(row), file_count: Number(count?.cnt ?? 0) };
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function updateProject(client: TypedQueryClient, id: string, patch: UpdateProjectInput): Promise<Project | null> {
  const existing = await client.get<Record<string, unknown>>("SELECT * FROM projects WHERE id = $1", [id]);
  if (!existing) return null;
  const name = patch.name ?? String(existing.name);
  const description = patch.description ?? String(existing.description ?? "");
  const status = patch.status ?? String(existing.status ?? "active");
  const metadata = patch.metadata !== undefined ? JSON.stringify(patch.metadata) : String(existing.metadata ?? "{}");
  await client.execute(
    "UPDATE projects SET name=$1, description=$2, status=$3, metadata=$4, updated_at=NOW()::text WHERE id=$5",
    [name, description, status, metadata, id],
  );
  const row = await client.get<Record<string, unknown>>("SELECT * FROM projects WHERE id = $1", [id]);
  return row ? toProject(row) : null;
}

export async function deleteProject(client: TypedQueryClient, id: string): Promise<boolean> {
  const res = await client.query<Record<string, unknown>>("DELETE FROM projects WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function getOrCreateProject(client: TypedQueryClient, name: string, description?: string): Promise<Project> {
  const existing = await client.get<Record<string, unknown>>("SELECT * FROM projects WHERE name = $1", [name]);
  if (existing) return toProject(existing);
  return createProject(client, name, description);
}

// ── Feedback ──────────────────────────────────────────────────────────────
export interface FeedbackInput {
  message: string;
  email?: string;
  category?: string;
  version: string;
}

export async function recordFeedback(client: TypedQueryClient, input: FeedbackInput): Promise<void> {
  await client.execute(
    "INSERT INTO feedback (id, message, email, category, version) VALUES ($1,$2,$3,$4,$5)",
    [`fb_${nanoid(10)}`, input.message, input.email ?? null, input.category ?? "general", input.version],
  );
}

// ── Agents ────────────────────────────────────────────────────────────────
function toAgent(r: Record<string, unknown>): Agent {
  return {
    id: String(r.id),
    name: String(r.name),
    session_id: r.session_id == null ? undefined : String(r.session_id),
    project_id: r.project_id == null ? undefined : String(r.project_id),
    last_seen_at: String(r.last_seen_at),
    created_at: String(r.created_at),
  };
}

export async function listAgents(client: TypedQueryClient): Promise<Agent[]> {
  const rows = await client.many<Record<string, unknown>>("SELECT * FROM agents ORDER BY last_seen_at DESC");
  return rows.map(toAgent);
}

export async function getAgent(client: TypedQueryClient, id: string): Promise<Agent | null> {
  const row = await client.get<Record<string, unknown>>("SELECT * FROM agents WHERE id = $1", [id]);
  return row ? toAgent(row) : null;
}

/** Register a new agent, or refresh an existing one by name. */
export async function registerAgent(client: TypedQueryClient, name: string, sessionId?: string): Promise<Agent> {
  const existing = await client.get<Record<string, unknown>>("SELECT * FROM agents WHERE name = $1", [name]);
  if (existing) {
    await client.execute(
      "UPDATE agents SET last_seen_at = NOW()::text, session_id = COALESCE($1, session_id) WHERE id = $2",
      [sessionId ?? null, String(existing.id)],
    );
    return (await getAgent(client, String(existing.id)))!;
  }
  const id = `ag_${nanoid(8)}`;
  await client.execute("INSERT INTO agents (id, name, session_id) VALUES ($1,$2,$3)", [id, name, sessionId ?? null]);
  return (await getAgent(client, id))!;
}

export async function heartbeatAgent(client: TypedQueryClient, id: string): Promise<Agent | null> {
  await client.execute("UPDATE agents SET last_seen_at = NOW()::text WHERE id = $1", [id]);
  return getAgent(client, id);
}

export async function setAgentFocus(client: TypedQueryClient, id: string, projectId?: string): Promise<Agent | null> {
  await client.execute("UPDATE agents SET project_id = $1 WHERE id = $2", [projectId ?? null, id]);
  return getAgent(client, id);
}

// ── Activity ──────────────────────────────────────────────────────────────
function toActivity(r: Record<string, unknown>): AgentActivity {
  return {
    id: String(r.id),
    agent_id: String(r.agent_id),
    action: String(r.action) as ActionType,
    file_id: r.file_id == null ? undefined : String(r.file_id),
    source_id: r.source_id == null ? undefined : String(r.source_id),
    session_id: r.session_id == null ? undefined : String(r.session_id),
    metadata: parseJson(r.metadata, {}),
    created_at: String(r.created_at),
  };
}

export interface LogActivityInput {
  agent_id: string;
  action: ActionType;
  file_id?: string;
  source_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity(client: TypedQueryClient, input: LogActivityInput): Promise<AgentActivity> {
  const id = `act_${nanoid(10)}`;
  await client.execute(
    `INSERT INTO agent_activity (id, agent_id, action, file_id, source_id, session_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.agent_id,
      input.action,
      input.file_id ?? null,
      input.source_id ?? null,
      input.session_id ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return (await client.get<Record<string, unknown>>("SELECT * FROM agent_activity WHERE id = $1", [id]).then((r) => toActivity(r!)));
}

export interface ActivityQuery {
  after?: string;
  before?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

function activityWhere(column: string, value: string, opts: ActivityQuery): { sql: string; params: unknown[] } {
  const conditions = [`${column} = $1`];
  const params: unknown[] = [value];
  if (opts.after) { params.push(opts.after); conditions.push(`created_at >= $${params.length}`); }
  if (opts.before) { params.push(opts.before); conditions.push(`created_at <= $${params.length}`); }
  if (opts.action) { params.push(opts.action); conditions.push(`action = $${params.length}`); }
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const sql = `SELECT * FROM agent_activity WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return { sql, params };
}

export async function getFileHistory(client: TypedQueryClient, fileId: string, opts: ActivityQuery = {}): Promise<AgentActivity[]> {
  const { sql, params } = activityWhere("file_id", fileId, opts);
  return (await client.many<Record<string, unknown>>(sql, params)).map(toActivity);
}

export async function getAgentActivity(client: TypedQueryClient, agentId: string, opts: ActivityQuery = {}): Promise<AgentActivity[]> {
  const { sql, params } = activityWhere("agent_id", agentId, opts);
  return (await client.many<Record<string, unknown>>(sql, params)).map(toActivity);
}

export async function getSessionActivity(client: TypedQueryClient, sessionId: string, opts: ActivityQuery = {}): Promise<AgentActivity[]> {
  const { sql, params } = activityWhere("session_id", sessionId, opts);
  return (await client.many<Record<string, unknown>>(sql, params)).map(toActivity);
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
  const byMachine = await client.many<Record<string, unknown>>(
    "SELECT f.machine_id, m.name, COUNT(*)::int AS count FROM files f JOIN machines m ON m.id=f.machine_id WHERE f.status='active' GROUP BY f.machine_id, m.name ORDER BY count DESC",
  );
  const byTag = await client.many<Record<string, unknown>>(
    "SELECT t.name AS tag, COUNT(*)::int AS count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY t.name ORDER BY count DESC LIMIT 20",
  );
  const totalCollections = await client.get<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM collections");
  const totalProjects = await client.get<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM projects");
  const totalAgents = await client.get<{ cnt: number }>("SELECT COUNT(*)::int AS cnt FROM agents");
  return {
    total_files: Number(totals?.total_files ?? 0),
    total_size: Number(totals?.total_size ?? 0),
    by_ext: byExt,
    by_source: bySource,
    by_machine: byMachine,
    by_tag: byTag,
    total_collections: Number(totalCollections?.cnt ?? 0),
    total_projects: Number(totalProjects?.cnt ?? 0),
    total_agents: Number(totalAgents?.cnt ?? 0),
  };
}
