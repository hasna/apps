import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import type { KnowledgeDatabase as Database } from './knowledge-db';
import {
  assertArtifactStoreMatchesWorkspace,
  type ArtifactStore,
  type ArtifactWrite,
} from './artifact-store';
import { hashArtifactBody, recordStorageObjects, type GeneratedStorageObject } from './storage-contract';
import { getSchemaVersion, openMigratedKnowledgeDb } from './knowledge-db';
import { generatedArtifactProvenance } from './provenance';
import { ingestSourceRef, type SourceIngestResult } from './source-ingest';
import { assertContainedSourceGraph, safePublicProperty } from './public-guard';
import { parseBoundedJsonData } from './input-limits';
import { assertWriteAllowed, recordAuditEvent, type SafetyPolicy } from './safety';
import {
  canonicalKnowledgeScope,
  assertKnowledgeWorkspaceScope,
  type KnowledgeConfig,
  type KnowledgeWorkspace,
} from './workspace';

export interface AppWikiWriteGuardOptions {
  scope: string;
  workspace: KnowledgeWorkspace;
  safetyPolicy?: SafetyPolicy;
  allowGlobal?: boolean;
}

export interface AppWikiReadGuardOptions {
  scope: string;
  workspace: KnowledgeWorkspace;
  allowGlobal?: boolean;
}

export interface AppWikiInitOptions extends AppWikiWriteGuardOptions {
  store: ArtifactStore;
  now?: Date;
}

export interface AppWikiNoteInput extends AppWikiWriteGuardOptions {
  store: ArtifactStore;
  title: string;
  content: string;
  tags?: string[];
  sourceRefs?: string[];
  path?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface AppWikiNoteListOptions extends AppWikiReadGuardOptions {
  dbPath: string;
  limit?: number;
}

export interface AppWikiNoteGetOptions extends AppWikiReadGuardOptions {
  dbPath: string;
  store: ArtifactStore;
  id: string;
  includeContent?: boolean;
}

export interface AppWikiSourceRefInput extends AppWikiWriteGuardOptions {
  sourceRef: string;
  purpose?: string;
  config?: KnowledgeConfig;
}

export interface AppWikiNoteRecord {
  id: string;
  path: string;
  title: string;
  artifact_uri: string | null;
  content_hash: string | null;
  tags: string[];
  source_refs: string[];
  created_at: string;
  updated_at: string;
}

export interface AppWikiNoteGetResult {
  ok: true;
  note: AppWikiNoteRecord;
  citations: Array<Record<string, unknown>>;
  content: string | null;
}

export interface AppWikiNoteWriteResult {
  ok: true;
  scope: string;
  workspace_home: string;
  note: AppWikiNoteRecord;
  artifact_uri: string;
  content_hash: string;
  citations_written: number;
  chunks_written: number;
  storage_objects_written: number;
  message: string;
}

export interface AppWikiInitResult {
  ok: true;
  scope: string;
  workspace_home: string;
  knowledge_db_path: string;
  schema_version: number;
  store_type: ArtifactStore['type'];
  global_write_allowed: boolean;
  message: string;
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
  return slug || 'note';
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = parseBoundedJsonData<unknown>(value, 'Persisted app-wiki metadata');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {};
  }
}

function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function normalizeNotePath(input: { title: string; path?: string }): string {
  const raw = input.path?.trim() || `wiki/notes/${slugify(input.title)}.md`;
  const normalized = raw.replace(/\\/g, '/');
  if (!normalized.startsWith('wiki/notes/') || !normalized.endsWith('.md')) {
    throw new Error('App wiki note paths must be relative wiki/notes/*.md artifact keys.');
  }
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`Invalid app wiki note path: ${raw}`);
  }
  return normalized;
}

function noteBody(input: {
  title: string;
  content: string;
  tags: string[];
  sourceRefs: string[];
  now: string;
}): string {
  const sections = [
    `# ${input.title}`,
    '',
    input.content.trim(),
    '',
    `Updated: ${input.now}`,
  ];
  if (input.tags.length > 0) {
    sections.push('', 'Tags:', ...input.tags.map((tag) => `- ${tag}`));
  }
  if (input.sourceRefs.length > 0) {
    sections.push('', 'Source refs:', ...input.sourceRefs.map((ref) => `- ${ref}`));
  }
  sections.push('');
  return sections.join('\n');
}

interface AppWikiAuthority {
  readonly scope: ReturnType<typeof canonicalKnowledgeScope>;
  readonly workspace: KnowledgeWorkspace;
  readonly store?: ArtifactStore;
}

function explicitOwnGlobalAuthority(options: AppWikiReadGuardOptions): boolean {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, 'allowGlobal');
  } catch {
    throw new Error('Global app-wiki access requires an explicit own allowGlobal=true data property.');
  }
  return Boolean(descriptor && 'value' in descriptor && descriptor.value === true);
}

function appWikiAuthority(
  options: AppWikiReadGuardOptions & { store?: ArtifactStore; dbPath?: string },
  requireStore = false,
): AppWikiAuthority {
  if (!options || typeof options !== 'object') {
    throw new Error('App-wiki access requires explicit trusted options.');
  }
  const scope = canonicalKnowledgeScope(safePublicProperty(options, 'scope', 'public-api'));
  if (scope === 'global' && !explicitOwnGlobalAuthority(options)) {
    throw new Error('Global app-wiki access requires an explicit own allowGlobal=true data property.');
  }
  const workspace = safePublicProperty(options, 'workspace', 'public-api') as KnowledgeWorkspace;
  const dbPath = safePublicProperty(options, 'dbPath', 'public-api');
  const store = safePublicProperty(options, 'store', 'public-api') as ArtifactStore | undefined;
  assertKnowledgeWorkspaceScope(workspace, scope);
  if (dbPath !== undefined && dbPath !== workspace.knowledgeDbPath) {
    throw new Error('App-wiki database path does not match the trusted workspace identity.');
  }
  if (requireStore && !store) {
    throw new Error('A trusted artifact store from the owning workspace is required.');
  }
  if (store) assertArtifactStoreMatchesWorkspace(store, workspace);
  return Object.freeze({ scope, workspace, store });
}

function revalidateAppWikiAuthority(authority: AppWikiAuthority): void {
  assertKnowledgeWorkspaceScope(authority.workspace, authority.scope);
  if (authority.store) assertArtifactStoreMatchesWorkspace(authority.store, authority.workspace);
  try {
    const stat = lstatSync(authority.workspace.knowledgeDbPath);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || stat.nlink !== 1
      || realpathSync.native(authority.workspace.knowledgeDbPath) !== authority.workspace.knowledgeDbPath
    ) {
      throw new Error('App-wiki database identity must be one canonical regular file.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function assertAppWikiReadAllowed(options: AppWikiReadGuardOptions): void {
  appWikiAuthority(options);
}

async function writeArtifact(
  authority: AppWikiAuthority & { readonly store: ArtifactStore },
  entry: ArtifactWrite,
): Promise<GeneratedStorageObject> {
  revalidateAppWikiAuthority(authority);
  const written = await authority.store.put(entry);
  revalidateAppWikiAuthority(authority);
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

async function appendLog(
  authority: AppWikiAuthority & { readonly store: ArtifactStore },
  event: Record<string, unknown>,
  now: Date,
): Promise<GeneratedStorageObject> {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const key = `logs/${year}/${month}/${day}.jsonl`;
  let existing = '';
  try {
    revalidateAppWikiAuthority(authority);
    existing = await authority.store.getText(key);
  } catch {
    existing = '';
  }
  return writeArtifact(authority, {
    key,
    body: `${existing}${JSON.stringify(event)}\n`,
    content_type: 'application/x-ndjson',
    metadata: {
      provenance: generatedArtifactProvenance({
        generated_from: String(event.event ?? 'app_wiki_log'),
        artifact_key: key,
      }),
    },
  });
}

function noteMetadata(input: {
  path: string;
  tags: string[];
  sourceRefs: string[];
  provenance: unknown;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...(input.metadata ?? {}),
    app_wiki: true,
    note: true,
    artifact_key: input.path,
    tags: input.tags,
    source_refs: input.sourceRefs,
    provenance: input.provenance,
  };
}

function noteRecord(row: {
  id: string;
  path: string;
  title: string;
  artifact_uri: string | null;
  content_hash: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}): AppWikiNoteRecord {
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    artifact_uri: row.artifact_uri,
    content_hash: row.content_hash,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    source_refs: Array.isArray(metadata.source_refs)
      ? metadata.source_refs.filter((ref): ref is string => typeof ref === 'string')
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sourceCitationRows(db: Database, sourceRefs: string[]): Array<{
  source_ref: string;
  source_uri: string;
  chunk_id: string | null;
  quote: string | null;
  start_offset: number | null;
  end_offset: number | null;
  metadata: Record<string, unknown>;
}> {
  return sourceRefs.map((sourceRef) => {
    const row = db.query<{
      source_uri: string;
      chunk_id: string | null;
      text: string | null;
      start_offset: number | null;
      end_offset: number | null;
      revision: string | null;
      hash: string | null;
      metadata_json: string | null;
    }, [string, string]>(
      `SELECT
         s.uri AS source_uri,
         c.id AS chunk_id,
         c.text,
         c.start_offset,
         c.end_offset,
         sr.revision,
         sr.hash,
         c.metadata_json
       FROM sources s
       LEFT JOIN source_revisions sr ON sr.source_id = s.id
       LEFT JOIN chunks c ON c.source_revision_id = sr.id
       WHERE s.uri = ? OR s.metadata_json LIKE ?
       ORDER BY sr.created_at DESC, c.ordinal ASC
       LIMIT 1`,
    ).get(sourceRef, `%${sourceRef}%`);
    const metadata = parseJsonObject(row?.metadata_json);
    return {
      source_ref: sourceRef,
      source_uri: row?.source_uri ?? sourceRef,
      chunk_id: row?.chunk_id ?? null,
      quote: row?.text ? row.text.replace(/\s+/g, ' ').slice(0, 240) : null,
      start_offset: row?.start_offset ?? null,
      end_offset: row?.end_offset ?? null,
      metadata: {
        source_ref: sourceRef,
        revision: row?.revision ?? metadata.revision,
        hash: row?.hash ?? metadata.hash,
      },
    };
  });
}

function replaceNoteCitations(db: Database, pageId: string, sourceRefs: string[], now: string): number {
  db.run('DELETE FROM citations WHERE wiki_page_id = ?', [pageId]);
  const citations = sourceCitationRows(db, sourceRefs);
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

function upsertNoteIndex(db: Database, input: {
  title: string;
  path: string;
  artifactUri: string;
  contentHash: string;
  tags: string[];
  sourceRefs: string[];
  now: string;
}): void {
  db.run(
    `INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, name, shard_key) DO UPDATE SET
       artifact_uri = excluded.artifact_uri,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
    [
      stableId('idx', `app-wiki-note\u0000${input.path}`),
      'app_wiki_note',
      input.title,
      input.artifactUri,
      input.path,
      JSON.stringify({
        artifact_key: input.path,
        content_hash: input.contentHash,
        tags: input.tags,
        source_refs: input.sourceRefs,
      }),
      input.now,
      input.now,
    ],
  );
}

function upsertNotePage(db: Database, input: {
  pageId: string;
  path: string;
  title: string;
  artifactUri: string;
  contentHash: string;
  body: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  db.run(
    `INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       title = excluded.title,
       artifact_uri = excluded.artifact_uri,
       content_hash = excluded.content_hash,
       status = excluded.status,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
    [
      input.pageId,
      input.path,
      input.title,
      input.artifactUri,
      input.contentHash,
      'active',
      JSON.stringify(input.metadata),
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
        ...input.metadata,
        artifact_uri: input.artifactUri,
        content_hash: input.contentHash,
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

function appWikiWriteAuthority(
  options: AppWikiWriteGuardOptions & { store?: ArtifactStore },
  requireStore = false,
): AppWikiAuthority {
  const authority = appWikiAuthority(options);
  if (authority.workspace.home.includes('/.husna/') || authority.workspace.home.endsWith('/.husna')) {
    throw new Error(`Refusing app-wiki writes to legacy .husna path: ${authority.workspace.home}`);
  }
  if (authority.workspace.home.includes('/.hasna/apps/knowledge')) {
    throw new Error(`Refusing app-wiki writes to legacy .hasna/apps/knowledge path: ${authority.workspace.home}`);
  }
  const safetyPolicy = safePublicProperty(options, 'safetyPolicy', 'public-api') as SafetyPolicy | undefined;
  if (safetyPolicy) assertWriteAllowed(authority.workspace.knowledgeDbPath, safetyPolicy);
  if (requireStore && !authority.store) {
    throw new Error('A trusted artifact store from the owning workspace is required.');
  }
  return authority;
}

export function assertAppWikiWriteAllowed(options: AppWikiWriteGuardOptions): void {
  appWikiWriteAuthority(options);
}

export async function initAppWikiScope(options: AppWikiInitOptions): Promise<AppWikiInitResult> {
  const authority = appWikiWriteAuthority(options, true) as AppWikiAuthority & { readonly store: ArtifactStore };
  revalidateAppWikiAuthority(authority);
  const db = openMigratedKnowledgeDb(authority.workspace.knowledgeDbPath, { ensureParent: false });
  try {
    revalidateAppWikiAuthority(authority);
    const schemaVersion = getSchemaVersion(db);
    recordAuditEvent(db, {
      event_type: 'write',
      action: 'app_wiki_init',
      target_uri: authority.workspace.home,
      decision: 'allow',
      metadata: {
        scope: authority.scope,
        store_type: authority.store.type,
        app_path: '.hasna/knowledge',
      },
      created_at: (options.now ?? new Date()).toISOString(),
    });
    return {
      ok: true,
      scope: authority.scope,
      workspace_home: authority.workspace.home,
      knowledge_db_path: authority.workspace.knowledgeDbPath,
      schema_version: schemaVersion,
      store_type: authority.store.type,
      global_write_allowed: authority.scope === 'global',
      message: `Initialized app wiki scope at ${authority.workspace.home}`,
    };
  } finally {
    db.close();
  }
}

export async function writeAppWikiNote(options: AppWikiNoteInput): Promise<AppWikiNoteWriteResult> {
  const authority = appWikiWriteAuthority(options, true) as AppWikiAuthority & { readonly store: ArtifactStore };
  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  const tags = uniqueStrings(options.tags);
  const sourceRefs = uniqueStrings(options.sourceRefs);
  const path = normalizeNotePath(options);
  const body = noteBody({
    title: options.title,
    content: options.content,
    tags,
    sourceRefs,
    now,
  });
  const provenance = generatedArtifactProvenance({
    generated_from: 'app_wiki_note',
    artifact_key: path,
    source_refs: sourceRefs,
  });
  const artifact = await writeArtifact(authority, {
    key: path,
    body,
    content_type: 'text/markdown',
    metadata: {
      generated_from: 'app_wiki_note',
      provenance,
      scope: authority.scope,
      tags: tags.join(','),
      source_refs: sourceRefs.join(','),
    },
  });
  const log = await appendLog(authority, {
    ts: now,
    event: 'app_wiki_note_written',
    page_key: path,
    source_refs: sourceRefs,
    tags,
  }, nowDate);

  revalidateAppWikiAuthority(authority);
  const db = openMigratedKnowledgeDb(authority.workspace.knowledgeDbPath, { ensureParent: false });
  try {
    const pageId = stableId('wiki', path);
    const metadata = noteMetadata({
      path,
      tags,
      sourceRefs,
      provenance,
      metadata: options.metadata,
    });
    revalidateAppWikiAuthority(authority);
    recordStorageObjects(db, [artifact, log], nowDate);
    revalidateAppWikiAuthority(authority);
    upsertNotePage(db, {
      pageId,
      path,
      title: options.title,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? '',
      body,
      metadata,
      now,
    });
    revalidateAppWikiAuthority(authority);
    const citationsWritten = replaceNoteCitations(db, pageId, sourceRefs, now);
    revalidateAppWikiAuthority(authority);
    upsertNoteIndex(db, {
      title: options.title,
      path,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? '',
      tags,
      sourceRefs,
      now,
    });
    revalidateAppWikiAuthority(authority);
    recordAuditEvent(db, {
      event_type: 'write',
      action: 'app_wiki_note_write',
      target_uri: artifact.uri,
      decision: 'allow',
      metadata: {
        scope: authority.scope,
        path,
        source_refs: sourceRefs,
        tags,
      },
      created_at: now,
    });
    revalidateAppWikiAuthority(authority);
    const row = db.query<{
      id: string;
      path: string;
      title: string;
      artifact_uri: string | null;
      content_hash: string | null;
      metadata_json: string;
      created_at: string;
      updated_at: string;
    }, [string]>('SELECT id, path, title, artifact_uri, content_hash, metadata_json, created_at, updated_at FROM wiki_pages WHERE id = ?').get(pageId);
    if (!row) throw new Error(`Failed to write app wiki note: ${path}`);
    return {
      ok: true,
      scope: authority.scope,
      workspace_home: authority.workspace.home,
      note: noteRecord(row),
      artifact_uri: artifact.uri,
      content_hash: artifact.hash ?? '',
      citations_written: citationsWritten,
      chunks_written: 1,
      storage_objects_written: 2,
      message: `Wrote app wiki note ${path}`,
    };
  } finally {
    db.close();
  }
}

export function listAppWikiNotes(options: AppWikiNoteListOptions): AppWikiNoteRecord[] {
  const authority = appWikiAuthority(options);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  if (!authority.workspace.knowledgeDbPath) return [];
  revalidateAppWikiAuthority(authority);
  const db = openMigratedKnowledgeDb(authority.workspace.knowledgeDbPath, { ensureParent: false });
  try {
    revalidateAppWikiAuthority(authority);
    return db.query<{
      id: string;
      path: string;
      title: string;
      artifact_uri: string | null;
      content_hash: string | null;
      metadata_json: string;
      created_at: string;
      updated_at: string;
    }, [number]>(
      `SELECT id, path, title, artifact_uri, content_hash, metadata_json, created_at, updated_at
       FROM wiki_pages
       WHERE status = 'active'
         AND path LIKE 'wiki/notes/%'
         AND metadata_json LIKE '%"app_wiki":true%'
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
    ).all(limit).map(noteRecord);
  } finally {
    db.close();
  }
}

export async function getAppWikiNote(options: AppWikiNoteGetOptions): Promise<AppWikiNoteGetResult | null> {
  const authority = appWikiAuthority(options, true) as AppWikiAuthority & { readonly store: ArtifactStore };
  revalidateAppWikiAuthority(authority);
  const db = openMigratedKnowledgeDb(authority.workspace.knowledgeDbPath, { ensureParent: false });
  try {
    revalidateAppWikiAuthority(authority);
    const row = db.query<{
      id: string;
      path: string;
      title: string;
      artifact_uri: string | null;
      content_hash: string | null;
      metadata_json: string;
      created_at: string;
      updated_at: string;
    }, [string, string]>(
      `SELECT id, path, title, artifact_uri, content_hash, metadata_json, created_at, updated_at
       FROM wiki_pages
       WHERE (id = ? OR path = ?)
         AND path LIKE 'wiki/notes/%'
         AND metadata_json LIKE '%"app_wiki":true%'`,
    ).get(options.id, options.id);
    if (!row) return null;
    revalidateAppWikiAuthority(authority);
    const citations = db.query<{
      id: string;
      chunk_id: string | null;
      source_uri: string;
      quote: string | null;
      start_offset: number | null;
      end_offset: number | null;
      metadata_json: string;
      created_at: string;
    }, [string]>(
      `SELECT id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at
       FROM citations
       WHERE wiki_page_id = ?
       ORDER BY created_at ASC`,
    ).all(row.id).map((citation) => ({
      ...citation,
      metadata: parseJsonObject(citation.metadata_json),
      metadata_json: undefined,
    }));
    let content: string | null = null;
    if (options.includeContent !== false) {
      try {
        revalidateAppWikiAuthority(authority);
        content = await authority.store.getText(row.path);
      } catch {
        revalidateAppWikiAuthority(authority);
        content = null;
      }
      revalidateAppWikiAuthority(authority);
    }
    return {
      ok: true,
      note: noteRecord(row),
      citations,
      content,
    };
  } finally {
    db.close();
  }
}

export async function ingestAppWikiSourceRef(options: AppWikiSourceRefInput): Promise<SourceIngestResult> {
  assertContainedSourceGraph(options, 'public-api');
  const sourceRef = safePublicProperty(options, 'sourceRef', 'public-api');
  if (typeof sourceRef !== 'string') throw new Error('sourceRef must be a string.');
  const authority = appWikiWriteAuthority(options);
  revalidateAppWikiAuthority(authority);
  const result = await ingestSourceRef({
    dbPath: authority.workspace.knowledgeDbPath,
    sourceRef,
    purpose: options.purpose ?? 'knowledge_index',
    config: options.config,
    safetyPolicy: options.safetyPolicy,
  });
  revalidateAppWikiAuthority(authority);
  return result;
}
