import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { ArtifactStore } from './artifact-store';
import { generatedArtifactProvenance, type GeneratedArtifactProvenance } from './provenance';
import {
  artifactKindForKey,
  hashArtifactBody,
  type GeneratedStorageObject,
} from './storage-contract';

export interface WikiLayoutInitResult {
  schema_key: string;
  root_index_key: string;
  wiki_readme_key: string;
  log_key: string;
  artifacts: GeneratedStorageObject[];
  written: string[];
}

interface CatalogArtifact {
  key: string;
  uri: string;
  hash?: string;
  metadata?: Record<string, unknown>;
}

function todayParts(now: Date): { year: string; month: string; day: string } {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return { year, month, day };
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

export function agentSchemaTemplate(): string {
  return `# Knowledge Agent Schema v1

## Source Rules

- Treat open-files source references as the preferred source of truth.
- Do not copy raw source files into knowledge.
- Cite every durable fact with a source URI, revision/hash when available, and optional span.
- Mark uncertainty explicitly when sources disagree or are incomplete.

## Wiki Rules

- Write generated knowledge as Markdown pages under wiki/.
- Keep root indexes small; use topic, team, project, and machine-readable shards for scale.
- Preserve backlinks between related pages and decisions.
- Prefer updating existing pages over creating near-duplicates.

## Query Rules

- Search wiki pages first, then source chunks, then deeper read-only source refs.
- Use web search only when requested or when current external context is required.
- File useful answers back into the wiki only after approval or approved auto-write mode.

## Lint Rules

- Flag stale pages, missing citations, contradictions, orphan pages, duplicate pages, and unresolved source refs.
`;
}

export function rootIndexTemplate(): string {
  return `# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`;
}

export function wikiReadmeTemplate(): string {
  return `# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`;
}

export async function initializeWikiLayout(store: ArtifactStore, now = new Date()): Promise<WikiLayoutInitResult> {
  const { year, month, day } = todayParts(now);
  const schemaKey = 'schemas/v1.md';
  const rootIndexKey = 'indexes/root.md';
  const wikiReadmeKey = 'wiki/README.md';
  const logKey = `logs/${year}/${month}/${day}.jsonl`;
  const event = {
    ts: now.toISOString(),
    event: 'wiki_layout_initialized',
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey,
  };

  const entries = [
    { key: schemaKey, body: agentSchemaTemplate(), content_type: 'text/markdown' },
    { key: rootIndexKey, body: rootIndexTemplate(), content_type: 'text/markdown' },
    { key: wikiReadmeKey, body: wikiReadmeTemplate(), content_type: 'text/markdown' },
    { key: logKey, body: `${JSON.stringify(event)}\n`, content_type: 'application/x-ndjson' },
  ];

  const artifacts = await Promise.all(entries.map(async (entry) => {
    const result = await store.put(entry);
    return {
      key: result.key,
      uri: result.uri,
      kind: artifactKindForKey(entry.key),
      content_type: entry.content_type,
      modified_at: result.modified_at,
      metadata: {
        provenance: generatedArtifactProvenance({
          generated_from: 'wiki_layout_init',
          artifact_key: entry.key,
          citation_required: entry.key.startsWith('wiki/') || entry.key.startsWith('indexes/'),
        }),
      },
      ...hashArtifactBody(entry.body),
    };
  }));
  return {
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey,
    log_key: logKey,
    artifacts,
    written: [schemaKey, rootIndexKey, wikiReadmeKey, logKey],
  };
}

function provenanceFor(artifact: CatalogArtifact): GeneratedArtifactProvenance {
  const existing = artifact.metadata?.provenance;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as GeneratedArtifactProvenance;
  }
  return generatedArtifactProvenance({
    generated_from: 'wiki_layout_init',
    artifact_key: artifact.key,
  });
}

function recordWikiChunk(db: Database, pageId: string, title: string, artifact: CatalogArtifact, body: string, now: string): void {
  const provenance = provenanceFor(artifact);
  const chunkId = stableId('chk', `${pageId}\u0000${artifact.hash ?? artifact.uri}`);
  const existing = db.query<{ id: string }, [string]>('SELECT id FROM chunks WHERE wiki_page_id = ?').all(pageId);
  for (const row of existing) db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', [row.id]);
  db.run('DELETE FROM chunks WHERE wiki_page_id = ?', [pageId]);
  db.run(
    `INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chunkId,
      pageId,
      'wiki',
      0,
      body,
      estimateTokenCount(body),
      0,
      body.length,
      JSON.stringify({
        artifact_key: artifact.key,
        artifact_uri: artifact.uri,
        content_hash: artifact.hash ?? null,
        provenance,
      }),
      now,
    ],
  );
  db.run(
    'INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)',
    [chunkId, body, title, artifact.uri],
  );
}

export function recordWikiLayoutCatalog(db: Database, artifacts: CatalogArtifact[], now = new Date()): void {
  const timestamp = now.toISOString();
  const rootIndex = artifacts.find((artifact) => artifact.key.endsWith('indexes/root.md'));
  const wikiReadme = artifacts.find((artifact) => artifact.key.endsWith('wiki/README.md'));

  if (rootIndex) {
    db.run(
      `INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, name, shard_key) DO UPDATE SET
         artifact_uri = excluded.artifact_uri,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
      [
        stableId('idx', 'root:indexes/root.md'),
        'root',
        'root',
        rootIndex.uri,
        'root',
        JSON.stringify({
          artifact_key: rootIndex.key,
          content_hash: rootIndex.hash ?? null,
          provenance: provenanceFor(rootIndex),
        }),
        timestamp,
        timestamp,
      ],
    );
  }

  if (wikiReadme) {
    const wikiPageId = stableId('wiki', 'wiki/README.md');
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
        wikiPageId,
        'wiki/README.md',
        'Wiki',
        wikiReadme.uri,
        wikiReadme.hash ?? null,
        'active',
        JSON.stringify({
          artifact_key: wikiReadme.key,
          provenance: provenanceFor(wikiReadme),
        }),
        timestamp,
        null,
        null,
        null,
        0.8,
        timestamp,
        timestamp,
        timestamp,
      ],
    );
    recordWikiChunk(db, wikiPageId, 'Wiki', wikiReadme, wikiReadmeTemplate(), timestamp);
  }
}
