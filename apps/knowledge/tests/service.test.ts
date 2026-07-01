import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../src/service';

describe('knowledge service facade', () => {
  test('resolves project workspace and shares source ingest/resolve operations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-service-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const source = join(dir, 'service-source.md');
    writeFileSync(source, 'Service facade source ingestion text.');
    const sourceRef = `file://${source}`;

    const paths = service.paths();
    expect(paths.home).toBe(join(dir, '.hasna', 'knowledge'));
    expect(paths.config.storage.type).toBe('local');
    expect(service.storageContract().source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(service.validateStorage().ok).toBe(true);

    const migration = service.initDb();
    expect(migration.schema_version).toBe(8);

    const ingest = await service.ingestSource(sourceRef, 'knowledge_index');
    expect(ingest.chunks_inserted).toBe(1);
    expect(ingest.content_source).toBe('file');

    const resolved = await service.resolveSource(sourceRef, { purpose: 'knowledge_index' });
    expect(resolved.resolved).toBe(true);
    expect(resolved.content.bytes_exposed).toBe(false);
    expect(resolved.chunks[0].text).toContain('Service facade');

    const stats = service.dbStats();
    expect(stats.sources).toBe(1);
    expect(stats.chunks).toBe(1);

    const wiki = await service.initWiki();
    expect(wiki.artifacts).toHaveLength(4);
    const wikiStats = service.dbStats();
    expect(wikiStats.storage_objects).toBe(4);
    expect(wikiStats.wiki_pages).toBe(1);
    expect(wikiStats.indexes).toBe(1);
  });
});
