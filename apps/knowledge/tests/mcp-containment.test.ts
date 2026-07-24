import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';
import { buildServer } from '../src/mcp.js';

const root = join(import.meta.dir, '..');
const entry = join(root, 'src', 'mcp-entry.js');
const entrySource = readFileSync(entry, 'utf8');
const mcpSource = readFileSync(join(root, 'src', 'mcp.js'), 'utf8');

const EXPECTED_TOOLS = [
  'knowledge_app_wiki_init', 'knowledge_app_wiki_note_add', 'knowledge_app_wiki_query',
  'knowledge_app_wiki_search', 'knowledge_app_wiki_source_add', 'knowledge_ask', 'knowledge_build',
  'knowledge_context_pack', 'knowledge_get', 'knowledge_ingest', 'knowledge_inventory', 'knowledge_lint',
  'knowledge_machines_preflight', 'knowledge_machines_topology', 'knowledge_resolve_source',
  'knowledge_run_status', 'knowledge_search', 'knowledge_storage', 'knowledge_sync_conflict_get',
  'knowledge_sync_conflict_propose', 'knowledge_sync_conflict_resolve', 'knowledge_sync_conflicts',
  'knowledge_sync_doctor', 'knowledge_sync_peer', 'knowledge_sync_snapshot', 'knowledge_sync_status',
  'knowledge_web_search', 'ok_add', 'ok_archive', 'ok_batch', 'ok_bulk_delete', 'ok_dedupe',
  'ok_delete', 'ok_embeddings_index', 'ok_embeddings_status', 'ok_export', 'ok_get', 'ok_import',
  'ok_list', 'ok_parse_source_ref', 'ok_paths', 'ok_provider_models', 'ok_provider_status', 'ok_prune',
  'ok_reindex_embeddings', 'ok_reindex_enqueue', 'ok_reindex_status', 'ok_resolve_source', 'ok_restore',
  'ok_search', 'ok_semantic_search', 'ok_stats', 'ok_storage_status', 'ok_untag', 'ok_update',
  'ok_upsert', 'ok_web_search', 'storage_pull', 'storage_push', 'storage_status', 'storage_sync',
] as const;

function runEntry(env: Record<string, string>, args: string[] = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-contained-'));
  const home = join(cwd, 'home');
  const result = Bun.spawnSync(['bun', entry, ...args], {
    cwd,
    env: sanitizedLocalTestEnv({
      HASNA_KNOWLEDGE_STORAGE_MODE: undefined,
      PATH: process.env.PATH ?? '',
      HOME: home,
      USERPROFILE: home,
      BUN_CONFIG_INSTALL_AUTO: 'disable',
      ...env,
    }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    cwd,
    home,
    result,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe('MCP stdio Stage-A containment', () => {
  for (const [name, env, code] of [
    ['hosted', { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' }, 'KNOWLEDGE_HOSTED_CONTAINED'],
    ['partial', { HASNA_KNOWLEDGE_API_KEY: 'synthetic-stage-a-key' }, 'KNOWLEDGE_RUNTIME_INTENT_INVALID'],
    ['unknown', { HASNA_KNOWLEDGE_STORAGE_MODE: 'mystery' }, 'KNOWLEDGE_RUNTIME_INTENT_INVALID'],
  ] as const) {
    test(`${name} intent exits before MCP SDK or workspace construction`, () => {
      const run = runEntry(env);
      expect(run.result.exitCode).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain(code);
      expect(existsSync(join(run.cwd, '.hasna'))).toBe(false);
      expect(existsSync(join(run.home, '.hasna'))).toBe(false);
      expect(run.stderr).not.toContain('modelcontextprotocol');
    });
  }

  test('help remains pure without importing the MCP SDK', () => {
    const run = runEntry({ HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' }, ['--help']);
    expect(run.result.exitCode).toBe(0);
    expect(run.stderr).toContain('Usage: knowledge-mcp');
    expect(existsSync(join(run.cwd, '.hasna'))).toBe(false);
  });

  test('HTTP entry wiring validates argv without a nonexistent host resolver', () => {
    expect(entrySource).toContain('resolveMcpHttpPort(argv, env)');
    expect(entrySource).not.toContain('resolveMcpHttpHost');
  });

  test('legacy MCP_HTTP=1 selects contained HTTP in source and built entrypoints', async () => {
    const [sourceEntry, builtEntry] = await Promise.all([
      import('../src/mcp-entry.js'),
      import('../bin/knowledge-mcp.js'),
    ]) as Array<{ wantsHttp?: (argv: string[], env: Record<string, string>) => boolean }>;

    for (const entrypoint of [sourceEntry, builtEntry]) {
      expect(typeof entrypoint.wantsHttp).toBe('function');
      expect(entrypoint.wantsHttp?.([], { MCP_HTTP: '1' })).toBe(true);
      expect(entrypoint.wantsHttp?.([], { MCP_HTTP: '0' })).toBe(false);
    }
  });

  test('every registered tool is routed through the single guarded helper', () => {
    const actual = [...mcpSource.matchAll(/registerTool\(server,\s*'([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(actual).toEqual([...EXPECTED_TOOLS].sort());
    expect((mcpSource.match(/server\.registerTool\(/g) ?? []).length).toBe(1);
    expect(mcpSource).toContain('const error = containmentForServer(server)');
  });

  test('all resources and templates route through guarded registration helpers', () => {
    expect((mcpSource.match(/server\.registerResource\(/g) ?? []).length).toBe(2);
    expect(mcpSource).toContain('serverFailurePayload(server, error)');
    expect(mcpSource).toContain('_meta: { containment: serverFailurePayload(server, error) }');
    expect(mcpSource).toContain('jsonResource(resourceUri, await read(resourceUri))');
  });

  test('mutable supplied env is revalidated before every tool lock or store access', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-runtime-flip-'));
    const storePath = join(cwd, 'must-not-open.json');
    const env: Record<string, string | undefined> = {
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
    };
    try {
      const server = buildServer({ cwd, env });
      env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';

      const registered = (server as unknown as {
        _registeredTools: Record<string, { handler(input: unknown): Promise<{ content?: Array<{ text?: string }> }> }>;
        _registeredResources: Record<string, {
          readCallback(uri: URL): Promise<{ contents?: Array<{ text?: string }> }>;
        }>;
        _registeredResourceTemplates: Record<string, {
          resourceTemplate: {
            listCallback?: () => Promise<{ resources?: unknown[]; _meta?: { containment?: unknown } }>;
          };
        }>;
      })._registeredTools;
      const result = await registered.ok_list.handler({
        store_path: storePath,
        allow_global: true,
      });
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');

      expect(payload).toMatchObject({
        code: 'KNOWLEDGE_HOSTED_CONTAINED',
        status: 503,
        role: 'hosted-client',
      });
      expect(existsSync(storePath)).toBe(false);
      expect(existsSync(`${storePath}.lock`)).toBe(false);
      expect(existsSync(join(cwd, '.hasna'))).toBe(false);

      const internal = server as unknown as {
        _registeredResources: Record<string, {
          readCallback(uri: URL): Promise<{ contents?: Array<{ text?: string }> }>;
        }>;
        _registeredResourceTemplates: Record<string, {
          resourceTemplate: {
            listCallback?: () => Promise<{ resources?: unknown[]; _meta?: { containment?: unknown } }>;
          };
        }>;
      };
      const resource = await internal._registeredResources['knowledge://project/config']
        .readCallback(new URL('knowledge://project/config'));
      expect(JSON.parse(resource.contents?.[0]?.text ?? '{}')).toMatchObject({
        code: 'KNOWLEDGE_HOSTED_CONTAINED',
        status: 503,
      });
      const template = Object.values(internal._registeredResourceTemplates)[0];
      expect(await template.resourceTemplate.listCallback?.()).toMatchObject({
        resources: [],
        _meta: { containment: { code: 'KNOWLEDGE_HOSTED_CONTAINED', status: 503 } },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
