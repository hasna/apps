// Hosted (cloud) embeddings for sessions-serve.
//
// Mirrors src/lib/embeddings.ts and src/lib/vector-search.ts over the shared
// Postgres: an `embeddings` table (migration 0007) holds one row per chunk as
// FLOAT8[], and ranking is brute-force cosine in JS exactly like the local
// SQLite path, so semantic / hybrid search behave identically on both
// backends. The embedder runs server-side (the operator's OPENAI_API_KEY, by
// env name — never a value in code), which is what makes the capability
// available to every client of the hosted /v1 API.

import type { TypedQueryClient } from "../../generated/storage-kit/index.js";
import { getCloudClient } from "./client.js";
import { sessionFilterClauses } from "./store.js";
import {
  chunkText,
  DEFAULT_EMBEDDING_MODEL,
  openaiEmbedder,
  type Embedder,
  type EmbedResult,
} from "../../lib/embeddings.js";
import { cosineSimilarity, reciprocalRankFusion } from "../../lib/vector-search.js";
import type { SearchHit, SearchOptions } from "../../lib/search.js";
import { searchContent } from "./store.js";

export type { Embedder, EmbedResult };

/** The embedder used when none is injected (reads OPENAI_API_KEY at call time). */
export function defaultCloudEmbedder(model: string): Embedder {
  return openaiEmbedder(model);
}

function clampLimit(limit: number | undefined, fallback: number): number {
  const n = Number(limit ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 500);
}

/**
 * Generate embeddings for messages that have none yet, one row per chunk in the
 * cloud `embeddings` table. Idempotent — already-embedded messages are skipped.
 */
export async function cloudEmbedSessions(
  opts: {
    limit?: number;
    embedder?: Embedder;
    model?: string;
    maxChars?: number;
  } = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<EmbedResult> {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const embedder = opts.embedder ?? defaultCloudEmbedder(model);

  const rows = await client.many<{ id: string; session_id: string; content: string }>(
    `SELECT m.id, m.session_id, m.content
       FROM messages m
      WHERE m.content IS NOT NULL AND m.content != ''
        AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.message_id = m.id)
      LIMIT $1`,
    [clampLimit(opts.limit, 200)],
  );

  let chunksEmbedded = 0;
  for (const m of rows) {
    const texts = chunkText(m.content, opts.maxChars ?? 2000);
    if (texts.length === 0) continue;
    const vectors = await embedder(texts);
    for (let i = 0; i < vectors.length; i++) {
      await client.execute(
        `INSERT INTO embeddings
           (id, message_id, session_id, chunk_index, chunk_text, embedding,
            embedding_model, dimensions, created_at, synced_to_s3)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), 0)`,
        [
          crypto.randomUUID(),
          m.id,
          m.session_id,
          i,
          texts[i],
          vectors[i],
          model,
          vectors[i].length,
        ],
      );
      chunksEmbedded++;
    }
  }

  return { messagesProcessed: rows.length, chunksEmbedded };
}

/** Number of stored embedding rows (for recall metadata). */
export async function cloudEmbeddingCount(
  client: TypedQueryClient = getCloudClient(),
): Promise<number> {
  const row = await client.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM embeddings WHERE embedding IS NOT NULL`,
  );
  return Number(row?.c ?? 0);
}

/** True when any embedding exists (optionally within the session filters). */
export async function cloudHasStoredEmbeddings(
  opts: SearchOptions = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<boolean> {
  const params: unknown[] = [];
  const where = sessionFilterClauses(opts, params, "s");
  const row = await client.get<{ present: number }>(
    `SELECT 1 AS present
       FROM embeddings e
       JOIN sessions s ON s.id = e.session_id
      WHERE e.embedding IS NOT NULL${where}
      LIMIT 1`,
    params,
  );
  return Boolean(row?.present);
}

/** Rank stored cloud embeddings against a query vector (brute-force cosine). */
export async function cloudVectorSearchByEmbedding(
  queryVec: number[],
  opts: SearchOptions = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<SearchHit[]> {
  const params: unknown[] = [];
  const where = sessionFilterClauses(opts, params, "s");
  const rows = await client.many<Record<string, unknown>>(
    `SELECT e.session_id, e.chunk_text, e.embedding,
            s.source, s.title, s.project_name, s.project_path, s.started_at
       FROM embeddings e
       JOIN sessions s ON s.id = e.session_id
      WHERE e.embedding IS NOT NULL${where}`,
    params,
  );

  const scored = rows
    .map((r) => ({
      r,
      score: cosineSimilarity(queryVec, (r.embedding as unknown as number[]) ?? []),
    }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const limit = clampLimit(opts.limit, 20);
  for (const { r, score } of scored) {
    const id = r.session_id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push({
      session_id: id,
      source: r.source as string,
      title: (r.title as string) ?? null,
      project_name: (r.project_name as string) ?? null,
      project_path: (r.project_path as string) ?? null,
      started_at: (r.started_at as string) ?? null,
      snippet: ((r.chunk_text as string) ?? "").slice(0, 200),
      rank: score,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Semantic search over the shared cloud: embed the query, then cosine-rank. */
export async function cloudSemanticSearch(
  query: string,
  opts: SearchOptions & { embedder?: Embedder } = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<SearchHit[]> {
  if (!(await cloudHasStoredEmbeddings(opts, client))) return [];
  const embedder = opts.embedder ?? defaultCloudEmbedder(DEFAULT_EMBEDDING_MODEL);
  const [queryVec] = await embedder([query]);
  return cloudVectorSearchByEmbedding(queryVec, opts, client);
}

/** Hybrid search over the shared cloud: RRF of full-text (ILIKE) + semantic. */
export async function cloudHybridSearch(
  query: string,
  opts: SearchOptions & { embedder?: Embedder } = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<SearchHit[]> {
  const limit = clampLimit(opts.limit, 20);
  const fts = await searchContent(query, { ...opts, limit: limit * 2 }, client);
  const semantic = await cloudSemanticSearch(query, { ...opts, limit: limit * 2 }, client);
  return reciprocalRankFusion([fts, semantic], limit);
}
