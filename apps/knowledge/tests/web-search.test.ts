import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProviderWebSearch } from '../src/web-search';
import { KnowledgeContainmentError } from '../src/runtime-role';

describe('provider web search', () => {
  test('fake and live modes are both contained before options, SQLite, config, or providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-web-search-'));
    const dbPath = join(dir, 'knowledge.db');
    let reads = 0;
    const hostile = new Proxy({ dbPath, fake: true }, {
      get() { reads += 1; throw new Error('web option getter tripwire'); },
      ownKeys() { reads += 1; throw new Error('web option enumeration tripwire'); },
    });
    try {
      await expect(runProviderWebSearch(hostile as never)).rejects.toBeInstanceOf(KnowledgeContainmentError);
      expect(reads).toBe(0);
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('remote result filing is contained before provider or database work', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-web-file-contained-'));
    const dbPath = join(dir, 'knowledge.db');
    try {
      await expect(runProviderWebSearch({
        dbPath,
        query: 'synthetic policy',
        provider: 'openai',
        fake: true,
        fileResults: true,
      })).rejects.toMatchObject({
        code: 'KNOWLEDGE_HOSTED_CONTAINED',
        status: 503,
      });
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
