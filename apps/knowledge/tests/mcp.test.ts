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

function parseResourceJson(result: any): any {
  const text = result.contents?.[0]?.text;
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
      expect(tools.tools.some((tool) => tool.name === 'ok_reindex_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_reindex_enqueue')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_reindex_embeddings')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_search')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_search')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_ask')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_get')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_ingest')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_build')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_web_search')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_lint')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_run_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_storage')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_resolve_source')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_web_search')).toBe(true);

      const resourceTemplates = await client.listResourceTemplates();
      expect(resourceTemplates.resourceTemplates.some((resource) => resource.uriTemplate === 'knowledge://project/runs/{id}')).toBe(true);
      expect(resourceTemplates.resourceTemplates.some((resource) => resource.uriTemplate === 'knowledge://project/wiki/pages/{id}')).toBe(true);

      const resources = await client.listResources();
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/config')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/schema')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/sources')).toBe(true);

      const schemaResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/schema' }));
      expect(schemaResource.stats.sources).toBe(1);
      expect(schemaResource.stats.chunks).toBe(1);

      const sourceResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/sources' }));
      expect(sourceResource.sources[0].uri).toBe('open-files://file/file_mcp');

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

      const stableGetItem = parseToolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'item', id: add.item.short_id, store_path: store },
      }));
      expect(stableGetItem.item.title).toBe('MCP item');

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

      const stableStorage = parseToolJson(await client.callTool({
        name: 'knowledge_storage',
        arguments: { scope: 'project' },
      }));
      expect(stableStorage.remote_contract.contract_version).toBe(1);
      expect(stableStorage.remote_contract.endpoints.build).toBe('/api/v1/knowledge/build');

      const ingest = parseToolJson(await client.callTool({
        name: 'knowledge_ingest',
        arguments: { scope: 'project', manifest },
      }));
      expect(ingest.mode).toBe('manifest');
      expect(ingest.items_seen).toBe(1);

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

      const stableResolved = parseToolJson(await client.callTool({
        name: 'knowledge_resolve_source',
        arguments: {
          source_ref: 'open-files://file/file_mcp/revision/rev_mcp',
          purpose: 'knowledge_answer',
          scope: 'project',
        },
      }));
      expect(stableResolved.resolved).toBe(true);
      expect(stableResolved.chunks[0].provenance.source_ref).toBe('open-files://file/file_mcp/revision/rev_mcp');

      const stableSourceGet = parseToolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'source', id: 'open-files://file/file_mcp', scope: 'project' },
      }));
      expect(stableSourceGet.source.uri).toBe('open-files://file/file_mcp');
      expect(stableSourceGet.chunks[0].text).toContain('MCP resolver source text');

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

      const reindexStatus = parseToolJson(await client.callTool({
        name: 'ok_reindex_status',
        arguments: { scope: 'project', fake: true, dimensions: 8 },
      }));
      expect(reindexStatus.missing_embeddings).toBe(1);

      const embeddingIndex = parseToolJson(await client.callTool({
        name: 'ok_embeddings_index',
        arguments: { scope: 'project', fake: true, dimensions: 8 },
      }));
      expect(embeddingIndex.vector_entries_upserted).toBe(1);

      const reindexEnqueue = parseToolJson(await client.callTool({
        name: 'ok_reindex_enqueue',
        arguments: { scope: 'project', fake: true, dimensions: 8 },
      }));
      expect(reindexEnqueue.enqueued).toBe(0);

      const reindexEmbeddings = parseToolJson(await client.callTool({
        name: 'ok_reindex_embeddings',
        arguments: { scope: 'project', full: true, fake: true, dimensions: 8 },
      }));
      expect(reindexEmbeddings.full).toBe(true);
      expect(reindexEmbeddings.deleted_vector_entries).toBe(1);
      expect(reindexEmbeddings.indexed.vector_entries_upserted).toBe(1);

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

      const contextSearch = parseToolJson(await client.callTool({
        name: 'knowledge_search',
        arguments: { scope: 'project', query: 'resolver source text', semantic: true, fake: true, dimensions: 8 },
      }));
      expect(contextSearch.excerpts.length).toBeGreaterThan(0);
      expect(contextSearch.citations[0].source_uri).toBe('open-files://file/file_mcp');

      const answer = parseToolJson(await client.callTool({
        name: 'knowledge_ask',
        arguments: { scope: 'project', prompt: 'Answer with resolver source text', generate: true, fake: true, model: 'openai:gpt-5-mini' },
      }));
      expect(answer.generated).toBe(true);
      expect(answer.answer).toContain('Fake generated answer');

      const build = parseToolJson(await client.callTool({
        name: 'knowledge_build',
        arguments: {
          scope: 'project',
          prompt: 'Build wiki answer from resolver source text',
          generate: true,
          fake: true,
          model: 'openai:gpt-5-mini',
          approve_write: true,
        },
      }));
      expect(build.generated).toBe(true);
      expect(build.wiki_file.durable_writes_performed).toBe(true);
      expect(build.wiki_file.page_id).toStartWith('wiki_');

      const runStatus = parseToolJson(await client.callTool({
        name: 'knowledge_run_status',
        arguments: { scope: 'project', run_id: build.run_id },
      }));
      expect(runStatus.run.id).toBe(build.run_id);
      expect(runStatus.events.some((event: any) => event.event === 'context_retrieved')).toBe(true);

      const runsList = parseToolJson(await client.callTool({
        name: 'knowledge_run_status',
        arguments: { scope: 'project', limit: 5 },
      }));
      expect(runsList.runs.some((run: any) => run.id === build.run_id)).toBe(true);

      const stableGetRun = parseToolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'run', id: build.run_id, scope: 'project' },
      }));
      expect(stableGetRun.run.status).toBe('completed');

      const stableGetWiki = parseToolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'wiki_page', id: build.wiki_file.page_id, scope: 'project' },
      }));
      expect(stableGetWiki.page.id).toBe(build.wiki_file.page_id);
      expect(stableGetWiki.content).toContain('Fake generated answer');

      const wikiPageResource = parseResourceJson(await client.readResource({
        uri: `knowledge://project/wiki/pages/${encodeURIComponent(build.wiki_file.page_id)}`,
      }));
      expect(wikiPageResource.page.id).toBe(build.wiki_file.page_id);
      expect(wikiPageResource.content).toContain('Fake generated answer');

      const lint = parseToolJson(await client.callTool({
        name: 'knowledge_lint',
        arguments: { scope: 'project' },
      }));
      expect(lint.ok).toBeBoolean();
      expect(lint.issue_count).toBeNumber();

      const web = parseToolJson(await client.callTool({
        name: 'ok_web_search',
        arguments: { scope: 'project', query: 'company wiki policy', provider: 'openai', model: 'openai:gpt-5-mini', fake: true, file_results: true, limit: 1 },
      }));
      expect(web.sources).toHaveLength(1);
      expect(web.filed_sources).toBe(1);

      const stableWeb = parseToolJson(await client.callTool({
        name: 'knowledge_web_search',
        arguments: { scope: 'project', query: 'company wiki policy', provider: 'openai', model: 'openai:gpt-5-mini', fake: true, limit: 1 },
      }));
      expect(stableWeb.sources).toHaveLength(1);

      const openFilesResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/open-files' }));
      expect(openFilesResource.raw_source_bytes_exposed).toBe(false);
      expect(openFilesResource.refs.some((ref: any) => ref.uri === 'open-files://file/file_mcp')).toBe(true);

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
