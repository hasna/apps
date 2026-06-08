import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { catalogSourceUriForRef, parseSourceRef, revisionIdForSourceRef } from './source-ref';
import { assertWriteAllowed, recordAuditEvent, type SafetyPolicy } from './safety';

export interface SourceResolveOptions {
  dbPath: string;
  sourceRef: string;
  purpose?: string;
  limit?: number;
  now?: Date;
  safetyPolicy?: SafetyPolicy;
}

export interface SourceResolverEvidence {
  resolver: 'open-files-read-only';
  mode: 'local_catalog';
  purpose: string;
  read_only: true;
  source_ref: string;
  source_uri: string;
  source_revision_id: string | null;
  revision: string | null;
  hash: string | null;
  chunk_id?: string;
  start_offset?: number | null;
  end_offset?: number | null;
  resolved_at: string;
}

export interface ResolvedSourceChunk {
  id: string;
  kind: string;
  ordinal: number;
  text: string;
  token_count: number | null;
  start_offset: number | null;
  end_offset: number | null;
  metadata: Record<string, unknown>;
  evidence: SourceResolverEvidence;
}

export interface ResolvedSourceCitation {
  source_ref: string;
  source_uri: string;
  chunk_id: string;
  quote: string;
  start_offset: number | null;
  end_offset: number | null;
  evidence: SourceResolverEvidence;
}

export interface SourceResolveResult {
  source_ref: string;
  source_uri: string;
  purpose: string;
  read_only: true;
  resolved: boolean;
  resolver: {
    name: 'open-files-read-only';
    mode: 'local_catalog';
    contract: 'open-files-knowledge-source-v1';
  };
  source: {
    id: string;
    uri: string;
    kind: string;
    title: string | null;
    metadata: Record<string, unknown>;
    permissions: Record<string, unknown>;
    updated_at: string;
  } | null;
  revision: {
    id: string;
    revision: string;
    hash: string | null;
    extracted_text_uri: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    reindex_required: boolean;
  } | null;
  content: {
    mime: string | null;
    size: number | null;
    hash: string | null;
    text_available: boolean;
    chunks_total: number;
    chunks_returned: number;
    char_count_returned: number;
    extracted_text_ref: string | null;
    bytes_available: false;
    bytes_exposed: false;
  };
  chunks: ResolvedSourceChunk[];
  citations: ResolvedSourceCitation[];
}

interface DbSourceRow {
  id: string;
  uri: string;
  kind: string;
  title: string | null;
  metadata_json: string;
  acl_json: string;
  updated_at: string;
}

interface DbRevisionRow {
  id: string;
  revision: string;
  hash: string | null;
  extracted_text_uri: string | null;
  metadata_json: string;
  created_at: string;
}

interface DbChunkRow {
  id: string;
  kind: string;
  ordinal: number;
  text: string;
  token_count: number | null;
  start_offset: number | null;
  end_offset: number | null;
  metadata_json: string;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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

function assertPurposeAllowed(permissions: Record<string, unknown>, purpose: string): void {
  const mode = permissions.mode;
  if (typeof mode === 'string' && mode !== 'read_only') {
    throw new Error(`Source resolver denied ${purpose}. Permission mode is ${mode}, expected read_only.`);
  }

  const denied = permissions.denied_purposes;
  if (Array.isArray(denied) && denied.includes(purpose)) {
    throw new Error(`Source resolver denied ${purpose}. Purpose is explicitly denied.`);
  }

  const allowed = permissions.allowed_purposes;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(purpose)) {
    throw new Error(`Source resolver denied ${purpose}. Allowed purposes: ${allowed.join(', ')}`);
  }
}

function sourceRevisionRef(sourceUri: string, revision: DbRevisionRow | null, fallback: string): string {
  if (!revision) return fallback;
  try {
    const parsed = parseSourceRef(sourceUri);
    if (parsed.kind === 'open-files' && parsed.entity === 'file') {
      return `${sourceUri}/revision/${encodeURIComponent(revision.revision)}`;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function selectSource(db: Database, sourceUri: string, requestedRef: string): DbSourceRow | null {
  return db.query<DbSourceRow, [string, string, string]>(
    `SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  ).get(sourceUri, requestedRef, sourceUri) ?? null;
}

function selectRevision(db: Database, sourceId: string, revisionId: string | null): DbRevisionRow | null {
  if (revisionId) {
    return db.query<DbRevisionRow, [string, string]>(
      `SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`,
    ).get(sourceId, revisionId) ?? null;
  }
  return db.query<DbRevisionRow, [string]>(
    `SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`,
  ).get(sourceId) ?? null;
}

function countChunks(db: Database, revisionId: string | null): number {
  if (!revisionId) return 0;
  const row = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?').get(revisionId);
  return row?.n ?? 0;
}

function selectChunks(db: Database, revisionId: string | null, limit: number): DbChunkRow[] {
  if (!revisionId || limit <= 0) return [];
  return db.query<DbChunkRow, [string, number]>(
    `SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`,
  ).all(revisionId, limit);
}

export async function resolveOpenFilesSource(options: SourceResolveOptions): Promise<SourceResolveResult> {
  const purpose = options.purpose ?? 'knowledge_answer';
  const limit = Math.max(0, Math.min(options.limit ?? 10, 100));
  const resolvedAt = (options.now ?? new Date()).toISOString();
  const parsed = parseSourceRef(options.sourceRef);
  const sourceUri = catalogSourceUriForRef(options.sourceRef, parsed);
  const requestedRevision = revisionIdForSourceRef(options.sourceRef);

  if (options.safetyPolicy) {
    if (!options.safetyPolicy.readOnlySourceAccess) throw new Error('Safety policy denied source resolution.');
    assertWriteAllowed(options.dbPath, options.safetyPolicy);
  }

  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    return db.transaction((): SourceResolveResult => {
      const source = selectSource(db, sourceUri, options.sourceRef);
      if (!source) {
        recordAuditEvent(db, {
          event_type: 'source_read',
          action: 'open_files_resolve_missing',
          target_uri: options.sourceRef,
          decision: 'allow',
          metadata: { purpose, read_only: true, source_uri: sourceUri },
          created_at: resolvedAt,
        });
        return {
          source_ref: options.sourceRef,
          source_uri: sourceUri,
          purpose,
          read_only: true,
          resolved: false,
          resolver: {
            name: 'open-files-read-only',
            mode: 'local_catalog',
            contract: 'open-files-knowledge-source-v1',
          },
          source: null,
          revision: null,
          content: {
            mime: null,
            size: null,
            hash: null,
            text_available: false,
            chunks_total: 0,
            chunks_returned: 0,
            char_count_returned: 0,
            extracted_text_ref: null,
            bytes_available: false,
            bytes_exposed: false,
          },
          chunks: [],
          citations: [],
        } satisfies SourceResolveResult;
      }

      const sourceMetadata = parseJsonObject(source.metadata_json);
      const permissions = parseJsonObject(source.acl_json);
      try {
        assertPurposeAllowed(permissions, purpose);
      } catch (error) {
        recordAuditEvent(db, {
          event_type: 'source_read',
          action: 'open_files_resolve',
          target_uri: options.sourceRef,
          decision: 'deny',
          metadata: {
            purpose,
            read_only: true,
            source_uri: source.uri,
            error: error instanceof Error ? error.message : String(error),
          },
          created_at: resolvedAt,
        });
        throw error;
      }

      const revision = selectRevision(db, source.id, requestedRevision);
      const revisionMetadata = parseJsonObject(revision?.metadata_json);
      const totalChunks = countChunks(db, revision?.id ?? null);
      const rows = selectChunks(db, revision?.id ?? null, limit);
      const effectiveSourceRef = sourceRevisionRef(source.uri, revision, options.sourceRef);
      const chunks = rows.map((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        const evidence: SourceResolverEvidence = {
          resolver: 'open-files-read-only',
          mode: 'local_catalog',
          purpose,
          read_only: true,
          source_ref: metadataString(metadata, ['source_ref']) ?? effectiveSourceRef,
          source_uri: source.uri,
          source_revision_id: revision?.id ?? null,
          revision: revision?.revision ?? null,
          hash: revision?.hash ?? metadataString(metadata, ['hash']),
          chunk_id: row.id,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          resolved_at: resolvedAt,
        };
        return {
          id: row.id,
          kind: row.kind,
          ordinal: row.ordinal,
          text: row.text,
          token_count: row.token_count,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          metadata,
          evidence,
        };
      });

      const citations = chunks.map((chunk) => ({
        source_ref: chunk.evidence.source_ref,
        source_uri: source.uri,
        chunk_id: chunk.id,
        quote: chunk.text.slice(0, 500),
        start_offset: chunk.start_offset,
        end_offset: chunk.end_offset,
        evidence: chunk.evidence,
      }));

      recordAuditEvent(db, {
        event_type: 'source_read',
        action: 'open_files_resolve',
        target_uri: options.sourceRef,
        decision: 'allow',
        metadata: {
          purpose,
          read_only: true,
          source_uri: source.uri,
          revision: revision?.revision ?? null,
          chunks_returned: chunks.length,
          chunks_total: totalChunks,
        },
        created_at: resolvedAt,
      });

      const mime = metadataString(sourceMetadata, ['mime', 'content_type']) ?? metadataString(revisionMetadata, ['mime', 'content_type']);
      const size = metadataNumber(sourceMetadata, ['size', 'size_bytes']) ?? metadataNumber(revisionMetadata, ['size', 'size_bytes']);
      return {
        source_ref: effectiveSourceRef,
        source_uri: source.uri,
        purpose,
        read_only: true,
        resolved: true,
        resolver: {
          name: 'open-files-read-only',
          mode: 'local_catalog',
          contract: 'open-files-knowledge-source-v1',
        },
        source: {
          id: source.id,
          uri: source.uri,
          kind: source.kind,
          title: source.title,
          metadata: sourceMetadata,
          permissions,
          updated_at: source.updated_at,
        },
        revision: revision ? {
          id: revision.id,
          revision: revision.revision,
          hash: revision.hash,
          extracted_text_uri: revision.extracted_text_uri,
          metadata: revisionMetadata,
          created_at: revision.created_at,
          reindex_required: revisionMetadata.reindex_required === true,
        } : null,
        content: {
          mime,
          size,
          hash: revision?.hash ?? metadataString(sourceMetadata, ['hash', 'checksum', 'sha256']),
          text_available: totalChunks > 0,
          chunks_total: totalChunks,
          chunks_returned: chunks.length,
          char_count_returned: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
          extracted_text_ref: revision?.extracted_text_uri ?? metadataString(revisionMetadata, ['extracted_text_ref', 'extracted_text_uri']),
          bytes_available: false,
          bytes_exposed: false,
        },
        chunks,
        citations,
      };
    })();
  } finally {
    db.close();
  }
}
