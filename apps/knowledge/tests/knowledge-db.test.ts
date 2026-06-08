import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';

describe('knowledge sqlite store', () => {
  test('migrates versioned schema and creates core catalog tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-'));
    const dbPath = join(dir, 'knowledge.db');

    const migration = migrateKnowledgeDb(dbPath);
    expect(migration.schema_version).toBe(1);

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
    expect(stats.schema_version).toBe(1);
    expect(stats.sources).toBe(0);
    expect(stats.runs).toBe(0);
  });
});
