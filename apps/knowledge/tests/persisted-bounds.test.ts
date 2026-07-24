import { describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db.ts';
import { MAX_INGEST_BATCH_ITEMS, MAX_INGEST_BODY_BYTES } from '../src/input-limits.ts';
import { ingestSourceRef } from '../src/source-ingest.ts';
import { resolveOpenFilesSource } from '../src/source-resolver.ts';
import { hybridSearch, hybridSearchLegacyStore } from '../src/search.ts';
import { createKnowledgeService } from '../src/service.ts';
import { setAnchoredFsTestHook } from '../src/anchored-fs.ts';

const SOURCE_REF = 'open-files://file/persisted-bounds-fixture';

function exactLegacyStore(byteLength: number): string {
  const prefix = '{"items":[],"padding":"';
  const suffix = '"}';
  const padding = byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (padding < 0) throw new Error('requested legacy store is too small');
  const result = `${prefix}${'x'.repeat(padding)}${suffix}`;
  if (Buffer.byteLength(result) !== byteLength) throw new Error('legacy boundary fixture drifted');
  return result;
}

function expectNoSqlite(dbPath: string): void {
  expect(existsSync(dbPath)).toBe(false);
  expect(existsSync(`${dbPath}-wal`)).toBe(false);
  expect(existsSync(`${dbPath}-shm`)).toBe(false);
}

function seedCatalog(dbPath: string, metadataJson: string, chunks: string[]): void {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const now = '2026-01-01T00:00:00.000Z';
    db.run(
      `INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['src_bounds', SOURCE_REF, 'open-files', 'Bounds', metadataJson, '{"mode":"read_only"}', now, now],
    );
    db.run(
      `INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['rev_bounds', 'src_bounds', 'v1', null, null, '{}', now],
    );
    const insert = db.prepare(
      `INSERT INTO chunks
       (id, source_revision_id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    );
    db.transaction(() => {
      chunks.forEach((text, ordinal) => {
        insert.run(`chk_bounds_${ordinal}`, 'rev_bounds', 'source', ordinal, text, '{}', now);
      });
    })();
  } finally {
    db.close();
  }
}

describe('persisted and aggregate source bounds', () => {
  test('legacy inventory and search accept the exact byte boundary', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-legacy-store-boundary-'));
    const legacyStorePath = join(fixture, 'db.json');
    const dbPath = join(fixture, '.hasna', 'knowledge', 'knowledge.db');
    try {
      writeFileSync(legacyStorePath, exactLegacyStore(MAX_INGEST_BODY_BYTES));
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      expect(service.inventory({ storePath: legacyStorePath }).legacy_store).toMatchObject({
        exists: true,
        read_error: null,
        total_items: 0,
      });
      expectNoSqlite(dbPath);
      const result = await hybridSearchLegacyStore({
        legacyStorePath,
        query: 'synthetic',
      });
      expect(result.results).toEqual([]);
      expectNoSqlite(dbPath);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('legacy size plus one fails before parsing or SQLite/WAL/SHM creation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-legacy-store-overflow-'));
    const legacyStorePath = join(fixture, 'db.json');
    const dbPath = join(fixture, '.hasna', 'knowledge', 'knowledge.db');
    try {
      writeFileSync(legacyStorePath, `${exactLegacyStore(MAX_INGEST_BODY_BYTES)}x`);
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      expect(() => service.inventory({ storePath: legacyStorePath })).toThrow('byte hard limit');
      expectNoSqlite(dbPath);
      await expect(hybridSearch({
        dbPath,
        legacyStorePath,
        query: 'synthetic',
      })).rejects.toThrow('byte hard limit');
      expectNoSqlite(dbPath);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('legacy growth during an anchored snapshot fails within the fixed byte allocation', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-legacy-store-race-'));
    const legacyStorePath = join(fixture, 'db.json');
    const dbPath = join(fixture, '.hasna', 'knowledge', 'knowledge.db');
    let injected = false;
    try {
      writeFileSync(legacyStorePath, exactLegacyStore(MAX_INGEST_BODY_BYTES));
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'snapshot-before-read' || detail !== legacyStorePath || injected) return;
        injected = true;
        appendFileSync(legacyStorePath, 'x');
      });
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      expect(() => service.inventory({ storePath: legacyStorePath })).toThrow('byte hard limit');
      expectNoSqlite(dbPath);
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('oversized persisted metadata is rejected before malformed JSON parsing', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-persisted-metadata-'));
    const dbPath = join(fixture, 'knowledge.db');
    try {
      seedCatalog(dbPath, `{"padding":"${'x'.repeat(MAX_INGEST_BODY_BYTES)}`, ['synthetic']);
      await expect(resolveOpenFilesSource({ dbPath, sourceRef: SOURCE_REF }))
        .rejects.toThrow('byte hard limit');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('persisted dangerous keys fail without prototype pollution', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-persisted-prototype-'));
    const dbPath = join(fixture, 'knowledge.db');
    try {
      seedCatalog(dbPath, '{"__proto__":{"polluted":true}}', ['synthetic']);
      await expect(resolveOpenFilesSource({ dbPath, sourceRef: SOURCE_REF }))
        .rejects.toThrow('dangerous key');
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('catalog chunk totals are bounded before joining or reinserting', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-persisted-chunk-count-'));
    const dbPath = join(fixture, 'knowledge.db');
    try {
      seedCatalog(
        dbPath,
        '{}',
        Array.from({ length: MAX_INGEST_BATCH_ITEMS + 1 }, () => 'synthetic'),
      );
      await expect(ingestSourceRef({ dbPath, sourceRef: SOURCE_REF }))
        .rejects.toThrow('chunk hard limit');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('catalog chunk joined bytes are bounded before allocation or reinsertion', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-persisted-chunk-bytes-'));
    const dbPath = join(fixture, 'knowledge.db');
    try {
      seedCatalog(
        dbPath,
        '{}',
        Array.from({ length: 9 }, () => 'x'.repeat(1_000_000)),
      );
      await expect(ingestSourceRef({ dbPath, sourceRef: SOURCE_REF }))
        .rejects.toThrow('joined byte hard limit');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
