/**
 * @hasna/prompts — /v1 server store.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * One store interface over the two server backends. Tenant scoping is
 * enforced here, in SQL, never in application memory: a request authenticated
 * with tenant `tid` sees exactly the rows with `tenant_id = tid`; an
 * untenanted key sees only rows with `tenant_id IS NULL` (never "all
 * tenants").
 */
import type { Database, SQLQueryBindings } from "bun:sqlite"
import type { PoolQueryClient } from "../generated/storage-kit/query.js"
import { sha256Hex, bytesOf } from "../body-store.js"

export interface V1PromptRow {
  id: string
  name: string
  slug: string
  title: string
  body: string
  description: string | null
  collection: string
  tags: string[]
  variables: Array<{ name: string; required?: boolean }>
  is_template: boolean
  source: string
  version: number
  use_count: number
  last_used_at: string | null
  pinned: boolean
  next_prompt: string | null
  expires_at: string | null
  project_id: string | null
  tenant_id: string | null
  body_uri: string | null
  body_sha256: string | null
  body_bytes: number | null
  created_at: string
  updated_at: string
}

export interface V1CreateInput {
  /** Caller-supplied stable id; the store generates one when absent. */
  id?: string
  name?: string
  title: string
  body: string
  slug?: string
  description?: string | null
  collection?: string
  tags?: string[]
  source?: string
  project_id?: string | null
  /** Object-first body record; the handler writes the object before create. */
  body_uri?: string | null
  body_sha256?: string | null
  body_bytes?: number | null
}

export function generatePromptId(): string {
  return `prmt-${Math.random().toString(36).slice(2, 10)}`
}

export interface V1ListFilter {
  collection?: string
  tags?: string[]
  is_template?: boolean
  limit: number
  offset: number
}

export interface V1SearchResult {
  item: V1PromptRow
  rank: number
}

export interface V1Store {
  readonly backend: "sqlite" | "postgresql"
  list(filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1PromptRow[]; total: number }>
  get(idOrSlug: string, tenantId: string | null): Promise<V1PromptRow | null>
  create(input: V1CreateInput, tenantId: string | null): Promise<V1PromptRow>
  update(id: string, patch: Partial<V1CreateInput>, tenantId: string | null): Promise<V1PromptRow | null>
  /** Increment use count and append a usage-log row. */
  use(id: string, tenantId: string | null): Promise<V1PromptRow | null>
  remove(id: string, tenantId: string | null): Promise<boolean>
  search(query: string, filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1SearchResult[]; total: number }>
  collections(tenantId: string | null): Promise<string[]>
  status(): Promise<{ backend: "sqlite" | "postgresql"; prompts_total: number; versions_total: number }>
  /** Ping the metadata database. */
  ping(): Promise<boolean>
}

function mapRow(row: Record<string, unknown>): V1PromptRow {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    title: String(row.title),
    body: String(row.body),
    description: row.description == null ? null : String(row.description),
    collection: String(row.collection),
    tags: JSON.parse(String(row.tags ?? "[]")) as string[],
    variables: JSON.parse(String(row.variables ?? "[]")) as Array<{ name: string; required?: boolean }>,
    is_template: Boolean(row.is_template),
    source: String(row.source),
    version: Number(row.version),
    use_count: Number(row.use_count),
    last_used_at: row.last_used_at == null ? null : String(row.last_used_at),
    pinned: Boolean(row.pinned),
    next_prompt: row.next_prompt == null ? null : String(row.next_prompt),
    expires_at: row.expires_at == null ? null : String(row.expires_at),
    project_id: row.project_id == null ? null : String(row.project_id),
    tenant_id: row.tenant_id == null ? null : String(row.tenant_id),
    body_uri: row.body_uri == null ? null : String(row.body_uri),
    body_sha256: row.body_sha256 == null ? null : String(row.body_sha256),
    body_bytes: row.body_bytes == null ? null : Number(row.body_bytes),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function v1CreateInputDefaults(input: V1CreateInput): Required<Pick<V1CreateInput, "name" | "slug" | "collection" | "tags" | "source">> {
  return {
    name: input.name || input.title,
    slug: input.slug || slugify(input.title),
    collection: input.collection || "default",
    tags: input.tags ?? [],
    source: input.source || "manual",
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled"
}

export function v1RowWithNewBody(row: V1PromptRow, body: string): V1PromptRow {
  return { ...row, body, body_sha256: sha256Hex(body), body_bytes: bytesOf(body) }
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

export class SqliteV1Store implements V1Store {
  readonly backend = "sqlite" as const

  constructor(private readonly db: Database) {}

  private tenantWhere(tenantId: string | null, alias: string): string {
    return tenantId === null ? `${alias}.tenant_id IS NULL` : `${alias}.tenant_id = ?`
  }

  async list(filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1PromptRow[]; total: number }> {
    const conditions: string[] = [this.tenantWhere(tenantId, "p")]
    const params: SQLQueryBindings[] = []
    if (tenantId !== null) params.push(tenantId)
    if (filter.collection) { conditions.push("p.collection = ?"); params.push(filter.collection) }
    if (filter.is_template !== undefined) { conditions.push("p.is_template = ?"); params.push(filter.is_template ? 1 : 0) }
    if (filter.tags && filter.tags.length > 0) {
      const tagConds = filter.tags.map(() => "p.tags LIKE ?")
      conditions.push(`(${tagConds.join(" OR ")})`)
      for (const tag of filter.tags) params.push(`%"${tag}"%`)
    }
    const where = `WHERE ${conditions.join(" AND ")}`
    const total = (this.db.query(`SELECT COUNT(*) as n FROM prompts p ${where}`).get(...params) as { n: number }).n
    const rows = this.db.query(
      `SELECT p.* FROM prompts p ${where} ORDER BY p.pinned DESC, p.updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, filter.limit, filter.offset) as Array<Record<string, unknown>>
    return { items: rows.map(mapRow), total }
  }

  async get(idOrSlug: string, tenantId: string | null): Promise<V1PromptRow | null> {
    const base = `SELECT * FROM prompts WHERE id = ? AND ${tenantId === null ? "tenant_id IS NULL" : "tenant_id = ?"}`
    const row = tenantId === null
      ? this.db.query(base).get(idOrSlug)
      : this.db.query(base).get(idOrSlug, tenantId)
    if (row) return mapRow(row as Record<string, unknown>)
    const bySlug = tenantId === null
      ? this.db.query(`SELECT * FROM prompts WHERE slug = ? AND tenant_id IS NULL`).get(idOrSlug)
      : this.db.query(`SELECT * FROM prompts WHERE slug = ? AND tenant_id = ?`).get(idOrSlug, tenantId)
    return bySlug ? mapRow(bySlug as Record<string, unknown>) : null
  }

  async create(input: V1CreateInput, tenantId: string | null): Promise<V1PromptRow> {
    const d = v1CreateInputDefaults(input)
    const id = input.id ?? generatePromptId()
    const tags = JSON.stringify(d.tags)
    const variables = JSON.stringify(input.body.match(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)?.map((m) => m.replace(/[{}]/g, "").trim()) ?? [])
    this.db.run(
      `INSERT INTO prompts (id, name, slug, title, body, description, collection, tags, variables, is_template, source, project_id, tenant_id, body_uri, body_sha256, body_bytes, body_media_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.name, d.slug, input.title, input.body, input.description ?? null, d.collection, tags, variables,
        variables === "[]" ? 0 : 1, d.source, input.project_id ?? null, tenantId,
        input.body_uri ?? null, input.body_sha256 ?? sha256Hex(input.body), input.body_bytes ?? bytesOf(input.body),
        "text/markdown"],
    )
    const created = await this.get(id, tenantId)
    if (!created) throw new Error("create returned no row")
    return created
  }

  async update(id: string, patch: Partial<V1CreateInput>, tenantId: string | null): Promise<V1PromptRow | null> {
    const existing = await this.get(id, tenantId)
    if (!existing) return null
    const title = patch.title ?? existing.title
    const body = patch.body ?? existing.body
    const tags = patch.tags ? JSON.stringify(patch.tags) : JSON.stringify(existing.tags)
    const version = body !== existing.body ? existing.version + 1 : existing.version
    this.db.run(
      `UPDATE prompts SET title = ?, body = ?, description = ?, collection = ?, tags = ?,
        body_uri = COALESCE(?, body_uri), body_sha256 = ?, body_bytes = ?, version = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [title, body, patch.description ?? existing.description, patch.collection ?? existing.collection, tags,
        patch.body_uri ?? null, sha256Hex(body), bytesOf(body), version, existing.id],
    )
    if (body !== existing.body) {
      this.db.run(
        `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by, body_uri, body_sha256, body_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`ver-${Math.random().toString(36).slice(2, 10)}`, existing.id, body, version, null,
          patch.body_uri ?? null, sha256Hex(body), bytesOf(body)],
      )
    }
    return this.get(existing.id, tenantId)
  }

  async use(id: string, tenantId: string | null): Promise<V1PromptRow | null> {
    const existing = await this.get(id, tenantId)
    if (!existing) return null
    this.db.run(
      "UPDATE prompts SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?",
      [existing.id],
    )
    this.db.run("INSERT INTO usage_log (id, prompt_id) VALUES (?, ?)", [`ul-${Math.random().toString(36).slice(2, 12)}`, existing.id])
    return this.get(existing.id, tenantId)
  }

  async remove(id: string, tenantId: string | null): Promise<boolean> {
    const existing = await this.get(id, tenantId)
    if (!existing) return false
    this.db.run("DELETE FROM prompts WHERE id = ?", [existing.id])
    return true
  }

  async search(query: string, filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1SearchResult[]; total: number }> {
    const like = `%${query}%`
    const base = `WHERE (p.name LIKE ? OR p.slug LIKE ? OR p.title LIKE ? OR p.body LIKE ? OR p.description LIKE ? OR p.tags LIKE ?) AND ${tenantId === null ? "p.tenant_id IS NULL" : "p.tenant_id = ?"}`
    const params: SQLQueryBindings[] = [like, like, like, like, like, like]
    if (tenantId !== null) params.push(tenantId)
    const rows = this.db.query(
      `SELECT p.*, 1 as rank FROM prompts p ${base} ORDER BY p.use_count DESC LIMIT ? OFFSET ?`,
    ).all(...params, filter.limit, filter.offset) as Array<Record<string, unknown>>
    const total = (this.db.query(`SELECT COUNT(*) as n FROM prompts p ${base}`).get(...params) as { n: number }).n
    return {
      items: rows.map((r) => ({ item: mapRow(r), rank: Number(r.rank ?? 1) })),
      total,
    }
  }

  async collections(tenantId: string | null): Promise<string[]> {
    const where = tenantId === null ? "WHERE tenant_id IS NULL" : "WHERE tenant_id = ?"
    const rows = tenantId === null
      ? this.db.query(`SELECT DISTINCT collection FROM prompts ${where} ORDER BY collection`).all()
      : this.db.query(`SELECT DISTINCT collection FROM prompts ${where} ORDER BY collection`).all(tenantId)
    return (rows as Array<{ collection: string }>).map((r) => r.collection)
  }

  async status(): Promise<{ backend: "sqlite"; prompts_total: number; versions_total: number }> {
    return {
      backend: "sqlite",
      prompts_total: (this.db.query("SELECT COUNT(*) as n FROM prompts").get() as { n: number }).n,
      versions_total: (this.db.query("SELECT COUNT(*) as n FROM prompt_versions").get() as { n: number }).n,
    }
  }

  async ping(): Promise<boolean> {
    try {
      this.db.query("SELECT 1").get()
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

export class PostgresV1Store implements V1Store {
  readonly backend = "postgresql" as const

  constructor(private readonly client: PoolQueryClient) {}

  private tenantWhere(tenantId: string | null, alias: string, offset: number): { sql: string; params: unknown[] } {
    return tenantId === null
      ? { sql: `${alias}.tenant_id IS NULL`, params: [] }
      : { sql: `${alias}.tenant_id = $${offset}`, params: [tenantId] }
  }

  async list(filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1PromptRow[]; total: number }> {
    const conditions: string[] = []
    const params: SQLQueryBindings[] = []
    const t = this.tenantWhere(tenantId, "p", 1)
    conditions.push(t.sql)
    params.push(...t.params as SQLQueryBindings[])
    if (filter.collection) { conditions.push(`p.collection = $${params.length + 1}`); params.push(filter.collection) }
    if (filter.is_template !== undefined) { conditions.push(`p.is_template = $${params.length + 1}`); params.push(filter.is_template) }
    if (filter.tags && filter.tags.length > 0) {
      const tagConds = filter.tags.map(() => `p.tags LIKE $${params.length + 1}`)
      conditions.push(`(${tagConds.join(" OR ")})`)
      for (const tag of filter.tags) params.push(`%"${tag}"%`)
    }
    const where = `WHERE ${conditions.join(" AND ")}`
    const total = Number((await this.client.get(`SELECT COUNT(*)::text AS n FROM prompts p ${where}`, params))?.n ?? 0)
    const rows = await this.client.many(
      `SELECT p.* FROM prompts p ${where} ORDER BY p.pinned DESC, p.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filter.limit, filter.offset],
    )
    return { items: rows.map((r) => mapRow(r as Record<string, unknown>)), total }
  }

  async get(idOrSlug: string, tenantId: string | null): Promise<V1PromptRow | null> {
    const t = this.tenantWhere(tenantId, "", 2)
    const row = await this.client.get(
      `SELECT * FROM prompts WHERE id = $1 AND ${t.sql}`, [idOrSlug, ...t.params],
    ) as Record<string, unknown> | null
    if (row) return mapRow(row)
    const bySlug = await this.client.get(
      `SELECT * FROM prompts WHERE slug = $1 AND ${t.sql}`, [idOrSlug, ...t.params],
    ) as Record<string, unknown> | null
    return bySlug ? mapRow(bySlug) : null
  }

  async create(input: V1CreateInput, tenantId: string | null): Promise<V1PromptRow> {
    const d = v1CreateInputDefaults(input)
    const id = input.id ?? generatePromptId()
    const tags = JSON.stringify(d.tags)
    const rows = await this.client.many(
      `INSERT INTO prompts (id, name, slug, title, body, description, collection, tags, variables, is_template, source, project_id, tenant_id, body_sha256, body_bytes, body_media_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]', FALSE, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [id, d.name, d.slug, input.title, input.body, input.description ?? null, d.collection, tags,
        d.source, input.project_id ?? null, tenantId, sha256Hex(input.body), bytesOf(input.body), "text/markdown"],
    )
    const created = rows[0] as Record<string, unknown> | undefined
    if (!created) throw new Error("create returned no row")
    return mapRow(created)
  }

  async update(id: string, patch: Partial<V1CreateInput>, tenantId: string | null): Promise<V1PromptRow | null> {
    const existing = await this.get(id, tenantId)
    if (!existing) return null
    const title = patch.title ?? existing.title
    const body = patch.body ?? existing.body
    const tags = JSON.stringify(patch.tags ?? existing.tags)
    const version = body !== existing.body ? existing.version + 1 : existing.version
    const rows = await this.client.many(
      `UPDATE prompts SET title = $1, body = $2, description = $3, collection = $4, tags = $5,
        body_uri = COALESCE($6, body_uri), body_sha256 = $7, body_bytes = $8, version = $9, updated_at = NOW()::text
       WHERE id = $10
       RETURNING *`,
      [title, body, patch.description ?? existing.description, patch.collection ?? existing.collection, tags,
        patch.body_uri ?? null, sha256Hex(body), bytesOf(body), version, existing.id],
    )
    if (body !== existing.body) {
      await this.client.many(
        `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by, body_uri, body_sha256, body_bytes)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
        [`ver-${Math.random().toString(36).slice(2, 10)}`, existing.id, body, version, patch.body_uri ?? null, sha256Hex(body), bytesOf(body)],
      )
    }
    const updated = rows[0] as Record<string, unknown> | undefined
    return updated ? mapRow(updated) : null
  }

  async use(id: string, tenantId: string | null): Promise<V1PromptRow | null> {
    const existing = await this.get(id, tenantId)
    if (!existing) return null
    await this.client.many(
      "UPDATE prompts SET use_count = use_count + 1, last_used_at = NOW()::text WHERE id = $1",
      [existing.id],
    )
    await this.client.many(
      "INSERT INTO usage_log (id, prompt_id) VALUES ($1, $2)",
      [`ul-${Math.random().toString(36).slice(2, 12)}`, existing.id],
    )
    return this.get(existing.id, tenantId)
  }

  async remove(id: string, tenantId: string | null): Promise<boolean> {
    const existing = await this.get(id, tenantId)
    if (!existing) return false
    await this.client.many("DELETE FROM prompts WHERE id = $1", [existing.id])
    return true
  }

  async search(query: string, filter: V1ListFilter, tenantId: string | null): Promise<{ items: V1SearchResult[]; total: number }> {
    const like = `%${query}%`
    const t = this.tenantWhere(tenantId, "p", 7)
    const where = `WHERE (p.name LIKE $1 OR p.slug LIKE $2 OR p.title LIKE $3 OR p.body LIKE $4 OR p.description LIKE $5 OR p.tags LIKE $6) AND ${t.sql}`
    const params: unknown[] = [like, like, like, like, like, like, ...t.params]
    const rows = await this.client.many(
      `SELECT p.*, ts_rank_cd(p.search_vector, plainto_tsquery('simple', $${params.length + 1})) AS rank
       FROM prompts p ${where}
       ORDER BY rank DESC NULLS LAST, p.use_count DESC
       LIMIT ${filter.limit} OFFSET ${filter.offset}`,
      [...params, query],
    )
    const total = Number((await this.client.get(`SELECT COUNT(*)::text AS n FROM prompts p ${where}`, params))?.n ?? 0)
    return {
      items: (rows as Array<Record<string, unknown>>).map((r) => ({ item: mapRow(r), rank: Number(r.rank ?? 1) })),
      total,
    }
  }

  async collections(tenantId: string | null): Promise<string[]> {
    const t = this.tenantWhere(tenantId, "", 1)
    const rows = await this.client.many(
      `SELECT DISTINCT collection FROM prompts WHERE ${t.sql} ORDER BY collection`,
      t.params,
    )
    return (rows as Array<{ collection: string }>).map((r) => r.collection)
  }

  async status(): Promise<{ backend: "postgresql"; prompts_total: number; versions_total: number }> {
    const prompts = await this.client.get("SELECT COUNT(*)::text AS n FROM prompts")
    const versions = await this.client.get("SELECT COUNT(*)::text AS n FROM prompt_versions")
    return {
      backend: "postgresql",
      prompts_total: Number(prompts?.n ?? 0),
      versions_total: Number(versions?.n ?? 0),
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.get("SELECT 1")
      return true
    } catch {
      return false
    }
  }
}
