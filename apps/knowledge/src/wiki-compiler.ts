import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { ArtifactStore, ArtifactWrite } from './artifact-store';
import { hashArtifactBody, recordStorageObjects, type GeneratedStorageObject } from './storage-contract';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { generatedArtifactProvenance } from './provenance';
import { createApprovalGate, recordAuditEvent } from './safety';
import {
  KNOWLEDGE_ANSWER_PURPOSE,
  KNOWLEDGE_INDEX_PURPOSE,
  metadataIsStale,
  parseJsonObject,
  sourceAccessDecision,
} from './source-access';
import type { KnowledgeContextPack } from './retrieval';

export interface WikiCompileOptions {
  dbPath: string;
  store: ArtifactStore;
  title?: string;
  query?: string;
  sourceRefs?: string[];
  limit?: number;
  approveWrite?: boolean;
  approvedBy?: string;
  now?: Date;
}

export interface WikiCompileResult {
  page_id: string;
  path: string;
  artifact_uri: string;
  content_hash: string;
  chunks_seen: number;
  citations_written: number;
  concept_page_id: string | null;
  indexes_updated: number;
  log_key: string;
  warnings: string[];
}

export interface WikiAnswerFileOptions {
  dbPath: string;
  store: ArtifactStore;
  prompt: string;
  answer: string;
  context: KnowledgeContextPack;
  approveWrite?: boolean;
  approvedBy?: string;
  now?: Date;
}

export interface WikiAnswerFileResult {
  approved: boolean;
  durable_writes_performed: boolean;
  page_id: string | null;
  path: string | null;
  artifact_uri: string | null;
  citations_written: number;
  log_key: string | null;
  message: string;
}

export interface WikiLintIssue {
  type:
    | 'missing_citation'
    | 'stale_citation'
    | 'duplicate_page'
    | 'orphan_page'
    | 'unresolved_source_ref'
    | 'contradiction_marker'
    | 'new_article_candidate'
    | 'expired_page';
  severity: 'info' | 'warn' | 'error';
  page_id?: string;
  path?: string;
  source_uri?: string;
  chunk_id?: string;
  message: string;
}

export interface WikiLintResult {
  ok: boolean;
  issue_count: number;
  issues: WikiLintIssue[];
  counts: {
    active_pages: number;
    citations: number;
    backlinks: number;
    new_article_candidates: number;
  };
}

interface SourceChunkRow {
  chunk_id: string;
  text: string;
  start_offset: number | null;
  end_offset: number | null;
  metadata_json: string;
  source_revision_id: string | null;
  revision_metadata_json: string | null;
  revision: string | null;
  hash: string | null;
  source_uri: string | null;
  source_title: string | null;
  source_acl_json: string | null;
  source_metadata_json: string | null;
}

interface CitationInput {
  chunk_id: string | null;
  source_uri: string;
  quote: string | null;
  start_offset: number | null;
  end_offset: number | null;
  metadata: Record<string, unknown>;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'knowledge-page';
}

function todayParts(now: Date): { year: string; month: string; day: string } {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, '0'),
    day: String(now.getUTCDate()).padStart(2, '0'),
  };
}

function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function queryTerms(query: string | undefined): string[] {
  return Array.from(new Set((query ?? '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])).slice(0, 12);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function selectSourceChunks(db: Database, options: WikiCompileOptions): SourceChunkRow[] {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const sourceRefs = options.sourceRefs ?? [];
  const terms = queryTerms(options.query);
  const where: string[] = ["c.kind = 'source'"];
  const params: (string | number)[] = [];

  if (sourceRefs.length > 0) {
    where.push(`(${sourceRefs.map(() => '(s.uri = ? OR c.metadata_json LIKE ?)').join(' OR ')})`);
    for (const ref of sourceRefs) {
      params.push(ref, `%${escapeLike(ref)}%`);
    }
  }

  if (terms.length > 0) {
    where.push(`(${terms.map(() => "lower(c.text) LIKE ? ESCAPE '\\'").join(' OR ')})`);
    for (const term of terms) params.push(`%${escapeLike(term)}%`);
  }

  params.push(limit);
  return db.query<SourceChunkRow, (string | number)[]>(
    `SELECT
       c.id AS chunk_id,
       c.text,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.metadata_json AS revision_metadata_json,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.title AS source_title,
       s.acl_json AS source_acl_json,
       s.metadata_json AS source_metadata_json
     FROM chunks c
     JOIN source_revisions sr ON sr.id = c.source_revision_id
     JOIN sources s ON s.id = sr.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`,
  ).all(...params);
}

function sourceChunkAllowed(row: SourceChunkRow, purpose: string): boolean {
  if (metadataIsStale(parseJsonObject(row.metadata_json))) return false;
  if (metadataIsStale(parseJsonObject(row.revision_metadata_json))) return false;
  if (metadataIsStale(parseJsonObject(row.source_metadata_json))) return false;
  return sourceAccessDecision(parseJsonObject(row.source_acl_json), purpose).allowed;
}

function excerpt(text: string, max = 420): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}...`;
}

function titleFor(options: WikiCompileOptions, rows: SourceChunkRow[]): string {
  if (options.title?.trim()) return options.title.trim();
  if (options.query?.trim()) return options.query.trim();
  return rows[0]?.source_title ?? 'Compiled Knowledge';
}

function compileBody(title: string, rows: SourceChunkRow[], now: string): string {
  const sourceLines = rows.map((row, index) => {
    const label = `S${index + 1}`;
    return `- [${label}] ${row.source_title ?? row.source_uri ?? 'Source'} (${row.source_uri ?? 'unknown'}, revision ${row.revision ?? 'unknown'}, hash ${row.hash ?? 'unknown'})`;
  });
  const noteLines = rows.map((row, index) => {
    const label = `S${index + 1}`;
    return [
      `## ${row.source_title ?? `Source ${index + 1}`}`,
      '',
      excerpt(row.text),
      '',
      `Citation: [${label}]`,
    ].join('\n');
  });
  return [
    `# ${title}`,
    '',
    `Generated at: ${now}`,
    '',
    '## Sources',
    '',
    ...sourceLines,
    '',
    ...noteLines,
    '',
  ].join('\n');
}

async function writeArtifact(store: ArtifactStore, entry: ArtifactWrite): Promise<GeneratedStorageObject> {
  const written = await store.put(entry);
  return {
    key: written.key,
    uri: written.uri,
    kind: entry.key.startsWith('logs/') ? 'log' : 'wiki_page',
    content_type: entry.content_type,
    modified_at: written.modified_at,
    ...hashArtifactBody(entry.body),
    metadata: {
      ...(entry.metadata ?? {}),
    },
  };
}

async function appendLog(store: ArtifactStore, event: Record<string, unknown>, now: Date): Promise<GeneratedStorageObject> {
  const { year, month, day } = todayParts(now);
  const key = `logs/${year}/${month}/${day}.jsonl`;
  let existing = '';
  try {
    existing = await store.getText(key);
  } catch {
    existing = '';
  }
  return writeArtifact(store, {
    key,
    body: `${existing}${JSON.stringify(event)}\n`,
    content_type: 'application/x-ndjson',
    metadata: {
      provenance: generatedArtifactProvenance({
        generated_from: String(event.event ?? 'wiki_log'),
        artifact_key: key,
      }),
    },
  });
}

function upsertWikiPage(db: Database, input: {
  pageId: string;
  path: string;
  title: string;
  artifactUri: string;
  contentHash: string;
  body: string;
  provenance: unknown;
  now: string;
}): void {
  db.run(
    `INSERT INTO wiki_pages (
       id, path, title, artifact_uri, content_hash, status, metadata_json,
       valid_from, valid_to, supersedes, superseded_by, confidence, last_verified_at,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       title = excluded.title,
       artifact_uri = excluded.artifact_uri,
       content_hash = excluded.content_hash,
       status = excluded.status,
       metadata_json = excluded.metadata_json,
       valid_from = COALESCE(wiki_pages.valid_from, excluded.valid_from),
       valid_to = excluded.valid_to,
       confidence = excluded.confidence,
       last_verified_at = excluded.last_verified_at,
       updated_at = excluded.updated_at`,
    [
      input.pageId,
      input.path,
      input.title,
      input.artifactUri,
      input.contentHash,
      'active',
      JSON.stringify({
        artifact_key: input.path,
        provenance: input.provenance,
      }),
      input.now,
      null,
      null,
      null,
      0.8,
      input.now,
      input.now,
      input.now,
    ],
  );

  const existing = db.query<{ id: string }, [string]>('SELECT id FROM chunks WHERE wiki_page_id = ?').all(input.pageId);
  for (const row of existing) db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', [row.id]);
  db.run('DELETE FROM chunks WHERE wiki_page_id = ?', [input.pageId]);

  const chunkId = stableId('chk', `${input.pageId}\u0000${input.contentHash}`);
  db.run(
    `INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chunkId,
      input.pageId,
      'wiki',
      0,
      input.body,
      estimateTokenCount(input.body),
      0,
      input.body.length,
      JSON.stringify({
        artifact_key: input.path,
        artifact_uri: input.artifactUri,
        content_hash: input.contentHash,
        provenance: input.provenance,
      }),
      input.now,
    ],
  );
  db.run('INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)', [
    chunkId,
    input.body,
    input.title,
    input.artifactUri,
  ]);
}

function replacePageCitations(db: Database, pageId: string, citations: CitationInput[], now: string): number {
  db.run('DELETE FROM citations WHERE wiki_page_id = ?', [pageId]);
  for (const citation of citations) {
    db.run(
      `INSERT INTO citations (id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stableId('cit', `${pageId}\u0000${citation.source_uri}\u0000${citation.chunk_id ?? randomUUID()}`),
        pageId,
        citation.chunk_id,
        citation.source_uri,
        citation.quote,
        citation.start_offset,
        citation.end_offset,
        JSON.stringify(citation.metadata),
        now,
      ],
    );
  }
  return citations.length;
}

function upsertIndex(db: Database, input: { title: string; path: string; artifactUri: string; contentHash: string; now: string }): number {
  db.run(
    `INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, name, shard_key) DO UPDATE SET
       artifact_uri = excluded.artifact_uri,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
    [
      stableId('idx', `wiki-topic\u0000${input.path}`),
      'wiki_topic',
      input.title,
      input.artifactUri,
      input.path,
      JSON.stringify({
        artifact_key: input.path,
        content_hash: input.contentHash,
      }),
      input.now,
      input.now,
    ],
  );
  return 1;
}

function firstConcept(title: string): string {
  return title.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/)?.[0] ?? 'knowledge';
}

function validateAnswerCitations(dbPath: string, citations: KnowledgeContextPack['citations']): void {
  if (citations.length === 0) {
    throw new Error('Cannot file a durable answer without citations.');
  }

  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  let sourceBacked = 0;
  try {
    for (const citation of citations) {
      if (!citation.chunk_id) continue;
      const row = db.query<{
        chunk_id: string;
        kind: string;
        chunk_metadata_json: string;
        revision_metadata_json: string | null;
        source_metadata_json: string | null;
        source_acl_json: string | null;
      }, [string]>(
        `SELECT
           c.id AS chunk_id,
           c.kind,
           c.metadata_json AS chunk_metadata_json,
           sr.metadata_json AS revision_metadata_json,
           s.metadata_json AS source_metadata_json,
           s.acl_json AS source_acl_json
         FROM chunks c
         LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
         LEFT JOIN sources s ON s.id = sr.source_id
         WHERE c.id = ?`,
      ).get(citation.chunk_id);
      if (!row) {
        throw new Error(`Cannot file durable answer with unresolved citation chunk: ${citation.chunk_id}`);
      }
      if (row.kind !== 'source') continue;
      sourceBacked += 1;
      if (
        metadataIsStale(parseJsonObject(row.chunk_metadata_json))
        || metadataIsStale(parseJsonObject(row.revision_metadata_json))
        || metadataIsStale(parseJsonObject(row.source_metadata_json))
      ) {
        throw new Error(`Cannot file durable answer with stale citation chunk: ${citation.chunk_id}`);
      }
      const access = sourceAccessDecision(parseJsonObject(row.source_acl_json), KNOWLEDGE_ANSWER_PURPOSE);
      if (!access.allowed) {
        throw new Error(`Cannot file durable answer with citation disallowed for ${KNOWLEDGE_ANSWER_PURPOSE}: ${citation.chunk_id}. ${access.message}`);
      }
    }
  } finally {
    db.close();
  }

  if (sourceBacked === 0) {
    throw new Error('Cannot file a durable answer without at least one source-backed citation.');
  }
}

function requireApprover(approvedBy: string | undefined, action: string): string {
  const approver = approvedBy?.trim();
  if (!approver) {
    throw new Error(`${action} requires --approved-by <name> when --approve-write is used.`);
  }
  return approver;
}

export async function compileWikiPage(options: WikiCompileOptions): Promise<WikiCompileResult> {
  if (!options.approveWrite) {
    throw new Error('Wiki compile writes generated pages and requires --approve-write.');
  }
  const approvedBy = requireApprover(options.approvedBy, 'Wiki compile');
  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  migrateKnowledgeDb(options.dbPath);
  const readDb = openKnowledgeDb(options.dbPath);
  let rows: SourceChunkRow[];
  try {
    rows = selectSourceChunks(readDb, options).filter((row) => sourceChunkAllowed(row, KNOWLEDGE_INDEX_PURPOSE));
  } finally {
    readDb.close();
  }
  if (rows.length === 0) throw new Error('No fresh knowledge_index source chunks matched wiki compile input.');

  const title = titleFor(options, rows);
  const slug = slugify(title);
  const path = `wiki/generated/${slug}.md`;
  const body = compileBody(title, rows, now);
  const sourceRefs = rows.map((row) => {
    const metadata = parseJsonObject(row.metadata_json);
    return typeof metadata.source_ref === 'string' ? metadata.source_ref : row.source_uri;
  }).filter((ref): ref is string => Boolean(ref));
  const provenance = generatedArtifactProvenance({
    generated_from: 'wiki_compile',
    artifact_key: path,
    source_refs: sourceRefs,
  });
  const pageArtifact = await writeArtifact(options.store, {
    key: path,
    body,
    content_type: 'text/markdown',
    metadata: { generated_from: 'wiki_compile' },
  });
  const pageId = stableId('wiki', path);
  const citations: CitationInput[] = rows.map((row) => ({
    chunk_id: row.chunk_id,
    source_uri: row.source_uri ?? 'unknown',
    quote: excerpt(row.text, 240),
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    metadata: {
      source_revision_id: row.source_revision_id,
      revision: row.revision,
      hash: row.hash,
      source_ref: parseJsonObject(row.metadata_json).source_ref ?? row.source_uri,
    },
  }));

  const concept = firstConcept(title);
  const conceptPath = `wiki/concepts/${slugify(concept)}.md`;
  const conceptBody = [`# ${concept}`, '', `Related page: [[${path}]]`, ''].join('\n');
  const conceptProvenance = generatedArtifactProvenance({
    generated_from: 'wiki_compile_concept',
    artifact_key: conceptPath,
    source_refs: sourceRefs,
  });
  const conceptArtifact = await writeArtifact(options.store, {
    key: conceptPath,
    body: conceptBody,
    content_type: 'text/markdown',
    metadata: { generated_from: 'wiki_compile_concept' },
  });
  const conceptPageId = stableId('wiki', conceptPath);

  const log = await appendLog(options.store, {
    ts: now,
    event: 'wiki_compile_completed',
    page_key: path,
    source_refs: sourceRefs,
    chunks_seen: rows.length,
  }, nowDate);

  const db = openKnowledgeDb(options.dbPath);
  try {
    const approval = createApprovalGate(db, {
      action: 'generated_write',
      target_uri: path,
      reason: 'wiki compile generated page write',
      approved_by: approvedBy,
      metadata: { command: 'wiki compile', source_refs: sourceRefs, chunks_seen: rows.length },
      created_at: now,
    });
    recordStorageObjects(db, [pageArtifact, conceptArtifact, log], nowDate);
    upsertWikiPage(db, {
      pageId,
      path,
      title,
      artifactUri: pageArtifact.uri,
      contentHash: pageArtifact.hash ?? '',
      body,
      provenance,
      now,
    });
    upsertWikiPage(db, {
      pageId: conceptPageId,
      path: conceptPath,
      title: concept,
      artifactUri: conceptArtifact.uri,
      contentHash: conceptArtifact.hash ?? '',
      body: conceptBody,
      provenance: conceptProvenance,
      now,
    });
    db.run(
      `INSERT OR REPLACE INTO wiki_backlinks (from_page_id, to_page_id, label, created_at)
       VALUES (?, ?, ?, ?)`,
      [pageId, conceptPageId, 'concept', now],
    );
    const citationsWritten = replacePageCitations(db, pageId, citations, now);
    const indexesUpdated = upsertIndex(db, {
      title,
      path,
      artifactUri: pageArtifact.uri,
      contentHash: pageArtifact.hash ?? '',
      now,
    });
    recordAuditEvent(db, {
      event_type: 'write',
      action: 'wiki_compile',
      target_uri: path,
      decision: 'allow',
      metadata: {
        approval_id: approval.id,
        approved_by: approvedBy,
        page_id: pageId,
        concept_page_id: conceptPageId,
        source_refs: sourceRefs,
        chunks_seen: rows.length,
        citations_written: citationsWritten,
      },
      created_at: now,
    });
    return {
      page_id: pageId,
      path,
      artifact_uri: pageArtifact.uri,
      content_hash: pageArtifact.hash ?? '',
      chunks_seen: rows.length,
      citations_written: citationsWritten,
      concept_page_id: conceptPageId,
      indexes_updated: indexesUpdated,
      log_key: log.key,
      warnings: [],
    };
  } finally {
    db.close();
  }
}

export async function fileAnswerToWiki(options: WikiAnswerFileOptions): Promise<WikiAnswerFileResult> {
  if (!options.approveWrite) {
    return {
      approved: false,
      durable_writes_performed: false,
      page_id: null,
      path: null,
      artifact_uri: null,
      citations_written: 0,
      log_key: null,
      message: 'Dry-run: answer filing requires --approve-write.',
    };
  }
  const approvedBy = requireApprover(options.approvedBy, 'Wiki answer filing');

  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  const title = options.prompt.length > 80 ? `${options.prompt.slice(0, 77)}...` : options.prompt;
  const slug = slugify(title);
  const path = `wiki/answers/${slug}.md`;
  const citations = options.context.citations;
  validateAnswerCitations(options.dbPath, citations);
  const body = [
    `# ${title}`,
    '',
    options.answer,
    '',
    '## Citations',
    '',
    ...citations.map((citation, index) => `- [C${index + 1}] ${citation.source_ref ?? citation.source_uri ?? citation.artifact_path ?? citation.artifact_uri ?? 'unknown'} ${citation.hash ? `(hash ${citation.hash})` : ''}`),
    '',
  ].join('\n');
  const sourceRefs = citations.map((citation) => citation.source_ref ?? citation.source_uri).filter((ref): ref is string => Boolean(ref));
  const provenance = generatedArtifactProvenance({
    generated_from: 'knowledge_answer',
    artifact_key: path,
    source_refs: sourceRefs,
  });
  const artifact = await writeArtifact(options.store, {
    key: path,
    body,
    content_type: 'text/markdown',
    metadata: { generated_from: 'knowledge_answer' },
  });
  const log = await appendLog(options.store, {
    ts: now,
    event: 'wiki_answer_filed',
    page_key: path,
    prompt: options.prompt,
    citations: citations.length,
  }, nowDate);
  const pageId = stableId('wiki', path);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const approval = createApprovalGate(db, {
      action: 'generated_write',
      target_uri: path,
      reason: 'wiki answer generated page write',
      approved_by: approvedBy,
      metadata: { command: 'wiki file-answer', prompt: options.prompt, citations: citations.length },
      created_at: now,
    });
    recordStorageObjects(db, [artifact, log], nowDate);
    upsertWikiPage(db, {
      pageId,
      path,
      title,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? '',
      body,
      provenance,
      now,
    });
    const written = replacePageCitations(db, pageId, citations.map((citation) => ({
      chunk_id: citation.chunk_id,
      source_uri: citation.source_uri ?? citation.artifact_uri ?? 'unknown',
      quote: citation.quote,
      start_offset: citation.start_offset,
      end_offset: citation.end_offset,
      metadata: {
        source_ref: citation.source_ref,
        artifact_path: citation.artifact_path,
        revision: citation.revision,
        hash: citation.hash,
      },
    })), now);
    upsertIndex(db, {
      title,
      path,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? '',
      now,
    });
    recordAuditEvent(db, {
      event_type: 'write',
      action: 'wiki_answer_file',
      target_uri: path,
      decision: 'allow',
      metadata: {
        approval_id: approval.id,
        approved_by: approvedBy,
        page_id: pageId,
        citations_written: written,
      },
      created_at: now,
    });
    return {
      approved: true,
      durable_writes_performed: true,
      page_id: pageId,
      path,
      artifact_uri: artifact.uri,
      citations_written: written,
      log_key: log.key,
      message: `Filed answer to ${path}`,
    };
  } finally {
    db.close();
  }
}

function addIssue(issues: WikiLintIssue[], issue: WikiLintIssue): void {
  issues.push(issue);
}

export function lintWiki(options: { dbPath: string }): WikiLintResult {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const issues: WikiLintIssue[] = [];
  try {
    const activePageWhere = "status = 'active' AND (valid_to IS NULL OR valid_to > datetime('now'))";
    const activePages = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM wiki_pages WHERE ${activePageWhere}`).get()?.n ?? 0;
    const citationCount = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM citations').get()?.n ?? 0;
    const backlinkCount = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM wiki_backlinks').get()?.n ?? 0;

    const expiredPages = db.query<{ id: string; path: string; valid_to: string }, []>(
      `SELECT id, path, valid_to
       FROM wiki_pages
       WHERE status = 'active' AND valid_to IS NOT NULL AND valid_to <= datetime('now')`,
    ).all();
    for (const page of expiredPages) {
      addIssue(issues, { type: 'expired_page', severity: 'warn', page_id: page.id, path: page.path, message: `Wiki page expired at ${page.valid_to}.` });
    }

    const missingCitations = db.query<{ id: string; path: string }, []>(
      `SELECT wp.id, wp.path
       FROM wiki_pages wp
       LEFT JOIN citations c ON c.wiki_page_id = wp.id
       WHERE ${activePageWhere.replaceAll('status', 'wp.status').replaceAll('valid_to', 'wp.valid_to')}
         AND wp.path LIKE 'wiki/generated/%'
       GROUP BY wp.id
       HAVING COUNT(c.id) = 0`,
    ).all();
    for (const page of missingCitations) {
      addIssue(issues, { type: 'missing_citation', severity: 'error', page_id: page.id, path: page.path, message: 'Generated wiki page has no citations.' });
    }

    const stale = db.query<{ page_id: string; path: string; source_uri: string; chunk_id: string | null }, []>(
      `SELECT wp.id AS page_id, wp.path, c.source_uri, c.chunk_id
       FROM citations c
       JOIN wiki_pages wp ON wp.id = c.wiki_page_id
       LEFT JOIN chunks ch ON ch.id = c.chunk_id
       WHERE ch.metadata_json LIKE '%"stale":true%' OR ch.metadata_json LIKE '%"status":"stale"%' OR ch.metadata_json LIKE '%"status":"deleted"%'`,
    ).all();
    for (const row of stale) {
      addIssue(issues, { type: 'stale_citation', severity: 'warn', page_id: row.page_id, path: row.path, source_uri: row.source_uri, chunk_id: row.chunk_id ?? undefined, message: 'Page cites a stale or deleted source chunk.' });
    }

    const duplicates = db.query<{ title: string; n: number }, []>(
      `SELECT lower(title) AS title, COUNT(*) AS n
       FROM wiki_pages
       WHERE ${activePageWhere}
       GROUP BY lower(title)
       HAVING COUNT(*) > 1`,
    ).all();
    for (const row of duplicates) {
      addIssue(issues, { type: 'duplicate_page', severity: 'warn', message: `Duplicate active wiki title: ${row.title} (${row.n} pages).` });
    }

    const orphans = db.query<{ id: string; path: string }, []>(
      `SELECT wp.id, wp.path
       FROM wiki_pages wp
       LEFT JOIN wiki_backlinks wb1 ON wb1.from_page_id = wp.id
       LEFT JOIN wiki_backlinks wb2 ON wb2.to_page_id = wp.id
       WHERE ${activePageWhere.replaceAll('status', 'wp.status').replaceAll('valid_to', 'wp.valid_to')}
         AND wp.path NOT IN ('wiki/README.md')
       GROUP BY wp.id
       HAVING COUNT(wb1.to_page_id) = 0 AND COUNT(wb2.from_page_id) = 0`,
    ).all();
    for (const page of orphans) {
      addIssue(issues, { type: 'orphan_page', severity: 'info', page_id: page.id, path: page.path, message: 'Wiki page has no backlinks.' });
    }

    const unresolved = db.query<{ page_id: string; path: string; source_uri: string }, []>(
      `SELECT wp.id AS page_id, wp.path, c.source_uri
       FROM citations c
       JOIN wiki_pages wp ON wp.id = c.wiki_page_id
       LEFT JOIN sources s ON s.uri = c.source_uri
       WHERE s.id IS NULL AND c.source_uri NOT LIKE 'file://%' AND c.source_uri NOT LIKE 's3://%' AND c.source_uri NOT LIKE 'https://%' AND c.source_uri NOT LIKE 'open-files://%'`,
    ).all();
    for (const row of unresolved) {
      addIssue(issues, { type: 'unresolved_source_ref', severity: 'error', page_id: row.page_id, path: row.path, source_uri: row.source_uri, message: 'Citation source URI cannot be resolved to a known or allowed source ref.' });
    }

    const contradictions = db.query<{ id: string; path: string }, []>(
      `SELECT id, path FROM wiki_pages WHERE lower(metadata_json) LIKE '%contradiction%'`,
    ).all();
    for (const page of contradictions) {
      addIssue(issues, { type: 'contradiction_marker', severity: 'warn', page_id: page.id, path: page.path, message: 'Page metadata contains a contradiction marker.' });
    }

    const newArticleCandidates = db.query<{ chunk_id: string; source_uri: string | null }, []>(
      `SELECT c.id AS chunk_id, s.uri AS source_uri
       FROM chunks c
       JOIN source_revisions sr ON sr.id = c.source_revision_id
       JOIN sources s ON s.id = sr.source_id
       LEFT JOIN citations cit ON cit.chunk_id = c.id
       WHERE c.kind = 'source'
       GROUP BY c.id
       HAVING COUNT(cit.id) = 0
       LIMIT 25`,
    ).all();
    for (const row of newArticleCandidates) {
      addIssue(issues, { type: 'new_article_candidate', severity: 'info', chunk_id: row.chunk_id, source_uri: row.source_uri ?? undefined, message: 'Source chunk is indexed but not cited by any wiki page yet.' });
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'error'),
      issue_count: issues.length,
      issues,
      counts: {
        active_pages: activePages,
        citations: citationCount,
        backlinks: backlinkCount,
        new_article_candidates: newArticleCandidates.length,
      },
    };
  } finally {
    db.close();
  }
}
