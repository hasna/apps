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
 */
import { readFileSync } from 'node:fs';
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type ApiKeyPrincipal } from '@hasna/contracts/auth';
import { createKnowledgeCloudClient } from './db/remote-storage.js';
import { knowledgeRegistryContract } from './registry-contract.js';
import { makeId, makeShortId, type KnowledgeItem } from './store.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';

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
  };
}

export class NoteRepo {
  constructor(private readonly client: PoolQueryClient) {}

  async create(input: NoteInput): Promise<KnowledgeItem> {
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
      const row = await this.client.get<Record<string, unknown>>(
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
      );
      return rowToItem(row!);
    }
    const id = makeId();
    const row = await this.client.get<Record<string, unknown>>(
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
    );
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

  async update(idOrShort: string, patch: Partial<NoteInput> & { archived?: boolean }): Promise<KnowledgeItem | null> {
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
    const row = await this.client.get<Record<string, unknown>>(
      `UPDATE knowledge_items SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return row ? rowToItem(row) : null;
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
    },
    required: ['id', 'title', 'content', 'tags', 'archived', 'created_at', 'updated_at'],
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
    },
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
        NoteList: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
            total: { type: 'integer' },
          },
          required: ['items', 'total'],
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
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NotePatch' } } },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } } },
          },
        },
        delete: {
          operationId: 'deleteNote',
          summary: 'Delete a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': {} },
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
          await authOrThrow(req, ['knowledge:write']);
          const body = (await req.json().catch(() => ({}))) as NoteInput;
          const item = await repo.create(body);
          return json(item, 201);
        }
        return json({ error: 'method_not_allowed' }, 405);
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
          await authOrThrow(req, ['knowledge:write']);
          const body = (await req.json().catch(() => ({}))) as Partial<NoteInput>;
          const item = await repo.update(id, body);
          return item ? json(item) : json({ error: 'not_found' }, 404);
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
