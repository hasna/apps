import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';

describe('knowledge sqlite store', () => {
  test('migrates versioned schema and creates core catalog tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-'));
    const dbPath = join(dir, 'knowledge.db');

    const migration = migrateKnowledgeDb(dbPath);
    expect(migration.schema_version).toBe(2);

    const db = openKnowledgeDb(dbPath);
    try {
      const tables = db.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name",
      ).all().map((row) => row.name);
      expect(tables).toContain('sources');
      expect(tables).toContain('source_revisions');
      expect(tables).toContain('chunks');
      expect(tables).toContain('chunk_embeddings');
      expect(tables).toContain('wiki_pages');
      expect(tables).toContain('citations');
      expect(tables).toContain('knowledge_indexes');
      expect(tables).toContain('runs');
      expect(tables).toContain('provider_usage');
      expect(tables).toContain('redaction_findings');
      expect(tables).toContain('storage_objects');
    } finally {
      db.close();
    }

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.schema_version).toBe(2);
    expect(stats.sources).toBe(0);
    expect(stats.runs).toBe(0);
  });

  test('ingests open-files manifests into sources, revisions, chunks, and FTS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-manifest-'));
    const dbPath = join(dir, 'knowledge.db');
    const manifestPath = join(dir, 'manifest.jsonl');
    const rows = [
      {
        source_ref: 'open-files://file/file_123/revision/rev_001',
        file_id: 'file_123',
        source_id: 'src_drive',
        path: 'Team Drive/Knowledge/Handbook.md',
        name: 'Handbook.md',
        mime: 'text/markdown',
        size: 128,
        hash: 'sha256:abc123',
        status: 'active',
        updated_at: '2026-06-08T00:00:00.000Z',
        permissions: { mode: 'read_only', allowed_purposes: ['knowledge_index'] },
        extracted_text: 'Company handbook\n\nSemantic search should find this source.',
      },
      {
        source_ref: 'open-files://file/file_456',
        revision_id: 'rev_current',
        name: 'No text yet.pdf',
        mime: 'application/pdf',
        size: 256,
        hash: 'sha256:def456',
        status: 'active',
      },
    ];
    writeFileSync(manifestPath, rows.map((row) => JSON.stringify(row)).join('\n'));

    const result = await ingestOpenFilesManifest({ dbPath, input: manifestPath });
    expect(result).toMatchObject({
      items_seen: 2,
      sources_upserted: 2,
      revisions_upserted: 2,
      chunks_inserted: 1,
      chunks_deleted: 0,
    });

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.schema_version).toBe(2);
    expect(stats.sources).toBe(2);
    expect(stats.source_revisions).toBe(2);
    expect(stats.chunks).toBe(1);
    migrateKnowledgeDb(dbPath);

    const db = openKnowledgeDb(dbPath);
    try {
      const source = db.query<{ uri: string; title: string; acl_json: string }, []>('SELECT uri, title, acl_json FROM sources ORDER BY title LIMIT 1').get();
      expect(source?.uri).toBe('open-files://file/file_123');
      expect(source?.title).toBe('Handbook.md');
      expect(JSON.parse(source?.acl_json ?? '{}')).toMatchObject({ mode: 'read_only' });

      const revision = db.query<{ revision: string; hash: string }, [string]>(
        'SELECT revision, hash FROM source_revisions WHERE hash = ?',
      ).get('sha256:abc123');
      expect(revision).toMatchObject({ revision: 'rev_001', hash: 'sha256:abc123' });

      const fts = db.query<{ chunk_id: string }, [string]>(
        'SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 1',
      ).get('semantic');
      expect(fts?.chunk_id).toStartWith('chk_');
    } finally {
      db.close();
    }
  });
});
