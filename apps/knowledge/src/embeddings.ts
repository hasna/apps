import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { assertProviderCredentials, parseModelRef, providerSettings, type AiProviderId } from './providers';
import { sourceProvenance, type KnowledgeProvenance } from './provenance';
import {
  KNOWLEDGE_ANSWER_PURPOSE,
  metadataIsStale,
  parseJsonObject,
  sourceAccessDecision,
} from './source-access';
import type { KnowledgeConfig } from './workspace';

export interface EmbeddingRuntimeOptions {
  config?: KnowledgeConfig;
  env?: Record<string, string | undefined>;
  modelRef?: string;
  dimensions?: number;
  fake?: boolean;
  batchSize?: number;
  maxParallelCalls?: number;
  purpose?: string;
}

export interface EmbeddingIndexOptions extends EmbeddingRuntimeOptions {
  dbPath: string;
  limit?: number;
  sourceRevisionId?: string;
  now?: Date;
}

export interface EmbeddingSearchOptions extends EmbeddingRuntimeOptions {
  dbPath: string;
  query: string;
  limit?: number;
}

export interface EmbeddingUsage {
  input_tokens: number;
}

export interface EmbeddingVectorResult {
  provider: AiProviderId;
  model: string;
  dimensions: number;
  vectors: number[][];
  usage: EmbeddingUsage;
}

export interface EmbeddingIndexResult {
  provider: AiProviderId;
  model: string;
  dimensions: number;
  chunks_seen: number;
  chunks_embedded: number;
  embeddings_upserted: number;
  vector_entries_upserted: number;
  usage: EmbeddingUsage;
}

export interface EmbeddingStatusResult {
  total_embeddings: number;
  total_vector_entries: number;
  indexes: Array<{
    provider: string;
    model: string;
    dimensions: number;
    entries: number;
    updated_at: string | null;
  }>;
}

export interface SemanticSearchResult {
  provider: AiProviderId;
  model: string;
  dimensions: number;
  query: string;
  results: Array<{
    chunk_id: string;
    score: number;
    text: string;
    source_uri: string | null;
    source_ref: string | null;
    revision: string | null;
    hash: string | null;
    provenance: KnowledgeProvenance | null;
  }>;
}

interface CandidateChunk {
  id: string;
  text: string;
  token_count: number | null;
  start_offset: number | null;
  end_offset: number | null;
  metadata_json: string;
  source_revision_id: string | null;
  revision: string | null;
  hash: string | null;
  source_uri: string | null;
  source_kind: string | null;
}

interface VectorRow {
  chunk_id: string;
  text: string;
  vector_json: string;
  vector_norm: number;
  source_uri: string | null;
  source_ref: string | null;
  revision: string | null;
  hash: string | null;
  metadata_json: string;
  source_acl_json: string | null;
  source_metadata_json: string | null;
  revision_metadata_json: string | null;
}

export const DEFAULT_EMBEDDING_MODEL_REF = 'openai:text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

function embeddingConfig(config?: KnowledgeConfig) {
  return (config as KnowledgeConfig & {
    embeddings?: {
      default_model?: string;
      dimensions?: number;
      batch_size?: number;
      max_parallel_calls?: number;
    };
  } | undefined)?.embeddings ?? {};
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function cosineSimilarity(a: number[], b: number[], bNorm = vectorNorm(b)): number {
  const aNorm = vectorNorm(a);
  if (aNorm === 0 || bNorm === 0) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}

function deterministicVector(text: string, dimensions: number): number[] {
  const bytes = createHash('sha256').update(text).digest();
  return Array.from({ length: dimensions }, (_, index) => {
    const value = bytes[index % bytes.length] / 255;
    return Number((value * 2 - 1).toFixed(6));
  });
}

async function openAiEmbeddingModel(model: string, config?: KnowledgeConfig, env: Record<string, string | undefined> = process.env): Promise<unknown> {
  assertProviderCredentials('openai', config, env);
  const settings = providerSettings(config, 'openai');
  const { createOpenAI } = await import('@ai-sdk/openai');
  const openai = createOpenAI({
    apiKey: env[settings.api_key_env],
    baseURL: settings.base_url,
  }) as unknown as {
    embeddingModel?: (modelId: string) => unknown;
    textEmbedding?: (modelId: string) => unknown;
    textEmbeddingModel?: (modelId: string) => unknown;
  };
  if (openai.embeddingModel) return openai.embeddingModel(model);
  if (openai.textEmbedding) return openai.textEmbedding(model);
  if (openai.textEmbeddingModel) return openai.textEmbeddingModel(model);
  throw new Error('OpenAI provider does not expose an embedding model factory.');
}

export function resolveEmbeddingModelRef(modelRef?: string, config?: KnowledgeConfig): string {
  if (!modelRef || modelRef === 'default' || modelRef === 'embedding') {
    return embeddingConfig(config).default_model ?? DEFAULT_EMBEDDING_MODEL_REF;
  }
  return modelRef;
}

export async function embedTexts(texts: string[], options: EmbeddingRuntimeOptions = {}): Promise<EmbeddingVectorResult> {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  if (parsed.provider !== 'openai') {
    throw new Error(`Embedding provider ${parsed.provider} is not supported yet. Use openai:text-embedding-3-small.`);
  }
  const dimensions = options.dimensions ?? embeddingConfig(options.config).dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;

  if (options.fake) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions,
      vectors: texts.map((text) => deterministicVector(text, dimensions)),
      usage: { input_tokens: texts.reduce((sum, text) => sum + Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.25)), 0) },
    };
  }

  const { embedMany } = await import('ai');
  const model = await openAiEmbeddingModel(parsed.model, options.config, options.env);
  const result = await embedMany({
    model: model as never,
    values: texts,
    maxParallelCalls: options.maxParallelCalls ?? embeddingConfig(options.config).max_parallel_calls,
    providerOptions: {
      openai: {
        dimensions,
      },
    },
  });
  const vectors = result.embeddings as number[][];
  return {
    provider: parsed.provider,
    model: parsed.model,
    dimensions: vectors[0]?.length ?? dimensions,
    vectors,
    usage: { input_tokens: result.usage?.tokens ?? 0 },
  };
}

function selectCandidateChunks(db: Database, options: {
  provider: AiProviderId;
  model: string;
  limit: number;
  sourceRevisionId?: string;
}): CandidateChunk[] {
  const baseQuery =
    `SELECT
       c.id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind
     FROM chunks c
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN vector_index_entries v
       ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
     WHERE v.id IS NULL`;
  const suffix = `
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`;
  if (options.sourceRevisionId) {
    return db.query<CandidateChunk, [string, string, string, number]>(
      `${baseQuery} AND c.source_revision_id = ?${suffix}`,
    ).all(options.provider, options.model, options.sourceRevisionId, options.limit);
  }
  return db.query<CandidateChunk, [string, string, number]>(
    `${baseQuery}${suffix}`,
  ).all(options.provider, options.model, options.limit);
}

function provenanceForChunk(row: CandidateChunk): KnowledgeProvenance {
  const metadata = parseJsonObject(row.metadata_json);
  const existing = metadata.provenance;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing as KnowledgeProvenance;
  return sourceProvenance({
    source_ref: metadataString(metadata, ['source_ref']),
    source_uri: row.source_uri ?? metadataString(metadata, ['source_uri']),
    source_kind: row.source_kind ?? metadataString(metadata, ['source_kind']),
    source_revision_id: row.source_revision_id,
    revision: row.revision ?? metadataString(metadata, ['revision']),
    hash: row.hash ?? metadataString(metadata, ['hash']),
    chunk_id: row.id,
    start_offset: row.start_offset ?? metadataNumber(metadata, ['start_offset']),
    end_offset: row.end_offset ?? metadataNumber(metadata, ['end_offset']),
    status: metadataString(metadata, ['status']),
    resolver: 'open-files-read-only',
  });
}

function upsertVectors(db: Database, rows: CandidateChunk[], embedding: EmbeddingVectorResult, now: string): number {
  const insertEmbedding = db.prepare(`
    INSERT INTO chunk_embeddings (id, chunk_id, provider, model, dimensions, vector_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      created_at = excluded.created_at
  `);
  const insertVector = db.prepare(`
    INSERT INTO vector_index_entries (
      id, chunk_id, source_revision_id, provider, model, dimensions, vector_json, vector_norm,
      source_uri, source_ref, revision, hash, start_offset, end_offset, token_count, status,
      metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      source_revision_id = excluded.source_revision_id,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      vector_norm = excluded.vector_norm,
      source_uri = excluded.source_uri,
      source_ref = excluded.source_ref,
      revision = excluded.revision,
      hash = excluded.hash,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      token_count = excluded.token_count,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);

  const write = db.transaction(() => {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const vector = embedding.vectors[index];
      if (!vector) continue;
      const metadata = parseJsonObject(row.metadata_json);
      const provenance = provenanceForChunk(row);
      const sourceRef = provenance.source_ref ?? metadataString(metadata, ['source_ref']);
      const sourceUri = provenance.source_uri ?? row.source_uri ?? metadataString(metadata, ['source_uri']);
      const revision = provenance.revision ?? row.revision ?? metadataString(metadata, ['revision']);
      const hash = provenance.hash ?? row.hash ?? metadataString(metadata, ['hash']);
      const status = provenance.status ?? metadataString(metadata, ['status']) ?? 'active';
      const vectorJson = JSON.stringify(vector);
      insertEmbedding.run(
        stableId('emb', `${row.id}\u0000${embedding.provider}\u0000${embedding.model}`),
        row.id,
        embedding.provider,
        embedding.model,
        embedding.dimensions,
        vectorJson,
        now,
      );
      insertVector.run(
        stableId('vec', `${row.id}\u0000${embedding.provider}\u0000${embedding.model}`),
        row.id,
        row.source_revision_id,
        embedding.provider,
        embedding.model,
        embedding.dimensions,
        vectorJson,
        vectorNorm(vector),
        sourceUri,
        sourceRef,
        revision,
        hash,
        provenance.start_offset,
        provenance.end_offset,
        row.token_count,
        status,
        JSON.stringify({
          ...metadata,
          provenance,
          embedded_at: now,
        }),
        now,
        now,
      );
    }
  });
  write();
  return rows.length;
}

export async function indexKnowledgeEmbeddings(options: EmbeddingIndexOptions): Promise<EmbeddingIndexResult> {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  if (parsed.provider !== 'openai') throw new Error(`Embedding provider ${parsed.provider} is not supported yet.`);
  const now = (options.now ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  migrateKnowledgeDb(options.dbPath);
  const readDb = openKnowledgeDb(options.dbPath);
  let rows: CandidateChunk[];
  try {
    rows = selectCandidateChunks(readDb, {
      provider: parsed.provider,
      model: parsed.model,
      limit,
      sourceRevisionId: options.sourceRevisionId,
    });
  } finally {
    readDb.close();
  }

  if (rows.length === 0) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions: options.dimensions ?? embeddingConfig(options.config).dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
      chunks_seen: 0,
      chunks_embedded: 0,
      embeddings_upserted: 0,
      vector_entries_upserted: 0,
      usage: { input_tokens: 0 },
    };
  }

  const embedding = await embedTexts(rows.map((row) => row.text), options);
  const writeDb = openKnowledgeDb(options.dbPath);
  try {
    const upserted = upsertVectors(writeDb, rows, embedding, now);
    return {
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
      chunks_seen: rows.length,
      chunks_embedded: rows.length,
      embeddings_upserted: upserted,
      vector_entries_upserted: upserted,
      usage: embedding.usage,
    };
  } finally {
    writeDb.close();
  }
}

export function embeddingIndexStatus(dbPath: string): EmbeddingStatusResult {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const totalEmbeddings = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM chunk_embeddings').get()?.n ?? 0;
    const totalVectorEntries = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM vector_index_entries').get()?.n ?? 0;
    const indexes = db.query<{
      provider: string;
      model: string;
      dimensions: number;
      entries: number;
      updated_at: string | null;
    }, []>(
      `SELECT provider, model, dimensions, COUNT(*) AS entries, MAX(updated_at) AS updated_at
       FROM vector_index_entries
       GROUP BY provider, model, dimensions
       ORDER BY provider, model`,
    ).all();
    return {
      total_embeddings: totalEmbeddings,
      total_vector_entries: totalVectorEntries,
      indexes,
    };
  } finally {
    db.close();
  }
}

export async function searchVectorIndex(options: EmbeddingSearchOptions): Promise<SemanticSearchResult> {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const purpose = options.purpose ?? KNOWLEDGE_ANSWER_PURPOSE;
  const embedded = await embedTexts([options.query], options);
  const queryVector = embedded.vectors[0] ?? [];

  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const rows = db.query<VectorRow, [string, string]>(
      `SELECT
         v.chunk_id,
         c.text,
         v.vector_json,
         v.vector_norm,
         v.source_uri,
         v.source_ref,
         v.revision,
         v.hash,
         v.metadata_json,
         s.acl_json AS source_acl_json,
         s.metadata_json AS source_metadata_json,
         sr.metadata_json AS revision_metadata_json
       FROM vector_index_entries v
       JOIN chunks c ON c.id = v.chunk_id
       LEFT JOIN source_revisions sr ON sr.id = v.source_revision_id
       LEFT JOIN sources s ON s.id = sr.source_id
       WHERE v.provider = ? AND v.model = ? AND v.status = 'active'`,
    ).all(parsed.provider, parsed.model);

    const scored = rows.flatMap((row) => {
      if (metadataIsStale(parseJsonObject(row.revision_metadata_json)) || metadataIsStale(parseJsonObject(row.source_metadata_json))) {
        return [];
      }
      const access = sourceAccessDecision(parseJsonObject(row.source_acl_json), purpose);
      if (!access.allowed) return [];
      const vector = JSON.parse(row.vector_json) as number[];
      const metadata = parseJsonObject(row.metadata_json);
      const provenance = metadata.provenance && typeof metadata.provenance === 'object' && !Array.isArray(metadata.provenance)
        ? metadata.provenance as KnowledgeProvenance
        : null;
      if (provenance?.stale) return [];
      return [{
        chunk_id: row.chunk_id,
        score: cosineSimilarity(queryVector, vector, row.vector_norm),
        text: row.text,
        source_uri: row.source_uri,
        source_ref: row.source_ref,
        revision: row.revision,
        hash: row.hash,
        provenance,
      }];
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions: embedded.dimensions,
      query: options.query,
      results: scored,
    };
  } finally {
    db.close();
  }
}
