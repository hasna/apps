import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';

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
    const manifest = join(dir, 'manifest.jsonl');
    writeFileSync(manifest, `${JSON.stringify({
      source_ref: 'open-files://file/file_mcp/revision/rev_mcp',
      file_id: 'file_mcp',
      path: 'docs/mcp.md',
      name: 'mcp.md',
      mime: 'text/markdown',
      hash: 'sha256:mcp',
      status: 'active',
      permissions: { mode: 'read_only', allowed_purposes: ['knowledge_answer'] },
      extracted_text: 'MCP resolver source text from open-files.',
    })}\n`);
    await ingestOpenFilesManifest({
      dbPath: join(dir, '.hasna', 'apps', 'knowledge', 'knowledge.db'),
      input: manifest,
    });

    const transport = new StdioClientTransport({
      command: 'bun',
      args: [MCP],
      cwd: dir,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'open-knowledge-test', version: '0.0.0' });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'ok_add')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_parse_source_ref')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_resolve_source')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_storage_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_provider_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_embeddings_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_embeddings_index')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_semantic_search')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_search')).toBe(true);

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

      const storageStatus = parseToolJson(await client.callTool({
        name: 'ok_storage_status',
        arguments: { scope: 'project' },
      }));
      expect(storageStatus.ok).toBe(true);
      expect(storageStatus.artifact_store.type).toBe('local');
      expect(storageStatus.source_ownership.owner).toBe('open-files');
      expect(storageStatus.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);

      const resolved = parseToolJson(await client.callTool({
        name: 'ok_resolve_source',
        arguments: {
          source_ref: 'open-files://file/file_mcp/revision/rev_mcp',
          purpose: 'knowledge_answer',
          scope: 'project',
        },
      }));
      expect(resolved.resolved).toBe(true);
      expect(resolved.content.bytes_exposed).toBe(false);
      expect(resolved.chunks[0].text).toContain('MCP resolver source text');
      expect(resolved.chunks[0].evidence.read_only).toBe(true);

      const providerStatus = parseToolJson(await client.callTool({
        name: 'ok_provider_status',
        arguments: { scope: 'project' },
      }));
      expect(providerStatus.providers).toHaveLength(3);
      expect(providerStatus.default_model).toBe('openai:gpt-5.2');

      const providerModels = parseToolJson(await client.callTool({
        name: 'ok_provider_models',
        arguments: { scope: 'project' },
      }));
      expect(providerModels.models.some((entry: any) => entry.alias === 'sonnet')).toBe(true);

      const embeddingStatus = parseToolJson(await client.callTool({
        name: 'ok_embeddings_status',
        arguments: { scope: 'project' },
      }));
      expect(embeddingStatus.total_vector_entries).toBe(0);

      const embeddingIndex = parseToolJson(await client.callTool({
        name: 'ok_embeddings_index',
        arguments: { scope: 'project', fake: true, dimensions: 8 },
      }));
      expect(embeddingIndex.vector_entries_upserted).toBe(1);

      const semanticSearch = parseToolJson(await client.callTool({
        name: 'ok_semantic_search',
        arguments: { scope: 'project', query: 'resolver source text', fake: true, dimensions: 8 },
      }));
      expect(semanticSearch.results).toHaveLength(1);
      expect(semanticSearch.results[0].text).toContain('MCP resolver source text');

      const hybridSearch = parseToolJson(await client.callTool({
        name: 'ok_search',
        arguments: { scope: 'project', query: 'resolver source text', semantic: true, fake: true, dimensions: 8 },
      }));
      expect(hybridSearch.results.some((entry: any) => entry.kind === 'source_chunk')).toBe(true);
      expect(hybridSearch.counts.semantic_results).toBeGreaterThan(0);

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
