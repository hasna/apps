/**
 * @hasna/knowledge — HTTP serve surface (knowledge-serve).
 *
 * Stage A is a contained HTTP surface: liveness and static metadata remain
 * available, while every data/readiness route fails before auth or datastore
 * construction until trusted project authority exists.
 *
 * Surfaces:
 *   GET  /health          liveness — { status, version, mode }         (public)
 *   GET  /ready           readiness — always 503, no dependency probes (public)
 *   GET  /version         { status, version, mode }                    (public)
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)       (public)
 *   /v1/registry, /v1/notes* return typed 403/503 before auth/datastore
 *   construction. Positive hosted authority remains disabled in Stage A.
 */
import { readFileSync } from 'node:fs';
import type { ApiKeyStore, ApiKeyVerifier } from '@hasna/contracts/auth';
import type { KnowledgeItem } from './store.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';
import {
  authorityContainmentError,
  type KnowledgeAuthorityState,
} from './runtime-role.js';

export const KNOWLEDGE_SERVE_APP = 'knowledge';

/** Redacted compatibility surface: reports presence without returning a DSN. */
export function normalizeCloudDatabaseUrl(env?: NodeJS.ProcessEnv): string | undefined;
export function normalizeCloudDatabaseUrl(): string | undefined {
  return undefined;
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

// ---------------------------------------------------------------------------
// Contained NoteRepo compatibility shape. Every method throws before client use.
// ---------------------------------------------------------------------------

export interface NoteInput {
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

function containedNoteRepo(): never {
  throw authorityContainmentError(undefined, 'server');
}

export class NoteRepo {
  declare private readonly client: PoolQueryClient;

  constructor(client: PoolQueryClient) {
    Object.defineProperty(this, 'client', {
      value: undefined,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  async create(input: NoteInput): Promise<KnowledgeItem> {
    return containedNoteRepo();
  }

  list(options?: NoteListOptions): Promise<{ items: KnowledgeItem[]; total: number }>;
  async list(): Promise<{ items: KnowledgeItem[]; total: number }> {
    return containedNoteRepo();
  }

  async get(idOrShort: string): Promise<KnowledgeItem | null> {
    return containedNoteRepo();
  }

  async update(
    idOrShort: string,
    patch: Partial<NoteInput> & { archived?: boolean },
  ): Promise<KnowledgeItem | null> {
    return containedNoteRepo();
  }

  async delete(idOrShort: string): Promise<boolean> {
    return containedNoteRepo();
  }
}

// ---------------------------------------------------------------------------
// OpenAPI document — source of truth for the generated SDK.
// ---------------------------------------------------------------------------

export function knowledgeOpenApi(version: string): Record<string, unknown> {
  const containmentResponseRefs = {
    '403': { $ref: '#/components/responses/KnowledgeProjectForbidden' },
    '503': { $ref: '#/components/responses/KnowledgeUnavailable' },
  };
  const stageAOperation = {
    description: 'Disabled during Stage A. Project-authority containment is evaluated before authentication; future positive authority is explicitly deferred.',
    deprecated: true,
    security: [],
    'x-knowledge-stage-a-containment': 'pre-auth',
    'x-knowledge-operation-enabled': false,
  };
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
    info: {
      title: 'Knowledge',
      version,
      description: '@hasna/knowledge Stage-A contained HTTP API; data operations fail before authentication or datastore access.',
    },
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
        KnowledgeContainmentResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', enum: [false] },
            code: {
              type: 'string',
              enum: [
                'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
                'KNOWLEDGE_PROJECT_FORBIDDEN',
                'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED',
              ],
            },
            status: { type: 'integer', enum: [403, 503] },
            role: { type: 'string', enum: ['hosted-server'] },
            surface: { type: 'string', enum: ['server'] },
            message: { type: 'string' },
          },
          required: ['ok', 'code', 'status', 'role', 'surface', 'message'],
        },
      },
      responses: {
        KnowledgeProjectForbidden: {
          description: 'Trusted server-side authority has zero Knowledge project grants; evaluated before authentication.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/KnowledgeContainmentResponse' } },
          },
        },
        KnowledgeUnavailable: {
          description: 'Authority is missing or untrusted, or positive hosted authority remains disabled; evaluated before authentication.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/KnowledgeContainmentResponse' } },
          },
        },
      },
    },
    security: [],
    paths: {
      '/v1/notes': {
        get: {
          ...stageAOperation,
          operationId: 'listNotes',
          summary: 'List knowledge items',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            ...containmentResponseRefs,
          },
        },
        post: {
          ...stageAOperation,
          operationId: 'createNote',
          summary: 'Create a knowledge item',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteInput' } } },
          },
          responses: {
            ...containmentResponseRefs,
          },
        },
      },
      '/v1/notes/{id}': {
        get: {
          ...stageAOperation,
          operationId: 'getNote',
          summary: 'Fetch a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            ...containmentResponseRefs,
          },
        },
        patch: {
          ...stageAOperation,
          operationId: 'updateNote',
          summary: 'Update a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NotePatch' } } },
          },
          responses: {
            ...containmentResponseRefs,
          },
        },
        delete: {
          ...stageAOperation,
          operationId: 'deleteNote',
          summary: 'Delete a knowledge item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            ...containmentResponseRefs,
          },
        },
      },
      '/v1/registry': {
        get: {
          ...stageAOperation,
          operationId: 'getRegistry',
          summary: 'Knowledge registry contract',
          responses: {
            ...containmentResponseRefs,
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

type InternalServeDeps = ServeDeps & { authority?: KnowledgeAuthorityState };

export function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const internalDeps = deps as InternalServeDeps;
  const mode = 'contained';

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
        const error = authorityContainmentError(internalDeps.authority, 'server');
        const { status: httpStatus, ...containment } = error.toJSON();
        return json({
          status: 'unavailable',
          http_status: httpStatus,
          version: deps.version,
          mode,
          ...containment,
        }, 503);
      }
      if (path === '/openapi.json' && method === 'GET') {
        return json(knowledgeOpenApi(deps.version));
      }

      if (path === '/v1/registry' || path === '/v1/notes' || path.startsWith('/v1/notes/')) {
        const error = authorityContainmentError(internalDeps.authority, 'server');
        return json(error.toJSON(), error.status);
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
 * Start the Stage-A liveness server. It intentionally constructs no auth,
 * Postgres, schema, provider, or hosted transport dependencies.
 */
export async function startKnowledgeServe(options: StartServeOptions = {}): Promise<RunningServe> {
  const runtimeOptions = options as StartServeOptions & { version?: string };
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? '0.0.0.0';
  const version = runtimeOptions.version ?? resolveVersion();

  const handler = createServeHandler({
    client: undefined as never,
    verifier: undefined as never,
    store: undefined as never,
    version,
  });

  // Bun.serve is provided by the Bun runtime the Dockerfile uses.
  const BunGlobal = (globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } })
    .Bun;
  if (!BunGlobal?.serve) {
    throw new Error('knowledge-serve requires the Bun runtime (Bun.serve unavailable).');
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=contained, version=${version})`);

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
    },
  };
}
