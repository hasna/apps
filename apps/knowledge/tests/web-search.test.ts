import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats } from '../src/knowledge-db';
import { runProviderWebSearch } from '../src/web-search';

describe('provider web search', () => {
  test('returns fake provider sources and can file them as web refs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-web-search-'));
    const dbPath = join(dir, 'knowledge.db');

    const result = await runProviderWebSearch({
      dbPath,
      query: 'company wiki latest policy',
      provider: 'openai',
      modelRef: 'openai:gpt-5-mini',
      fake: true,
      fileResults: true,
      limit: 2,
    });

    expect(result.provider).toBe('openai');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].url).toBe('https://example.com/knowledge-web-1');
    expect(result.filed_sources).toBe(2);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.sources).toBe(2);
    expect(stats.chunks).toBe(2);
    expect(stats.runs).toBe(1);
  });
});
