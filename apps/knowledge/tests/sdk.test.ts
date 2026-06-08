import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HASNA_KNOWLEDGE_APP_PATH,
  HASNA_XYZ_KNOWLEDGE_CANONICAL,
  createKnowledgeClient,
  createKnowledgeSdk,
  parseSourceRef,
  type KnowledgeClient,
} from '../src/index';

describe('public knowledge sdk', () => {
  test('exposes a stable client facade for installed apps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sdk-'));
    const client: KnowledgeClient = createKnowledgeClient({ scope: 'project', cwd: dir });
    const source = join(dir, 'sdk-source.md');
    writeFileSync(source, 'The SDK facade lets apps index company wiki source context without shelling out.');

    expect(createKnowledgeSdk).toBe(createKnowledgeClient);
    expect(HASNA_KNOWLEDGE_APP_PATH).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(HASNA_XYZ_KNOWLEDGE_CANONICAL.source_owner).toBe('open-files');

    const paths = client.paths();
    expect(paths.home).toBe(join(dir, '.hasna', 'apps', 'knowledge'));
    expect(paths.config.storage.type).toBe('local');

    const setup = client.setup({ mode: 'hosted', canonicalHasnaXyz: true });
    expect(setup.mode).toBe('hosted');
    expect(setup.storage_type).toBe('s3');
    expect(setup.canonical_hasna_xyz.active).toBe(true);

    const storage = client.storage.status();
    expect(storage.source_ownership.owner).toBe('open-files');
    expect(storage.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(client.storage.validate().ok).toBe(true);

    const parsed = parseSourceRef(`file://${source}`);
    expect(parsed.kind).toBe('file');

    const migration = client.db.init();
    expect(migration.schema_version).toBe(5);

    const ingest = await client.ingest.source(`file://${source}`, 'knowledge_index');
    expect(ingest.sources_upserted).toBe(1);
    expect(ingest.chunks_inserted).toBe(1);

    const search = await client.search({ query: 'SDK facade source context', limit: 3 });
    expect(search.results[0].text).toContain('SDK facade');

    const answer = await client.ask('What does the SDK facade let apps do?', { limit: 3 });
    expect(answer.generated).toBe(false);
    expect(answer.answer).toContain('SDK facade');
    expect(answer.context.citations.length).toBeGreaterThan(0);

    const stats = client.db.stats();
    expect(stats.sources).toBe(1);
    expect(stats.chunks).toBe(1);
    expect(stats.runs).toBe(1);
  });
});
