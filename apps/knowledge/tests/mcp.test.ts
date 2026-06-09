import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { createKnowledgeService } from '../src/service';
import { recordKnowledgeSyncConflict } from '../src/sync';

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

function writeFakeSshBin(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const ssh = join(bin, 'ssh');
  writeFileSync(ssh, [
    '#!/bin/sh',
    'if [ -n "$KNOWLEDGE_FAKE_SSH_TARGET_PATH" ]; then printf "%s" "$1" > "$KNOWLEDGE_FAKE_SSH_TARGET_PATH"; fi',
    'command="$2"',
    'if printf "%s" "$command" | grep -q "sync.*export"; then',
    '    printf "%s" "$KNOWLEDGE_FAKE_SSH_EXPORT_JSON"',
    'elif printf "%s" "$command" | grep -q "sync.*import"; then',
    '    cat >/dev/null',
    '    printf "%s" "$KNOWLEDGE_FAKE_SSH_IMPORT_JSON"',
    'else',
    '    echo "unexpected fake ssh command: $*" >&2',
    '    exit 9',
    'fi',
    '',
  ].join('\n'));
  chmodSync(ssh, 0o755);
  return bin;
}

function writeFakeMachinesRouteBin(bin: string, target: string, projectRoot = '/remote/open-knowledge'): void {
  const machines = join(bin, 'machines');
  writeFileSync(machines, [
    '#!/bin/sh',
    'if [ "$1" = "route" ]; then',
    `  printf '%s\\n' '${JSON.stringify({
      ok: true,
      target,
      route: 'tailscale',
      source: 'tailscale',
      confidence: 'high',
      evidence: {
        topology: true,
        matched_by: 'machine_id',
        selected_hint: {
          kind: 'tailscale',
          target,
          reachable: true,
        },
      },
      warnings: [],
    })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "workspace" ] && [ "$2" = "resolve" ]; then',
    `  printf '%s\\n' '${JSON.stringify({
      ok: true,
      requested_machine_id: 'spark01',
      machine_id: 'spark01',
      project: { project_id: 'open-knowledge', repo_name: 'open-knowledge' },
      machine: { current: false, primary: false, trust_status: 'trusted', auth_status: 'authenticated' },
      paths: {
        workspace_root: { path: '/remote', source: 'manifest' },
        project_root: { path: projectRoot, source: 'manifest_metadata' },
        open_files_root: { path: '/remote/open-files', source: 'manifest_metadata' },
      },
      evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
      warnings: [],
    })}'`,
    '  exit 0',
    'fi',
    'exit 9',
    '',
  ].join('\n'));
  chmodSync(machines, 0o755);
}

function emptySyncBundle() {
  return {
    ok: true,
    format: 'knowledge-sync-bundle',
    version: 1,
    protocol_version: 1,
    min_protocol_version: 1,
    generated_at: '2026-06-09T00:00:00.000Z',
    source: {
      scope: 'project',
      workspace_home: '/remote/.hasna/apps/knowledge',
      sqlite_schema_version: 6,
      machine_id: 'spark01',
      artifact_root_uri: 'file:///remote/.hasna/apps/knowledge/artifacts/',
    },
    tables: [],
    artifacts: [],
    warnings: [],
    message: 'valid empty bundle',
  };
}

function emptyImportResult() {
  return {
    ok: true,
    protocol_version: 1,
    min_protocol_version: 1,
    dry_run: true,
    direction: 'import',
    source: emptySyncBundle().source,
    target: {
      scope: 'project',
      workspace_home: '/remote/.hasna/apps/knowledge',
      sqlite_schema_version: 6,
      artifact_root_uri: 'file:///remote/.hasna/apps/knowledge/artifacts/',
    },
    tables: [],
    artifacts: {
      source_artifacts: 0,
      target_artifacts: 0,
      copied: 0,
      skipped: 0,
      conflicts: 0,
      missing_content: 0,
    },
    conflicts_created: 0,
    warnings: [],
    message: 'Would import 0 row(s), copied 0 artifact(s), 0 conflict(s)',
  };
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

describe('knowledge MCP', () => {
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
    const targetPath = join(dir, 'mcp-ssh-target.txt');
    const fakeBin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(fakeBin, 'mcp-spark01.tailnet.test');

    const transport = new StdioClientTransport({
      command: 'bun',
      args: [MCP],
      cwd: dir,
      stderr: 'pipe',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(emptySyncBundle()),
        KNOWLEDGE_FAKE_SSH_IMPORT_JSON: JSON.stringify(emptyImportResult()),
        KNOWLEDGE_FAKE_SSH_TARGET_PATH: targetPath,
      },
    });
    const client = new Client({ name: 'knowledge-test', version: '0.0.0' });

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
      expect(tools.tools.some((tool) => tool.name === 'knowledge_machines_topology')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_machines_preflight')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_snapshot')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_conflicts')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_conflict_get')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_conflict_propose')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_conflict_resolve')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_sync_peer')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'storage_status')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'storage_push')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'storage_pull')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'storage_sync')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'knowledge_resolve_source')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'ok_web_search')).toBe(true);

      const resourceTemplates = await client.listResourceTemplates();
      expect(resourceTemplates.resourceTemplates.some((resource) => resource.uriTemplate === 'knowledge://project/runs/{id}')).toBe(true);
      expect(resourceTemplates.resourceTemplates.some((resource) => resource.uriTemplate === 'knowledge://project/wiki/pages/{id}')).toBe(true);

      const resources = await client.listResources();
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/config')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/schema')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/sources')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/machines')).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/sync')).toBe(true);

      const schemaResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/schema' }));
      expect(schemaResource.stats.sources).toBe(1);
      expect(schemaResource.stats.chunks).toBe(1);

      const machinesResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/machines' }));
      expect(machinesResource.ok).toBe(true);
      expect(machinesResource.knowledge.app_path).toBe('.hasna/apps/knowledge');

      const syncResource = parseResourceJson(await client.readResource({ uri: 'knowledge://project/sync' }));
      expect(syncResource.ok).toBe(true);
      expect(syncResource.sqlite_schema_version).toBe(6);

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

      const machines = parseToolJson(await client.callTool({
        name: 'knowledge_machines_topology',
        arguments: { scope: 'project', include_tailscale: false },
      }));
      expect(machines.ok).toBe(true);
      expect(machines.machines.length).toBeGreaterThanOrEqual(1);

      const syncStatus = parseToolJson(await client.callTool({
        name: 'knowledge_sync_status',
        arguments: { scope: 'project' },
      }));
      expect(syncStatus.ok).toBe(true);
      expect(syncStatus.snapshots.total).toBe(0);

      const syncSnapshot = parseToolJson(await client.callTool({
        name: 'knowledge_sync_snapshot',
        arguments: { scope: 'project', include_tailscale: false },
      }));
      expect(syncSnapshot.ok).toBe(true);
      expect(syncSnapshot.snapshot.content_hash).toStartWith('sha256:');

      const syncConflicts = parseToolJson(await client.callTool({
        name: 'knowledge_sync_conflicts',
        arguments: { scope: 'project', limit: 5 },
      }));
      expect(syncConflicts.conflicts).toEqual([]);

      const conflictService = createKnowledgeService({ scope: 'project', cwd: dir });
      const conflict = recordKnowledgeSyncConflict(conflictService.ensureWorkspace().knowledgeDbPath, {
        entityKind: 'wiki_pages',
        entityId: 'wiki/mcp.md',
        localMachineId: 'spark02',
        remoteMachineId: 'spark01',
        localHash: 'sha256:mcp-local',
        remoteHash: 'sha256:mcp-remote',
        baseHash: 'sha256:mcp-base',
        metadata: { reason: 'mcp conflict workflow' },
      });

      const conflictGet = parseToolJson(await client.callTool({
        name: 'knowledge_sync_conflict_get',
        arguments: { scope: 'project', id: conflict.id },
      }));
      expect(conflictGet.conflict.metadata.reason).toBe('mcp conflict workflow');

      const conflictProposal = parseToolJson(await client.callTool({
        name: 'knowledge_sync_conflict_propose',
        arguments: { scope: 'project', id: conflict.id },
      }));
      expect(conflictProposal.requires_approval).toBe(true);
      expect(conflictProposal.merge_prompt).toContain('Do not write changes without approval');

      const blockedConflictResolve = parseToolJson(await client.callTool({
        name: 'knowledge_sync_conflict_resolve',
        arguments: { scope: 'project', id: conflict.id, strategy: 'manual-merge' },
      }));
      expect(blockedConflictResolve.ok).toBe(false);
      expect(blockedConflictResolve.approval_required).toBe(true);

      const conflictResolve = parseToolJson(await client.callTool({
        name: 'knowledge_sync_conflict_resolve',
        arguments: {
          scope: 'project',
          id: conflict.id,
          strategy: 'manual-merge',
          approve_write: true,
          approved_by: 'mcp-reviewer',
          proposed_patch_uri: 'file:///tmp/mcp.patch',
        },
      }));
      expect(conflictResolve.ok).toBe(true);
      expect(conflictResolve.conflict.status).toBe('resolved');
      expect(conflictResolve.audit_event_id).toStartWith('audit_');

      const peerDir = makeTempDir('ok-mcp-peer-sync-');
      const syncPeer = parseToolJson(await client.callTool({
        name: 'knowledge_sync_peer',
        arguments: {
          scope: 'project',
          peer_workspace: peerDir,
          direction: 'dry-run',
        },
      }));
      expect(syncPeer.ok).toBe(true);
      expect(syncPeer.dry_run).toBe(true);

      const remoteSyncPeer = parseToolJson(await client.callTool({
        name: 'knowledge_sync_peer',
        arguments: {
          scope: 'project',
          machine: 'spark01',
          direction: 'dry-run',
        },
      }));
      expect(remoteSyncPeer.ok).toBe(true);
      expect(remoteSyncPeer.transport).toBe('ssh');
      expect(remoteSyncPeer.resolved_machine).toBe('mcp-spark01.tailnet.test');
      expect(remoteSyncPeer.resolved_route).toMatchObject({
        source: 'open-machines',
        adapter: {
          implementation: 'cli',
          available: true,
        },
        target: 'mcp-spark01.tailnet.test',
        route: 'tailscale',
        target_kind: 'tailscale',
        confidence: 'high',
      });
      expect(remoteSyncPeer.peer_workspace).toBe('/remote/open-knowledge');
      expect(remoteSyncPeer.resolved_workspace).toMatchObject({
        source: 'open-machines',
        adapter: {
          implementation: 'cli',
          available: true,
        },
        project_root: '/remote/open-knowledge',
        project_root_source: 'manifest_metadata',
        open_files_root: '/remote/open-files',
      });
      expect(readFileSync(targetPath, 'utf8')).toBe('mcp-spark01.tailnet.test');

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

      const databaseStorage = parseToolJson(await client.callTool({
        name: 'storage_status',
        arguments: { scope: 'project' },
      }));
      expect(databaseStorage.service).toBe('knowledge');
      expect(databaseStorage.mode).toBe('local');
      expect(databaseStorage.tables).toContain('sources');
      expect(databaseStorage.tables).not.toContain('chunks_fts');

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
