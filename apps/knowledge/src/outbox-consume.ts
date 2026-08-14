import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { parseSourceRef, type SourceRef } from './source-ref';
import type { KnowledgeConfig } from './workspace';
import { assertS3ReadAllowed, assertWriteAllowed, recordAuditEvent, type SafetyPolicy } from './safety';

type OutboxObject = Record<string, unknown>;

export interface OutboxConsumeOptions {
  dbPath: string;
  input: string;
  config?: KnowledgeConfig;
  safetyPolicy?: SafetyPolicy;
  now?: Date;
}

export interface OutboxConsumeResult {
  path: string;
  db_path: string;
  run_id: string;
  events_seen: number;
  sources_touched: number;
  revisions_touched: number;
  chunks_deleted: number;
  embeddings_deleted: number;
  stale_revisions: number;
  deleted_sources: number;
  moved_sources: number;
  permission_updates: number;
  vector_entries_deleted: number;
}

interface NormalizedOutboxEvent {
  raw: OutboxObject;
  eventType: string;
  sourceRef: string;
  sourceUri: string;
  kind: SourceRef['kind'];
  title: string | null;
  revision: string | null;
  previousRevision: string | null;
  hash: string | null;
  status: string | null;
  updatedAt: string;
  acl: unknown;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function asObject(value: unknown): OutboxObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as OutboxObject : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildSourceRef(event: OutboxObject): string {
  const explicit = asString(event.source_ref) ?? asString(event.source_uri) ?? asString(event.uri);
  if (explicit) return explicit;
  const fileId = asString(event.file_id);
  if (fileId) {
    const revision = asString(event.revision_id) ?? asString(event.revision);
    const fileRef = `open-files://file/${encodeURIComponent(fileId)}`;
    return revision ? `${fileRef}/revision/${encodeURIComponent(revision)}` : fileRef;
  }
  const sourceId = asString(event.source_id);
  const path = asString(event.path);
  if (sourceId && path) {
    return `open-files://source/${encodeURIComponent(sourceId)}/path/${encodeURIComponent(path)}`;
  }
  throw new Error('Outbox event is missing source_ref, file_id, or source_id/path.');
}

function baseSourceUri(sourceRef: string, parsed: SourceRef): string {
  if (parsed.kind === 'open-files' && parsed.entity === 'file' && parsed.revision_id) {
    return sourceRef.replace(/\/revision\/[^/]+$/, '');
  }
  return sourceRef;
}

function hashFromEvent(event: OutboxObject): string | null {
  return asString(event.hash) ?? asString(event.checksum) ?? asString(event.sha256) ?? null;
}

function revisionFromEvent(event: OutboxObject, parsed: SourceRef, hash: string | null): string | null {
  return (
    asString(event.revision_id) ??
    asString(event.revision) ??
    asString(event.version_id) ??
    (parsed.kind === 'open-files' ? parsed.revision_id : undefined) ??
    hash ??
    null
  );
}

function previousRevisionFromEvent(event: OutboxObject): string | null {
  return (
    asString(event.previous_revision_id) ??
    asString(event.previous_revision) ??
    asString(event.previous_version_id) ??
    null
  );
}

function eventType(event: OutboxObject): string {
  return (
    asString(event.event_type) ??
    asString(event.event) ??
    asString(event.type) ??
    asString(event.action) ??
    asString(event.change_type) ??
    'changed'
  ).toLowerCase();
}

function titleFromEvent(event: OutboxObject): string | null {
  const path = asString(event.path);
  return asString(event.title) ?? asString(event.name) ?? (path ? basename(path) : null);
}

function normalizeEvent(event: OutboxObject, now: string): NormalizedOutboxEvent {
  const sourceRef = buildSourceRef(event);
  const parsed = parseSourceRef(sourceRef);
  const hash = hashFromEvent(event);
  return {
    raw: event,
    eventType: eventType(event),
    sourceRef,
    sourceUri: baseSourceUri(sourceRef, parsed),
    kind: parsed.kind,
    title: titleFromEvent(event),
    revision: revisionFromEvent(event, parsed, hash),
    previousRevision: previousRevisionFromEvent(event),
    hash,
    status: asString(event.status)?.toLowerCase() ?? null,
    updatedAt: asString(event.updated_at) ?? now,
    acl: event.permissions ?? event.acl ?? undefined,
  };
}

function parseOutboxText(text: string): OutboxObject[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Outbox array parse failed.');
    return parsed.map((entry) => {
      const event = asObject(entry);
      if (!event) throw new Error('Outbox array entries must be objects.');
      return event;
    });
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const object = asObject(parsed);
      if (!object) throw new Error('Outbox object parse failed.');
      if (Array.isArray(object.events)) {
        return object.events.map((entry) => {
          const event = asObject(entry);
          if (!event) throw new Error('Outbox events entries must be objects.');
          return event;
        });
      }
      if ('source_ref' in object || 'source_uri' in object || 'file_id' in object) return [object];
    } catch (error) {
      const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length <= 1) throw error;
      return lines.map((line) => {
        const event = asObject(JSON.parse(line));
        if (!event) throw new Error('Outbox JSONL entries must be objects.');
        return event;
      });
    }
  }
  return trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    const event = asObject(JSON.parse(line));
    if (!event) throw new Error('Outbox JSONL entries must be objects.');
    return event;
  });
}

async function readS3Text(uri: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<string> {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!bucket || !key) throw new Error(`Invalid S3 outbox URI: ${uri}`);
  if (safetyPolicy) assertS3ReadAllowed(uri, safetyPolicy);
  const [{ S3Client, GetObjectCommand }, { fromIni }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/credential-providers'),
  ]);
  const s3Config = config?.storage.type === 's3' && config.storage.s3?.bucket === bucket ? config.storage.s3 : undefined;
  const client = new S3Client({
    region: s3Config?.region,
    credentials: s3Config?.profile ? fromIni({ profile: s3Config.profile }) : undefined,
    maxAttempts: s3Config?.max_attempts,
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) return '';
  return await response.Body.transformToString();
}

async function readOutboxInput(input: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<string> {
  if (input.startsWith('s3://')) return readS3Text(input, config, safetyPolicy);
  if (!existsSync(input)) throw new Error(`Outbox not found: ${input}`);
  return readFileSync(input, 'utf8');
}

function mergeJson(existing: string | null | undefined, patch: OutboxObject): string {
  let base: OutboxObject = {};
  if (existing) {
    try {
      base = asObject(JSON.parse(existing)) ?? {};
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

function ensureSource(db: Database, event: NormalizedOutboxEvent, now: string): string {
  const id = stableId('src', event.sourceUri);
  db.run(
    `INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,
    [
      id,
      event.sourceUri,
      event.kind,
      event.title,
      JSON.stringify({ source_ref: event.sourceRef, source_uri: event.sourceUri, status: event.status, last_outbox_event: event.eventType }),
      JSON.stringify(event.acl ?? {}),
      now,
      event.updatedAt,
    ],
  );
  const row = db.query<{ id: string; metadata_json: string; acl_json: string }, [string]>('SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?').get(event.sourceUri);
  if (!row) throw new Error(`Failed to upsert source for outbox event: ${event.sourceUri}`);
  const patch: OutboxObject = {
    source_ref: event.sourceRef,
    source_uri: event.sourceUri,
    last_outbox_event: event.eventType,
    last_outbox_at: event.updatedAt,
  };
  if (event.status) patch.status = event.status;
  if (asString(event.raw.path)) patch.path = event.raw.path;
  db.run(
    'UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?',
    [
      mergeJson(row.metadata_json, patch),
      event.acl === undefined ? null : JSON.stringify(event.acl),
      event.acl === undefined ? null : JSON.stringify(event.acl),
      event.updatedAt,
      row.id,
    ],
  );
  return row.id;
}

function ensureRevision(db: Database, sourceId: string, event: NormalizedOutboxEvent, now: string): string | null {
  if (!event.revision) return null;
  const id = stableId('rev', `${sourceId}\u0000${event.revision}`);
  const metadata = {
    source_ref: event.sourceRef,
    source_uri: event.sourceUri,
    status: event.status,
    last_outbox_event: event.eventType,
    reindex_required: true,
  };
  db.run(
    `INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,
    [id, sourceId, event.revision, event.hash, asString(event.raw.extracted_text_ref) ?? null, JSON.stringify(metadata), now],
  );
  const row = db.query<{ id: string }, [string, string]>(
    'SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?',
  ).get(sourceId, event.revision);
  return row?.id ?? null;
}

function revisionIdsForEvent(db: Database, sourceId: string, event: NormalizedOutboxEvent): string[] {
  if (event.previousRevision) {
    const previous = db.query<{ id: string }, [string, string]>(
      'SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?',
    ).all(sourceId, event.previousRevision).map((row) => row.id);
    if (previous.length > 0) return previous;
  }
  if (event.revision) {
    return db.query<{ id: string }, [string, string]>(
      'SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?',
    ).all(sourceId, event.revision).map((row) => row.id);
  }
  if (event.hash) {
    return db.query<{ id: string }, [string, string]>(
      'SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?',
    ).all(sourceId, event.hash).map((row) => row.id);
  }
  return db.query<{ id: string }, [string]>(
    'SELECT id FROM source_revisions WHERE source_id = ?',
  ).all(sourceId).map((row) => row.id);
}

function invalidateRevision(db: Database, revisionId: string): { chunksDeleted: number; embeddingsDeleted: number; vectorEntriesDeleted: number } {
  const chunks = db.query<{ id: string }, [string]>('SELECT id FROM chunks WHERE source_revision_id = ?').all(revisionId);
  let embeddingsDeleted = 0;
  let vectorEntriesDeleted = 0;
  for (const chunk of chunks) {
    const row = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?').get(chunk.id);
    embeddingsDeleted += row?.n ?? 0;
    const vectorRow = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM vector_index_entries WHERE chunk_id = ?').get(chunk.id);
    vectorEntriesDeleted += vectorRow?.n ?? 0;
    db.run('DELETE FROM vector_index_entries WHERE chunk_id = ?', [chunk.id]);
    db.run('DELETE FROM chunk_embeddings WHERE chunk_id = ?', [chunk.id]);
    db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', [chunk.id]);
  }
  db.run('DELETE FROM chunks WHERE source_revision_id = ?', [revisionId]);
  const revision = db.query<{ metadata_json: string }, [string]>('SELECT metadata_json FROM source_revisions WHERE id = ?').get(revisionId);
  db.run(
    'UPDATE source_revisions SET metadata_json = ? WHERE id = ?',
    [mergeJson(revision?.metadata_json, { reindex_required: true, invalidated_at: new Date().toISOString() }), revisionId],
  );
  return { chunksDeleted: chunks.length, embeddingsDeleted, vectorEntriesDeleted };
}

function isDeleteEvent(eventType: string, status: string | null): boolean {
  return status === 'deleted' || ['delete', 'deleted', 'remove', 'removed'].includes(eventType);
}

function isMoveEvent(eventType: string): boolean {
  return ['move', 'moved', 'rename', 'renamed', 'path_changed', 'canonical_key_changed'].includes(eventType);
}

function isPermissionEvent(eventType: string): boolean {
  return ['permission', 'permissions', 'permission_changed', 'acl_changed', 'acl_revoked'].includes(eventType);
}

export async function consumeOpenFilesOutbox(options: OutboxConsumeOptions): Promise<OutboxConsumeResult> {
  const now = (options.now ?? new Date()).toISOString();
  if (options.safetyPolicy) assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const text = await readOutboxInput(options.input, options.config, options.safetyPolicy);
  const events = parseOutboxText(text);
  const db = openKnowledgeDb(options.dbPath);
  const runId = `run_${randomUUID()}`;
  try {
    return db.transaction(() => {
      db.run(
        `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          'open-files-outbox',
          options.input,
          'completed',
          'local',
          'open-files-outbox',
          JSON.stringify({ path: options.input, events: events.length }),
          now,
          now,
        ],
      );

      const sourcesTouched = new Set<string>();
      const revisionsTouched = new Set<string>();
      let chunksDeleted = 0;
      let embeddingsDeleted = 0;
      let vectorEntriesDeleted = 0;
      let staleRevisions = 0;
      let deletedSources = 0;
      let movedSources = 0;
      let permissionUpdates = 0;

      recordAuditEvent(db, {
        event_type: 'source_read',
        action: options.input.startsWith('s3://') ? 's3_outbox_read' : 'local_outbox_read',
        target_uri: options.input,
        decision: 'allow',
        metadata: { events: events.length, read_only: true },
        created_at: now,
      });

      events.forEach((raw, index) => {
        const event = normalizeEvent(raw, now);
        const sourceId = ensureSource(db, event, now);
        sourcesTouched.add(sourceId);
        const createdRevisionId = ensureRevision(db, sourceId, event, now);
        if (createdRevisionId) revisionsTouched.add(createdRevisionId);

        const affectedRevisionIds = revisionIdsForEvent(db, sourceId, event);
        for (const revisionId of affectedRevisionIds) {
          revisionsTouched.add(revisionId);
          const invalidation = invalidateRevision(db, revisionId);
          chunksDeleted += invalidation.chunksDeleted;
          embeddingsDeleted += invalidation.embeddingsDeleted;
          vectorEntriesDeleted += invalidation.vectorEntriesDeleted;
          staleRevisions += 1;
        }

        if (isDeleteEvent(event.eventType, event.status)) deletedSources += 1;
        if (isMoveEvent(event.eventType)) movedSources += 1;
        if (isPermissionEvent(event.eventType) || event.acl !== undefined) permissionUpdates += 1;

        db.run(
          `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            stableId('evt', `${runId}\u0000${index}\u0000${event.sourceRef}\u0000${event.eventType}`),
            runId,
            'info',
            event.eventType,
            JSON.stringify({
              source_ref: event.sourceRef,
              source_uri: event.sourceUri,
              revision: event.revision,
              hash: event.hash,
              status: event.status,
              affected_revisions: affectedRevisionIds.length,
            }),
            event.updatedAt,
          ],
        );
      });

      db.run(
        `INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
        [
          stableId('usage', runId),
          runId,
          'local',
          'open-files-outbox',
          JSON.stringify({ note: 'No model provider used for outbox invalidation.' }),
          now,
        ],
      );

      recordAuditEvent(db, {
        event_type: 'write',
        action: 'knowledge_outbox_invalidation',
        target_uri: options.dbPath,
        decision: 'allow',
        metadata: {
          run_id: runId,
          events: events.length,
          sources: sourcesTouched.size,
          revisions: revisionsTouched.size,
          chunks_deleted: chunksDeleted,
          embeddings_deleted: embeddingsDeleted,
          vector_entries_deleted: vectorEntriesDeleted,
        },
        created_at: now,
      });

      return {
        path: options.input,
        db_path: options.dbPath,
        run_id: runId,
        events_seen: events.length,
        sources_touched: sourcesTouched.size,
        revisions_touched: revisionsTouched.size,
        chunks_deleted: chunksDeleted,
        embeddings_deleted: embeddingsDeleted,
        vector_entries_deleted: vectorEntriesDeleted,
        stale_revisions: staleRevisions,
        deleted_sources: deletedSources,
        moved_sources: movedSources,
        permission_updates: permissionUpdates,
      };
    })();
  } finally {
    db.close();
  }
}
