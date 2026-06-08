import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP = join(__dirname, '..', 'src', 'mcp.js');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseToolJson(result: any): any {
  const text = result.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text);
}

describe('open-knowledge MCP', () => {
  test('registers tools and can add/get through stdio', async () => {
    const dir = makeTempDir('ok-mcp-');
    const store = join(dir, 'db.json');
    const transport = new StdioClientTransport({
      command: 'bun',
      args: [MCP],
      cwd: join(__dirname, '..'),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'open-knowledge-test', version: '0.0.0' });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'ok_add')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_parse_source_ref')).toBe(true);

      const add = parseToolJson(await client.callTool({
        name: 'ok_add',
        arguments: {
          title: 'MCP item',
          content: 'Stored through MCP',
          tags: ['mcp'],
          store_path: store,
        },
      }));
      expect(add.ok).toBe(true);
      expect(add.item.id).toStartWith('k_');
      expect(add.item.short_id).toBeString();

      const get = parseToolJson(await client.callTool({
        name: 'ok_get',
        arguments: { id: add.item.short_id, store_path: store },
      }));
      expect(get.item.title).toBe('MCP item');

      const source = parseToolJson(await client.callTool({
        name: 'ok_parse_source_ref',
        arguments: { uri: 'open-files://file/file_123/revision/rev_456' },
      }));
      expect(source.source_ref).toMatchObject({ kind: 'open-files', entity: 'file', id: 'file_123', revision_id: 'rev_456' });

      const batch = parseToolJson(await client.callTool({
        name: 'ok_batch',
        arguments: {
          store_path: store,
          items: [
            { title: 'Duplicate', content: 'Same' },
            { title: 'Duplicate', content: 'Same' },
          ],
        },
      }));
      expect(batch.added).toBe(2);

      const dedupe = parseToolJson(await client.callTool({
        name: 'ok_dedupe',
        arguments: { store_path: store, confirm: true },
      }));
      expect(dedupe.removed).toBe(1);

      const db = JSON.parse(readFileSync(store, 'utf8'));
      expect(db.items).toHaveLength(2);
    } finally {
      await client.close();
    }
  });
});
