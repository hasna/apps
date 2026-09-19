/**
 * PORT-TO-API slice A — real-process proof that hosted Knowledge surfaces use
 * the canonical app authority and never create on-box state.
 *
 * This test deliberately drives the package-declared, published CLI and MCP
 * binaries. A 0600 credential file stores a bare app authority mounted at
 * `/knowledge`; the clients must append `/v1` exactly once. Every possible
 * local root (HOME, data/config overrides, XDG roots, cwd and temp) lives under
 * one owned sandbox whose filesystem snapshot must remain unchanged after each
 * command/tool call.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PGlite } from '@electric-sql/pglite';
import pkg from '../package.json' with { type: 'json' };
import { knowledgeCredentialsPath } from '../src/auth';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  KNOWLEDGE_LOCAL_OPT_IN_ENV,
} from '../src/client-transport';
import { createServeHandler } from '../src/serve';
import { resolveItemStore, type ItemStore } from '../src/item-store';
import { createMigratedPglite } from './fixtures/pglite-client';
import { budget } from './support/budget';

const SIGNING = 'test-signing-secret-not-a-real-key';
const MOUNT = '/knowledge';
const PACKAGE_ROOT = join(import.meta.dir, '..');
const CLI = join(PACKAGE_ROOT, pkg.bin.knowledge);
const MCP = join(PACKAGE_ROOT, pkg.bin['knowledge-mcp']);
const CHILD_TIMEOUT_MS = 45_000;

interface ObservedRequest {
  method: string;
  pathname: string;
  search: string;
  authenticated: boolean;
}

interface TreeScan {
  entries: string[];
  errors: string[];
}

let db: PGlite;
let server: { port: number; stop: (closeActive?: boolean) => void };
let hostedEnv: Record<string, string>;
let hostedToken: string;
let sandboxRoot: string;
let sandboxHome: string;
let sandboxCwd: string;
let sandboxTmp: string;
let credentialsPath: string;
let baselineTree: string[];

/** Request metadata only. Header values and bodies are never retained. */
const requestLog: ObservedRequest[] = [];

function mark(): number {
  return requestLog.length;
}

function since(at: number): ObservedRequest[] {
  return requestLog.slice(at);
}

function signature(request: ObservedRequest): string {
  return `${request.method} ${request.pathname}${request.search}`;
}

function searchRequest(query: string, limit = 20): string {
  const params = new URLSearchParams({
    q: query,
    archive: 'active',
    limit: String(limit),
    offset: '0',
  });
  return `GET ${MOUNT}/v1/notes/search?${params.toString()}`;
}

function expectRequests(at: number, expected: string[]): void {
  const observed = since(at);
  expect(observed.map(signature)).toEqual(expected);
  expect(observed.every((request) => request.authenticated)).toBe(true);
  expect(observed.every((request) => !request.pathname.includes('/v1/v1'))).toBe(true);
}

function scanTree(root: string): TreeScan {
  const entries: string[] = [];
  const errors: string[] = [];
  const walk = (current: string) => {
    let children;
    try {
      children = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      errors.push(`${relative(root, current) || '.'}: ${error instanceof Error ? error.name : 'read_error'}`);
      return;
    }
    for (const child of children) {
      const full = join(current, child.name);
      const rel = relative(root, full).split('\\').join('/');
      if (child.isDirectory()) {
        entries.push(`dir:${rel}`);
        walk(full);
      } else if (child.isFile()) {
        entries.push(`file:${rel}`);
      } else if (child.isSymbolicLink()) {
        entries.push(`symlink:${rel}`);
      } else {
        entries.push(`other:${rel}`);
      }
    }
  };
  walk(root);
  entries.sort();
  errors.sort();
  return { entries, errors };
}

function assertSandboxUnchanged(): void {
  const scanned = scanTree(sandboxRoot);
  expect(scanned.errors).toEqual([]);
  expect(scanned.entries).toEqual(baselineTree);
}

function safeChildEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'test',
    NO_COLOR: '1',
    CI: '1',
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
    HOME: sandboxHome,
    USERPROFILE: sandboxHome,
    PWD: sandboxCwd,
    TMPDIR: sandboxTmp,
    TMP: sandboxTmp,
    TEMP: sandboxTmp,
    HASNA_HOME: '',
    HASNA_CONFIG_HOME: '',
    HASNA_DATA_HOME: join(sandboxRoot, 'hasna-data'),
    HASNA_KNOWLEDGE_HOME: join(sandboxRoot, 'knowledge-data'),
    HASNA_KNOWLEDGE_AUTH_DIR: join(sandboxRoot, 'legacy-auth'),
    HASNA_KNOWLEDGE_AUTH_PATH: join(sandboxRoot, 'legacy-auth', 'auth.json'),
    XDG_CONFIG_HOME: join(sandboxRoot, 'xdg-config'),
    XDG_DATA_HOME: join(sandboxRoot, 'xdg-data'),
    XDG_CACHE_HOME: join(sandboxRoot, 'xdg-cache'),
    XDG_STATE_HOME: join(sandboxRoot, 'xdg-state'),
    XDG_RUNTIME_DIR: join(sandboxRoot, 'xdg-runtime'),
    HASNA_STATION: 'knowledge-hosted-path-test',
    [KNOWLEDGE_LOCAL_OPT_IN_ENV]: '',
  };
  for (const key of ['LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

beforeAll(async () => {
  sandboxRoot = mkdtempSync(join(tmpdir(), 'knowledge-hosted-path-'));
  sandboxHome = join(sandboxRoot, 'home');
  sandboxCwd = join(sandboxRoot, 'cwd');
  sandboxTmp = join(sandboxRoot, 'tmp');
  for (const dir of [
    sandboxHome,
    sandboxCwd,
    sandboxTmp,
    join(sandboxRoot, 'hasna-data'),
    join(sandboxRoot, 'xdg-config'),
    join(sandboxRoot, 'xdg-data'),
    join(sandboxRoot, 'xdg-cache'),
    join(sandboxRoot, 'xdg-state'),
    join(sandboxRoot, 'xdg-runtime'),
  ]) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const created = await createMigratedPglite();
  db = created.db;
  const store = new ApiKeyStore(created.client);
  const verifier = verifyApiKey({
    app: 'knowledge',
    signingSecret: SIGNING,
    keyStatus: () => Promise.resolve('active' as const),
  });
  hostedToken = mintApiKey({
    app: 'knowledge',
    scopes: ['knowledge:read', 'knowledge:write'],
    signingSecret: SIGNING,
    tid: 'tenant-hosted-path',
  }).token;
  const handler = createServeHandler({ client: created.client, verifier, store, version: '9.9.9' });

  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request: Request, ...rest: unknown[]) => {
      const observedUrl = new URL(request.url);
      const authenticated = request.headers.get('x-api-key') === hostedToken
        || request.headers.get('authorization') === `Bearer ${hostedToken}`;
      requestLog.push({
        method: request.method,
        pathname: observedUrl.pathname,
        search: observedUrl.search,
        authenticated,
      });
      if (!observedUrl.pathname.startsWith(`${MOUNT}/v1`)) {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }
      const forwardedUrl = new URL(request.url);
      forwardedUrl.pathname = observedUrl.pathname.slice(MOUNT.length);
      const forwarded = new Request(forwardedUrl, request);
      return (handler as (req: Request, ...args: unknown[]) => Response | Promise<Response>)(forwarded, ...rest);
    },
  });

  hostedEnv = safeChildEnv();
  credentialsPath = knowledgeCredentialsPath(hostedEnv);
  expect(credentialsPath).toBe(join(sandboxHome, '.hasna', 'knowledge', 'config', 'credentials'));
  mkdirSync(dirname(credentialsPath), { recursive: true, mode: 0o700 });
  const bareAuthority = `http://127.0.0.1:${server.port}${MOUNT}`;
  writeFileSync(
    credentialsPath,
    `${KNOWLEDGE_API_KEY_ENV}=${hostedToken}\n${KNOWLEDGE_API_URL_ENV}=${bareAuthority}\n`,
    { mode: 0o600 },
  );
  chmodSync(credentialsPath, 0o600);
  if (process.platform !== 'win32') expect(statSync(credentialsPath).mode & 0o777).toBe(0o600);

  const initial = scanTree(sandboxRoot);
  expect(initial.errors).toEqual([]);
  baselineTree = initial.entries;
});

afterAll(async () => {
  server?.stop(true);
  await db?.close().catch(() => {});
  if (sandboxRoot) rmSync(sandboxRoot, { recursive: true, force: true });
});

function httpStore(): ItemStore {
  return resolveItemStore({
    storePath: join(sandboxRoot, 'never-used', 'db.json'),
    storePathOverridden: false,
    env: hostedEnv as NodeJS.ProcessEnv,
  });
}

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: sandboxCwd,
    env: { ...hostedEnv, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve(-1);
      }, CHILD_TIMEOUT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (timedOut) throw new Error(`knowledge CLI timed out: ${args.join(' ')}`);
  expect(stdout.includes(hostedToken)).toBe(false);
  expect(stderr.includes(hostedToken)).toBe(false);
  assertSandboxUnchanged();
  return { exitCode, stdout, stderr };
}

async function withMcp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP, '--mcp-profile', 'full'],
    cwd: sandboxCwd,
    stderr: 'pipe',
    env: hostedEnv,
  });
  const stderrChunks: Buffer[] = [];
  transport.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const client = new Client({ name: 'knowledge-hosted-path-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    expect(stderr.includes(hostedToken)).toBe(false);
    assertSandboxUnchanged();
  }
}

function toolJson(result: unknown): { body: Record<string, unknown>; raw: string } {
  const value = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  expect(value.isError).not.toBe(true);
  const textParts = (value.content ?? []).filter((part) => part.type === 'text');
  expect(textParts).toHaveLength(1);
  const raw = textParts[0]?.text ?? '';
  return { body: JSON.parse(raw) as Record<string, unknown>, raw };
}

describe('hosted-path harness controls', () => {
  test('local-artifact detection covers SQLite, JSON, sidecars and arbitrary workspace output', () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-local-artifact-detector-'));
    try {
      const before = scanTree(root);
      for (const name of [
        'knowledge.db',
        'catalog.sqlite',
        'catalog.sqlite3',
        'knowledge.db-wal',
        'knowledge.db-shm',
        'knowledge.db-journal',
        'db.json',
        'events.jsonl',
        'db.json.lock',
        'config.json',
      ]) writeFileSync(join(root, name), 'fixture');
      mkdirSync(join(root, 'artifacts'), { recursive: true });
      const after = scanTree(root);
      expect(after.errors).toEqual([]);
      expect(after.entries.filter((entry) => !before.entries.includes(entry))).toEqual([
        'dir:artifacts',
        'file:catalog.sqlite',
        'file:catalog.sqlite3',
        'file:config.json',
        'file:db.json',
        'file:db.json.lock',
        'file:events.jsonl',
        'file:knowledge.db',
        'file:knowledge.db-journal',
        'file:knowledge.db-shm',
        'file:knowledge.db-wal',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('published bins and the canonical 0600 disk credential select one /knowledge/v1 root', async () => {
    const at = mark();
    const transport = await runCli(['transport', '--json']);
    expect(transport.exitCode).toBe(0);
    const parsed = JSON.parse(transport.stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      transport: 'http',
      source: credentialsPath,
      api_url_source: credentialsPath,
      api_key_source: credentialsPath,
      api_key_tier: 'disk',
      base_url: `http://127.0.0.1:${server.port}${MOUNT}/v1`,
    });
    expectRequests(at, []);
  }, budget(60_000));
});

describe('knowledge CLI — hosted surfaces reach exact /knowledge/v1 routes', () => {
  test('search, compact context, bounded pack, ask and build use only notes/search', async () => {
    const store = httpStore();
    await store.create({
      title: 'Retrieval budget policy',
      content: `${'Context packs are capped at a token budget. '.repeat(80)}RAW_HOSTED_TAIL`,
    });
    await store.create({ title: 'Unrelated note', content: 'Nothing to do with budgets.' });

    const atSearch = mark();
    const search = await runCli(['search', 'budget', '--json', '--detail', 'compact']);
    expect(search.stderr).toBe('');
    expect(search.exitCode).toBe(0);
    const searched = JSON.parse(search.stdout) as { ok: boolean; detail: string; results: Record<string, unknown>[] };
    expect(searched.ok).toBe(true);
    expect(searched.detail).toBe('compact');
    expect(searched.results.length).toBeGreaterThan(0);
    expect(searched.results[0]?.text).toBeUndefined();
    expect(search.stdout.includes('RAW_HOSTED_TAIL')).toBe(false);
    expect(search.stdout.trim().includes('\n')).toBe(false);
    expectRequests(atSearch, [searchRequest('budget')]);

    const atContext = mark();
    const context = await runCli(['search', 'budget', '--context', '--json', '--detail', 'compact']);
    expect(context.exitCode).toBe(0);
    const contextBody = JSON.parse(context.stdout) as { ok: boolean; results: Record<string, unknown>[]; excerpts: Record<string, unknown>[] };
    expect(contextBody.ok).toBe(true);
    expect(contextBody.results[0]?.text).toBeUndefined();
    expect(contextBody.excerpts[0]?.text).toBeUndefined();
    expect(context.stdout.includes('RAW_HOSTED_TAIL')).toBe(false);
    expectRequests(atContext, [searchRequest('budget')]);

    const atPack = mark();
    const pack = await runCli([
      'context', 'pack', 'budget', '--json',
      '--max-tokens', '1000', '--max-bytes', '8192', '--max-items', '2', '--limit', '2',
    ]);
    expect(pack.exitCode).toBe(0);
    const packBody = JSON.parse(pack.stdout) as {
      ok: boolean;
      budgets: {
        estimated_tokens: number;
        max_tokens: number;
        encoded_bytes: number;
        max_bytes: number;
        token_budget_exceeded: boolean;
        byte_budget_exceeded: boolean;
      };
    };
    expect(packBody.ok).toBe(true);
    expect(packBody.budgets.estimated_tokens).toBeLessThanOrEqual(packBody.budgets.max_tokens);
    expect(packBody.budgets.encoded_bytes).toBeLessThanOrEqual(packBody.budgets.max_bytes);
    expect(packBody.budgets.token_budget_exceeded).toBe(false);
    expect(packBody.budgets.byte_budget_exceeded).toBe(false);
    expect(Buffer.byteLength(pack.stdout.trim(), 'utf8')).toBeLessThanOrEqual(8192);
    expectRequests(atPack, [searchRequest('budget', 2)]);

    const prompt = 'what is the retrieval budget';
    const atAsk = mark();
    const ask = await runCli(['ask', prompt, '--json', '--limit', '2']);
    expect(ask.exitCode).toBe(0);
    expect(JSON.parse(ask.stdout)).toMatchObject({ ok: true, generated: false });
    expectRequests(atAsk, [searchRequest(prompt, 2)]);

    const atBuild = mark();
    const build = await runCli(['build', prompt, '--json', '--limit', '2']);
    expect(build.exitCode).toBe(0);
    expectRequests(atBuild, [searchRequest(prompt, 2)]);
  }, budget(180_000));

  test('the semantic half refuses without any HTTP or local-store activity', async () => {
    const at = mark();
    const semantic = await runCli(['search', 'budget', '--semantic', '--json']);
    expect(semantic.exitCode).not.toBe(0);
    expect(semantic.stderr).toContain('semantic_query_unavailable');
    expectRequests(at, []);
  }, budget(60_000));

  test('inventory reports only the API corpus', async () => {
    const at = mark();
    const inventory = await runCli(['inventory', '--json']);
    expect(inventory.exitCode).toBe(0);
    const parsed = JSON.parse(inventory.stdout) as {
      legacy_store: { path: string; total_items: number };
      paths: { knowledge_db_exists: boolean; json_store_exists: boolean };
      items: unknown[];
    };
    expect(parsed.legacy_store.path).toBe(`http://127.0.0.1:${server.port}${MOUNT}/v1`);
    expect(parsed.legacy_store.total_items).toBeGreaterThan(0);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.paths.knowledge_db_exists).toBe(false);
    expect(parsed.paths.json_store_exists).toBe(false);
    expectRequests(at, [
      `GET ${MOUNT}/v1/notes?archive=all&includeArchived=true&limit=200&offset=0`,
    ]);
  }, budget(60_000));

  test('versions, diff and purge cross only the exact version routes', async () => {
    const store = httpStore();
    const created = await store.create({ title: 'Versioned subject', content: 'first body' });
    await store.update(created.id, { content: 'second body' });

    const atVersions = mark();
    const versions = await runCli(['versions', '--id', created.id, '--json']);
    expect(versions.exitCode).toBe(0);
    expect((JSON.parse(versions.stdout) as { total: number }).total).toBe(1);
    expectRequests(atVersions, [
      `GET ${MOUNT}/v1/notes/${created.id}/versions?offset=0`,
    ]);

    const atDiff = mark();
    const diff = await runCli(['diff', '--id', created.id, '--json']);
    expect(diff.exitCode).toBe(0);
    expect((JSON.parse(diff.stdout) as { identical: boolean }).identical).toBe(false);
    expectRequests(atDiff, [
      `GET ${MOUNT}/v1/notes/${created.id}`,
      `GET ${MOUNT}/v1/notes/${created.id}/versions?limit=1`,
      `GET ${MOUNT}/v1/notes/${created.id}/versions/1`,
    ]);

    const atPurge = mark();
    const purge = await runCli(['versions', 'purge', '--id', created.id, '--yes', '--json']);
    expect(purge.exitCode).toBe(0);
    expectRequests(atPurge, [
      `DELETE ${MOUNT}/v1/notes/${created.id}/versions`,
    ]);
  }, budget(180_000));

  test('project-panel resolves the registered project through exact hosted routes', async () => {
    const slug = 'panel-hosted-path-proof';
    const atRegistration = mark();
    const registration = await runCli([
      'project-registration', 'create',
      '--project', slug,
      '--slug', slug,
      '--name', 'Panel project',
      '--operation-id', `op-${slug}`,
      '--step-id', `step-${slug}`,
      '--idempotency-key', `idem-${slug}`,
      '--json',
    ]);
    expect(registration.stderr).toBe('');
    expect(registration.exitCode).toBe(0);
    expectRequests(atRegistration, [
      `GET ${MOUNT}/v1/project-registration/capability`,
      `POST ${MOUNT}/v1/project-registration/create`,
    ]);

    const atPanel = mark();
    const panel = await runCli(['project-panel', '--project', slug, '--json']);
    expect(panel.exitCode).toBe(0);
    expect(JSON.parse(panel.stdout)).toBeTruthy();
    expectRequests(atPanel, [
      `GET ${MOUNT}/v1/projects/${slug}/resources`,
    ]);
  }, budget(180_000));
});

describe('knowledge-mcp — hosted tools reach exact /knowledge/v1 routes', () => {
  test('search, bounded context, item reads and inventory stay hosted', async () => {
    const store = httpStore();
    const item = await store.create({
      title: 'MCP hosted subject',
      content: `${'searchable mcp body '.repeat(80)}RAW_MCP_HOSTED_TAIL`,
    });

    await withMcp(async (client) => {
      const atSearch = mark();
      const okSearch = toolJson(await client.callTool({
        name: 'ok_search',
        arguments: { query: 'searchable', limit: 1 },
      }));
      expect(okSearch.body).toMatchObject({ ok: true, detail: 'compact' });
      expect((okSearch.body.results as Record<string, unknown>[])[0]?.text).toBeUndefined();
      expect(okSearch.raw.includes('RAW_MCP_HOSTED_TAIL')).toBe(false);
      expect(okSearch.raw.includes('\n')).toBe(false);
      expectRequests(atSearch, [searchRequest('searchable', 1)]);

      const atKnowledgeSearch = mark();
      const knowledgeSearch = toolJson(await client.callTool({
        name: 'knowledge_search',
        arguments: { query: 'searchable', limit: 1 },
      }));
      expect(knowledgeSearch.body).toMatchObject({ ok: true, detail: 'compact' });
      expect((knowledgeSearch.body.results as Record<string, unknown>[])[0]?.text).toBeUndefined();
      expect(knowledgeSearch.raw.includes('RAW_MCP_HOSTED_TAIL')).toBe(false);
      expectRequests(atKnowledgeSearch, [searchRequest('searchable', 1)]);

      const atPack = mark();
      const contextPack = toolJson(await client.callTool({
        name: 'knowledge_context_pack',
        arguments: {
          query: 'searchable',
          from: 'search',
          limit: 1,
          max_items: 1,
          max_tokens: 1000,
          max_bytes: 4800,
        },
      }));
      expect(contextPack.body.ok).toBe(true);
      const contextBudgets = contextPack.body.budgets as {
        estimated_tokens: number;
        max_tokens: number;
        encoded_bytes: number;
        max_bytes: number;
        token_budget_exceeded: boolean;
        byte_budget_exceeded: boolean;
      };
      expect(contextBudgets.token_budget_exceeded).toBe(false);
      expect(contextBudgets.byte_budget_exceeded).toBe(false);
      expect(contextBudgets.estimated_tokens).toBeLessThanOrEqual(contextBudgets.max_tokens);
      expect(contextBudgets.encoded_bytes).toBeLessThanOrEqual(contextBudgets.max_bytes);
      expect(Buffer.byteLength(contextPack.raw, 'utf8')).toBeLessThanOrEqual(4800);
      expectRequests(atPack, [searchRequest('searchable', 1)]);

      const atAsk = mark();
      const ask = toolJson(await client.callTool({
        name: 'knowledge_ask',
        arguments: { prompt: 'what is searchable', limit: 1 },
      }));
      expect(ask.body).toMatchObject({ ok: true, generated: false });
      expectRequests(atAsk, [searchRequest('what is searchable', 1)]);

      const atGet = mark();
      const got = toolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'item', id: item.id },
      }));
      expect(got.body.ok).toBe(true);
      expectRequests(atGet, [`GET ${MOUNT}/v1/notes/${item.id}`]);

      // Regression: project scope must resolve HTTP before touching its local
      // workspace. Before this PR, resolveStorePath() called jsonStorePath()
      // first and created config.json plus eight directories on a hosted read.
      const atProjectGet = mark();
      const projectGot = toolJson(await client.callTool({
        name: 'knowledge_get',
        arguments: { kind: 'item', id: item.id, scope: 'project' },
      }));
      expect(projectGot.body.ok).toBe(true);
      expectRequests(atProjectGet, [`GET ${MOUNT}/v1/notes/${item.id}`]);

      const atInventory = mark();
      const inventory = toolJson(await client.callTool({
        name: 'knowledge_inventory',
        arguments: { limit: 20 },
      }));
      expect(inventory.body.ok).toBe(true);
      const inventoryStore = inventory.body.legacy_store as { path: string; total_items: number };
      expect(inventoryStore.path).toBe(`http://127.0.0.1:${server.port}${MOUNT}/v1`);
      expect(inventoryStore.total_items).toBeGreaterThan(0);
      expect((inventory.body.paths as { knowledge_db_exists: boolean }).knowledge_db_exists).toBe(false);
      expectRequests(atInventory, [
        `GET ${MOUNT}/v1/notes?archive=all&includeArchived=true&limit=200&offset=0`,
      ]);

      const atParse = mark();
      const parsed = toolJson(await client.callTool({
        name: 'ok_parse_source_ref',
        arguments: { uri: 'https://example.com/doc.md' },
      }));
      expect(parsed.body.ok).toBe(true);
      expectRequests(atParse, []);
    });
  }, budget(240_000));
});

describe('fail-closed acceptance', () => {
  test('every controlled local root has no new entry beyond the credential fixture', () => {
    assertSandboxUnchanged();
  });
});
