#!/usr/bin/env bun
/**
 * Generate the Stage-A contained Knowledge API compatibility client.
 *
 * The OpenAPI document remains the schema/operation source of truth.  The
 * implementation is deliberately emitted from a fixed template: regenerating
 * may never restore a network-capable fetch client while hosted authority is
 * unavailable.  Public declarations stay byte-compatible with the pinned base
 * package so existing TypeScript consumers continue to compile.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeOpenApi } from '../src/serve.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await Bun.file(join(root, 'package.json')).text());
const spec = knowledgeOpenApi(pkg.version);

const requiredSchemas = ['Note', 'NoteInput', 'NotePatch', 'NoteList'];
const requiredOperations = [
  'listNotes',
  'createNote',
  'getNote',
  'deleteNote',
  'updateNote',
  'getRegistry',
];
const schemas = spec?.components?.schemas ?? {};
const operations = Object.values(spec?.paths ?? {}).flatMap((pathItem) =>
  Object.values(pathItem ?? {})
    .filter((operation) => operation && typeof operation === 'object')
    .map((operation) => operation.operationId)
    .filter(Boolean),
);
for (const schema of requiredSchemas) {
  if (!Object.hasOwn(schemas, schema)) throw new Error(`OpenAPI is missing ${schema}.`);
}
for (const operation of requiredOperations) {
  if (!operations.includes(operation)) throw new Error(`OpenAPI is missing ${operation}.`);
}

const code = `// @generated from the knowledge-serve OpenAPI document by scripts/generate-sdk.mjs.
// DO NOT EDIT. Regenerate: bun scripts/generate-sdk.mjs

import { KnowledgeContainmentError } from '../runtime-role.js';

export interface Note {
  "id": string;
  "short_id"?: string | null;
  "title": string;
  "content": string;
  "url"?: string | null;
  "tags": Array<string>;
  "metadata"?: Record<string, unknown>;
  "archived": boolean;
  "created_at": string;
  "updated_at": string;
}

export interface NoteInput {
  "title": string;
  "content"?: string;
  "url"?: string | null;
  "tags"?: Array<string>;
  "metadata"?: Record<string, unknown>;
}

export interface NotePatch {
  "title"?: string;
  "content"?: string;
  "url"?: string | null;
  "tags"?: Array<string>;
  "metadata"?: Record<string, unknown>;
  "archived"?: boolean;
}

export interface NoteList {
  "items": Array<Note>;
  "total": number;
}

export interface KnowledgeApiClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

function containedClientBoundary(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'KnowledgeApiClient is a zero-I/O compatibility boundary during Stage A',
  );
}

export class KnowledgeApiClient {
  declare private readonly baseUrl: string;
  declare private readonly apiKey: string | undefined;
  declare private readonly fetchImpl: typeof fetch;
  declare private readonly baseHeaders: Record<string, string>;

  constructor(options: KnowledgeApiClientOptions) {
    containedClientBoundary();
  }

  private async request<T>(_method: string, _path: string, _opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    return containedClientBoundary();
  }

  /** List knowledge items */
  async listNotes(query?: { "limit"?: number; "offset"?: number; "search"?: string }, init?: RequestInit): Promise<NoteList> {
    return containedClientBoundary();
  }

  /** Create a knowledge item */
  async createNote(body: NoteInput, init?: RequestInit): Promise<Note> {
    return containedClientBoundary();
  }

  /** Fetch a knowledge item */
  async getNote(id: string, init?: RequestInit): Promise<Note> {
    return containedClientBoundary();
  }

  /** Delete a knowledge item */
  async deleteNote(id: string, init?: RequestInit): Promise<void> {
    return containedClientBoundary();
  }

  /** Update a knowledge item */
  async updateNote(id: string, body: NotePatch, init?: RequestInit): Promise<Note> {
    return containedClientBoundary();
  }

  /** Knowledge registry contract */
  async getRegistry(init?: RequestInit): Promise<Record<string, unknown>> {
    return containedClientBoundary();
  }
}
`;

const outputIndex = process.argv.indexOf('--output');
const outFile = outputIndex >= 0
  ? resolve(process.argv[outputIndex + 1] ?? '')
  : join(root, 'src', 'generated', 'knowledge-api-client.ts');
if (!outFile.endsWith('.ts')) throw new Error('--output requires a TypeScript file path');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, code);

console.log(`[knowledge] generated contained SDK: ${requiredOperations.length} operations -> ${outFile}`);
