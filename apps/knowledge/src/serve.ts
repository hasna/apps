/**
 * @hasna/knowledge — HTTP serve surface (knowledge-serve).
 *
 * A real HTTP API wrapping the knowledge core library. PURE REMOTE per
 * Amendment A1: the service reads and writes the shared cloud Postgres directly
 * (no local cache, no sync engine in the service). Requests are authenticated
 * with @hasna/contracts API-key middleware.
 *
 * Surfaces:
 *   GET  /health          liveness — { status, version, mode }         (public)
 *   GET  /ready           readiness — pings the DB                      (public)
 *   GET  /version         { status, version, mode }                    (public)
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)       (public)
 *   GET  /v1/registry     knowledge registry contract                  (auth: knowledge:read)
 *   POST /v1/notes        create a knowledge item                      (auth: knowledge:write)
 *   GET  /v1/notes        list knowledge items                         (auth: knowledge:read)
 *   GET  /v1/notes/{id}   fetch one knowledge item                     (auth: knowledge:read)
 *   PATCH /v1/notes/{id}  update a knowledge item                      (auth: knowledge:write)
 *   DELETE /v1/notes/{id} delete a knowledge item                      (auth: knowledge:write)
 *   GET  /v1/notes/{id}/versions            entry history              (auth: knowledge:read)
 *   GET  /v1/notes/{id}/versions/{version}  one prior snapshot         (auth: knowledge:read)
 */
import { readFileSync } from 'node:fs';
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type ApiKeyPrincipal } from '@hasna/contracts/auth';
import { createKnowledgeCloudClient } from './db/remote-storage.js';
import { knowledgeRegistryContract } from './registry-contract.js';
import {
  makeId,
  makeShortId,
  type KnowledgeItem,
  type KnowledgeItemVersion,
  type KnowledgeItemVersionList,
} from './store.js';
import type { PoolQueryClient, TypedQueryClient } from './generated/storage-kit/index.js';

export const KNOWLEDGE_SERVE_APP = 'knowledge';

/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Appends libpq-compat so `require`/`prefer` mean exactly what
 * the kit documents. Never logs the URL. Returns the (possibly) updated value.
 */
export function normalizeCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = 'HASNA_KNOWLEDGE_DATABASE_URL';
  const url = env[key] ?? env.KNOWLEDGE_DATABASE_URL;
  if (!url) return url;
  const lower = url.toLowerCase();
  const needsCompat =
    (lower.includes('sslmode=require') || lower.includes('sslmode=prefer')) &&
    !lower.includes('uselibpqcompat');
  if (!needsCompat) return url;
  const updated = url.includes('?')
    ? `${url}&uselibpqcompat=true`
    : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}

function resolveVersion(): string {
  if (process.env.HASNA_KNOWLEDGE_VERSION) return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    // package.json sits one level up from the built bin/ or src/.
    const url = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return process.env.npm_package_version ?? '0.0.0';
  }
}

function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_KNOWLEDGE_API_SIGNING_KEY ??
    env.API_KEY_SIGNING_SECRET ??
    env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      'knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY ' +
        '(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).',
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Note repository — knowledge_items in the cloud Postgres (PURE REMOTE / A1).
// ---------------------------------------------------------------------------

export interface NoteInput {
  /** Optional caller-supplied stable id (upsert). When present, create is an
   * idempotent upsert on this id — matching the local db.json upsert semantics so
   * `upsert --id <stable>` and data import/re-sync never duplicate in cloud mode. */
  id?: string;
  title: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NoteListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  includeArchived?: boolean;
}

/**
 * Attribution and concurrency control for a write. `actor`/`reason` are handed
 * to the database as transaction-local settings so the versioning trigger can
 * stamp them onto the snapshot it takes — the writer never inserts the history
 * row itself, which is the whole point (see db/pg-migrations.ts).
 */
export interface NoteWriteOptions {
  /** Authenticated identity performing the write; recorded on the snapshot. */
  actor?: string | null;
  /** Optional free-text justification recorded on the snapshot. */
  reason?: string | null;
}

export interface NoteUpdateOptions extends NoteWriteOptions {
  /**
   * Optimistic concurrency: apply only if the stored row is still at this
   * version. Absent means last-writer-wins (phase 1 — every installed 0.2.x CLI
   * on the fleet omits it and must keep working).
   */
  expectedVersion?: number;
}

/**
 * Raised when `expectedVersion` no longer matches the stored row. Carries both
 * numbers so a caller can decide whether a re-read-and-retry is safe, rather
 * than blind-retrying and overwriting the other writer.
 */
export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  constructor(readonly expected: number, readonly current: number) {
    super(`version_conflict: expected version ${expected}, stored version is ${current}`);
    this.name = 'VersionConflictError';
  }
}

/**
 * One immutable snapshot of an entry, and a page of them. The shapes live in
 * store.ts next to KnowledgeItem so the CLI and SDK clients can consume them
 * without importing the server; these aliases keep the serve-side vocabulary.
 */
export type NoteVersion = KnowledgeItemVersion;
export type NoteVersionList = KnowledgeItemVersionList;

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function rowToVersion(row: Record<string, unknown>): NoteVersion {
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    tenant_id: (row.tenant_id as string | null) ?? null,
    version: Number(row.version),
    title: String(row.title ?? ''),
    content: (row.content as string | null) ?? null,
    body_uri: (row.body_uri as string | null) ?? null,
    content_hash: String(row.content_hash ?? ''),
    content_bytes: Number(row.content_bytes ?? 0),
    url: (row.url as string | null) ?? null,
    tags: parseJsonColumn<string[]>(row.tags, []),
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata, {}),
    archived: Boolean(row.archived),
    actor: (row.actor as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    valid_from: (row.valid_from as string | null) ?? null,
    valid_to: String(row.valid_to ?? ''),
  };
}

function rowToItem(row: Record<string, unknown>): KnowledgeItem {
  const parseJson = <T>(value: unknown, fallback: T): T => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  };
  return {
    id: String(row.id),
    short_id: (row.short_id as string | null) ?? null,
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    url: (row.url as string | null) ?? null,
    tags: parseJson<string[]>(row.tags, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    archived: Boolean(row.archived),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    // Rows written before the versioning migration read as version 1 — the
    // truthful answer for a row that has never been snapshotted.
    version: row.version == null ? 1 : Number(row.version),
  };
}

export class NoteRepo {
  constructor(private readonly client: PoolQueryClient) {}

  /**
   * Run a write with its attribution attached, in one transaction.
   *
   * `set_config(..., true)` is TRANSACTION-local, which is what makes this safe
   * on a pooled connection: the value cannot leak into the next request that
   * happens to be handed the same client. It resets to the empty string rather
   * than to unset, which is why the trigger reads it through NULLIF — otherwise
   * an unattributed write would record an actor that is present but blank.
   *
   * Every knowledge_items write goes through here, including the upsert branch
   * of create(), because that branch is an UPDATE whenever the id already
   * exists and must be attributed like any other edit.
   */
  private async write<T>(options: NoteWriteOptions, fn: (client: TypedQueryClient) => Promise<T>): Promise<T> {
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT set_config('hasna.actor', $1, true), set_config('hasna.reason', $2, true)`, [
        options.actor ?? '',
        options.reason ?? '',
      ]);
      return fn(tx);
    });
  }

  async create(input: NoteInput, options: NoteWriteOptions = {}): Promise<KnowledgeItem> {
    if (!input.title || typeof input.title !== 'string') {
      throw new HttpError(400, 'title is required');
    }
    const now = new Date().toISOString();
    const suppliedId = typeof input.id === 'string' ? input.id.trim() : '';
    if (suppliedId) {
      // Caller-supplied stable id => idempotent upsert (parity with the local
      // db.json store, where `upsert --id` persists that id so a later get()
      // re-finds it). Without this, cloud create dropped the id and every
      // `upsert --id`/import re-invocation created a duplicate. id is the PK, so
      // ON CONFLICT is safe; short_id is only derived on first insert.
      // The DO UPDATE arm is an UPDATE, so the versioning trigger fires on it
      // and snapshots the pre-upsert body. That is deliberate and load-bearing:
      // this is the branch `knowledge upsert --id`, import, and `ingest rules`
      // take, and it is the exact branch that lost history in open-mementos.
      const row = await this.write(options, (tx) => tx.get<Record<string, unknown>>(
        `INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          suppliedId,
          makeShortId(suppliedId),
          input.title,
          input.content ?? '',
          input.url ?? null,
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.metadata ?? {}),
          now,
        ],
      ));
      return rowToItem(row!);
    }
    const id = makeId();
    const row = await this.write(options, (tx) => tx.get<Record<string, unknown>>(
      `INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$9)
       RETURNING *`,
      [
        id,
        makeShortId(id),
        input.title,
        input.content ?? '',
        input.url ?? null,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ],
    ));
    return rowToItem(row!);
  }

  async list(options: NoteListOptions = {}): Promise<{ items: KnowledgeItem[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!options.includeArchived) where.push('archived = FALSE');

    // Full-text search via the weighted tsvector generated column + GIN index
    // (see pg-migrations.ts). websearch_to_tsquery gives users implicit-AND,
    // "phrases", and OR/-negation; ts_rank_cd ranks by relevance (title
    // weighted over content) with created_at as a deterministic tiebreak.
    // Replaces the old ILIKE-substring + recency-only path that returned
    // materially different / near-empty results in cloud vs local.
    const search = options.search?.trim();
    let tsQueryExpr: string | null = null;
    if (search) {
      params.push(search);
      tsQueryExpr = `websearch_to_tsquery('english', $${params.length})`;
      where.push(`search_vector @@ ${tsQueryExpr}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = tsQueryExpr
      ? `ORDER BY ts_rank_cd(search_vector, ${tsQueryExpr}) DESC, created_at DESC`
      : 'ORDER BY created_at DESC';

    const totalRow = await this.client.get<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`,
      params,
    );
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM knowledge_items ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { items: rows.map(rowToItem), total: Number(totalRow?.count ?? 0) };
  }

  async get(idOrShort: string): Promise<KnowledgeItem | null> {
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_items WHERE id = $1 OR short_id = $1 LIMIT 1`,
      [idOrShort],
    );
    return row ? rowToItem(row) : null;
  }

  async update(
    idOrShort: string,
    patch: Partial<NoteInput> & { archived?: boolean },
    options: NoteUpdateOptions = {},
  ): Promise<KnowledgeItem | null> {
    const existing = await this.get(idOrShort);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, cast = '') => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.title !== undefined) push('title', patch.title);
    if (patch.content !== undefined) push('content', patch.content);
    if (patch.url !== undefined) push('url', patch.url);
    if (patch.tags !== undefined) push('tags', JSON.stringify(patch.tags), '::jsonb');
    if (patch.metadata !== undefined) push('metadata', JSON.stringify(patch.metadata), '::jsonb');
    if (patch.archived !== undefined) push('archived', patch.archived);
    push('updated_at', new Date().toISOString());
    params.push(existing.id);
    // `version` is never assigned here. The trigger owns the counter, so a
    // caller cannot advance, freeze, or forge it — it only reads it as a guard.
    let where = `id = $${params.length}`;
    const { expectedVersion } = options;
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      where += ` AND version = $${params.length}`;
    }
    const row = await this.write(options, (tx) => tx.get<Record<string, unknown>>(
      `UPDATE knowledge_items SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
      params,
    ));
    if (row) return rowToItem(row);
    if (expectedVersion === undefined) return null;
    // Zero rows with a version guard means either the row moved on (conflict) or
    // it disappeared between the read and the write (not found). Distinguish
    // them: reporting a deletion as a conflict would send the caller into a
    // retry loop against a row that no longer exists.
    const current = await this.get(existing.id);
    if (!current) return null;
    throw new VersionConflictError(expectedVersion, current.version ?? 1);
  }

  /**
   * Prior snapshots for an entry, newest first.
   *
   * Returns `null` — not an empty list — when the entry itself is absent. The
   * distinction is the whole lesson of the open-mementos read bug: "this entry
   * has never been edited" and "this entry does not exist" printed the same
   * "No previous versions" line, so an empty result was unreadable as evidence.
   */
  async listVersions(
    idOrShort: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<NoteVersionList | null> {
    const existing = await this.get(idOrShort);
    if (!existing) return null;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const totalRow = await this.client.get<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_item_versions WHERE item_id = $1`,
      [existing.id],
    );
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM knowledge_item_versions WHERE item_id = $1
        ORDER BY version DESC LIMIT ${limit} OFFSET ${offset}`,
      [existing.id],
    );
    return {
      item_id: existing.id,
      current_version: existing.version ?? 1,
      total: Number(totalRow?.count ?? 0),
      items: rows.map(rowToVersion),
    };
  }

  /** One prior snapshot by version number, or `null` if that version is absent. */
  async getVersion(idOrShort: string, version: number): Promise<NoteVersion | null> {
    const existing = await this.get(idOrShort);
    if (!existing) return null;
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_item_versions WHERE item_id = $1 AND version = $2`,
      [existing.id, version],
    );
    return row ? rowToVersion(row) : null;
  }

  async delete(idOrShort: string): Promise<boolean> {
    const existing = await this.get(idOrShort);
    if (!existing) return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}

// ---------------------------------------------------------------------------
// OpenAPI document — source of truth for the generated SDK.
// ---------------------------------------------------------------------------

export function knowledgeOpenApi(version: string): Record<string, unknown> {
  const noteSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      short_id: { type: 'string', nullable: true },
      title: { type: 'string' },
      content: { type: 'string' },
      url: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object', additionalProperties: true },
      archived: { type: 'boolean' },
      created_at: { type: 'string' },
      updated_at: { type: 'string' },
      version: { type: 'integer', description: 'Current entry version; send it back as If-Match to write safely.' },
    },
    required: ['id', 'title', 'content', 'tags', 'archived', 'created_at', 'updated_at', 'version'],
  };
  const noteVersionSchema = {
    type: 'object',
    description: 'An immutable snapshot of the entry as it stood BEFORE the edit that produced the next version.',
    properties: {
      id: { type: 'string' },
      item_id: { type: 'string' },
      tenant_id: { type: 'string', nullable: true },
      version: { type: 'integer' },
      title: { type: 'string' },
      content: { type: 'string', nullable: true },
      body_uri: { type: 'string', nullable: true },
      content_hash: { type: 'string' },
      content_bytes: { type: 'integer' },
      url: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object', additionalProperties: true },
      archived: { type: 'boolean' },
      actor: { type: 'string', nullable: true },
      reason: { type: 'string', nullable: true },
      valid_from: { type: 'string', nullable: true },
      valid_to: { type: 'string' },
    },
    required: ['id', 'item_id', 'version', 'title', 'content_hash', 'content_bytes', 'tags', 'archived', 'valid_to'],
  };
  const noteInput = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      url: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object', additionalProperties: true },
    },
    required: ['title'],
  };
  const notePatch = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      url: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object', additionalProperties: true },
      archived: { type: 'boolean' },
      expected_version: {
        type: 'integer',
        description:
          'Optimistic concurrency guard, equivalent to the If-Match header, for clients that cannot set headers. '
          + 'The write applies only if the stored entry is still at this version; otherwise 409 version_conflict.',
      },
    },
  };
  const versionConflict = {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['version_conflict'] },
      expected: { type: 'integer' },
      current: { type: 'integer' },
    },
    required: ['error', 'expected', 'current'],
  };
  return {
    openapi: '3.0.3',
    info: { title: 'Knowledge', version, description: '@hasna/knowledge self-hosted HTTP API' },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteVersion: noteVersionSchema,
        VersionConflict: versionConflict,
        NoteList: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
            total: { type: 'integer' },
          },
          required: ['items', 'total'],
        },
        NoteVersionList: {
          type: 'object',
          properties: {
            item_id: { type: 'string' },
            current_version: { type: 'integer' },
            total: { type: 'integer' },
            items: { type: 'array', items: { $ref: '#/components/schemas/NoteVersion' } },
          },
          required: ['item_id', 'current_version', 'total', 'items'],
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/v1/notes': {
        get: {
          operationId: 'listNotes',
          summary: 'List knowledge items',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteList' } } } },
          },
        },
        post: {
          operationId: 'createNote',
          summary: 'Create a knowledge item',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteInput' } } },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } } },
          },
        },
      },
      '/v1/notes/{id}': {
        get: {
          operationId: 'getNote',
          summary: 'Fetch a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } } },
          },
        },
        patch: {
          operationId: 'updateNote',
          summary: 'Update a knowledge item',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'If-Match',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description:
                'Optimistic concurrency guard: the version the client last read. The write applies only if the '
                + 'stored entry is still at that version, otherwise 409 version_conflict. Optional in this phase so '
                + 'already-installed clients keep working; `*` means "any existing version".',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NotePatch' } } },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } } },
            '409': {
              description: 'The stored entry moved on; nothing was written.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/VersionConflict' } } },
            },
          },
        },
        delete: {
          operationId: 'deleteNote',
          summary: 'Delete a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': {} },
        },
      },
      '/v1/notes/{id}/versions': {
        get: {
          operationId: 'listNoteVersions',
          summary: 'List prior versions of a knowledge item (newest first)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteVersionList' } } } },
            '404': { description: 'No such entry. An entry that exists but was never edited returns 200 with an empty list.' },
          },
        },
      },
      '/v1/notes/{id}/versions/{version}': {
        get: {
          operationId: 'getNoteVersion',
          summary: 'Fetch one prior version of a knowledge item',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteVersion' } } } },
            '404': { description: 'No such entry, or no such version of it.' },
          },
        },
      },
      '/v1/registry': {
        get: {
          operationId: 'getRegistry',
          summary: 'Knowledge registry contract',
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The identity stamped on a version snapshot.
 *
 * Taken from the AUTHENTICATED principal, never from a caller-supplied body
 * field, so "who changed this" cannot be spoofed or omitted. `kid` is a key
 * identifier, not a credential — the token itself is never read here and never
 * leaves the auth middleware.
 */
function principalActor(principal: ApiKeyPrincipal): string {
  return principal.agent ? `agent:${principal.agent}` : `key:${principal.kid}`;
}

/**
 * Read the optimistic-concurrency guard off a PATCH.
 *
 * Accepts `If-Match: 3`, the RFC-quoted `If-Match: "3"`, and the weak form
 * `W/"3"`, because clients and proxies differ on which they emit and a guard
 * that is silently dropped because of a pair of quotes is worse than no guard.
 * `*` means "any existing representation" and is therefore NOT a version check.
 * A header that is present but unusable is a 400 — never a silent unguarded
 * write, which is exactly the failure the caller was trying to prevent.
 */
function parseExpectedVersion(req: Request, body: Record<string, unknown>): number | undefined {
  const header = req.headers.get('if-match');
  if (header != null && header.trim() !== '' && header.trim() !== '*') {
    const cleaned = header.trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
    const parsed = Number(cleaned);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new HttpError(400, `If-Match must be an entry version number (got ${header}).`);
    }
    return parsed;
  }
  const fromBody = body.expected_version;
  if (fromBody === undefined || fromBody === null) return undefined;
  const parsed = Number(fromBody);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, 'expected_version must be a positive integer entry version.');
  }
  return parsed;
}

export interface ServeDeps {
  client: PoolQueryClient;
  verifier: ApiKeyVerifier;
  store: ApiKeyStore;
  version: string;
}

export function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const repo = new NoteRepo(deps.client);
  const mode = 'cloud';

  const authOrThrow = async (
    req: Request,
    requiredScopes: string[],
  ): Promise<ApiKeyPrincipal> => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    void deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    try {
      // ---- Public probes ----
      if (path === '/health' && method === 'GET') {
        return json({ status: 'ok', version: deps.version, mode });
      }
      if (path === '/version' && method === 'GET') {
        return json({ status: 'ok', version: deps.version, mode });
      }
      if (path === '/ready' && method === 'GET') {
        try {
          await deps.client.query('SELECT 1');
          return json({ status: 'ready', version: deps.version, mode });
        } catch {
          return json({ status: 'unavailable', version: deps.version, mode }, 503);
        }
      }
      if (path === '/openapi.json' && method === 'GET') {
        return json(knowledgeOpenApi(deps.version));
      }

      // ---- Registry ----
      if (path === '/v1/registry' && method === 'GET') {
        await authOrThrow(req, ['knowledge:read']);
        return json(
          knowledgeRegistryContract({
            mode: 'hosted',
            sourceSchemes: ['open-files', 's3', 'web', 'file'],
            storageType: 's3',
            artifactUriPrefix: process.env.HASNA_KNOWLEDGE_S3_PREFIX ?? null,
          }),
        );
      }

      // ---- Notes CRUD ----
      if (path === '/v1/notes') {
        if (method === 'GET') {
          await authOrThrow(req, ['knowledge:read']);
          const result = await repo.list({
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
            offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
            search: url.searchParams.get('search') ?? undefined,
            includeArchived: url.searchParams.get('includeArchived') === 'true',
          });
          return json(result);
        }
        if (method === 'POST') {
          const principal = await authOrThrow(req, ['knowledge:write']);
          const body = (await req.json().catch(() => ({}))) as NoteInput;
          // An id-carrying create is an upsert, so it can be an EDIT of an
          // existing entry — it must be attributed like one.
          const item = await repo.create(body, { actor: principalActor(principal) });
          return json(item, 201);
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      // Version sub-resources are matched before the entity route so the entity
      // route's `[^/]+` can never swallow them.
      const versionListMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions$/);
      if (versionListMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        await authOrThrow(req, ['knowledge:read']);
        const history = await repo.listVersions(decodeURIComponent(versionListMatch[1]!), {
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
        });
        // null = no such entry (404). An entry with no edits yields 200 and an
        // empty list — the two must never collapse into one answer.
        return history ? json(history) : json({ error: 'not_found' }, 404);
      }

      const versionOneMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions\/(\d+)$/);
      if (versionOneMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        await authOrThrow(req, ['knowledge:read']);
        const snapshot = await repo.getVersion(
          decodeURIComponent(versionOneMatch[1]!),
          Number(versionOneMatch[2]),
        );
        return snapshot ? json(snapshot) : json({ error: 'not_found' }, 404);
      }

      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]!);
        if (method === 'GET') {
          await authOrThrow(req, ['knowledge:read']);
          const item = await repo.get(id);
          return item ? json(item) : json({ error: 'not_found' }, 404);
        }
        if (method === 'PATCH') {
          const principal = await authOrThrow(req, ['knowledge:write']);
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const expectedVersion = parseExpectedVersion(req, body);
          // `expected_version` is a control field, not entry data: strip it so
          // it can never be persisted as part of the note.
          const { expected_version: _ignored, ...patch } = body;
          try {
            const item = await repo.update(id, patch as Partial<NoteInput>, {
              expectedVersion,
              actor: principalActor(principal),
            });
            return item ? json(item) : json({ error: 'not_found' }, 404);
          } catch (error) {
            if (error instanceof VersionConflictError) {
              return json({ error: 'version_conflict', expected: error.expected, current: error.current }, 409);
            }
            throw error;
          }
        }
        if (method === 'DELETE') {
          await authOrThrow(req, ['knowledge:write']);
          const ok = await repo.delete(id);
          return ok ? new Response(null, { status: 204 }) : json({ error: 'not_found' }, 404);
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      return json({ error: 'not_found', path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? 'unauthorized' : 'error';
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : 'internal error';
      return json({ error: 'internal', message }, 500);
    }
  };
}

export interface StartServeOptions {
  port?: number;
  hostname?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningServe {
  port: number;
  hostname: string;
  stop: () => Promise<void>;
}

/**
 * Start the knowledge HTTP service on Bun. Opens a PURE-REMOTE cloud pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export async function startKnowledgeServe(options: StartServeOptions = {}): Promise<RunningServe> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? '0.0.0.0';
  const version = resolveVersion();

  normalizeCloudDatabaseUrl(env);
  const client = createKnowledgeCloudClient();
  const store = new ApiKeyStore(client);
  // DDL (the api_keys table) is owned by the migration task (run as the DB
  // owner role); the service connects with a DML-only app role per least
  // privilege, so it must NOT attempt CREATE TABLE here. The api_keys schema is
  // a deploy prerequisite (bun scripts/apply-cloud-migrations.mjs).
  const verifier = verifyApiKey({
    app: KNOWLEDGE_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === 'deny') {
        // Never log tokens/keys — kid + reason only.
        console.warn(`[knowledge-serve] auth deny kid=${e.kid ?? '-'} reason=${e.reason} ${e.method} ${e.path}`);
      }
    },
  });

  const handler = createServeHandler({ client, verifier, store, version });

  // Bun.serve is provided by the Bun runtime the Dockerfile uses.
  const BunGlobal = (globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } })
    .Bun;
  if (!BunGlobal?.serve) {
    throw new Error('knowledge-serve requires the Bun runtime (Bun.serve unavailable).');
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=cloud, version=${version})`);

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    },
  };
}
