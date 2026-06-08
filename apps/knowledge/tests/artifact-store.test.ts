import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore, normalizeArtifactKey } from '../src/artifact-store';

describe('knowledge artifact store', () => {
  test('normalizes safe keys and rejects traversal', () => {
    expect(normalizeArtifactKey('wiki/engineering/mcp.md')).toBe('wiki/engineering/mcp.md');
    expect(normalizeArtifactKey('wiki\\engineering\\mcp.md')).toBe('wiki/engineering/mcp.md');
    expect(() => normalizeArtifactKey('../secrets.txt')).toThrow('Invalid artifact key');
    expect(() => normalizeArtifactKey('/absolute/path.txt')).toThrow('Invalid artifact key');
    expect(() => normalizeArtifactKey('wiki/../secret.txt')).toThrow('Invalid artifact key');
  });

  test('local store writes and reads text inside artifact root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-artifacts-'));
    const store = new LocalArtifactStore(dir);

    const result = await store.put({
      key: 'wiki/engineering/mcp.md',
      body: '# MCP\n\nAgent-facing tools.',
      content_type: 'text/markdown',
    });

    expect(result.key).toBe('wiki/engineering/mcp.md');
    expect(result.uri).toStartWith('file://');
    expect(existsSync(join(dir, 'wiki', 'engineering', 'mcp.md'))).toBe(true);
    expect(await store.exists('wiki/engineering/mcp.md')).toBe(true);
    expect(await store.getText('wiki/engineering/mcp.md')).toContain('Agent-facing tools');
  });
});
