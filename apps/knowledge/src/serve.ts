/**
 * @hasna/knowledge — HTTP serve surface (knowledge-serve).
 *
 * A real HTTP API wrapping the knowledge core library. PURE REMOTE per
 * Amendment A1: the service reads and writes its PostgreSQL backend directly
 * (no local cache, no sync engine in the service). Requests are authenticated
 * with @hasna/contracts API-key middleware.
 *
 * Surfaces:
 *   GET  /health          liveness — { status, version, backend }      (public)
 *   GET  /ready           readiness — pings the DB                      (public)
 *   GET  /version         { status, version, backend }                 (public)
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)       (public)
 *   GET  /v1/registry     knowledge registry contract                  (auth: knowledge:read)
 *   POST /v1/notes        create a knowledge item                      (auth: knowledge:write)
 *   GET  /v1/notes        list knowledge items                         (auth: knowledge:read)
 *   GET  /v1/notes/{id}   fetch one knowledge item                     (auth: knowledge:read)
 *   PATCH /v1/notes/{id}  update a knowledge item                      (auth: knowledge:write)
 *   DELETE /v1/notes/{id} delete a knowledge item                      (auth: knowledge:write)
 *   GET  /v1/notes/{id}/versions            entry history              (auth: knowledge:read)
 *   GET  /v1/notes/{id}/versions/{version}  one prior snapshot         (auth: knowledge:read)
 *   DELETE /v1/notes/{id}/versions          purge ALL retained history (auth: knowledge:write)
 *   DELETE /v1/notes/{id}/versions/{n}      purge ONE retained version (auth: knowledge:write)
 */
import { readFileSync } from 'node:fs';
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type ApiKeyPrincipal } from '@hasna/contracts/auth';
import { createKnowledgeDatabaseClient } from './db/remote-storage.js';
export { createKnowledgeDatabaseClient } from './db/remote-storage.js';
export { PG_MIGRATIONS } from './db/pg-migrations.js';
export { buildKnowledgePostgresMigrations } from './db/migrate-list.js';
export { MigrationLedger, defineMigration } from './generated/storage-kit/migrations.js';
import { knowledgeRegistryContract } from './registry-contract.js';
import {
  makeId,
  makeShortId,
  type KnowledgeItem,
  type KnowledgeItemVersion,
  type KnowledgeItemVersionList,
} from './store.js';
import {
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  KNOWLEDGE_PRIVATE_INPUT_SCHEMA,
  KNOWLEDGE_PRIVATE_QUERY_SCHEMA,
  KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA,
  KNOWLEDGE_RELATIONS_METADATA_KEY,
  KNOWLEDGE_RELATIONS_SCHEMA,
  assertKnowledgeGuardedBinding,
  assertKnowledgeGuardedBounds,
  assertKnowledgeGuardedManifestOptions,
  assertKnowledgeGuardedPayload,
  assertKnowledgeGuardedPrecondition,
  assertKnowledgePrivateQueryBounds,
  assertKnowledgePrivateQueryPage,
  assertKnowledgePrivateQuerySelector,
  assertKnowledgeRelationsMetadata,
  canonicalKnowledgeGuardedJson,
  computeKnowledgeGuardedAdoptionDeterministicKey,
  computeKnowledgeGuardedAdoptionReceiptId,
  computeKnowledgeGuardedDeterministicKey,
  computeKnowledgeGuardedManifestDeterministicKey,
  computeKnowledgeGuardedManifestDigest,
  computeKnowledgeGuardedReceiptId,
  evaluateKnowledgeGuardedManifestCompletion,
  knowledgeGuardedDigest,
  knowledgeGuardedContentSha256,
  knowledgeGuardedUtf8Bytes,
  knowledgePrivateHistoricalQueryItemProof,
  knowledgePrivateItemProof,
  knowledgePrivateQueryItemProof,
  normalizeKnowledgeGuardedLimits,
  type CreateKnowledgeGuardedManifestOptions,
  type KnowledgeAuthorityBinding,
  type KnowledgeGuardedAdoptionEnvelope,
  type KnowledgeGuardedAdoptionReceipt,
  type KnowledgeGuardedAdoptionReconciliation,
  type KnowledgeGuardedAdoptionSubmission,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedBindingStateReadback,
  type KnowledgeGuardedBounds,
  type KnowledgeGuardedManifest,
  type KnowledgeGuardedManifestEnvelope,
  type KnowledgeGuardedManifestReconciliation,
  type KnowledgeGuardedManifestStep,
  type KnowledgeGuardedManifestSubmission,
  type KnowledgeGuardedPayload,
  type KnowledgeGuardedPrecondition,
  type KnowledgeGuardedReadback,
  type KnowledgeGuardedReceipt,
  type KnowledgeGuardedSubmission,
  type KnowledgeGuardedTitleLookup,
  type KnowledgeGuardedTitleLookupEnvelope,
  type KnowledgeGuardedWriteEnvelope,
  type KnowledgePrivateQueryBounds,
  type KnowledgePrivateQueryEnvelope,
  type KnowledgePrivateQueryResult,
  type KnowledgePrivateQuerySelector,
  type KnowledgeTerminalReconciliation,
} from './guarded-write-contract.js';
import type { PoolQueryClient, TypedQueryClient } from './generated/storage-kit/index.js';
import { KNOWLEDGE_BOUNDED_QUERY_CAPABILITY } from './query-contract.js';
import {
  KnowledgeProjectLinksError,
  createPostgresKnowledgeProjectLinksAuthority,
  knowledgeProjectLinksErrorResponse,
  type KnowledgeProjectItemBindingRequest,
  type KnowledgeProjectInverseRequest,
  type KnowledgeProjectLinksAuthority,
  type KnowledgeProjectReceiptLookupRequest,
  type KnowledgeProjectRegistrationRequest,
  type KnowledgeProjectResourceKind,
} from './project-links.js';

export const KNOWLEDGE_SERVE_APP = 'knowledge';

/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Appends libpq-compat so `require`/`prefer` mean exactly what
 * the kit documents. Never logs the URL. Returns the (possibly) updated value.
 */
export function normalizePostgresDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = 'HASNA_KNOWLEDGE_DATABASE_URL';
  const url = env[key];
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
    return '0.0.0';
  }
}

function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_KNOWLEDGE_API_SIGNING_KEY?.trim() ||
    env.API_KEY_SIGNING_SECRET?.trim() ||
    env.HASNA_API_SIGNING_KEY?.trim();
  if (!secret) {
    throw new Error(
      'knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY ' +
        '(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).',
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Note repository — knowledge_items in the server PostgreSQL backend.
// ---------------------------------------------------------------------------

export interface NoteInput {
  /** Optional caller-supplied stable id (upsert). When present, create is an
   * idempotent upsert on this id — matching the local db.json upsert semantics so
   * `upsert --id <stable>` and data import/re-sync never duplicate through the server. */
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
  /** Literal case-insensitive id/title/content filter. */
  filter?: string;
  /** Repeated raw tag filters; every raw filter narrows the result. */
  tags?: string[];
  archive?: 'active' | 'archived' | 'all';
  sort?: 'created' | 'title';
  direction?: 'asc' | 'desc';
}

export interface NoteSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  archive?: 'active' | 'archived' | 'all';
}

export interface NoteSearchHit {
  item: KnowledgeItem;
  rank: number;
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

/** A purge target is the live row, not a retained prior version. */
export class CannotPurgeLiveVersionError extends Error {
  readonly code = 'cannot_purge_live_version';
  constructor(readonly version: number, readonly current: number, readonly id: string) {
    super(`cannot purge version ${version} of ${id}: it is the live version (the item is at version ${current}), not a retained prior version`);
    this.name = 'CannotPurgeLiveVersionError';
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

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new HttpError(400, `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
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
    if (input.metadata) {
      try {
        assertKnowledgeRelationsMetadata(input.metadata, suppliedId || undefined);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'invalid relation metadata.');
      }
    }
    if (suppliedId) {
      const guarded = await this.client.get<{ guarded: boolean }>(
        `SELECT TRUE AS guarded FROM knowledge_items
          WHERE id = $1 AND authority_classification IS NOT NULL
          LIMIT 1`,
        [suppliedId],
      );
      if (guarded) {
        throw new HttpError(409, 'guarded_item_requires_fcame1_writer');
      }
      // Caller-supplied stable id => idempotent upsert (parity with the local
      // db.json store, where `upsert --id` persists that id so a later get()
      // re-finds it). Without this, HTTP create dropped the id and every
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

  async list(
    options: NoteListOptions = {},
    guardedTenantId?: string,
  ): Promise<{ items: KnowledgeItem[]; total: number }> {
    const limit = boundedInteger(options.limit, 50, 'limit', 1, 200);
    const offset = boundedInteger(options.offset, 0, 'offset', 0, 10_000);
    const params: unknown[] = [];
    const where: string[] = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push('authority_classification IS NULL');
    }
    const archive = options.archive ?? 'active';
    if (archive === 'active') where.push('archived = FALSE');
    else if (archive === 'archived') where.push('archived = TRUE');

    const filter = options.filter?.trim();
    if (filter) {
      params.push(filter);
      const position = params.length;
      where.push(
        `(strpos(LOWER(id), LOWER($${position})) > 0
          OR strpos(LOWER(title), LOWER($${position})) > 0
          OR strpos(LOWER(content), LOWER($${position})) > 0)`,
      );
    }
    for (const raw of options.tags ?? []) {
      const whole = raw.trim().toLowerCase();
      const parts = raw.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      const tagPredicates: string[] = [];
      if (whole) {
        params.push(whole);
        tagPredicates.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
          WHERE LOWER(item_tag) = $${params.length}
        )`);
      }
      if (parts.length > 0) {
        const partPredicates = parts.map((part) => {
          params.push(part);
          return `EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
            WHERE LOWER(item_tag) = $${params.length}
          )`;
        });
        tagPredicates.push(`(${partPredicates.join(' AND ')})`);
      }
      if (tagPredicates.length > 0) where.push(`(${tagPredicates.join(' OR ')})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortColumn = options.sort === 'title' ? 'title' : 'created_at';
    const direction = options.direction === 'desc' ? 'DESC' : 'ASC';
    const orderSql = `ORDER BY ${sortColumn} ${direction}, id ${direction}`;

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

  /**
   * Ranked producer-side PostgreSQL full-text query. This endpoint is separate
   * from list filtering so public list compatibility remains literal.
   */
  async search(
    options: NoteSearchOptions,
    guardedTenantId?: string,
  ): Promise<{ items: NoteSearchHit[]; total: number }> {
    const query = options.query.trim();
    if (!query) throw new HttpError(400, 'q is required');
    const limit = boundedInteger(options.limit, 20, 'limit', 1, 200);
    const offset = boundedInteger(options.offset, 0, 'offset', 0, 10_000);
    const params: unknown[] = [];
    const where: string[] = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push('authority_classification IS NULL');
    }
    const archive = options.archive ?? 'active';
    if (archive === 'active') where.push('archived = FALSE');
    else if (archive === 'archived') where.push('archived = TRUE');
    params.push(query);
    const tsQueryExpr = `websearch_to_tsquery('english', $${params.length})`;
    where.push(`search_vector @@ ${tsQueryExpr}`);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const totalRow = await this.client.get<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`,
      params,
    );
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT *, ts_rank_cd(search_vector, ${tsQueryExpr}) AS search_rank
        FROM knowledge_items
        ${whereSql}
        ORDER BY search_rank DESC, created_at DESC, id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      items: rows.map((row) => ({
        item: rowToItem(row),
        rank: Number(row.search_rank ?? 0),
      })),
      total: Number(totalRow?.count ?? 0),
    };
  }

  async get(idOrShort: string, guardedTenantId?: string): Promise<KnowledgeItem | null> {
    const guardedVisibility = guardedTenantId
      ? 'AND (authority_classification IS NULL OR tenant_id = $2)'
      : 'AND authority_classification IS NULL';
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_items
        WHERE (id = $1 OR short_id = $1)
          ${guardedVisibility}
        LIMIT 1`,
      guardedTenantId ? [idOrShort, guardedTenantId] : [idOrShort],
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
    if (patch.metadata !== undefined) {
      try {
        assertKnowledgeRelationsMetadata(patch.metadata, existing.id);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'invalid relation metadata.');
      }
    }
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
    guardedTenantId?: string,
  ): Promise<NoteVersionList | null> {
    const existing = await this.get(idOrShort, guardedTenantId);
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
  async getVersion(
    idOrShort: string,
    version: number,
    guardedTenantId?: string,
  ): Promise<NoteVersion | null> {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing) return null;
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_item_versions WHERE item_id = $1 AND version = $2`,
      [existing.id, version],
    );
    return row ? rowToVersion(row) : null;
  }

  /**
   * Permanently purge retained prior versions of an entry — the secret-hygiene
   * capability that redacts history that must stop being reachable.
   *
   * The operation deletes by id/version and NEVER reads the retained body, so a
   * credential sitting in history cannot be rendered as a side effect of
   * removing it. The live row is never a purge target.
   *
   * Returns `null` — not an empty purge — when the entry itself is absent, the
   * same contract as {@link listVersions}. With no `version` option, every
   * retained prior version is deleted; with `version`, only that one.
   *
   * Deleting a retained version is consistent with the schema's own guard: the
   * append-only trigger blocks UPDATE of `knowledge_item_versions`, while
   * DELETE is deliberately allowed (it already cascades from item deletion).
   */
  async purgeVersions(
    idOrShort: string,
    options?: { version?: number },
    guardedTenantId?: string,
  ): Promise<{ purged: number; current_version: number } | null> {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing) return null;
    const currentVersion = existing.version ?? 1;

    if (options?.version !== undefined) {
      const version = options.version;
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(`version must be a positive integer, got ${version}`);
      }
      // Only the EXACT live version is refused — a version past the current one
      // is simply not retained, and must no-op (purged 0) rather than error.
      if (version === currentVersion) {
        throw new CannotPurgeLiveVersionError(version, currentVersion, existing.id);
      }
      const deleted = await this.client.query<{ version: number }>(
        `DELETE FROM knowledge_item_versions WHERE item_id = $1 AND version = $2 RETURNING version`,
        [existing.id, version],
      );
      return { purged: deleted.rows.length, current_version: currentVersion };
    }

    const deleted = await this.client.query<{ version: number }>(
      `DELETE FROM knowledge_item_versions WHERE item_id = $1 RETURNING version`,
      [existing.id],
    );
    return { purged: deleted.rows.length, current_version: currentVersion };
  }

  async delete(idOrShort: string): Promise<boolean> {
    const existing = await this.get(idOrShort);
    if (!existing) return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}

// ---------------------------------------------------------------------------
// FCAME-1 guarded production writer.
// ---------------------------------------------------------------------------

export interface KnowledgeServeGuardedAuthority extends KnowledgeAuthorityBinding {}

class OperationBindingConflictError extends Error {
  constructor(readonly receipt: KnowledgeGuardedReceipt | null) {
    super('operation and step are already bound to a different deterministic key');
    this.name = 'OperationBindingConflictError';
  }
}

class AdoptionOperationBindingConflictError extends Error {
  constructor(readonly receipt: KnowledgeGuardedAdoptionReceipt | null) {
    super('adoption operation and step are already bound to a different deterministic key');
    this.name = 'AdoptionOperationBindingConflictError';
  }
}

class ManifestBindingConflictError extends Error {
  constructor(readonly manifest: KnowledgeGuardedManifest) {
    super('manifest_id is already bound to a different deterministic key');
    this.name = 'ManifestBindingConflictError';
  }
}

function rowToAdoptionReceipt(row: Record<string, unknown>): KnowledgeGuardedAdoptionReceipt {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    action: String(row.action) as KnowledgeGuardedAdoptionReceipt['action'],
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(
          row.authority_classification,
        ) as KnowledgeAuthorityBinding['classification'],
        authority_id: String(row.authority_id),
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id),
    },
    expected_version: Number(row.expected_version),
    expected_content_sha256: String(row.expected_content_sha256),
    adoption_receipt_id: row.adoption_receipt_id == null
      ? null
      : String(row.adoption_receipt_id),
    prior_tenant_id: row.prior_tenant_id == null ? null : String(row.prior_tenant_id),
    status: String(row.status) as KnowledgeGuardedAdoptionReceipt['status'],
    code: String(row.code),
    effect_count: Number(row.effect_count) as 0 | 1,
    result_version: row.result_version == null ? null : Number(row.result_version),
    result_content_sha256: row.result_content_sha256 == null
      ? null
      : String(row.result_content_sha256),
    created_at: String(row.created_at),
  };
}

function guardedPreconditionFromRow(row: Record<string, unknown>): KnowledgeGuardedPrecondition {
  return row.precondition_kind === 'absent'
    ? { kind: 'absent' }
    : { kind: 'version', expected_version: Number(row.expected_version) };
}

function rowToGuardedReceipt(row: Record<string, unknown>): KnowledgeGuardedReceipt {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    verb: String(row.verb) as KnowledgeGuardedReceipt['verb'],
    target_id: String(row.target_id),
    authority: {
      classification: String(row.authority_classification) as KnowledgeAuthorityBinding['classification'],
      authority_id: String(row.authority_id),
    },
    tenant_id: String(row.tenant_id),
    scope: String(row.scope),
    parent_id: String(row.parent_id),
    payload_digest: String(row.payload_digest),
    precondition: guardedPreconditionFromRow(row),
    manifest: row.manifest_id == null
      ? null
      : {
        manifest_id: String(row.manifest_id),
        ordinal: Number(row.manifest_ordinal),
        phase: String(row.manifest_phase) as 'primary' | 'recovery',
        compensates_receipt_id: row.compensates_receipt_id == null
          ? null
          : String(row.compensates_receipt_id),
      },
    status: String(row.status) as KnowledgeGuardedReceipt['status'],
    code: String(row.code),
    effect_count: Number(row.effect_count) as 0 | 1,
    result_id: row.result_id == null ? null : String(row.result_id),
    result_version: row.result_version == null ? null : Number(row.result_version),
    created_at: String(row.created_at),
  };
}

function rowMatchesGuardedBinding(row: Record<string, unknown>, binding: KnowledgeGuardedBinding): boolean {
  return (
    row.authority_classification === binding.authority.classification
    && row.authority_id === binding.authority.authority_id
    && row.tenant_id === binding.tenant_id
    && row.scope === binding.scope
    && row.parent_id === binding.parent_id
  );
}

function guardedRelationTargets(payload: KnowledgeGuardedPayload): string[] {
  if (!('metadata' in payload) || !payload.metadata) return [];
  const relation = payload.metadata[KNOWLEDGE_RELATIONS_METADATA_KEY];
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return [];
  const value = relation as Record<string, unknown>;
  return [value.supersedes_item_id, value.canonical_item_id]
    .filter((target): target is string => typeof target === 'string');
}

function rowToManifestStep(row: Record<string, unknown>): KnowledgeGuardedManifestStep {
  return {
    ordinal: Number(row.ordinal),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    deterministic_key: String(row.deterministic_key),
    verb: String(row.verb) as KnowledgeGuardedManifestStep['verb'],
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(row.authority_classification) as KnowledgeAuthorityBinding['classification'],
        authority_id: String(row.authority_id),
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id),
    },
    semantic_digest: String(row.semantic_digest),
    precondition: guardedPreconditionFromRow(row),
    dependencies: parseJsonColumn<number[]>(row.dependencies, []),
    limits: parseJsonColumn(row.limits, normalizeKnowledgeGuardedLimits()),
    recovery: {
      strategy: String(row.recovery_strategy) as KnowledgeGuardedManifestStep['recovery']['strategy'],
      operation_id: String(row.recovery_operation_id),
      step_id: String(row.recovery_step_id),
      deterministic_key: String(row.recovery_deterministic_key),
      verb: String(row.recovery_verb) as KnowledgeGuardedManifestStep['recovery']['verb'],
      target_id: String(row.recovery_target_id),
      semantic_digest: String(row.recovery_semantic_digest),
      precondition: row.recovery_precondition_kind === 'absent'
        ? { kind: 'absent' }
        : { kind: 'version', expected_version: Number(row.recovery_expected_version) },
      binding: {
        authority: {
          classification: String(
            row.recovery_authority_classification,
          ) as KnowledgeAuthorityBinding['classification'],
          authority_id: String(row.recovery_authority_id),
        },
        tenant_id: String(row.recovery_tenant_id),
        scope: String(row.recovery_scope),
        parent_id: String(row.recovery_parent_id),
      },
      limits: parseJsonColumn(row.recovery_limits, normalizeKnowledgeGuardedLimits()),
      receipt_scope: row.recovery_receipt_scope == null
        ? null
        : 'accepted_step_receipt',
      compensates_receipt_id: row.recovery_compensates_receipt_id == null
        ? null
        : String(row.recovery_compensates_receipt_id),
    },
  };
}

function rowsToManifest(
  row: Record<string, unknown>,
  stepRows: Record<string, unknown>[],
): KnowledgeGuardedManifest {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_receipt_id: String(row.manifest_receipt_id),
    manifest_id: String(row.manifest_id),
    operation_id: String(row.operation_id),
    deterministic_key: String(row.deterministic_key),
    manifest_digest: String(row.manifest_digest),
    maintainer: {
      authority: {
        classification: String(
          row.maintainer_authority_classification,
        ) as KnowledgeAuthorityBinding['classification'],
        authority_id: String(row.maintainer_authority_id),
      },
      tenant_id: String(row.maintainer_tenant_id),
      scope: String(row.maintainer_scope),
      parent_id: String(row.maintainer_parent_id),
    },
    step_count: Number(row.step_count),
    steps: stepRows.map(rowToManifestStep),
    created_at: String(row.created_at),
  };
}

class GuardedWriteRepo {
  constructor(
    private readonly client: PoolQueryClient,
    readonly authority: KnowledgeServeGuardedAuthority,
  ) {}

  private binding(envelope: KnowledgeGuardedWriteEnvelope): KnowledgeGuardedBinding {
    return envelope.descriptor.binding;
  }

  private async receiptById(
    client: TypedQueryClient,
    receiptId: string,
  ): Promise<KnowledgeGuardedReceipt | null> {
    const row = await client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_write_receipts WHERE receipt_id = $1`,
      [receiptId],
    );
    return row ? rowToGuardedReceipt(row) : null;
  }

  private async adoptionReceiptById(
    client: TypedQueryClient,
    receiptId: string,
  ): Promise<KnowledgeGuardedAdoptionReceipt | null> {
    const row = await client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_adoption_receipts WHERE receipt_id = $1`,
      [receiptId],
    );
    return row ? rowToAdoptionReceipt(row) : null;
  }

  private async finishAdoption(
    client: TypedQueryClient,
    envelope: KnowledgeGuardedAdoptionEnvelope,
    status: 'accepted' | 'rejected',
    code: string,
    result: { version: number; content_sha256: string } | null,
    priorTenantId: string | null,
  ): Promise<KnowledgeGuardedAdoptionReceipt> {
    const binding = envelope.binding;
    const receiptId = computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key);
    const row = await client.get<Record<string, unknown>>(
      `INSERT INTO knowledge_guarded_adoption_receipts (
         receipt_id, deterministic_key, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id, prior_tenant_id,
         status, code, effect_count, result_version, result_content_sha256
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )
       RETURNING *`,
      [
        receiptId,
        envelope.deterministic_key,
        envelope.operation_id,
        envelope.step_id,
        envelope.action,
        envelope.target_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.expected_version,
        envelope.expected_content_sha256,
        envelope.adoption_receipt_id,
        priorTenantId,
        status,
        code,
        status === 'accepted' ? 1 : 0,
        result?.version ?? null,
        result?.content_sha256 ?? null,
      ],
    );
    const boundClaim = await client.get<{ deterministic_key: string }>(
      `UPDATE knowledge_guarded_adoption_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`,
      [receiptId, envelope.deterministic_key],
    );
    if (!row) throw new Error('guarded adoption receipt insertion returned no row.');
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error('guarded adoption receipt was not bound to exactly one live claim.');
    }
    return rowToAdoptionReceipt(row);
  }

  async bindingState(
    fullId: string,
    binding: KnowledgeGuardedBinding,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedBindingStateReadback | null> {
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_items
        WHERE id = $1
          AND (
            (
              authority_classification IS NULL
              AND (tenant_id IS NULL OR tenant_id::text = $2)
            )
            OR tenant_id::text = $2
          )
        LIMIT 1`,
      [fullId, binding.tenant_id],
    );
    if (!row) return null;
    const legacyForRequestedTenant = (
      row.authority_classification == null
      && row.authority_id == null
      && row.scope == null
      && row.parent_id == null
      && (row.tenant_id == null || String(row.tenant_id) === binding.tenant_id)
    );
    const requested = rowMatchesGuardedBinding(row, binding);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      target_id: fullId,
      state: legacyForRequestedTenant
        ? 'legacy_unbound'
        : requested
          ? 'bound_to_requested'
          : 'bound_elsewhere',
      item_version: legacyForRequestedTenant || requested ? Number(row.version ?? 1) : null,
      content_sha256: legacyForRequestedTenant || requested
        ? knowledgeGuardedContentSha256(String(row.content ?? ''))
        : null,
      limits,
    };
  }

  async executeAdoption(
    envelope: KnowledgeGuardedAdoptionEnvelope,
    actor: string,
  ): Promise<KnowledgeGuardedAdoptionSubmission> {
    const binding = envelope.binding;
    return this.client.transaction(async (tx) => {
      await tx.execute(
        `SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_adoption_key', $3, true)`,
        [
          actor,
          `FCAME-1 ${envelope.action} ${envelope.operation_id}/${envelope.step_id}`,
          envelope.deterministic_key,
        ],
      );
      await tx.execute(
        `INSERT INTO knowledge_guarded_adoption_claims (
           deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           expected_version, expected_content_sha256, adoption_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`,
        [
          envelope.deterministic_key,
          computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
          envelope.operation_id,
          envelope.step_id,
          envelope.action,
          envelope.target_id,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id,
          envelope.expected_version,
          envelope.expected_content_sha256,
          envelope.adoption_receipt_id,
        ],
      );
      const claim = await tx.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_adoption_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`,
        [
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id,
          envelope.operation_id,
          envelope.step_id,
        ],
      );
      if (!claim) throw new Error('guarded adoption claim was not created.');
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt = claim.receipt_id
          ? await this.adoptionReceiptById(tx, String(claim.receipt_id))
          : null;
        throw new AdoptionOperationBindingConflictError(receipt);
      }
      if (claim.receipt_id) {
        const receipt = await this.adoptionReceiptById(tx, String(claim.receipt_id));
        if (!receipt) throw new Error('guarded adoption claim references a missing receipt.');
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: true,
        };
      }

      if (envelope.action === 'rollback') {
        const source = envelope.adoption_receipt_id
          ? await this.adoptionReceiptById(tx, envelope.adoption_receipt_id)
          : null;
        if (
          !source
          || source.action !== 'adopt'
          || source.status !== 'accepted'
          || source.effect_count !== 1
          || source.target_id !== envelope.target_id
          || source.result_version !== envelope.expected_version
          || source.result_content_sha256 !== envelope.expected_content_sha256
          || canonicalKnowledgeGuardedJson(source.binding)
            !== canonicalKnowledgeGuardedJson(binding)
        ) {
          const receipt = await this.finishAdoption(
            tx,
            envelope,
            'rejected',
            'adoption_receipt_mismatch',
            null,
            null,
          );
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt,
            duplicate: false,
          };
        }
      }

      const existing = await tx.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_items
          WHERE id = $1
            AND (tenant_id IS NULL OR tenant_id::text = $2)
          FOR UPDATE`,
        [envelope.target_id, binding.tenant_id],
      );
      if (!existing) {
        const receipt = await this.finishAdoption(tx, envelope, 'rejected', 'not_found', null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }

      const legacyForRequestedTenant = (
        existing.authority_classification == null
        && existing.authority_id == null
        && existing.scope == null
        && existing.parent_id == null
        && (existing.tenant_id == null || String(existing.tenant_id) === binding.tenant_id)
      );
      const requested = rowMatchesGuardedBinding(existing, binding);
      if (
        (envelope.action === 'adopt' && !legacyForRequestedTenant)
        || (
          envelope.action === 'rollback'
          && (
            !requested
            || existing.guarded_adoption_receipt_id !== envelope.adoption_receipt_id
          )
        )
      ) {
        const code = envelope.action === 'adopt'
          ? (requested ? 'already_bound' : 'binding_mismatch')
          : (
            requested
              ? 'adoption_receipt_not_current'
              : 'binding_mismatch'
          );
        const receipt = await this.finishAdoption(tx, envelope, 'rejected', code, null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== envelope.expected_version) {
        const receipt = await this.finishAdoption(
          tx,
          envelope,
          'rejected',
          'version_conflict',
          null,
          null,
        );
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }
      const currentContentSha256 = knowledgeGuardedContentSha256(String(existing.content ?? ''));
      if (currentContentSha256 !== envelope.expected_content_sha256) {
        const receipt = await this.finishAdoption(
          tx,
          envelope,
          'rejected',
          'content_digest_conflict',
          null,
          null,
        );
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }

      const updated = envelope.action === 'adopt'
        ? await tx.get<Record<string, unknown>>(
          `UPDATE knowledge_items SET
             authority_classification = $1,
             authority_id = $2,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $3::text)
               )
             ).tenant_id,
             scope = $4,
             parent_id = $5,
             guarded_adoption_receipt_id = $6
           WHERE id = $7
             AND version = $8
             AND authority_classification IS NULL
             AND authority_id IS NULL
             AND scope IS NULL
             AND parent_id IS NULL
             AND guarded_adoption_receipt_id IS NULL
             AND (tenant_id IS NULL OR tenant_id::text = $3)
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $9
           RETURNING *`,
          [
            binding.authority.classification,
            binding.authority.authority_id,
            binding.tenant_id,
            binding.scope,
            binding.parent_id,
            computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
            envelope.target_id,
            envelope.expected_version,
            envelope.expected_content_sha256,
          ],
        )
        : await tx.get<Record<string, unknown>>(
          `UPDATE knowledge_items SET
             authority_classification = NULL,
             authority_id = NULL,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $1::text)
               )
             ).tenant_id,
             scope = NULL,
             parent_id = NULL,
             guarded_adoption_receipt_id = NULL
           WHERE id = $2
             AND version = $3
             AND authority_classification = $4
             AND authority_id = $5
             AND tenant_id::text = $6
             AND scope = $7
             AND parent_id = $8
             AND guarded_adoption_receipt_id = $9
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $10
           RETURNING *`,
          [
            (
              await this.adoptionReceiptById(tx, envelope.adoption_receipt_id!)
            )!.prior_tenant_id,
            envelope.target_id,
            envelope.expected_version,
            binding.authority.classification,
            binding.authority.authority_id,
            binding.tenant_id,
            binding.scope,
            binding.parent_id,
            envelope.adoption_receipt_id,
            envelope.expected_content_sha256,
          ],
        );
      if (!updated) {
        const receipt = await this.finishAdoption(
          tx,
          envelope,
          'rejected',
          'compare_and_swap_conflict',
          null,
          null,
        );
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }
      const result = {
        version: Number(updated.version ?? 1),
        content_sha256: knowledgeGuardedContentSha256(String(updated.content ?? '')),
      };
      const receipt = await this.finishAdoption(
        tx,
        envelope,
        'accepted',
        envelope.action === 'adopt' ? 'adopted' : 'rolled_back',
        result,
        envelope.action === 'adopt'
          ? (existing.tenant_id == null ? null : String(existing.tenant_id))
          : (
            await this.adoptionReceiptById(tx, envelope.adoption_receipt_id!)
          )!.prior_tenant_id,
      );
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false,
      };
    });
  }

  async reconcileAdoption(
    deterministicKey: string,
    binding: KnowledgeGuardedBinding,
    operationId: string,
    stepId: string,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedAdoptionReconciliation> {
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_adoption_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`,
      [
        deterministicKey,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        operationId,
        stepId,
      ],
    );
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToAdoptionReceipt(row) : null,
      limits,
    };
  }

  private async manifestById(
    client: TypedQueryClient,
    manifestId: string,
  ): Promise<KnowledgeGuardedManifest | null> {
    const row = await client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1`,
      [manifestId],
    );
    if (!row) return null;
    const steps = await client.many<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_write_manifest_steps
        WHERE manifest_id = $1 ORDER BY ordinal ASC`,
      [manifestId],
    );
    return rowsToManifest(row, steps);
  }

  async createManifest(
    envelope: KnowledgeGuardedManifestEnvelope,
  ): Promise<KnowledgeGuardedManifestSubmission> {
    const { manifest, maintainer } = envelope;
    return this.client.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO knowledge_guarded_write_manifests (
           manifest_id, manifest_receipt_id, deterministic_key, operation_id,
           manifest_digest,
           maintainer_authority_classification, maintainer_authority_id,
           maintainer_tenant_id, maintainer_scope, maintainer_parent_id,
           step_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [
          manifest.manifest_id,
          `kmr_${envelope.deterministic_key.replace(/^fcame1_manifest_/, '')}`,
          envelope.deterministic_key,
          manifest.operation_id,
          computeKnowledgeGuardedManifestDigest(maintainer, manifest),
          maintainer.authority.classification,
          maintainer.authority.authority_id,
          maintainer.tenant_id,
          maintainer.scope,
          maintainer.parent_id,
          manifest.steps.length,
        ],
      );
      const row = await tx.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1 FOR UPDATE`,
        [manifest.manifest_id],
      );
      if (!row) throw new Error('guarded manifest was not created.');
      const existingSteps = await tx.many<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_manifest_steps
          WHERE manifest_id = $1 ORDER BY ordinal ASC`,
        [manifest.manifest_id],
      );
      if (row.deterministic_key !== envelope.deterministic_key) {
        throw new ManifestBindingConflictError(rowsToManifest(row, existingSteps));
      }
      const duplicate = existingSteps.length > 0;
      if (!duplicate) {
        for (const step of manifest.steps) {
          await tx.execute(
            `INSERT INTO knowledge_guarded_write_manifest_steps (
               manifest_id, ordinal, operation_id, step_id, deterministic_key,
               verb, target_id, semantic_digest, precondition_kind, expected_version,
               dependencies, limits,
               authority_classification, authority_id, tenant_id, scope, parent_id,
               recovery_strategy, recovery_operation_id, recovery_step_id,
               recovery_deterministic_key, recovery_verb, recovery_target_id,
               recovery_semantic_digest, recovery_precondition_kind, recovery_expected_version,
               recovery_authority_classification, recovery_authority_id,
               recovery_tenant_id, recovery_scope, recovery_parent_id,
               recovery_limits, recovery_receipt_scope, recovery_compensates_receipt_id
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
             )`,
            [
              manifest.manifest_id,
              step.ordinal,
              step.operation_id,
              step.step_id,
              step.deterministic_key,
              step.verb,
              step.target_id,
              step.semantic_digest,
              step.precondition.kind,
              step.precondition.kind === 'version' ? step.precondition.expected_version : null,
              JSON.stringify(step.dependencies),
              JSON.stringify(step.limits),
              step.binding.authority.classification,
              step.binding.authority.authority_id,
              step.binding.tenant_id,
              step.binding.scope,
              step.binding.parent_id,
              step.recovery.strategy,
              step.recovery.operation_id,
              step.recovery.step_id,
              step.recovery.deterministic_key,
              step.recovery.verb,
              step.recovery.target_id,
              step.recovery.semantic_digest,
              step.recovery.precondition.kind,
              step.recovery.precondition.kind === 'version'
                ? step.recovery.precondition.expected_version
                : null,
              step.recovery.binding.authority.classification,
              step.recovery.binding.authority.authority_id,
              step.recovery.binding.tenant_id,
              step.recovery.binding.scope,
              step.recovery.binding.parent_id,
              JSON.stringify(step.recovery.limits),
              step.recovery.receipt_scope,
              step.recovery.compensates_receipt_id,
            ],
          );
        }
      }
      const stored = await this.manifestById(tx, manifest.manifest_id);
      if (!stored || stored.steps.length !== manifest.steps.length) {
        throw new Error('guarded manifest exact readback failed in its creation transaction.');
      }
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        manifest: stored,
        duplicate,
      };
    });
  }

  private async assertManifestStep(
    client: TypedQueryClient,
    envelope: KnowledgeGuardedWriteEnvelope,
  ): Promise<void> {
    const manifestBinding = envelope.descriptor.manifest;
    if (!manifestBinding) return;
    // Serialize every primary and recovery decision for one manifest through
    // commit. Without this shared row lock, a next-primary transaction and a
    // recovery transaction can both observe the other's receipt as absent at
    // READ COMMITTED, then commit contradictory effects and terminal receipts.
    const lockedManifest = await client.get<{ manifest_id: string }>(
      `SELECT manifest_id FROM knowledge_guarded_write_manifests
        WHERE manifest_id = $1
        FOR UPDATE`,
      [manifestBinding.manifest_id],
    );
    if (!lockedManifest) throw new HttpError(409, 'guarded manifest does not exist.');
    const manifest = await this.manifestById(client, manifestBinding.manifest_id);
    if (!manifest) throw new Error('locked guarded manifest disappeared inside its transaction.');
    const step = manifest.steps[manifestBinding.ordinal];
    if (!step || step.ordinal !== manifestBinding.ordinal) {
      throw new HttpError(409, 'guarded manifest step does not exist.');
    }
    const descriptor = envelope.descriptor;
    const action = manifestBinding.phase === 'primary' ? step : step.recovery;
    if (
      action.deterministic_key !== envelope.deterministic_key
      || action.operation_id !== descriptor.operation_id
      || action.step_id !== descriptor.step_id
      || action.verb !== descriptor.verb
      || action.target_id !== descriptor.target_id
      || action.semantic_digest !== descriptor.payload_digest
      || canonicalKnowledgeGuardedJson(action.precondition)
        !== canonicalKnowledgeGuardedJson(descriptor.precondition)
      || canonicalKnowledgeGuardedJson(action.binding)
        !== canonicalKnowledgeGuardedJson(descriptor.binding)
      || canonicalKnowledgeGuardedJson(action.limits)
        !== canonicalKnowledgeGuardedJson(envelope.limits)
    ) {
      throw new HttpError(409, 'guarded write does not match its immutable manifest step.');
    }
    if (
      manifestBinding.phase === 'recovery'
      && (
        manifestBinding.compensates_receipt_id !== step.recovery.compensates_receipt_id
        || (
          step.recovery.strategy === 'receipt_scoped_compensation'
          && manifestBinding.compensates_receipt_id === null
        )
      )
    ) {
      throw new HttpError(409, 'guarded recovery does not match its receipt-scoped manifest action.');
    }
    const existingExactReceipt = await client.get<Record<string, unknown>>(
      `SELECT receipt_id FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`,
      [
        envelope.deterministic_key,
        descriptor.binding.authority.classification,
        descriptor.binding.authority.authority_id,
        descriptor.binding.tenant_id,
        descriptor.binding.scope,
        descriptor.binding.parent_id,
        descriptor.operation_id,
        descriptor.step_id,
      ],
    );
    if (existingExactReceipt) return;

    const prerequisites = manifestBinding.phase === 'primary'
      ? step.dependencies.map((ordinal) => manifest.steps[ordinal]!)
      : manifest.steps.slice(0, step.ordinal + 1);
    let prefixReceipt: KnowledgeGuardedReceipt | null = null;
    for (const prior of prerequisites) {
      if (
        prior.binding.authority.classification !== this.authority.classification
        || prior.binding.authority.authority_id !== this.authority.authority_id
      ) {
        throw new HttpError(
          409,
          'manifest_prior_external_authority_receipt_unverified: this authority cannot certify the prior step.',
        );
      }
      const receipt = await client.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`,
        [
          prior.deterministic_key,
          prior.binding.authority.classification,
          prior.binding.authority.authority_id,
          prior.binding.tenant_id,
          prior.binding.scope,
          prior.binding.parent_id,
        ],
      );
      if (!receipt || receipt.status !== 'accepted') {
        throw new HttpError(409, 'manifest_prior_step_not_accepted.');
      }
      if (prior.ordinal === step.ordinal) prefixReceipt = rowToGuardedReceipt(receipt);
    }
    if (manifestBinding.phase === 'primary') {
      for (const prior of prerequisites) {
        if (
          prior.recovery.binding.authority.classification !== this.authority.classification
          || prior.recovery.binding.authority.authority_id !== this.authority.authority_id
          || prior.recovery.binding.tenant_id !== descriptor.binding.tenant_id
        ) {
          throw new HttpError(
            409,
            'external_authority_receipt_verifier_required: '
            + 'this authority cannot prove that a prior recovery action is absent.',
          );
        }
        const recoveryReceipt = await client.get<Record<string, unknown>>(
          `SELECT status FROM knowledge_guarded_write_receipts
            WHERE deterministic_key = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
              AND operation_id = $7
              AND step_id = $8
            LIMIT 1`,
          [
            prior.recovery.deterministic_key,
            prior.recovery.binding.authority.classification,
            prior.recovery.binding.authority.authority_id,
            prior.recovery.binding.tenant_id,
            prior.recovery.binding.scope,
            prior.recovery.binding.parent_id,
            prior.recovery.operation_id,
            prior.recovery.step_id,
          ],
        );
        if (recoveryReceipt) {
          throw new HttpError(
            409,
            'manifest_prior_recovery_terminal: the workflow cannot resume its primary path '
            + 'after a declared recovery action reached a terminal receipt.',
          );
        }
      }
    }
    if (
      manifestBinding.phase === 'recovery'
      && step.recovery.strategy === 'receipt_scoped_compensation'
      && prefixReceipt?.receipt_id !== step.recovery.compensates_receipt_id
    ) {
      throw new HttpError(409, 'manifest compensation is not scoped to the accepted prefix receipt.');
    }
    if (manifestBinding.phase === 'recovery') {
      const next = manifest.steps[step.ordinal + 1];
      if (!next) {
        throw new HttpError(409, 'manifest has no partial suffix after this prefix; recovery is not runnable.');
      }
      if (
        next.binding.authority.classification !== this.authority.classification
        || next.binding.authority.authority_id !== this.authority.authority_id
        || next.binding.tenant_id !== descriptor.binding.tenant_id
      ) {
        throw new HttpError(
          409,
          'external_authority_receipt_verifier_required: recovery cannot infer the next authority state.',
        );
      }
      const nextReceipt = await client.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`,
        [
          next.deterministic_key,
          next.binding.authority.classification,
          next.binding.authority.authority_id,
          next.binding.tenant_id,
          next.binding.scope,
          next.binding.parent_id,
        ],
      );
      if (nextReceipt?.status === 'accepted') {
        throw new HttpError(409, 'manifest prefix has already advanced; this recovery action is no longer runnable.');
      }
    }
  }

  private async finish(
    client: TypedQueryClient,
    envelope: KnowledgeGuardedWriteEnvelope,
    status: 'accepted' | 'rejected',
    code: string,
    result: KnowledgeItem | null,
  ): Promise<KnowledgeGuardedReceipt> {
    const descriptor = envelope.descriptor;
    const binding = descriptor.binding;
    const receiptId = computeKnowledgeGuardedReceiptId(envelope.deterministic_key);
    const row = await client.get<Record<string, unknown>>(
      `INSERT INTO knowledge_guarded_write_receipts (
         receipt_id, deterministic_key, operation_id, step_id, verb, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         payload_digest, precondition_kind, expected_version,
         manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id,
         status, code, effect_count, result_id, result_version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       )
       RETURNING *`,
      [
        receiptId,
        envelope.deterministic_key,
        descriptor.operation_id,
        descriptor.step_id,
        descriptor.verb,
        descriptor.target_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        descriptor.payload_digest,
        descriptor.precondition.kind,
        descriptor.precondition.kind === 'version' ? descriptor.precondition.expected_version : null,
        descriptor.manifest?.manifest_id ?? null,
        descriptor.manifest?.ordinal ?? null,
        descriptor.manifest?.phase ?? null,
        descriptor.manifest?.compensates_receipt_id ?? null,
        status,
        code,
        status === 'accepted' ? 1 : 0,
        result?.id ?? null,
        result?.version ?? null,
      ],
    );
    const boundClaim = await client.get<Record<string, unknown>>(
      `UPDATE knowledge_guarded_write_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`,
      [receiptId, envelope.deterministic_key],
    );
    if (!row) throw new Error('guarded receipt insertion returned no row.');
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error('guarded receipt was not bound to exactly one live operation claim.');
    }
    return rowToGuardedReceipt(row);
  }

  async execute(
    envelope: KnowledgeGuardedWriteEnvelope,
    actor: string,
  ): Promise<KnowledgeGuardedSubmission> {
    const descriptor = envelope.descriptor;
    const binding = this.binding(envelope);
    return this.client.transaction(async (tx) => {
      await tx.execute(
        `SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_deterministic_key', $3, true)`,
        [
          actor,
          `FCAME-1 ${descriptor.operation_id}/${descriptor.step_id}`,
          envelope.deterministic_key,
        ],
      );
      await this.assertManifestStep(tx, envelope);
      await tx.execute(
        `INSERT INTO knowledge_guarded_write_claims (
           deterministic_key, operation_id, step_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           verb, target_id, payload_digest, precondition_kind, expected_version,
           manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING`,
        [
          envelope.deterministic_key,
          descriptor.operation_id,
          descriptor.step_id,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id,
          descriptor.verb,
          descriptor.target_id,
          descriptor.payload_digest,
          descriptor.precondition.kind,
          descriptor.precondition.kind === 'version' ? descriptor.precondition.expected_version : null,
          descriptor.manifest?.manifest_id ?? null,
          descriptor.manifest?.ordinal ?? null,
          descriptor.manifest?.phase ?? null,
          descriptor.manifest?.compensates_receipt_id ?? null,
        ],
      );
      const claim = await tx.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`,
        [
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id,
          descriptor.operation_id,
          descriptor.step_id,
        ],
      );
      if (!claim) throw new Error('guarded operation claim was not created.');
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt = claim.receipt_id
          ? await this.receiptById(tx, String(claim.receipt_id))
          : null;
        throw new OperationBindingConflictError(receipt);
      }
      if (claim.receipt_id) {
        const receipt = await this.receiptById(tx, String(claim.receipt_id));
        if (!receipt) throw new Error('guarded claim references a missing receipt.');
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: true,
        };
      }

      for (const targetId of guardedRelationTargets(envelope.payload)) {
        const target = await tx.get<{ id: string }>(
          `SELECT id FROM knowledge_items
            WHERE id = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
            LIMIT 1`,
          [
            targetId,
            binding.authority.classification,
            binding.authority.authority_id,
            binding.tenant_id,
            binding.scope,
            binding.parent_id,
          ],
        );
        if (!target) {
          const receipt = await this.finish(
            tx,
            envelope,
            'rejected',
            'relation_binding_mismatch',
            null,
          );
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt,
            duplicate: false,
          };
        }
      }

      if (descriptor.verb === 'create') {
        const payload = envelope.payload as Extract<KnowledgeGuardedPayload, { title: string }>;
        const now = new Date().toISOString();
        const inserted = await tx.get<Record<string, unknown>>(
          `INSERT INTO knowledge_items (
             id, short_id, title, content, url, tags, metadata, archived,
             created_at, updated_at,
             authority_classification, authority_id, tenant_id, scope, parent_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8,$9,$10,$11,$12,$13
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING *`,
          [
            descriptor.target_id,
            makeShortId(descriptor.target_id),
            payload.title,
            payload.content ?? '',
            payload.url ?? null,
            JSON.stringify(payload.tags ?? []),
            JSON.stringify(payload.metadata ?? {}),
            now,
            binding.authority.classification,
            binding.authority.authority_id,
            binding.tenant_id,
            binding.scope,
            binding.parent_id,
          ],
        );
        if (!inserted) {
          const existing = await tx.get<Record<string, unknown>>(
            `SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`,
            [descriptor.target_id],
          );
          const code = existing && rowMatchesGuardedBinding(existing, binding)
            ? 'target_exists'
            : 'binding_mismatch';
          const receipt = await this.finish(tx, envelope, 'rejected', code, null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt,
            duplicate: false,
          };
        }
        const item = rowToItem(inserted);
        const receipt = await this.finish(tx, envelope, 'accepted', 'created', item);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }

      const existing = await tx.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`,
        [descriptor.target_id],
      );
      if (!existing) {
        const receipt = await this.finish(tx, envelope, 'rejected', 'not_found', null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }
      if (!rowMatchesGuardedBinding(existing, binding)) {
        const receipt = await this.finish(tx, envelope, 'rejected', 'binding_mismatch', null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }
      const expectedVersion = descriptor.precondition.kind === 'version'
        ? descriptor.precondition.expected_version
        : 0;
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== expectedVersion) {
        const receipt = await this.finish(tx, envelope, 'rejected', 'version_conflict', null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt,
          duplicate: false,
        };
      }

      const patch = envelope.payload as Record<string, unknown>;
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (column: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (patch.title !== undefined) push('title', patch.title);
      if (patch.content !== undefined) push('content', patch.content);
      if (patch.url !== undefined) push('url', patch.url);
      if (patch.tags !== undefined) push('tags', JSON.stringify(patch.tags), '::jsonb');
      if (patch.metadata !== undefined) push('metadata', JSON.stringify(patch.metadata), '::jsonb');
      if (patch.archived !== undefined) push('archived', patch.archived);
      push('updated_at', new Date().toISOString());
      params.push(descriptor.target_id);
      const idPosition = params.length;
      params.push(expectedVersion);
      const versionPosition = params.length;
      const updated = await tx.get<Record<string, unknown>>(
        `UPDATE knowledge_items
            SET ${sets.join(', ')}
          WHERE id = $${idPosition} AND version = $${versionPosition}
          RETURNING *`,
        params,
      );
      if (!updated) throw new Error('guarded compare-and-swap lost its locked target.');
      const item = rowToItem(updated);
      const receipt = await this.finish(tx, envelope, 'accepted', 'updated', item);
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false,
      };
    });
  }

  async reconcileManifest(
    manifestId: string,
    maintainer: KnowledgeGuardedBinding,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedManifestReconciliation | null> {
    const manifest = await this.manifestById(this.client, manifestId);
    if (
      !manifest
      || canonicalKnowledgeGuardedJson(manifest.maintainer) !== canonicalKnowledgeGuardedJson(maintainer)
    ) {
      return null;
    }
    const steps: KnowledgeGuardedManifestReconciliation['steps'] = [];
    const externalAuthorities = new Set<string>();
    const reconcileAction = async (action: {
      deterministic_key: string;
      operation_id: string;
      step_id: string;
      binding: KnowledgeGuardedBinding;
    }): Promise<{
      state: KnowledgeGuardedManifestReconciliation['steps'][number]['state'];
      receipt: KnowledgeGuardedReceipt | null;
    }> => {
      const locallyVerifiable = (
        action.binding.authority.classification === this.authority.classification
        && action.binding.authority.authority_id === this.authority.authority_id
        && action.binding.tenant_id === maintainer.tenant_id
      );
      if (!locallyVerifiable) {
        const authorityKey = `${action.binding.authority.classification}:${action.binding.authority.authority_id}`;
        externalAuthorities.add(authorityKey);
        return { state: 'unverified_external_authority', receipt: null };
      }
      const row = await this.client.get<Record<string, unknown>>(
        `SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
            AND operation_id = $7
            AND step_id = $8
          LIMIT 1`,
        [
          action.deterministic_key,
          action.binding.authority.classification,
          action.binding.authority.authority_id,
          action.binding.tenant_id,
          action.binding.scope,
          action.binding.parent_id,
          action.operation_id,
          action.step_id,
        ],
      );
      const receipt = row ? rowToGuardedReceipt(row) : null;
      return { state: receipt?.status ?? 'missing', receipt };
    };
    for (const step of manifest.steps) {
      const primary = await reconcileAction(step);
      const recovery = await reconcileAction(step.recovery);
      steps.push({
        ordinal: step.ordinal,
        deterministic_key: step.deterministic_key,
        authority: step.binding.authority,
        state: primary.state,
        receipt: primary.receipt,
        recovery_deterministic_key: step.recovery.deterministic_key,
        recovery_state: recovery.state,
        recovery_receipt: recovery.receipt,
      });
    }
    const completion = evaluateKnowledgeGuardedManifestCompletion(steps);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      manifest,
      exact: true,
      bounded: true,
      terminal_complete: completion.terminal_complete,
      accepted_complete: completion.accepted_complete,
      unsupported_gap: externalAuthorities.size > 0
        ? `external_authority_receipt_verifier_required:${[...externalAuthorities].sort().join(',')}`
        : null,
      steps,
      limits,
    };
  }

  async reconcile(
    deterministicKey: string,
    binding: KnowledgeGuardedBinding,
    operationId: string,
    stepId: string,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeTerminalReconciliation> {
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`,
      [
        deterministicKey,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        operationId,
        stepId,
      ],
    );
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToGuardedReceipt(row) : null,
      limits,
    };
  }

  async lookupTitle(
    title: string,
    binding: KnowledgeGuardedBinding,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedTitleLookup> {
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM knowledge_items
        WHERE title = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        ORDER BY id
        LIMIT 2`,
      [
        title,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
      ],
    );
    if (rows.length > 1) throw new PrivateTitleLookupAmbiguousError();
    const items = rows.map((row) => knowledgePrivateItemProof(rowToItem(row)));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: items.length as 0 | 1,
      binding,
      title_digest: knowledgeGuardedContentSha256(title),
      items,
      limits,
    };
  }

  async query(
    selector: KnowledgePrivateQuerySelector,
    selectorDigest: string,
    archive: 'active' | 'archived' | 'all',
    page: { limit: number; offset: number },
    binding: KnowledgeGuardedBinding,
    limits: KnowledgePrivateQueryBounds,
  ): Promise<KnowledgePrivateQueryResult> {
    if (selector.kind === 'semantic_overlap') {
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: 'unavailable',
        code: 'semantic_query_unavailable',
        binding,
        selector_digest: selectorDigest,
        total: 0,
        item_count: 0,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: 0,
          has_more: false,
        },
        items: [],
        limits,
      };
    }

    const bindingParams: unknown[] = [
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
    ];
    const currentWhere = [
      'authority_classification = $1',
      'authority_id = $2',
      'tenant_id = $3',
      'scope = $4',
      'parent_id = $5',
    ];
    if (archive === 'active') currentWhere.push('archived = FALSE');
    else if (archive === 'archived') currentWhere.push('archived = TRUE');
    let currentOrder = 'ORDER BY id ASC';
    let matchedValue: string;

    if (selector.kind === 'historical_version') {
      const params: unknown[] = [...bindingParams, selector.item_id, selector.version];
      const historyWhere = [
        'i.authority_classification = $1',
        'i.authority_id = $2',
        'i.tenant_id = $3',
        'i.scope = $4',
        'i.parent_id = $5',
        'v.item_id = $6',
        'v.version = $7',
      ];
      if (archive === 'active') historyWhere.push('v.archived = FALSE');
      else if (archive === 'archived') historyWhere.push('v.archived = TRUE');
      const whereSql = `WHERE ${historyWhere.join(' AND ')}`;
      const totalRow = await this.client.get<{ count: string }>(
        `SELECT count(*)::text AS count
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql}`,
        params,
      );
      const rows = await this.client.many<Record<string, unknown>>(
        `SELECT v.*
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql}
          ORDER BY v.version ASC
          LIMIT ${page.limit} OFFSET ${page.offset}`,
        params,
      );
      const total = Number(totalRow?.count ?? 0);
      const items = rows.map((row) => (
        knowledgePrivateHistoricalQueryItemProof(rowToVersion(row), selector.item_id)
      ));
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: 'available',
        code: null,
        binding,
        selector_digest: selectorDigest,
        total,
        item_count: items.length,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: items.length,
          has_more: page.offset + items.length < total,
        },
        items,
        limits,
      };
    }

    switch (selector.kind) {
      case 'exact_title':
        bindingParams.push(selector.title);
        currentWhere.push(`title = $${bindingParams.length}`);
        matchedValue = selector.title;
        break;
      case 'lexical_overlap': {
        bindingParams.push(selector.query);
        const tsQuery = `websearch_to_tsquery('english', $${bindingParams.length})`;
        currentWhere.push(`search_vector @@ ${tsQuery}`);
        currentOrder = `ORDER BY ts_rank_cd(search_vector, ${tsQuery}) DESC, id ASC`;
        matchedValue = selector.query;
        break;
      }
      case 'supersession':
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.supersedes_item_id);
        currentWhere.push(
          `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`,
          `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},supersedes_item_id}' = $${bindingParams.length}`,
        );
        matchedValue = selector.supersedes_item_id;
        break;
      case 'current_version':
        bindingParams.push(selector.item_id);
        currentWhere.push(`id = $${bindingParams.length}`);
        matchedValue = selector.item_id;
        break;
      case 'canonical_pointer':
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.canonical_item_id);
        currentWhere.push(
          `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`,
          `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},canonical_item_id}' = $${bindingParams.length}`,
        );
        matchedValue = selector.canonical_item_id;
        break;
      default:
        throw new HttpError(400, 'private query selector kind is unsupported.');
    }
    const whereSql = `WHERE ${currentWhere.join(' AND ')}`;
    const totalRow = await this.client.get<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`,
      bindingParams,
    );
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM knowledge_items
        ${whereSql}
        ${currentOrder}
        LIMIT ${page.limit} OFFSET ${page.offset}`,
      bindingParams,
    );
    const total = Number(totalRow?.count ?? 0);
    const items = rows.map((row) => knowledgePrivateQueryItemProof(rowToItem(row), matchedValue));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      private: true,
      query_kind: selector.kind,
      status: 'available',
      code: null,
      binding,
      selector_digest: selectorDigest,
      total,
      item_count: items.length,
      page: {
        limit: page.limit,
        offset: page.offset,
        returned: items.length,
        has_more: page.offset + items.length < total,
      },
      items,
      limits,
    };
  }

  async readback(
    fullId: string,
    binding: KnowledgeGuardedBinding,
    limits: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedReadback | null> {
    const row = await this.client.get<Record<string, unknown>>(
      `SELECT * FROM knowledge_items
        WHERE id = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        LIMIT 1`,
      [
        fullId,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
      ],
    );
    if (!row) return null;
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      binding,
      item: rowToItem(row),
      limits,
    };
  }
}

class PrivateTitleLookupAmbiguousError extends Error {
  constructor() {
    super('more than one exact title exists in the frozen binding.');
    this.name = 'PrivateTitleLookupAmbiguousError';
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
  const guardedReceipt = {
    type: 'object',
    description: 'Immutable FCAME-1 terminal receipt. Private payload bytes are never stored here.',
    properties: {
      contract: { type: 'string', enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: 'string' },
      deterministic_key: { type: 'string' },
      operation_id: { type: 'string' },
      step_id: { type: 'string' },
      status: { type: 'string', enum: ['accepted', 'rejected'] },
      code: { type: 'string' },
      effect_count: { type: 'integer', enum: [0, 1] },
      result_id: { type: 'string', nullable: true },
      result_version: { type: 'integer', nullable: true },
      created_at: { type: 'string' },
    },
    required: [
      'contract',
      'receipt_id',
      'deterministic_key',
      'operation_id',
      'step_id',
      'status',
      'code',
      'effect_count',
      'created_at',
    ],
  };
  const guardedAdoptionReceipt = {
    type: 'object',
    description:
      'Immutable FCAME-1 receipt for an exact legacy binding adoption or its receipt-scoped rollback.',
    properties: {
      contract: { type: 'string', enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: 'string' },
      deterministic_key: { type: 'string' },
      action: { type: 'string', enum: ['adopt', 'rollback'] },
      operation_id: { type: 'string' },
      step_id: { type: 'string' },
      target_id: { type: 'string' },
      expected_version: { type: 'integer' },
      expected_content_sha256: { type: 'string' },
      adoption_receipt_id: { type: 'string', nullable: true },
      prior_tenant_id: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['accepted', 'rejected'] },
      code: { type: 'string' },
      effect_count: { type: 'integer', enum: [0, 1] },
      result_version: { type: 'integer', nullable: true },
      result_content_sha256: { type: 'string', nullable: true },
      created_at: { type: 'string' },
    },
    required: [
      'contract',
      'receipt_id',
      'deterministic_key',
      'action',
      'operation_id',
      'step_id',
      'target_id',
      'expected_version',
      'expected_content_sha256',
      'status',
      'code',
      'effect_count',
      'created_at',
    ],
  };
  const guardedLimitParameters = [
    'max_calls',
    'max_items',
    'max_bytes',
    'wall_time_ms',
  ].map((name) => ({
    name,
    in: 'query',
    required: true,
    schema: { type: 'integer', minimum: 1 },
  }));
  const guardedBindingParameters = [
    'authority_classification',
    'authority_id',
    'tenant_id',
    'scope',
    'parent_id',
  ].map((name) => ({
    name,
    in: 'query',
    required: true,
    schema: { type: 'string' },
  }));
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
        GuardedReceipt: guardedReceipt,
        GuardedAdoptionReceipt: guardedAdoptionReceipt,
        GuardedAdoptionEnvelope: {
          type: 'object',
          description:
            'Exact full-ID, version, and raw UTF-8 content-sha256 compare-and-swap for legacy binding adoption '
            + 'or immutable-receipt-scoped rollback.',
          required: [
            'contract',
            'action',
            'deterministic_key',
            'operation_id',
            'step_id',
            'target_id',
            'binding',
            'expected_version',
            'expected_content_sha256',
            'adoption_receipt_id',
            'limits',
          ],
          additionalProperties: false,
        },
        GuardedWriteEnvelope: {
          type: 'object',
          description:
            'FCAME-1 frozen descriptor metadata, deterministic key, explicit finite limits, and private payload. '
            + 'The payload is accepted only in this authenticated request body.',
          required: ['contract', 'descriptor', 'deterministic_key', 'limits', 'payload'],
          additionalProperties: true,
        },
        GuardedManifest: {
          type: 'object',
          description:
            'Immutable ordered workflow manifest. Every step declares deterministic forward repair or '
            + 'accepted-receipt-scoped compensation.',
          required: [
            'manifest_receipt_id',
            'manifest_id',
            'operation_id',
            'deterministic_key',
            'manifest_digest',
            'maintainer',
            'step_count',
            'steps',
            'created_at',
          ],
          additionalProperties: true,
        },
        ProjectRegistrationCapability: {
          type: 'object',
          required: [
            'authority',
            'route',
            'resource_route',
            'package_version',
            'authority_id',
            'tenant_id',
            'corpus_id',
            'supported_resources',
            'membership_rule',
          ],
          additionalProperties: true,
        },
        ProjectRegistrationReceipt: {
          type: 'object',
          required: [
            'receipt_id',
            'authority',
            'route',
            'package_version',
            'authority_id',
            'tenant_id',
            'corpus_id',
            'operation_id',
            'step_id',
            'action',
            'resource_kind',
            'direction',
            'idempotency_key',
            'request_digest',
            'precondition_digest',
            'outcome',
            'created_by_operation',
            'created_at',
          ],
          additionalProperties: true,
        },
        ProjectCollectionRecord: {
          type: 'object',
          required: [
            'source_project_id',
            'project_id',
            'project_slug',
            'project_name',
            'collection_id',
            'collection_slug',
            'collection_name',
            'membership_rule',
            'revision',
            'digest',
            'created_at',
            'updated_at',
          ],
          properties: {
            source_project_id: { type: 'string' },
            project_id: { type: 'string' },
            project_slug: { type: 'string' },
            project_name: { type: 'string' },
            collection_id: { type: 'string' },
            collection_slug: { type: 'string' },
            collection_name: { type: 'string' },
            membership_rule: {
              type: 'string',
              enum: ['explicit_collection_binding'],
            },
            revision: { type: 'string' },
            digest: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
          additionalProperties: false,
        },
        ProjectResource: {
          type: 'object',
          required: [
            'key',
            'kind',
            'id',
            'project_id',
            'source_project_id',
            'collection_id',
            'revision',
            'digest',
            'title',
            'locator',
            'metadata',
          ],
          properties: {
            key: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['project', 'collection', 'item', 'taxonomy'],
            },
            id: { type: 'string' },
            project_id: { type: 'string' },
            source_project_id: { type: 'string' },
            collection_id: { type: 'string' },
            revision: { type: 'string' },
            digest: { type: 'string' },
            title: { type: 'string' },
            locator: {
              type: 'object',
              required: ['kind', 'value'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['external_uuid', 'canonical_uri'],
                },
                value: { type: 'string' },
              },
              additionalProperties: false,
            },
            metadata: {
              type: 'object',
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
        ProjectResourcePage: {
          type: 'object',
          required: [
            'schema',
            'authority',
            'route',
            'authority_id',
            'tenant_id',
            'corpus_id',
            'project_id',
            'source_project_id',
            'collection_id',
            'collection_revision',
            'population_digest',
            'resource_kinds',
            'resources',
            'count',
            'total',
            'limit',
            'cursor',
            'next_cursor',
            'has_more',
            'complete',
            'truncated',
          ],
          properties: {
            collection_revision: { type: 'string' },
            population_digest: { type: 'string' },
            resources: {
              type: 'array',
              items: { $ref: '#/components/schemas/ProjectResource' },
            },
            count: { type: 'integer' },
            total: { type: 'integer' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            has_more: { type: 'boolean' },
            complete: { type: 'boolean' },
            truncated: { type: 'boolean', enum: [false] },
          },
          additionalProperties: true,
        },
        NoteList: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
            total: { type: 'integer' },
            query_capability: {
              type: 'string',
              enum: [KNOWLEDGE_BOUNDED_QUERY_CAPABILITY],
            },
          },
          required: ['items', 'total', 'query_capability'],
        },
        NoteSearchList: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { $ref: '#/components/schemas/Note' },
                  rank: { type: 'number' },
                },
                required: ['item', 'rank'],
              },
            },
            total: { type: 'integer' },
            query_capability: {
              type: 'string',
              enum: [KNOWLEDGE_BOUNDED_QUERY_CAPABILITY],
            },
          },
          required: ['items', 'total', 'query_capability'],
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
        NotePurgeReceipt: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            purged: { type: 'integer' },
            current_version: { type: 'integer' },
            message: { type: 'string' },
          },
          required: ['ok', 'id', 'purged', 'current_version'],
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/v1/project-registration/capability': {
        get: {
          operationId: 'getKnowledgeProjectRegistrationCapability',
          summary: 'Read the exact Knowledge project-registration capability identity',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      capability: { $ref: '#/components/schemas/ProjectRegistrationCapability' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/project-registration/create': {
        post: {
          operationId: 'registerKnowledgeProjectCollection',
          summary: 'Create or exactly adopt one project-owned Knowledge collection',
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      receipt: { $ref: '#/components/schemas/ProjectRegistrationReceipt' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/project-registration/read-exact': {
        post: {
          operationId: 'readKnowledgeProjectCollection',
          summary: 'Read one project collection by exact stable collection id',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      record: { $ref: '#/components/schemas/ProjectCollectionRecord' },
                    },
                  },
                },
              },
            },
            '404': { description: 'No exact collection id.' },
          },
        },
      },
      '/v1/project-registration/receipts/lookup': {
        post: {
          operationId: 'lookupKnowledgeProjectRegistrationReceipt',
          summary: 'Look up exactly one immutable registration or membership receipt',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      receipt: { $ref: '#/components/schemas/ProjectRegistrationReceipt' },
                    },
                  },
                },
              },
            },
            '404': { description: 'No exact terminal receipt.' },
          },
        },
      },
      '/v1/project-registration/compensate': {
        post: {
          operationId: 'compensateKnowledgeProjectCollection',
          summary: 'Conditionally remove an operation-created empty collection aggregate',
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      receipt: { $ref: '#/components/schemas/ProjectRegistrationReceipt' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/project-registration/verify-inverse': {
        post: {
          operationId: 'verifyKnowledgeProjectCollectionInverse',
          summary: 'Verify an accepted collection inverse by exact receipt and absence',
          responses: { '200': { description: 'Exact absence verification.' } },
        },
      },
      '/v1/project-registration/items/bind': {
        post: {
          operationId: 'bindKnowledgeItemToProjectCollection',
          summary: 'Explicitly bind one exact existing item to a project collection',
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      receipt: { $ref: '#/components/schemas/ProjectRegistrationReceipt' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/project-registration/items/read-exact': {
        post: {
          operationId: 'readKnowledgeProjectItemBinding',
          summary: 'Read one exact collection/item membership',
          responses: {
            '200': { description: 'Exact membership readback.' },
            '404': { description: 'No exact membership.' },
          },
        },
      },
      '/v1/project-registration/items/compensate': {
        post: {
          operationId: 'compensateKnowledgeProjectItemBinding',
          summary: 'Conditionally remove a membership owned by the accepted binding receipt',
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      receipt: { $ref: '#/components/schemas/ProjectRegistrationReceipt' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/project-registration/items/verify-inverse': {
        post: {
          operationId: 'verifyKnowledgeProjectItemBindingInverse',
          summary: 'Verify an accepted membership inverse by exact receipt and absence',
          responses: { '200': { description: 'Exact membership absence verification.' } },
        },
      },
      '/v1/projects/{projectId}/resources': {
        get: {
          operationId: 'listKnowledgeProjectResources',
          summary: 'Enumerate the complete stable project/collection/item/taxonomy population',
          parameters: [
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            {
              name: 'kind',
              in: 'query',
              style: 'form',
              explode: true,
              schema: {
                type: 'array',
                items: { type: 'string', enum: ['project', 'collection', 'item', 'taxonomy'] },
              },
            },
          ],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ProjectResourcePage' } },
              },
            },
            '409': { description: 'Cursor is stale or belongs to another population.' },
          },
        },
      },
      '/v1/projects/{projectId}/resources/{kind}/{resourceId}': {
        get: {
          operationId: 'getKnowledgeProjectResource',
          summary: 'Read one project resource by exact stable kind and id',
          parameters: [
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'kind',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['project', 'collection', 'item', 'taxonomy'] },
            },
            { name: 'resourceId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { resource: { $ref: '#/components/schemas/ProjectResource' } },
                  },
                },
              },
            },
            '404': { description: 'No exact resource kind and id.' },
          },
        },
      },
      '/v1/notes': {
        get: {
          operationId: 'listNotes',
          summary: 'List knowledge items with literal filters and bounded paging',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            { name: 'filter', in: 'query', schema: { type: 'string' } },
            {
              name: 'search',
              in: 'query',
              deprecated: true,
              description: 'Legacy alias for filter.',
              schema: { type: 'string' },
            },
            {
              name: 'tags',
              in: 'query',
              style: 'form',
              explode: true,
              schema: { type: 'array', items: { type: 'string' } },
            },
            { name: 'archive', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'all'] } },
            {
              name: 'includeArchived',
              in: 'query',
              deprecated: true,
              description: 'Legacy alias: true maps to archive=all.',
              schema: { type: 'boolean' },
            },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created', 'title'] } },
            { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NoteList' } },
              },
            },
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
      '/v1/notes/search': {
        get: {
          operationId: 'searchNotes',
          summary: 'Ranked PostgreSQL full-text query with bounded paging',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            { name: 'archive', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'all'] } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NoteSearchList' } },
              },
            },
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
        delete: {
          operationId: 'purgeNoteVersions',
          summary: 'Permanently purge every retained prior version of a knowledge item',
          description:
            'Secret-hygiene operation: deletes the retained history so a credential-shaped value '
            + 'in a prior snapshot stops being reachable. Never returns or renders the retained body. '
            + 'The live row is untouched.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Purge receipt: purged count and the untouched current version.', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotePurgeReceipt' } } } },
            '404': { description: 'No such entry.' },
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
        delete: {
          operationId: 'purgeNoteVersion',
          summary: 'Permanently purge ONE retained prior version of a knowledge item',
          description:
            'Secret-hygiene operation. Deleting the live/current version is refused with 409. '
            + 'A version that is not retained returns 200 with purged: 0. Never returns the body.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '200': { description: 'Purge receipt: purged count and the untouched current version.', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotePurgeReceipt' } } } },
            '404': { description: 'No such entry.' },
            '409': { description: 'The version is the live row, not a retained prior version.' },
          },
        },
      },
      '/v1/guarded-writes': {
        post: {
          operationId: 'executeGuardedKnowledgeWrite',
          summary: 'Execute one FCAME-1 create-if-absent or compare-and-swap write',
          description:
            'Requires x-knowledge-tenant-id, Idempotency-Key, and the four x-knowledge-* bound headers. '
            + 'The server stores one immutable terminal receipt and never falls back to local or raw storage.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GuardedWriteEnvelope' },
              },
            },
          },
          responses: {
            '201': { description: 'Accepted with one immutable receipt.' },
            '200': { description: 'Same deterministic operation already accepted; duplicate proof returned.' },
            '409': { description: 'Terminal rejection or operation/step binding conflict.' },
          },
        },
      },
      '/v1/guarded-writes/lookups/title': {
        post: {
          operationId: 'lookupGuardedKnowledgeTitle',
          summary: 'Bounded exact-title lookup under one frozen FCAME-1 binding',
          description:
            'Returns zero or one metadata-only item proof. More than one exact title is an ambiguity error; '
            + 'item bodies and titles are never returned.',
          responses: {
            '200': { description: 'Exact bounded metadata-only result containing zero or one item proof.' },
            '409': { description: 'More than one exact title exists under the frozen binding.' },
          },
        },
      },
      '/v1/guarded-adoptions': {
        post: {
          operationId: 'executeGuardedKnowledgeAdoption',
          summary: 'Adopt one exact legacy row or roll it back through its immutable adoption receipt',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GuardedAdoptionEnvelope' },
              },
            },
          },
          responses: {
            '201': { description: 'Accepted with one immutable adoption receipt.' },
            '200': { description: 'Exact deterministic replay; no second effect.' },
            '409': { description: 'Terminal CAS/binding rejection or operation binding conflict.' },
          },
        },
      },
      '/v1/guarded-adoptions/receipts/{deterministicKey}': {
        get: {
          operationId: 'reconcileGuardedKnowledgeAdoption',
          summary: 'Bounded exact adoption-receipt reconciliation',
          parameters: [
            {
              name: 'deterministicKey',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            ...guardedBindingParameters,
            { name: 'operation_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'step_id', in: 'query', required: true, schema: { type: 'string' } },
            ...guardedLimitParameters,
          ],
          responses: {
            '200': { description: 'Exact bounded result containing zero or one immutable receipt.' },
          },
        },
      },
      '/v1/guarded-adoptions/items/{id}/binding-state': {
        get: {
          operationId: 'readGuardedKnowledgeBindingState',
          summary: 'Exact bounded stored-binding-state readback for a full Knowledge id',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ...guardedBindingParameters,
            ...guardedLimitParameters,
          ],
          responses: {
            '200': {
              description:
                'legacy_unbound, bound_to_requested, or bound_elsewhere; elsewhere does not disclose version/hash.',
            },
            '404': { description: 'No exact full-ID row.' },
          },
        },
      },
      '/v1/guarded-writes/queries': {
        post: {
          operationId: 'queryGuardedKnowledge',
          summary: 'Bounded private Knowledge query under one frozen FCAME-1 binding',
          description:
            'The raw selector exists only in this authenticated request body. '
            + 'The response contains hashes, versions, page evidence, and no raw selector or item id.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['contract', 'descriptor', 'selector', 'limits'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '200': { description: 'Exact bounded private result or typed semantic unavailability.' },
            '400': { description: 'Descriptor, selector, binding digest, page, or bounds mismatch.' },
          },
        },
      },
      '/v1/guarded-writes/receipts/{deterministicKey}': {
        get: {
          operationId: 'reconcileGuardedKnowledgeWrite',
          summary: 'Bounded exact terminal-receipt reconciliation',
          parameters: [
            {
              name: 'deterministicKey',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            ...guardedBindingParameters,
            { name: 'operation_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'step_id', in: 'query', required: true, schema: { type: 'string' } },
            ...guardedLimitParameters,
          ],
          responses: {
            '200': {
              description: 'Exact bounded result containing zero or one terminal receipt and completeness.',
            },
          },
        },
      },
      '/v1/guarded-writes/items/{id}': {
        get: {
          operationId: 'readbackGuardedKnowledgeItem',
          summary: 'Exact full-ID readback under the frozen binding',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ...guardedBindingParameters,
            ...guardedLimitParameters,
          ],
          responses: {
            '200': { description: 'Exactly one full-ID and binding match.' },
            '404': { description: 'No exact full-ID and binding match.' },
          },
        },
      },
      '/v1/guarded-manifests': {
        post: {
          operationId: 'createGuardedKnowledgeManifest',
          summary: 'Create an immutable ordered FCAME-1 workflow manifest before step zero',
          responses: {
            '201': { description: 'Manifest created.' },
            '200': { description: 'Exact manifest replay; duplicate proof returned.' },
            '409': { description: 'manifest_id is already bound to different semantics.' },
          },
        },
      },
      '/v1/guarded-manifests/{manifestId}': {
        get: {
          operationId: 'reconcileGuardedKnowledgeManifest',
          summary: 'Derive bounded workflow completeness from immutable authority receipts',
          description:
            'External-authority steps remain unverified and keep terminal_complete false until that authority '
            + 'provides a verifiable receipt path.',
          parameters: [
            { name: 'manifestId', in: 'path', required: true, schema: { type: 'string' } },
            ...guardedBindingParameters,
            ...guardedLimitParameters,
          ],
          responses: {
            '200': { description: 'Manifest plus per-step receipt state and any unsupported authority gap.' },
            '404': { description: 'No exact manifest and maintainer binding match.' },
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

function boundedJson(
  body: unknown,
  status: number,
  bounds: KnowledgeGuardedBounds,
  startedAt: number,
): Response {
  if (Date.now() - startedAt > bounds.wall_time_ms) {
    throw new HttpError(408, 'guarded phase exceeded its producer wall-time cap.');
  }
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, 'utf8') > bounds.max_bytes) {
    throw new HttpError(413, 'guarded phase response exceeds its producer byte cap.');
  }
  return new Response(encoded, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parsePositiveInteger(value: string | null, field: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
}

function guardedBoundsFromHeaders(req: Request): KnowledgeGuardedBounds {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get('x-knowledge-max-calls'), 'x-knowledge-max-calls'),
    max_items: parsePositiveInteger(req.headers.get('x-knowledge-max-items'), 'x-knowledge-max-items'),
    max_bytes: parsePositiveInteger(req.headers.get('x-knowledge-max-bytes'), 'x-knowledge-max-bytes'),
    wall_time_ms: parsePositiveInteger(req.headers.get('x-knowledge-wall-time-ms'), 'x-knowledge-wall-time-ms'),
  };
  try {
    assertKnowledgeGuardedBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid guarded bounds.');
  }
  return bounds;
}

function privateQueryBoundsFromHeaders(req: Request): KnowledgePrivateQueryBounds {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get('x-knowledge-max-calls'), 'x-knowledge-max-calls'),
    max_items: parsePositiveInteger(req.headers.get('x-knowledge-max-items'), 'x-knowledge-max-items'),
    max_bytes: parsePositiveInteger(req.headers.get('x-knowledge-max-bytes'), 'x-knowledge-max-bytes'),
    wall_time_ms: parsePositiveInteger(req.headers.get('x-knowledge-wall-time-ms'), 'x-knowledge-wall-time-ms'),
  };
  try {
    assertKnowledgePrivateQueryBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid private query bounds.');
  }
  return bounds;
}

function guardedBoundsFromQuery(req: Request, url: URL): KnowledgeGuardedBounds {
  const fromHeaders = guardedBoundsFromHeaders(req);
  const fromQuery = {
    max_calls: parsePositiveInteger(url.searchParams.get('max_calls'), 'max_calls'),
    max_items: parsePositiveInteger(url.searchParams.get('max_items'), 'max_items'),
    max_bytes: parsePositiveInteger(url.searchParams.get('max_bytes'), 'max_bytes'),
    wall_time_ms: parsePositiveInteger(url.searchParams.get('wall_time_ms'), 'wall_time_ms'),
  };
  if (canonicalKnowledgeGuardedJson(fromHeaders) !== canonicalKnowledgeGuardedJson(fromQuery)) {
    throw new HttpError(400, 'guarded query bounds must exactly match the bound headers.');
  }
  return fromHeaders;
}

async function readBoundedJson(
  req: Request,
  bounds: KnowledgeGuardedBounds,
  startedAt: number,
): Promise<unknown> {
  if (!req.body) throw new HttpError(400, 'guarded write body is required.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const remaining = bounds.wall_time_ms - (Date.now() - startedAt);
      if (remaining <= 0) throw new HttpError(408, 'guarded request exceeded its producer wall-time cap.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new HttpError(408, 'guarded request exceeded its producer wall-time cap.')),
            remaining,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > bounds.max_bytes) {
        throw new HttpError(413, 'guarded request exceeds its producer byte cap.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'guarded request body must be valid JSON.');
  }
}

function guardedBindingFromQuery(url: URL): KnowledgeGuardedBinding {
  const binding = {
    authority: {
      classification: url.searchParams.get('authority_classification'),
      authority_id: url.searchParams.get('authority_id'),
    },
    tenant_id: url.searchParams.get('tenant_id'),
    scope: url.searchParams.get('scope'),
    parent_id: url.searchParams.get('parent_id'),
  } as unknown as KnowledgeGuardedBinding;
  try {
    assertKnowledgeGuardedBinding(binding);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid guarded binding.');
  }
  return binding;
}

function assertConfiguredAuthority(
  binding: KnowledgeGuardedBinding,
  authority: KnowledgeServeGuardedAuthority,
): void {
  if (
    binding.authority.classification !== authority.classification
    || binding.authority.authority_id !== authority.authority_id
  ) {
    throw new HttpError(403, 'guarded write authority does not match this service authority.');
  }
}

function assertExactRequestKeys(
  value: Record<string, unknown>,
  field: string,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalKnowledgeGuardedJson(actual) !== canonicalKnowledgeGuardedJson(wanted)) {
    throw new Error(`${field} keys do not match the FCAME-1 request schema.`);
  }
}

function validateGuardedEnvelope(
  value: unknown,
  headerBounds: KnowledgeGuardedBounds,
  authority: KnowledgeServeGuardedAuthority,
  idempotencyKey: string | null,
): KnowledgeGuardedWriteEnvelope {
  try {
    if (!value || typeof value !== 'object') throw new Error('guarded write envelope is required.');
    const envelope = value as KnowledgeGuardedWriteEnvelope;
    assertExactRequestKeys(
      value as Record<string, unknown>,
      'guarded write envelope',
      ['contract', 'descriptor', 'deterministic_key', 'limits', 'payload'],
    );
    const descriptor = envelope.descriptor;
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error('unsupported guarded-write contract.');
    }
    if (
      !descriptor
      || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
      || descriptor.schema !== KNOWLEDGE_PRIVATE_INPUT_SCHEMA
    ) {
      throw new Error('invalid private input descriptor schema.');
    }
    assertExactRequestKeys(
      descriptor as Record<string, unknown>,
      'private input descriptor',
      [
        'contract',
        'schema',
        'descriptor_id',
        'operation_id',
        'step_id',
        'verb',
        'target_id',
        'payload_digest',
        'binding_digest',
        'precondition',
        'binding',
        'manifest',
        'expires_at',
      ],
    );
    if (typeof descriptor.descriptor_id !== 'string' || descriptor.descriptor_id.length === 0) {
      throw new Error('private input descriptor id is required.');
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (
      !Number.isFinite(descriptorExpiresAt)
      || descriptorExpiresAt <= descriptorNow
      || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000
    ) {
      throw new Error('private input descriptor is expired or malformed.');
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedPrecondition(descriptor.verb, descriptor.precondition);
    assertKnowledgeGuardedPayload(descriptor.verb, envelope.payload);
    if ('metadata' in envelope.payload && envelope.payload.metadata) {
      assertKnowledgeRelationsMetadata(envelope.payload.metadata, descriptor.target_id);
    }
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error('guarded-write limits must be explicit and complete.');
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error('submission limits must exactly match the producer bound headers.');
    }
    const payloadDigest = knowledgeGuardedDigest(envelope.payload);
    if (payloadDigest !== descriptor.payload_digest) {
      throw new Error('private payload digest does not match the frozen descriptor.');
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      precondition: descriptor.precondition,
      payload_digest: descriptor.payload_digest,
      manifest: descriptor.manifest,
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error('private descriptor binding digest does not match.');
    }
    const expectedKey = computeKnowledgeGuardedDeterministicKey({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      payload_digest: descriptor.payload_digest,
      precondition: descriptor.precondition,
      manifest: descriptor.manifest,
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error('deterministic key must match both the frozen tuple and Idempotency-Key.');
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error('guarded write envelope exceeds the producer byte cap.');
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid guarded write envelope.');
  }
}

function validatePrivateTitleLookupEnvelope(
  value: unknown,
  headerBounds: KnowledgeGuardedBounds,
  authority: KnowledgeServeGuardedAuthority,
): KnowledgeGuardedTitleLookupEnvelope {
  try {
    if (!value || typeof value !== 'object') {
      throw new Error('private title lookup envelope is required.');
    }
    const envelope = value as KnowledgeGuardedTitleLookupEnvelope;
    assertExactRequestKeys(
      value as Record<string, unknown>,
      'private title lookup envelope',
      ['contract', 'descriptor', 'title', 'limits'],
    );
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error('unsupported guarded-write contract.');
    }
    const descriptor = envelope.descriptor;
    if (
      !descriptor
      || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
      || descriptor.schema !== KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA
    ) {
      throw new Error('invalid private title lookup descriptor schema.');
    }
    assertExactRequestKeys(
      descriptor as Record<string, unknown>,
      'private title lookup descriptor',
      [
        'contract',
        'schema',
        'operation_id',
        'step_id',
        'title_digest',
        'binding_digest',
        'binding',
        'expires_at',
      ],
    );
    if (
      typeof descriptor.operation_id !== 'string'
      || descriptor.operation_id.length === 0
      || typeof descriptor.step_id !== 'string'
      || descriptor.step_id.length === 0
      || typeof envelope.title !== 'string'
      || envelope.title.length === 0
      || envelope.title.length > 2048
    ) {
      throw new Error('private title lookup operation, step, and bounded title are required.');
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (
      !Number.isFinite(descriptorExpiresAt)
      || descriptorExpiresAt <= descriptorNow
      || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000
    ) {
      throw new Error('private title lookup descriptor is expired or malformed.');
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedBounds(envelope.limits, 'private title lookup bounds');
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error('private title lookup limits must exactly match the producer bound headers.');
    }
    const titleDigest = knowledgeGuardedContentSha256(envelope.title);
    if (titleDigest !== descriptor.title_digest) {
      throw new Error('private title lookup digest does not match the frozen descriptor.');
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      title_digest: descriptor.title_digest,
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error('private title lookup binding digest does not match.');
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error('private title lookup envelope exceeds the producer byte cap.');
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'invalid private title lookup envelope.',
    );
  }
}

function validatePrivateQueryEnvelope(
  value: unknown,
  headerBounds: KnowledgePrivateQueryBounds,
  authority: KnowledgeServeGuardedAuthority,
): KnowledgePrivateQueryEnvelope {
  try {
    if (!value || typeof value !== 'object') {
      throw new Error('private query envelope is required.');
    }
    const envelope = value as KnowledgePrivateQueryEnvelope;
    assertExactRequestKeys(
      value as Record<string, unknown>,
      'private query envelope',
      ['contract', 'descriptor', 'selector', 'limits'],
    );
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error('unsupported guarded-write contract.');
    }
    const descriptor = envelope.descriptor;
    if (
      !descriptor
      || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
      || descriptor.schema !== KNOWLEDGE_PRIVATE_QUERY_SCHEMA
    ) {
      throw new Error('invalid private query descriptor schema.');
    }
    assertExactRequestKeys(
      descriptor as Record<string, unknown>,
      'private query descriptor',
      [
        'contract',
        'schema',
        'operation_id',
        'step_id',
        'query_kind',
        'selector_digest',
        'binding_digest',
        'binding',
        'archive',
        'page',
        'expires_at',
      ],
    );
    if (
      typeof descriptor.operation_id !== 'string'
      || descriptor.operation_id.length === 0
      || typeof descriptor.step_id !== 'string'
      || descriptor.step_id.length === 0
      || !['active', 'archived', 'all'].includes(descriptor.archive)
    ) {
      throw new Error('private query operation, step, and archive mode are required.');
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (
      !Number.isFinite(descriptorExpiresAt)
      || descriptorExpiresAt <= descriptorNow
      || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000
    ) {
      throw new Error('private query descriptor is expired or malformed.');
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgePrivateQueryBounds(envelope.limits);
    assertKnowledgePrivateQueryPage(descriptor.page, envelope.limits);
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error('private query limits must exactly match the producer bound headers.');
    }
    assertKnowledgePrivateQuerySelector(envelope.selector);
    if (envelope.selector.kind !== descriptor.query_kind) {
      throw new Error('private query selector kind does not match the frozen descriptor.');
    }
    const selectorDigest = knowledgeGuardedDigest(envelope.selector);
    if (selectorDigest !== descriptor.selector_digest) {
      throw new Error('private query selector digest does not match the frozen descriptor.');
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      query_kind: descriptor.query_kind,
      selector_digest: descriptor.selector_digest,
      archive: descriptor.archive,
      page: descriptor.page,
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error('private query binding digest does not match.');
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error('private query envelope exceeds the producer byte cap.');
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'invalid private query envelope.',
    );
  }
}

function validateGuardedAdoptionEnvelope(
  value: unknown,
  headerBounds: KnowledgeGuardedBounds,
  authority: KnowledgeServeGuardedAuthority,
  idempotencyKey: string | null,
): KnowledgeGuardedAdoptionEnvelope {
  try {
    if (!value || typeof value !== 'object') {
      throw new Error('guarded adoption envelope is required.');
    }
    const envelope = value as KnowledgeGuardedAdoptionEnvelope;
    assertExactRequestKeys(
      value as Record<string, unknown>,
      'guarded adoption envelope',
      [
        'contract',
        'action',
        'deterministic_key',
        'operation_id',
        'step_id',
        'target_id',
        'binding',
        'expected_version',
        'expected_content_sha256',
        'adoption_receipt_id',
        'limits',
      ],
    );
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error('unsupported guarded adoption contract.');
    }
    assertKnowledgeGuardedBinding(envelope.binding);
    assertConfiguredAuthority(envelope.binding, authority);
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error('guarded-adoption limits must be explicit and complete.');
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error('adoption submission limits must exactly match the producer bound headers.');
    }
    const expectedKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: envelope.action,
      operation_id: envelope.operation_id,
      step_id: envelope.step_id,
      target_id: envelope.target_id,
      binding: envelope.binding,
      expected_version: envelope.expected_version,
      expected_content_sha256: envelope.expected_content_sha256,
      adoption_receipt_id: envelope.adoption_receipt_id,
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error('adoption deterministic key must match both the exact tuple and Idempotency-Key.');
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error('guarded adoption envelope exceeds the producer byte cap.');
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'invalid guarded adoption envelope.',
    );
  }
}

function validateGuardedManifestEnvelope(
  value: unknown,
  bounds: KnowledgeGuardedBounds,
  authority: KnowledgeServeGuardedAuthority,
  idempotencyKey: string | null,
): KnowledgeGuardedManifestEnvelope {
  try {
    if (!value || typeof value !== 'object') throw new Error('guarded manifest envelope is required.');
    const envelope = value as KnowledgeGuardedManifestEnvelope;
    assertExactRequestKeys(
      value as Record<string, unknown>,
      'guarded manifest envelope',
      ['contract', 'maintainer', 'manifest', 'deterministic_key'],
    );
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error('unsupported guarded manifest contract.');
    }
    assertKnowledgeGuardedBinding(envelope.maintainer);
    assertConfiguredAuthority(envelope.maintainer, authority);
    assertKnowledgeGuardedManifestOptions(envelope.maintainer, envelope.manifest);
    const expectedKey = computeKnowledgeGuardedManifestDeterministicKey(
      envelope.maintainer,
      envelope.manifest,
    );
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error('manifest deterministic key must match both the frozen tuple and Idempotency-Key.');
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) {
      throw new Error('guarded manifest exceeds the producer byte cap.');
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid guarded manifest envelope.');
  }
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
  /**
   * Explicit authority for FCAME-1 production writes. When absent, legacy
   * routes keep working and guarded routes fail closed with 503.
   */
  guardedAuthority?: KnowledgeServeGuardedAuthority;
  /**
   * Optional test/host override for the package-owned project-link authority.
   * Production uses the same Postgres client as notes and scopes every
   * authority instance to the authenticated tenant.
   */
  projectLinksAuthority?: (tenantId: string) => KnowledgeProjectLinksAuthority;
}

export function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const repo = new NoteRepo(deps.client);
  const guardedRepo = deps.guardedAuthority
    ? new GuardedWriteRepo(deps.client, deps.guardedAuthority)
    : null;
  const projectLinksForTenant = (tenantId: string): KnowledgeProjectLinksAuthority => (
    deps.projectLinksAuthority?.(tenantId)
    ?? createPostgresKnowledgeProjectLinksAuthority({
      client: deps.client,
      itemResolver: (id) => repo.get(id, tenantId),
      options: {
        packageVersion: deps.version,
        authorityId: process.env.HASNA_KNOWLEDGE_PROJECT_AUTHORITY_ID ?? KNOWLEDGE_SERVE_APP,
        tenantId,
        corpusId: process.env.HASNA_KNOWLEDGE_PROJECT_CORPUS_ID ?? 'knowledge',
      },
    })
  );
  const backend = 'postgresql';

  const authOrThrow = async (
    req: Request,
    requiredScopes: string[],
    expectedTid?: string,
  ): Promise<ApiKeyPrincipal> => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
      ...(expectedTid !== undefined ? { expectedTid } : {}),
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
        return json({ status: 'ok', version: deps.version, backend });
      }
      if (path === '/version' && method === 'GET') {
        return json({ status: 'ok', version: deps.version, backend });
      }
      if (path === '/ready' && method === 'GET') {
        try {
          await deps.client.query('SELECT 1');
          return json({ status: 'ready', version: deps.version, backend });
        } catch {
          return json({ status: 'unavailable', version: deps.version, backend }, 503);
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
            sourceSchemes: ['open-files', 's3', 'web', 'file'],
            storageType: 's3',
            artifactUriPrefix: process.env.HASNA_KNOWLEDGE_S3_PREFIX ?? null,
          }),
        );
      }

      // ---- FCAME-1 guarded writes ----
      if (path === '/v1/guarded-manifests' && method === 'POST') {
        if (!guardedRepo) {
          return json({ error: 'guarded_authority_unconfigured' }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get('x-knowledge-tenant-id');
        if (!tenantId) throw new HttpError(400, 'x-knowledge-tenant-id is required.');
        await authOrThrow(req, ['knowledge:write'], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedManifestEnvelope(
          raw,
          bounds,
          guardedRepo.authority,
          req.headers.get('idempotency-key'),
        );
        if (envelope.maintainer.tenant_id !== tenantId) {
          throw new HttpError(403, 'manifest tenant does not match the authenticated request tenant.');
        }
        try {
          const submission = await guardedRepo.createManifest(envelope);
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof ManifestBindingConflictError) {
            return boundedJson(
              {
                error: 'manifest_binding_conflict',
                manifest: error.manifest,
              },
              409,
              bounds,
              startedAt,
            );
          }
          throw error;
        }
      }

      const guardedManifestMatch = path.match(/^\/v1\/guarded-manifests\/([^/]+)$/);
      if (guardedManifestMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (!guardedRepo) return json({ error: 'guarded_authority_unconfigured' }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ['knowledge:read'], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const reconciliation = await guardedRepo.reconcileManifest(
          decodeURIComponent(guardedManifestMatch[1]!),
          binding,
          bounds,
        );
        return reconciliation
          ? boundedJson(reconciliation, 200, bounds, startedAt)
          : boundedJson({ error: 'not_found' }, 404, bounds, startedAt);
      }

      if (path === '/v1/guarded-adoptions' && method === 'POST') {
        if (!guardedRepo) {
          return json({ error: 'guarded_authority_unconfigured' }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get('x-knowledge-tenant-id');
        if (!tenantId) throw new HttpError(400, 'x-knowledge-tenant-id is required.');
        const principal = await authOrThrow(req, ['knowledge:write'], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedAdoptionEnvelope(
          raw,
          bounds,
          guardedRepo.authority,
          req.headers.get('idempotency-key'),
        );
        if (envelope.binding.tenant_id !== tenantId) {
          throw new HttpError(403, 'adoption tenant does not match the authenticated request tenant.');
        }
        try {
          const submission = await guardedRepo.executeAdoption(
            envelope,
            principalActor(principal),
          );
          if (submission.receipt.status === 'rejected') {
            if (submission.receipt.code === 'not_found') {
              return boundedJson({ error: 'not_found' }, 404, bounds, startedAt);
            }
            return boundedJson(
              { error: 'guarded_adoption_rejected', ...submission },
              409,
              bounds,
              startedAt,
            );
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof AdoptionOperationBindingConflictError) {
            return boundedJson(
              {
                error: 'adoption_operation_conflict',
                receipt: error.receipt,
              },
              409,
              bounds,
              startedAt,
            );
          }
          throw error;
        }
      }

      const guardedAdoptionReceiptMatch = path.match(
        /^\/v1\/guarded-adoptions\/receipts\/([^/]+)$/,
      );
      if (guardedAdoptionReceiptMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (!guardedRepo) return json({ error: 'guarded_authority_unconfigured' }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ['knowledge:read'], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get('operation_id');
        const stepId = url.searchParams.get('step_id');
        if (!operationId || !stepId) {
          throw new HttpError(
            400,
            'operation_id and step_id are required for exact adoption reconciliation.',
          );
        }
        const reconciliation = await guardedRepo.reconcileAdoption(
          decodeURIComponent(guardedAdoptionReceiptMatch[1]!),
          binding,
          operationId,
          stepId,
          bounds,
        );
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }

      const guardedBindingStateMatch = path.match(
        /^\/v1\/guarded-adoptions\/items\/([^/]+)\/binding-state$/,
      );
      if (guardedBindingStateMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (!guardedRepo) return json({ error: 'guarded_authority_unconfigured' }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ['knowledge:read'], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.bindingState(
          decodeURIComponent(guardedBindingStateMatch[1]!),
          binding,
          bounds,
        );
        return readback
          ? boundedJson(readback, 200, bounds, startedAt)
          : boundedJson({ error: 'not_found' }, 404, bounds, startedAt);
      }

      if (path === '/v1/guarded-writes' && method === 'POST') {
        if (!guardedRepo) {
          return json({ error: 'guarded_authority_unconfigured' }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get('x-knowledge-tenant-id');
        if (!tenantId) throw new HttpError(400, 'x-knowledge-tenant-id is required.');
        const principal = await authOrThrow(req, ['knowledge:write'], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedEnvelope(
          raw,
          bounds,
          guardedRepo.authority,
          req.headers.get('idempotency-key'),
        );
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, 'descriptor tenant does not match the authenticated request tenant.');
        }
        try {
          const submission = await guardedRepo.execute(envelope, principalActor(principal));
          if (submission.receipt.status === 'rejected') {
            return boundedJson(
              { error: 'guarded_write_rejected', ...submission },
              409,
              bounds,
              startedAt,
            );
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof OperationBindingConflictError) {
            return boundedJson(
              {
                error: 'operation_binding_conflict',
                receipt: error.receipt,
              },
              409,
              bounds,
              startedAt,
            );
          }
          throw error;
        }
      }

      if (path === '/v1/guarded-writes/lookups/title' && method === 'POST') {
        if (!guardedRepo) {
          return json({ error: 'guarded_authority_unconfigured' }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get('x-knowledge-tenant-id');
        if (!tenantId) throw new HttpError(400, 'x-knowledge-tenant-id is required.');
        await authOrThrow(req, ['knowledge:read'], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateTitleLookupEnvelope(
          raw,
          bounds,
          guardedRepo.authority,
        );
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, 'descriptor tenant does not match the authenticated request tenant.');
        }
        try {
          const result = await guardedRepo.lookupTitle(
            envelope.title,
            envelope.descriptor.binding,
            bounds,
          );
          return boundedJson(result, 200, bounds, startedAt);
        } catch (error) {
          if (error instanceof PrivateTitleLookupAmbiguousError) {
            return boundedJson(
              { error: 'private_title_lookup_ambiguous' },
              409,
              bounds,
              startedAt,
            );
          }
          throw error;
        }
      }

      if (path === '/v1/guarded-writes/queries' && method === 'POST') {
        if (!guardedRepo) {
          return json({ error: 'guarded_authority_unconfigured' }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get('x-knowledge-tenant-id');
        if (!tenantId) throw new HttpError(400, 'x-knowledge-tenant-id is required.');
        await authOrThrow(req, ['knowledge:read'], tenantId);
        const bounds = privateQueryBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateQueryEnvelope(raw, bounds, guardedRepo.authority);
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, 'descriptor tenant does not match the authenticated request tenant.');
        }
        const result = await guardedRepo.query(
          envelope.selector,
          envelope.descriptor.selector_digest,
          envelope.descriptor.archive,
          envelope.descriptor.page,
          envelope.descriptor.binding,
          bounds,
        );
        return boundedJson(result, 200, bounds, startedAt);
      }

      const guardedReceiptMatch = path.match(/^\/v1\/guarded-writes\/receipts\/([^/]+)$/);
      if (guardedReceiptMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (!guardedRepo) return json({ error: 'guarded_authority_unconfigured' }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ['knowledge:read'], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get('operation_id');
        const stepId = url.searchParams.get('step_id');
        if (!operationId || !stepId) {
          throw new HttpError(400, 'operation_id and step_id are required for exact reconciliation.');
        }
        const reconciliation = await guardedRepo.reconcile(
          decodeURIComponent(guardedReceiptMatch[1]!),
          binding,
          operationId,
          stepId,
          bounds,
        );
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }

      const guardedItemMatch = path.match(/^\/v1\/guarded-writes\/items\/([^/]+)$/);
      if (guardedItemMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (!guardedRepo) return json({ error: 'guarded_authority_unconfigured' }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ['knowledge:read'], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.readback(
          decodeURIComponent(guardedItemMatch[1]!),
          binding,
          bounds,
        );
        return readback
          ? boundedJson(readback, 200, bounds, startedAt)
          : boundedJson({ error: 'not_found' }, 404, bounds, startedAt);
      }

      // ---- Projects resource-link producer ----
      if (path === '/v1/project-registration/capability') {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        return json({ capability: await projectLinksForTenant(principal.tid).capability() });
      }

      if (path === '/v1/project-registration/create') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:write']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectRegistrationRequest;
        return json({ receipt: await projectLinksForTenant(principal.tid).registerCollection(body) }, 201);
      }

      if (path === '/v1/project-registration/read-exact') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const body = await req.json().catch(() => ({})) as { collection_id?: string };
        return json({
          record: await projectLinksForTenant(principal.tid).readCollection(
            String(body.collection_id ?? ''),
          ),
        });
      }

      if (path === '/v1/project-registration/receipts/lookup') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectReceiptLookupRequest;
        return json({ receipt: await projectLinksForTenant(principal.tid).lookupReceipt(body) });
      }

      if (path === '/v1/project-registration/compensate') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:write']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectInverseRequest;
        return json({ receipt: await projectLinksForTenant(principal.tid).compensateRegistration(body) }, 201);
      }

      if (path === '/v1/project-registration/verify-inverse') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectInverseRequest;
        return json({
          verification: await projectLinksForTenant(principal.tid).verifyRegistrationInverse(body),
        });
      }

      if (path === '/v1/project-registration/items/bind') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:write']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectItemBindingRequest;
        return json({ receipt: await projectLinksForTenant(principal.tid).bindItem(body) }, 201);
      }

      if (path === '/v1/project-registration/items/read-exact') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const body = await req.json().catch(() => ({})) as {
          collection_id?: string;
          item_id?: string;
        };
        return json({
          record: await projectLinksForTenant(principal.tid).readItemBinding(
            String(body.collection_id ?? ''),
            String(body.item_id ?? ''),
          ),
        });
      }

      if (path === '/v1/project-registration/items/compensate') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:write']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectInverseRequest;
        return json({ receipt: await projectLinksForTenant(principal.tid).compensateItemBinding(body) }, 201);
      }

      if (path === '/v1/project-registration/items/verify-inverse') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const body = await req.json().catch(() => ({})) as KnowledgeProjectInverseRequest;
        return json({
          verification: await projectLinksForTenant(principal.tid).verifyItemBindingInverse(body),
        });
      }

      const exactProjectResourceMatch = path.match(
        /^\/v1\/projects\/([^/]+)\/resources\/(project|collection|item|taxonomy)\/([^/]+)$/,
      );
      if (exactProjectResourceMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const resource = await projectLinksForTenant(principal.tid).readProjectResource(
          decodeURIComponent(exactProjectResourceMatch[1]!),
          exactProjectResourceMatch[2] as KnowledgeProjectResourceKind,
          decodeURIComponent(exactProjectResourceMatch[3]!),
        );
        return json({ resource });
      }

      const projectResourcesMatch = path.match(/^\/v1\/projects\/([^/]+)\/resources$/);
      if (projectResourcesMatch) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const page = await projectLinksForTenant(principal.tid).listProjectResources(
          decodeURIComponent(projectResourcesMatch[1]!),
          {
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
            cursor: url.searchParams.get('cursor'),
            kinds: url.searchParams.getAll('kind') as KnowledgeProjectResourceKind[],
          },
        );
        return json(page);
      }

      // ---- Notes bounded queries and CRUD ----
      if (path === '/v1/notes/search') {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const principal = await authOrThrow(req, ['knowledge:read']);
        const query = url.searchParams.get('q') ?? '';
        const archiveRaw = url.searchParams.get('archive') ?? 'active';
        if (!['active', 'archived', 'all'].includes(archiveRaw)) {
          throw new HttpError(400, 'archive must be active, archived, or all.');
        }
        const result = await repo.search({
          query,
          archive: archiveRaw as NoteSearchOptions['archive'],
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
        }, principal.tid);
        return json({ ...result, query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY });
      }

      if (path === '/v1/notes') {
        if (method === 'GET') {
          const principal = await authOrThrow(req, ['knowledge:read']);
          const includeArchived = url.searchParams.get('includeArchived') === 'true';
          const archiveRaw = url.searchParams.get('archive') ?? (includeArchived ? 'all' : 'active');
          const sortRaw = url.searchParams.get('sort') ?? 'created';
          const directionRaw = url.searchParams.get('direction') ?? 'asc';
          if (!['active', 'archived', 'all'].includes(archiveRaw)) {
            throw new HttpError(400, 'archive must be active, archived, or all.');
          }
          if (!['created', 'title'].includes(sortRaw)) {
            throw new HttpError(400, 'sort must be created or title.');
          }
          if (!['asc', 'desc'].includes(directionRaw)) {
            throw new HttpError(400, 'direction must be asc or desc.');
          }
          const tags = url.searchParams.getAll('tags');
          const result = await repo.list({
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
            offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
            filter: url.searchParams.get('filter') ?? url.searchParams.get('search') ?? undefined,
            tags: tags.length > 0 ? tags : undefined,
            archive: archiveRaw as NoteListOptions['archive'],
            sort: sortRaw as NoteListOptions['sort'],
            direction: directionRaw as NoteListOptions['direction'],
          }, principal.tid);
          return json({ ...result, query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY });
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
        if (method === 'GET') {
          const principal = await authOrThrow(req, ['knowledge:read']);
          const history = await repo.listVersions(decodeURIComponent(versionListMatch[1]!), {
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
            offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
          }, principal.tid);
          // null = no such entry (404). An entry with no edits yields 200 and an
          // empty list — the two must never collapse into one answer.
          return history ? json(history) : json({ error: 'not_found' }, 404);
        }
        if (method === 'DELETE') {
          // Secret-hygiene purge of every retained prior version. Never reads
          // the retained body; the live row is untouched.
          const principal = await authOrThrow(req, ['knowledge:write']);
          const id = decodeURIComponent(versionListMatch[1]!);
          const purged = await repo.purgeVersions(id, {}, principal.tid);
          if (!purged) return json({ error: 'not_found' }, 404);
          return json({
            ok: true,
            id,
            purged: purged.purged,
            current_version: purged.current_version,
            message: `${id} purged ${purged.purged} retained version(s); live content at version ${purged.current_version} untouched`,
          }, 200);
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      const versionOneMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions\/(\d+)$/);
      if (versionOneMatch) {
        if (method === 'GET') {
          const principal = await authOrThrow(req, ['knowledge:read']);
          const snapshot = await repo.getVersion(
            decodeURIComponent(versionOneMatch[1]!),
            Number(versionOneMatch[2]),
            principal.tid,
          );
          return snapshot ? json(snapshot) : json({ error: 'not_found' }, 404);
        }
        if (method === 'DELETE') {
          // Secret-hygiene purge of ONE retained prior version.
          const principal = await authOrThrow(req, ['knowledge:write']);
          const id = decodeURIComponent(versionOneMatch[1]!);
          const version = Number(versionOneMatch[2]);
          try {
            const purged = await repo.purgeVersions(id, { version }, principal.tid);
            if (!purged) return json({ error: 'not_found' }, 404);
            return json({
              ok: true,
              id,
              purged: purged.purged,
              current_version: purged.current_version,
              message: purged.purged === 0
                ? `no retained version ${version} of ${id}`
                : `${id} purged retained version ${version}; live content at version ${purged.current_version} untouched`,
            }, 200);
          } catch (error) {
            if (error instanceof CannotPurgeLiveVersionError) {
              return json({ error: error.code, version: error.version, current_version: error.current }, 409);
            }
            throw error;
          }
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]!);
        if (method === 'GET') {
          const principal = await authOrThrow(req, ['knowledge:read']);
          const item = await repo.get(id, principal.tid);
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
      if (error instanceof KnowledgeProjectLinksError) {
        return knowledgeProjectLinksErrorResponse(error);
      }
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

export function resolveKnowledgeGuardedAuthority(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeServeGuardedAuthority | undefined {
  const classification = env.HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION;
  const authorityId = env.HASNA_KNOWLEDGE_AUTHORITY_ID;
  if (!classification && !authorityId) return undefined;
  if (!classification || !authorityId) {
    throw new Error(
      'FCAME-1 guarded writes require both HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION '
      + 'and HASNA_KNOWLEDGE_AUTHORITY_ID.',
    );
  }
  const binding = {
    authority: {
      classification,
      authority_id: authorityId,
    },
    tenant_id: 'validation-only',
    scope: 'validation-only',
    parent_id: 'validation-only',
  } as KnowledgeGuardedBinding;
  assertKnowledgeGuardedBinding(binding);
  return binding.authority;
}

/**
 * Start the knowledge HTTP service on Bun. Opens the server PostgreSQL pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export async function startKnowledgeServe(options: StartServeOptions = {}): Promise<RunningServe> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? '0.0.0.0';
  const version = resolveVersion();

  normalizePostgresDatabaseUrl(env);
  const client = createKnowledgeDatabaseClient();
  const store = new ApiKeyStore(client);
  // DDL (the api_keys table) is owned by the migration task (run as the DB
  // owner role); the service connects with a DML-only app role per least
  // privilege, so it must NOT attempt CREATE TABLE here. The api_keys schema is
  // a deploy prerequisite (bun scripts/apply-postgres-migrations.mjs).
  const verifier = verifyApiKey({
    app: KNOWLEDGE_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    keyStatus: store.keyStatus,
    audit: (e) => {
      if (e.outcome === 'deny') {
        // Never log tokens/keys — kid + reason only.
        console.warn(`[knowledge-serve] auth deny kid=${e.kid ?? '-'} reason=${e.reason} ${e.method} ${e.path}`);
      }
    },
  });

  const handler = createServeHandler({
    client,
    verifier,
    store,
    version,
    guardedAuthority: resolveKnowledgeGuardedAuthority(env),
  });

  // Bun.serve is provided by the Bun runtime the Dockerfile uses.
  const BunGlobal = (globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } })
    .Bun;
  if (!BunGlobal?.serve) {
    throw new Error('knowledge-serve requires the Bun runtime (Bun.serve unavailable).');
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (backend=postgresql, version=${version})`);

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    },
  };
}
