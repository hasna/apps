import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../src/artifact-store';
import { initializeWikiLayout } from '../src/wiki-layout';

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
  });
});
