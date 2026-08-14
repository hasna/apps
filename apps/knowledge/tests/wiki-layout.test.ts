import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../src/artifact-store';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { recordStorageObjects } from '../src/storage-contract';
import { initializeWikiLayout, recordWikiLayoutCatalog } from '../src/wiki-layout';

describe('wiki layout', () => {
  test('initializes schema, root index, wiki readme, and log shard', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-'));
    const store = new LocalArtifactStore(dir);

    const result = await initializeWikiLayout(store, new Date('2026-06-08T00:00:00.000Z'));

    expect(result.written).toEqual([
      'schemas/v1.md',
      'indexes/root.md',
      'wiki/README.md',
      'logs/2026/06/08.jsonl',
    ]);
    expect(await store.getText('schemas/v1.md')).toContain('Knowledge Agent Schema v1');
    expect(await store.getText('indexes/root.md')).toContain('compact orientation index');
    expect(await store.getText('logs/2026/06/08.jsonl')).toContain('wiki_layout_initialized');
    expect(result.artifacts).toHaveLength(4);
    expect(result.artifacts.map((entry) => entry.kind)).toEqual(['schema', 'index', 'wiki_page', 'log']);
    expect(result.artifacts.every((entry) => entry.hash?.startsWith('sha256:'))).toBe(true);
    expect(result.artifacts.every((entry) => !Number.isNaN(Date.parse(entry.modified_at ?? '')))).toBe(true);
    expect(result.artifacts.find((entry) => entry.key === 'wiki/README.md')?.metadata?.provenance).toMatchObject({
      source_owner: 'open-files',
      generated_from: 'wiki_layout_init',
      raw_source_bytes_stored_in_open_knowledge: false,
    });
  });

  test('records root index and wiki readme provenance in catalog tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-catalog-'));
    const store = new LocalArtifactStore(join(dir, 'artifacts'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const result = await initializeWikiLayout(store, new Date('2026-06-08T00:00:00.000Z'));
    const db = openKnowledgeDb(dbPath);
    try {
      recordStorageObjects(db, result.artifacts, new Date('2026-06-08T00:00:00.000Z'));
      recordWikiLayoutCatalog(db, result.artifacts, new Date('2026-06-08T00:00:00.000Z'));
      const storageObject = db.query<{ metadata_json: string }, [string]>(
        'SELECT metadata_json FROM storage_objects WHERE artifact_uri = ?',
      ).get(result.artifacts.find((entry) => entry.key === 'wiki/README.md')?.uri ?? '');
      const storageMetadata = JSON.parse(storageObject?.metadata_json ?? '{}');
      expect(storageMetadata.key).toBe('wiki/README.md');
      expect(Number.isNaN(Date.parse(storageMetadata.artifact_modified_at))).toBe(false);
      expect(storageMetadata.provenance).toMatchObject({
        generated_from: 'wiki_layout_init',
        artifact_key: 'wiki/README.md',
      });

      const index = db.query<{ artifact_uri: string; metadata_json: string }, [string, string]>(
        'SELECT artifact_uri, metadata_json FROM knowledge_indexes WHERE kind = ? AND name = ?',
      ).get('root', 'root');
      expect(index?.artifact_uri).toStartWith('file://');
      expect(JSON.parse(index?.metadata_json ?? '{}').provenance).toMatchObject({
        source_owner: 'open-files',
        artifact_key: 'indexes/root.md',
      });

      const page = db.query<{ artifact_uri: string; metadata_json: string }, [string]>(
        'SELECT artifact_uri, metadata_json FROM wiki_pages WHERE path = ?',
      ).get('wiki/README.md');
      expect(page?.artifact_uri).toStartWith('file://');
      expect(JSON.parse(page?.metadata_json ?? '{}').provenance).toMatchObject({
        source_owner: 'open-files',
        artifact_key: 'wiki/README.md',
      });
    } finally {
      db.close();
    }
  });
});
