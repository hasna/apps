import { createHash, randomUUID } from 'node:crypto';
import { indexKnowledgeEmbeddings, resolveEmbeddingModelRef, type EmbeddingRuntimeOptions } from './embeddings';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { parseModelRef } from './providers';
import type { KnowledgeConfig } from './workspace';

export interface ReindexRuntimeOptions extends EmbeddingRuntimeOptions {
  dbPath: string;
  config?: KnowledgeConfig;
  now?: Date;
}

export interface ReindexHealthResult {
  schema_version: number;
  chunks: number;
  vector_entries: number;
  missing_embeddings: number;
  queued: Record<string, number>;
  stale_revisions: number;
}

export interface ReindexEnqueueResult {
  enqueued: number;
  already_queued: number;
  reason: string;
}

export interface ReindexEmbeddingsResult {
  run_id: string;
  full: boolean;
  deleted_embeddings: number;
  deleted_vector_entries: number;
  queued: ReindexEnqueueResult;
  indexed: Awaited<ReturnType<typeof indexKnowledgeEmbeddings>>;
  completed_queue_items: number;
}

interface MissingChunkRow {
  chunk_id: string;
  source_revision_id: string | null;
  source_uri: string | null;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function queueCounts(dbPath: string): Record<string, number> {
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query<{ status: string; n: number }, []>(
      `SELECT status, COUNT(*) AS n FROM reindex_queue GROUP BY status ORDER BY status`,
    ).all();
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  } finally {
    db.close();
  }
}

function missingEmbeddingRows(dbPath: string, options: ReindexRuntimeOptions): MissingChunkRow[] {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query<MissingChunkRow, [string, string]>(
      `SELECT c.id AS chunk_id, c.source_revision_id, s.uri AS source_uri
       FROM chunks c
       LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
       LEFT JOIN sources s ON s.id = sr.source_id
       LEFT JOIN vector_index_entries v ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
       WHERE v.id IS NULL
       ORDER BY c.created_at ASC, c.ordinal ASC`,
    ).all(parsed.provider, parsed.model);
  } finally {
    db.close();
  }
}

export function reindexHealth(options: ReindexRuntimeOptions): ReindexHealthResult {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const version = db.query<{ version: number }, []>('SELECT MAX(version) AS version FROM schema_versions').get()?.version ?? 0;
    const chunks = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM chunks').get()?.n ?? 0;
    const vectorEntries = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM vector_index_entries').get()?.n ?? 0;
    const missing = missingEmbeddingRows(options.dbPath, options).length;
    const stale = db.query<{ n: number }, []>(
      `SELECT COUNT(*) AS n FROM source_revisions
       WHERE metadata_json LIKE '%"reindex_required":true%' OR metadata_json LIKE '%"status":"stale"%'`,
    ).get()?.n ?? 0;
    return {
      schema_version: version,
      chunks,
      vector_entries: vectorEntries,
      missing_embeddings: missing,
      queued: queueCounts(options.dbPath),
      stale_revisions: stale,
    };
  } finally {
    db.close();
  }
}

export function enqueueMissingEmbeddings(options: ReindexRuntimeOptions & { reason?: string }): ReindexEnqueueResult {
  migrateKnowledgeDb(options.dbPath);
  const now = (options.now ?? new Date()).toISOString();
  const reason = options.reason ?? 'missing_embedding';
  const rows = missingEmbeddingRows(options.dbPath, options);
  const db = openKnowledgeDb(options.dbPath);
  let enqueued = 0;
  let alreadyQueued = 0;
  try {
    const write = db.transaction(() => {
      for (const row of rows) {
        const id = stableId('rq', `embedding\u0000${row.chunk_id}\u0000${reason}`);
        const before = db.query<{ id: string }, [string, string, string]>(
          'SELECT id FROM reindex_queue WHERE kind = ? AND target_id = ? AND reason = ?',
        ).get('embedding', row.chunk_id, reason);
        if (before) {
          alreadyQueued += 1;
          continue;
        }
        db.run(
          `INSERT INTO reindex_queue (id, kind, target_id, source_uri, reason, status, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            'embedding',
            row.chunk_id,
            row.source_uri,
            reason,
            'pending',
            JSON.stringify({ source_revision_id: row.source_revision_id }),
            now,
            now,
          ],
        );
        enqueued += 1;
      }
    });
    write();
  } finally {
    db.close();
  }
  return { enqueued, already_queued: alreadyQueued, reason };
}

function clearEmbeddingIndex(dbPath: string): { embeddings: number; vectorEntries: number } {
  const db = openKnowledgeDb(dbPath);
  try {
    const embeddings = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM chunk_embeddings').get()?.n ?? 0;
    const vectorEntries = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM vector_index_entries').get()?.n ?? 0;
    db.run('DELETE FROM vector_index_entries');
    db.run('DELETE FROM chunk_embeddings');
    return { embeddings, vectorEntries };
  } finally {
    db.close();
  }
}

function completeIndexedQueueItems(dbPath: string, options: ReindexRuntimeOptions, now: string): number {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const db = openKnowledgeDb(dbPath);
  try {
    const result = db.run(
      `UPDATE reindex_queue
       SET status = ?, updated_at = ?
       WHERE kind = ?
         AND status = ?
         AND EXISTS (
           SELECT 1 FROM vector_index_entries v
           WHERE v.chunk_id = reindex_queue.target_id
             AND v.provider = ?
             AND v.model = ?
         )`,
      ['completed', now, 'embedding', 'pending', parsed.provider, parsed.model],
    );
    return result.changes;
  } finally {
    db.close();
  }
}

export async function refreshEmbeddingIndex(options: ReindexRuntimeOptions & { full?: boolean; limit?: number }): Promise<ReindexEmbeddingsResult> {
  migrateKnowledgeDb(options.dbPath);
  const now = (options.now ?? new Date()).toISOString();
  const runId = `run_${randomUUID()}`;
  const deleted = options.full ? clearEmbeddingIndex(options.dbPath) : { embeddings: 0, vectorEntries: 0 };
  const queued = enqueueMissingEmbeddings({ ...options, reason: options.full ? 'full_embedding_rebuild' : 'missing_embedding' });
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(
      `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        'embedding-refresh',
        options.full ? 'full' : 'incremental',
        'running',
        'local',
        resolveEmbeddingModelRef(options.modelRef, options.config),
        JSON.stringify({ full: options.full === true, queued }),
        now,
        now,
      ],
    );
  } finally {
    db.close();
  }

  const indexed = await indexKnowledgeEmbeddings({
    dbPath: options.dbPath,
    config: options.config,
    env: options.env,
    modelRef: options.modelRef,
    dimensions: options.dimensions,
    fake: options.fake,
    limit: options.limit,
    now: options.now,
  });

  const completedQueueItems = completeIndexedQueueItems(options.dbPath, options, now);
  const doneDb = openKnowledgeDb(options.dbPath);
  try {
    doneDb.run(
      `UPDATE runs SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
      [
        'completed',
        JSON.stringify({ full: options.full === true, queued, indexed, completed_queue_items: completedQueueItems }),
        now,
        runId,
      ],
    );
    doneDb.run(
      `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `evt_${randomUUID()}`,
        runId,
        'info',
        'embedding_refresh_completed',
        JSON.stringify({ queued, indexed, completed_queue_items: completedQueueItems }),
        now,
      ],
    );
  } finally {
    doneDb.close();
  }

  return {
    run_id: runId,
    full: options.full === true,
    deleted_embeddings: deleted.embeddings,
    deleted_vector_entries: deleted.vectorEntries,
    queued,
    indexed,
    completed_queue_items: completedQueueItems,
  };
}
