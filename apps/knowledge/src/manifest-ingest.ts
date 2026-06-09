import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { parseSourceRef, type SourceRef } from './source-ref';
import { sourceProvenance, withProvenance } from './provenance';
import type { KnowledgeConfig } from './workspace';
import {
  assertS3ReadAllowed,
  assertWriteAllowed,
  recordAuditEvent,
  recordRedactionFindings,
  redactSecrets,
  type SafetyPolicy,
} from './safety';

export interface ManifestIngestOptions {
  dbPath: string;
  input: string;
  config?: KnowledgeConfig;
  safetyPolicy?: SafetyPolicy;
  now?: Date;
  maxChunkChars?: number;
  chunkOverlapChars?: number;
}

export interface ManifestItemsIngestOptions {
  dbPath: string;
  items: ManifestObject[];
  sourceLabel: string;
  readAction?: string;
  safetyPolicy?: SafetyPolicy;
  now?: Date;
  maxChunkChars?: number;
  chunkOverlapChars?: number;
}

export interface ManifestIngestResult {
  path: string;
  db_path: string;
  items_seen: number;
  sources_upserted: number;
  revisions_upserted: number;
  chunks_inserted: number;
  chunks_deleted: number;
  redactions: number;
  skipped: number;
}

export type ManifestObject = Record<string, unknown>;

interface NormalizedManifestItem {
  raw: ManifestObject;
  sourceRef: string;
  sourceUri: string;
  kind: SourceRef['kind'];
  title: string | null;
  revision: string;
  hash: string | null;
  extractedTextUri: string | null;
  text: string | null;
  metadata: ManifestObject;
  acl: unknown;
  status: string;
  updatedAt: string;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function asObject(value: unknown): ManifestObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ManifestObject : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildSourceRefFromItem(item: ManifestObject): string {
  const explicit = asString(item.source_ref) ?? asString(item.source_uri) ?? asString(item.uri);
  if (explicit) return explicit;

  const fileId = asString(item.file_id);
  if (fileId) {
    const revision = asString(item.revision_id) ?? asString(item.revision);
    const fileRef = `open-files://file/${encodeURIComponent(fileId)}`;
    return revision ? `${fileRef}/revision/${encodeURIComponent(revision)}` : fileRef;
  }

  const sourceId = asString(item.source_id);
  const path = asString(item.path);
  if (sourceId && path) {
    return `open-files://source/${encodeURIComponent(sourceId)}/path/${encodeURIComponent(path)}`;
  }

  throw new Error('Manifest item is missing source_ref, file_id, or source_id/path.');
}

function baseSourceUri(sourceRef: string, parsed: SourceRef): string {
  if (parsed.kind === 'open-files' && parsed.entity === 'file' && parsed.revision_id) {
    return sourceRef.replace(/\/revision\/[^/]+$/, '');
  }
  return sourceRef;
}

function textFromItem(item: ManifestObject): string | null {
  const direct =
    asString(item.extracted_text) ??
    asString(item.text) ??
    asString(item.content_text) ??
    asString(item.markdown);
  if (direct !== undefined) return direct;
  const content = item.content;
  return typeof content === 'string' ? content : null;
}

function extractedTextUriFromItem(item: ManifestObject): string | null {
  const direct = asString(item.extracted_text_ref) ?? asString(item.extracted_text_uri) ?? asString(item.text_ref);
  if (direct) return direct;
  const content = asObject(item.content);
  return asString(content?.extracted_text_ref) ?? asString(content?.extracted_text_uri) ?? null;
}

function titleFromItem(item: ManifestObject): string | null {
  const path = asString(item.path);
  return asString(item.title) ?? asString(item.name) ?? (path ? basename(path) : null);
}

function hashFromItem(item: ManifestObject): string | null {
  return asString(item.hash) ?? asString(item.checksum) ?? asString(item.sha256) ?? null;
}

const OMIT_MANIFEST_METADATA_KEYS = new Set([
  'text',
  'content',
  'content_text',
  'extracted_text',
  'markdown',
  'raw',
  'raw_text',
  'raw_bytes',
  'raw_content',
  'raw_body',
  'raw_file',
  'source_raw',
  'source_raw_bytes',
  'source_bytes',
  'source_content',
  'source_body',
  'file_bytes',
  'file_content',
  'content_bytes',
  'content_base64',
  'document_bytes',
  'document_content',
  'document_base64',
  'binary',
  'binary_content',
  'binary_base64',
  'bytes',
  'body',
  'blob',
  'data',
  'payload',
]);

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]+/g, '_');
}

function sanitizeManifestMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeManifestMetadataValue(entry));
  const object = asObject(value);
  if (!object) return value;
  const sanitized: ManifestObject = {};
  for (const [key, nestedValue] of Object.entries(object)) {
    if (OMIT_MANIFEST_METADATA_KEYS.has(normalizeMetadataKey(key))) continue;
    sanitized[key] = sanitizeManifestMetadataValue(nestedValue);
  }
  return sanitized;
}

function revisionFromItem(item: ManifestObject, parsed: SourceRef, hash: string | null): string {
  const revision =
    asString(item.revision_id) ??
    asString(item.revision) ??
    asString(item.version_id) ??
    (parsed.kind === 'open-files' ? parsed.revision_id : undefined) ??
    hash ??
    asString(item.updated_at);
  return revision ?? 'current';
}

function metadataFromItem(item: ManifestObject, normalized: {
  sourceRef: string;
  sourceUri: string;
  status: string;
}): ManifestObject {
  const metadata: ManifestObject = {};
  for (const [key, value] of Object.entries(item)) {
    if (OMIT_MANIFEST_METADATA_KEYS.has(normalizeMetadataKey(key))) continue;
    metadata[key] = sanitizeManifestMetadataValue(value);
  }
  metadata.source_ref = normalized.sourceRef;
  metadata.source_uri = normalized.sourceUri;
  metadata.status = normalized.status;
  return metadata;
}

function normalizeManifestItem(item: ManifestObject, now: string): NormalizedManifestItem {
  const sourceRef = buildSourceRefFromItem(item);
  const parsed = parseSourceRef(sourceRef);
  const sourceUri = baseSourceUri(sourceRef, parsed);
  const hash = hashFromItem(item);
  const status = asString(item.status) ?? 'active';
  return {
    raw: item,
    sourceRef,
    sourceUri,
    kind: parsed.kind,
    title: titleFromItem(item),
    revision: revisionFromItem(item, parsed, hash),
    hash,
    extractedTextUri: extractedTextUriFromItem(item),
    text: textFromItem(item),
    metadata: metadataFromItem(item, { sourceRef, sourceUri, status }),
    acl: item.permissions ?? item.acl ?? {},
    status,
    updatedAt: asString(item.updated_at) ?? now,
  };
}

function parseManifestText(text: string): ManifestObject[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Manifest array parse failed.');
    return parsed.map((entry) => {
      const item = asObject(entry);
      if (!item) throw new Error('Manifest array entries must be objects.');
      return item;
    });
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const object = asObject(parsed);
      if (!object) throw new Error('Manifest object parse failed.');
      if (Array.isArray(object.items)) {
        return object.items.map((entry) => {
          const item = asObject(entry);
          if (!item) throw new Error('Manifest items entries must be objects.');
          return item;
        });
      }
      if ('source_ref' in object || 'source_uri' in object || 'file_id' in object) return [object];
    } catch (error) {
      const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length <= 1) throw error;
      return lines.map((line) => {
        const item = asObject(JSON.parse(line));
        if (!item) throw new Error('Manifest JSONL entries must be objects.');
        return item;
      });
    }
  }

  return trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    const item = asObject(JSON.parse(line));
    if (!item) throw new Error('Manifest JSONL entries must be objects.');
    return item;
  });
}

async function readS3Text(uri: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<string> {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!bucket || !key) throw new Error(`Invalid S3 manifest URI: ${uri}`);
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

async function readManifestInput(input: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<string> {
  if (input.startsWith('s3://')) return readS3Text(input, config, safetyPolicy);
  if (!existsSync(input)) throw new Error(`Manifest not found: ${input}`);
  return readFileSync(input, 'utf8');
}

interface TextChunk {
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

function chunkText(text: string, maxChars: number, overlapChars: number): TextChunk[] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + maxChars);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', hardEnd);
      const sentenceBreak = normalized.lastIndexOf('. ', hardEnd);
      const candidate = Math.max(paragraphBreak, sentenceBreak);
      if (candidate > start + Math.floor(maxChars * 0.5)) end = candidate + (candidate === paragraphBreak ? 2 : 1);
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push({
        ordinal: chunks.length,
        text: chunk,
        startOffset: start,
        endOffset: end,
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function deleteChunksForRevision(db: Database, sourceRevisionId: string): number {
  const rows = db.query<{ id: string }, [string]>('SELECT id FROM chunks WHERE source_revision_id = ?').all(sourceRevisionId);
  for (const row of rows) {
    db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', [row.id]);
  }
  db.run('DELETE FROM chunks WHERE source_revision_id = ?', [sourceRevisionId]);
  return rows.length;
}

function upsertSource(db: Database, item: NormalizedManifestItem, now: string): string {
  const sourceId = stableId('src', item.sourceUri);
  db.run(
    `INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,
    [
      sourceId,
      item.sourceUri,
      item.kind,
      item.title,
      JSON.stringify(item.metadata),
      JSON.stringify(item.acl ?? {}),
      now,
      item.updatedAt,
    ],
  );
  const row = db.query<{ id: string }, [string]>('SELECT id FROM sources WHERE uri = ?').get(item.sourceUri);
  if (!row) throw new Error(`Failed to upsert source: ${item.sourceUri}`);
  return row.id;
}

function upsertRevision(db: Database, sourceId: string, item: NormalizedManifestItem, now: string): string {
  const revisionId = stableId('rev', `${sourceId}\u0000${item.revision}`);
  db.run(
    `INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,
    [
      revisionId,
      sourceId,
      item.revision,
      item.hash,
      item.extractedTextUri,
      JSON.stringify(item.metadata),
      now,
    ],
  );
  const row = db.query<{ id: string }, [string, string]>(
    'SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?',
  ).get(sourceId, item.revision);
  if (!row) throw new Error(`Failed to upsert source revision: ${item.sourceRef}`);
  return row.id;
}

function insertChunks(db: Database, sourceRevisionId: string, item: NormalizedManifestItem, now: string, maxChars: number, overlapChars: number, safetyPolicy?: SafetyPolicy): { chunksInserted: number; redactions: number } {
  if (!item.text || item.status.toLowerCase() === 'deleted') return { chunksInserted: 0, redactions: 0 };
  const redacted = redactSecrets(item.text, safetyPolicy);
  if (redacted.findings.length > 0) {
    recordRedactionFindings(db, {
      source_uri: item.sourceUri,
      findings: redacted.findings,
      metadata: { source_ref: item.sourceRef, revision: item.revision },
      created_at: now,
    });
    recordAuditEvent(db, {
      event_type: 'redaction',
      action: 'source_text_redact',
      target_uri: item.sourceUri,
      decision: 'redacted',
      metadata: { findings: redacted.findings.length, source_ref: item.sourceRef, revision: item.revision },
      created_at: now,
    });
  }
  const chunks = chunkText(redacted.text, maxChars, overlapChars);
  for (const chunk of chunks) {
    const chunkId = stableId('chk', `${sourceRevisionId}\u0000${chunk.ordinal}\u0000${chunk.text}`);
    const provenance = sourceProvenance({
      source_ref: item.sourceRef,
      source_uri: item.sourceUri,
      source_kind: item.kind,
      source_revision_id: sourceRevisionId,
      revision: item.revision,
      hash: item.hash,
      chunk_id: chunkId,
      start_offset: chunk.startOffset,
      end_offset: chunk.endOffset,
      status: item.status,
      resolver: 'open-files-read-only',
    });
    const metadata = withProvenance({
      source_ref: item.sourceRef,
      source_uri: item.sourceUri,
      source_kind: item.kind,
      source_revision_id: sourceRevisionId,
      revision: item.revision,
      hash: item.hash,
      status: item.status,
      path: asString(item.raw.path) ?? null,
      mime: asString(item.raw.mime) ?? asString(item.raw.content_type) ?? null,
      size: asNumber(item.raw.size) ?? null,
    }, provenance);
    db.run(
      `INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunkId,
        sourceRevisionId,
        'source',
        chunk.ordinal,
        chunk.text,
        estimateTokenCount(chunk.text),
        chunk.startOffset,
        chunk.endOffset,
        JSON.stringify(metadata),
        now,
      ],
    );
    db.run(
      'INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)',
      [chunkId, chunk.text, item.title ?? '', item.sourceUri],
    );
  }
  return { chunksInserted: chunks.length, redactions: redacted.findings.length };
}

export async function ingestOpenFilesManifest(options: ManifestIngestOptions): Promise<ManifestIngestResult> {
  const now = options.now ?? new Date();
  if (options.safetyPolicy) assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const text = await readManifestInput(options.input, options.config, options.safetyPolicy);
  const items = parseManifestText(text);
  return ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items,
    sourceLabel: options.input,
    safetyPolicy: options.safetyPolicy,
    now,
    maxChunkChars: options.maxChunkChars,
    chunkOverlapChars: options.chunkOverlapChars,
  });
}

export async function ingestOpenFilesManifestItems(options: ManifestItemsIngestOptions): Promise<ManifestIngestResult> {
  const now = (options.now ?? new Date()).toISOString();
  const maxChunkChars = options.maxChunkChars ?? 4000;
  const chunkOverlapChars = options.chunkOverlapChars ?? 200;
  if (maxChunkChars < 500) throw new Error('maxChunkChars must be at least 500.');
  if (chunkOverlapChars < 0 || chunkOverlapChars >= maxChunkChars) throw new Error('chunkOverlapChars must be less than maxChunkChars.');

  if (options.safetyPolicy) assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const result = db.transaction(() => {
      const seenSources = new Set<string>();
      const seenRevisions = new Set<string>();
      let chunksInserted = 0;
      let chunksDeleted = 0;
      let redactions = 0;
      let skipped = 0;
      recordAuditEvent(db, {
        event_type: 'source_read',
        action: options.readAction ?? (options.sourceLabel.startsWith('s3://') ? 's3_manifest_read' : 'local_manifest_read'),
        target_uri: options.sourceLabel,
        decision: 'allow',
        metadata: { items: options.items.length, read_only: true },
        created_at: now,
      });
      for (const raw of options.items) {
        const item = normalizeManifestItem(raw, now);
        const sourceId = upsertSource(db, item, now);
        const revisionId = upsertRevision(db, sourceId, item, now);
        seenSources.add(sourceId);
        seenRevisions.add(revisionId);
        if (item.text || item.status.toLowerCase() === 'deleted') {
          chunksDeleted += deleteChunksForRevision(db, revisionId);
        }
        const inserted = insertChunks(db, revisionId, item, now, maxChunkChars, chunkOverlapChars, options.safetyPolicy);
        chunksInserted += inserted.chunksInserted;
        redactions += inserted.redactions;
      }
      recordAuditEvent(db, {
        event_type: 'write',
        action: 'knowledge_manifest_ingest',
        target_uri: options.dbPath,
        decision: 'allow',
        metadata: { items: options.items.length, sources: seenSources.size, revisions: seenRevisions.size, chunks_inserted: chunksInserted, redactions },
        created_at: now,
      });
      return {
        path: options.sourceLabel,
        db_path: options.dbPath,
        items_seen: options.items.length,
        sources_upserted: seenSources.size,
        revisions_upserted: seenRevisions.size,
        chunks_inserted: chunksInserted,
        chunks_deleted: chunksDeleted,
        redactions,
        skipped,
      };
    })();
    return result;
  } finally {
    db.close();
  }
}
