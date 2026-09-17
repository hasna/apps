import type { Database } from "bun:sqlite";
import type {
  Config,
  ConfigFilter,
  ConfigOutput,
  ConfigSummary,
  ConfigIdentity,
  BoundedReadOptions,
  BoundedReadPage,
  ConfigRow,
  CreateConfigInput,
  UpdateConfigInput,
} from "../types/index.js";
import { ConfigNotFoundError } from "../types/index.js";
import { getDatabase, now, slugify, uuid } from "./database.js";
import { createSnapshot } from "./snapshots.js";
import { boundedReadPage, normalizeBoundedReadOptions } from "../lib/bounded-read.js";

function rowToConfig(row: ConfigRow): Config {
  let outputs: ConfigOutput[] = [];
  try {
    const parsed = JSON.parse(row.outputs || "[]") as unknown;
    outputs = Array.isArray(parsed) ? parsed as ConfigOutput[] : [];
  } catch {
    outputs = [];
  }

  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    outputs,
    is_template: !!row.is_template,
    kind: row.kind as Config["kind"],
    category: row.category as Config["category"],
    agent: row.agent as Config["agent"],
    format: row.format as Config["format"],
  };
}

function uniqueSlug(name: string, db: Database, excludeId?: string): string {
  const base = slugify(name);
  let slug = base;
  let i = 1;
  while (true) {
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM configs WHERE slug = ?")
      .get(slug);
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
}

export function createConfig(input: CreateConfigInput, db?: Database): Config {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  const slug = uniqueSlug(input.name, d);
  const tags = JSON.stringify(input.tags || []);
  const outputs = JSON.stringify(input.outputs || []);

  return d.transaction(() => {
    d.run(
      `INSERT INTO configs (id, name, slug, kind, category, agent, target_path, outputs, format, content, description, tags, is_template, version, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
      [
        id,
        input.name,
        slug,
        input.kind ?? "file",
        input.category,
        input.agent ?? "global",
        input.target_path ?? null,
        outputs,
        input.format ?? "text",
        input.content,
        input.description ?? null,
        tags,
        input.is_template ? 1 : 0,
        ts,
        ts,
      ]
    );
    createSnapshot(id, input.content, 1, d);
    return getConfig(id, d);
  })();
}

export function getConfig(idOrSlug: string, db?: Database): Config {
  const d = db || getDatabase();
  const row = d
    .query<ConfigRow, [string, string]>(
      "SELECT * FROM configs WHERE id = ? OR slug = ?"
    )
    .get(idOrSlug, idOrSlug);
  if (!row) throw new ConfigNotFoundError(idOrSlug);
  return rowToConfig(row);
}

export function getConfigById(id: string, db?: Database): Config {
  const d = db || getDatabase();
  const row = d
    .query<ConfigRow, [string]>("SELECT * FROM configs WHERE id = ?")
    .get(id);
  if (!row) throw new ConfigNotFoundError(id);
  return rowToConfig(row);
}

export function listConfigs(filter?: ConfigFilter, db?: Database): Config[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.category) {
    conditions.push("category = ?");
    params.push(filter.category);
  }
  if (filter?.agent) {
    conditions.push("agent = ?");
    params.push(filter.agent);
  }
  if (filter?.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.is_template !== undefined) {
    conditions.push("is_template = ?");
    params.push(filter.is_template ? 1 : 0);
  }
  if (filter?.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR content LIKE ?)");
    const q = `%${filter.search}%`;
    params.push(q, q, q);
  }
  if (filter?.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map(() => "tags LIKE ?").join(" OR ");
    conditions.push(`(${tagConditions})`);
    for (const tag of filter.tags) params.push(`%"${tag}"%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d
    .query<ConfigRow, typeof params>(`SELECT * FROM configs ${where} ORDER BY category, name`)
    .all(...params);

  return rows.map(rowToConfig);
}

export function listConfigsPage(
  filter: ConfigFilter = {},
  options: BoundedReadOptions = {},
  db?: Database,
): BoundedReadPage<Config> {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.category) { conditions.push("category = ?"); params.push(filter.category); }
  if (filter.agent) { conditions.push("agent = ?"); params.push(filter.agent); }
  if (filter.kind) { conditions.push("kind = ?"); params.push(filter.kind); }
  if (filter.is_template !== undefined) { conditions.push("is_template = ?"); params.push(filter.is_template ? 1 : 0); }
  if (filter.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR content LIKE ?)");
    const q = `%${filter.search}%`; params.push(q, q, q);
  }
  if (filter.tags?.length) {
    conditions.push(`(${filter.tags.map(() => "tags LIKE ?").join(" AND ")})`);
    for (const tag of filter.tags) params.push(`%"${tag}"%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const normalized = normalizeBoundedReadOptions(options);
  const total = d.query<{ total: number }, typeof params>(`SELECT COUNT(*) AS total FROM configs ${where}`).get(...params)?.total ?? 0;
  const pageParams = [...params, normalized.limit, normalized.cursor];
  const rows = d.query<ConfigRow, typeof pageParams>(
    `SELECT * FROM configs ${where} ORDER BY id LIMIT ? OFFSET ?`,
  ).all(...pageParams);
  return boundedReadPage(rows.map(rowToConfig), total, normalized);
}

export function listConfigIdentitiesPage(
  filter: ConfigFilter = {},
  options: BoundedReadOptions = {},
  db?: Database,
): BoundedReadPage<ConfigIdentity> {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.category) { conditions.push("category = ?"); params.push(filter.category); }
  if (filter.agent) { conditions.push("agent = ?"); params.push(filter.agent); }
  if (filter.kind) { conditions.push("kind = ?"); params.push(filter.kind); }
  if (filter.is_template !== undefined) { conditions.push("is_template = ?"); params.push(filter.is_template ? 1 : 0); }
  if (filter.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR content LIKE ?)");
    const q = `%${filter.search}%`; params.push(q, q, q);
  }
  if (filter.tags?.length) {
    conditions.push(`(${filter.tags.map(() => "tags LIKE ?").join(" AND ")})`);
    for (const tag of filter.tags) params.push(`%"${tag}"%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const normalized = normalizeBoundedReadOptions(options);
  const total = d.query<{ total: number }, typeof params>(`SELECT COUNT(*) AS total FROM configs ${where}`).get(...params)?.total ?? 0;
  const pageParams = [...params, normalized.limit, normalized.cursor];
  const rows = d.query<{
    id: string; name: string; slug: string; kind: string; category: string; agent: string; format: string;
    is_template: number; version: number; created_at: string; updated_at: string; synced_at: string | null;
  }, typeof pageParams>(
    `SELECT id, name, slug, kind, category, agent, format, is_template, version, created_at, updated_at, synced_at
       FROM configs ${where} ORDER BY id LIMIT ? OFFSET ?`,
  ).all(...pageParams);
  return boundedReadPage(rows.map((row) => ({
    ...row,
    kind: row.kind as Config["kind"],
    category: row.category as Config["category"],
    agent: row.agent as Config["agent"],
    format: row.format as Config["format"],
    is_template: Boolean(row.is_template),
  })), total, normalized);
}

export function listConfigSummariesPage(
  filter: ConfigFilter = {},
  options: BoundedReadOptions = {},
  db?: Database,
): BoundedReadPage<ConfigSummary> {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.category) { conditions.push("category = ?"); params.push(filter.category); }
  if (filter.agent) { conditions.push("agent = ?"); params.push(filter.agent); }
  if (filter.kind) { conditions.push("kind = ?"); params.push(filter.kind); }
  if (filter.is_template !== undefined) { conditions.push("is_template = ?"); params.push(filter.is_template ? 1 : 0); }
  if (filter.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR content LIKE ?)");
    const q = `%${filter.search}%`;
    params.push(q, q, q);
  }
  if (filter.tags && filter.tags.length > 0) {
    conditions.push(`(${filter.tags.map(() => "tags LIKE ?").join(" AND ")})`);
    for (const tag of filter.tags) params.push(`%"${tag}"%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const normalized = normalizeBoundedReadOptions(options);
  const total = d.query<{ total: number }, typeof params>(`SELECT COUNT(*) AS total FROM configs ${where}`).get(...params)?.total ?? 0;
  const pageParams = [...params, normalized.limit, normalized.cursor];
  const rows = d.query<{
    id: string; name: string; slug: string; kind: string; category: string; agent: string;
    target_path: string | null; format: string; output_count: number; description: string | null;
    tags: string; is_template: number; version: number; updated_at: string;
  }, typeof pageParams>(
    `SELECT id, name, slug, kind, category, agent, target_path, format,
            CASE WHEN json_valid(outputs) AND json_type(outputs) = 'array' THEN json_array_length(outputs) ELSE 0 END AS output_count, description, tags,
            is_template, version, updated_at
       FROM configs ${where} ORDER BY category, name, id LIMIT ? OFFSET ?`,
  ).all(...pageParams);
  return boundedReadPage(rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category as Config["category"],
    agent: row.agent as Config["agent"],
    kind: row.kind as Config["kind"],
    format: row.format as Config["format"],
    target_path: row.target_path,
    output_count: Number(row.output_count ?? 0),
    version: row.version,
    is_template: Boolean(row.is_template),
    updated_at: row.updated_at,
    description: row.description,
    tags: JSON.parse(row.tags || "[]") as string[],
  })), total, normalized);
}

export function updateConfig(
  idOrSlug: string,
  input: UpdateConfigInput,
  db?: Database
): Config {
  const d = db || getDatabase();
  const existing = getConfig(idOrSlug, d);
  const ts = now();

  const updates: string[] = ["updated_at = ?", "version = version + 1"];
  const params: (string | number | null)[] = [ts];

  if (input.name !== undefined) {
    updates.push("name = ?", "slug = ?");
    params.push(input.name, uniqueSlug(input.name, d, existing.id));
  }
  if (input.kind !== undefined) { updates.push("kind = ?"); params.push(input.kind); }
  if (input.category !== undefined) { updates.push("category = ?"); params.push(input.category); }
  if (input.agent !== undefined) { updates.push("agent = ?"); params.push(input.agent); }
  if (input.target_path !== undefined) { updates.push("target_path = ?"); params.push(input.target_path); }
  if (input.outputs !== undefined) { updates.push("outputs = ?"); params.push(JSON.stringify(input.outputs)); }
  if (input.format !== undefined) { updates.push("format = ?"); params.push(input.format); }
  if (input.content !== undefined) { updates.push("content = ?"); params.push(input.content); }
  if (input.description !== undefined) { updates.push("description = ?"); params.push(input.description); }
  if (input.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(input.tags)); }
  if (input.is_template !== undefined) { updates.push("is_template = ?"); params.push(input.is_template ? 1 : 0); }
  if (input.synced_at !== undefined) { updates.push("synced_at = ?"); params.push(input.synced_at); }

  return d.transaction(() => {
    params.push(existing.id);
    d.run(`UPDATE configs SET ${updates.join(", ")} WHERE id = ?`, params);
    const updated = getConfigById(existing.id, d);
    createSnapshot(updated.id, updated.content, updated.version, d);
    return updated;
  })();
}

export function deleteConfig(idOrSlug: string, db?: Database): void {
  const d = db || getDatabase();
  const existing = getConfig(idOrSlug, d);
  d.run("DELETE FROM configs WHERE id = ?", [existing.id]);
}

export function getConfigStats(db?: Database): Record<string, number> {
  const d = db || getDatabase();
  const rows = d
    .query<{ category: string; count: number }, []>(
      "SELECT category, COUNT(*) as count FROM configs GROUP BY category"
    )
    .all();
  const stats: Record<string, number> = { total: 0 };
  for (const row of rows) {
    stats[row.category] = row.count;
    stats["total"] = (stats["total"] || 0) + row.count;
  }
  return stats;
}
