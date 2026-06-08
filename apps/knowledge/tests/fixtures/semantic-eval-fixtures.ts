import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../../src/artifact-store';
import { indexKnowledgeEmbeddings } from '../../src/embeddings';
import { migrateKnowledgeDb, openKnowledgeDb } from '../../src/knowledge-db';
import { generatedArtifactProvenance } from '../../src/provenance';
import { ingestSourceRef } from '../../src/source-ingest';
import { initializeWikiLayout, recordWikiLayoutCatalog } from '../../src/wiki-layout';

export interface EvalSource {
  key: string;
  sourceRef: string;
  path: string;
}

export interface EvalCorpus {
  dir: string;
  dbPath: string;
  sources: Record<string, EvalSource>;
}

interface ChunkMetadata {
  source_ref?: string;
  status?: string;
  provenance?: Record<string, unknown>;
  [key: string]: unknown;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function tokenEstimate(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

async function addSource(corpus: EvalCorpus, key: string, fileName: string, text: string): Promise<EvalSource> {
  const path = join(corpus.dir, fileName);
  writeFileSync(path, text);
  const sourceRef = `file://${path}`;
  await ingestSourceRef({
    dbPath: corpus.dbPath,
    sourceRef,
    purpose: 'knowledge_index',
    now: new Date('2026-06-08T00:00:00.000Z'),
  });
  const source = { key, sourceRef, path };
  corpus.sources[key] = source;
  return source;
}

export async function seedEvalCorpus(): Promise<EvalCorpus> {
  const dir = mkdtempSync(join(tmpdir(), 'ok-semantic-evals-'));
  const corpus: EvalCorpus = {
    dir,
    dbPath: join(dir, 'knowledge.db'),
    sources: {},
  };

  await addSource(corpus, 'handbook', 'handbook.md', [
    'Company handbook policy explains paid time off approvals.',
    'Managers approve PTO requests before payroll closes.',
    'Employees should cite the handbook when answering leave questions.',
  ].join('\n'));
  await addSource(corpus, 'incident', 'incident-runbook.md', [
    'Incident response escalation owner is the on-call engineering manager.',
    'Escalation owner updates the incident channel every fifteen minutes.',
  ].join('\n'));
  await addSource(corpus, 'incidentWeak', 'incident-history.md', [
    'Incident retrospectives summarize historical outages and broad response lessons.',
    'These notes do not define the current escalation path.',
  ].join('\n'));
  await addSource(corpus, 'stale', 'deprecated-vpn.md', [
    'Deprecated VPN password rotation instructions should not appear in agent context.',
  ].join('\n'));
  await addSource(corpus, 'private', 'private-compensation.md', [
    'Private executive compensation plan details should be permission filtered.',
  ].join('\n'));

  const store = new LocalArtifactStore(join(dir, 'artifacts'));
  const wiki = await initializeWikiLayout(store, new Date('2026-06-08T00:00:00.000Z'));
  const db = openKnowledgeDb(corpus.dbPath);
  try {
    recordWikiLayoutCatalog(db, wiki.artifacts, new Date('2026-06-08T00:00:00.000Z'));
  } finally {
    db.close();
  }

  return corpus;
}

export async function seedSemanticFallbackCorpus(): Promise<EvalCorpus> {
  const dir = mkdtempSync(join(tmpdir(), 'ok-semantic-fallback-'));
  const corpus: EvalCorpus = {
    dir,
    dbPath: join(dir, 'knowledge.db'),
    sources: {},
  };
  await addSource(corpus, 'leaveSynonym', 'leave-allowance.md', [
    'Sabbatical allowance covers extended time away for employees.',
    'The people team owns eligibility guidance.',
  ].join('\n'));
  await indexKnowledgeEmbeddings({
    dbPath: corpus.dbPath,
    fake: true,
    dimensions: 8,
    limit: 10,
  });
  return corpus;
}

export async function indexEvalCorpus(corpus: EvalCorpus): Promise<void> {
  await indexKnowledgeEmbeddings({
    dbPath: corpus.dbPath,
    fake: true,
    dimensions: 8,
    limit: 50,
  });
}

export function patchChunkProvenance(dbPath: string, sourceRef: string, patch: Record<string, unknown>): void {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query<{ id: string; metadata_json: string }, [string]>(
      `SELECT c.id, c.metadata_json
       FROM chunks c
       JOIN source_revisions sr ON sr.id = c.source_revision_id
       JOIN sources s ON s.id = sr.source_id
       WHERE s.uri = ?`,
    ).all(sourceRef);

    for (const row of rows) {
      const metadata = JSON.parse(row.metadata_json) as ChunkMetadata;
      metadata.provenance = {
        ...(metadata.provenance ?? {}),
        ...patch,
      };
      if (typeof patch.status === 'string') metadata.status = patch.status;
      db.run('UPDATE chunks SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), row.id]);
    }
  } finally {
    db.close();
  }
}

export function insertEvalWikiPage(dbPath: string, input: {
  path: string;
  title: string;
  body: string;
  sourceRefs?: string[];
}): void {
  migrateKnowledgeDb(dbPath);
  const now = '2026-06-08T00:00:00.000Z';
  const artifactUri = `local://artifacts/${input.path}`;
  const contentHash = sha256(input.body);
  const pageId = stableId('wiki', input.path);
  const chunkId = stableId('chk', `${pageId}\u0000${contentHash}`);
  const provenance = generatedArtifactProvenance({
    generated_from: 'semantic_eval_fixture',
    artifact_key: input.path,
    source_refs: input.sourceRefs ?? [],
  });
  const db = openKnowledgeDb(dbPath);
  try {
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
        pageId,
        input.path,
        input.title,
        artifactUri,
        contentHash,
        'active',
        JSON.stringify({ artifact_key: input.path, provenance }),
        now,
        now,
      ],
    );
    db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', [chunkId]);
    db.run('DELETE FROM chunks WHERE wiki_page_id = ?', [pageId]);
    db.run(
      `INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunkId,
        pageId,
        'wiki',
        0,
        input.body,
        tokenEstimate(input.body),
        0,
        input.body.length,
        JSON.stringify({
          artifact_key: input.path,
          artifact_uri: artifactUri,
          content_hash: contentHash,
          provenance,
        }),
        now,
      ],
    );
    db.run(
      'INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)',
      [chunkId, input.body, input.title, artifactUri],
    );
  } finally {
    db.close();
  }
}
