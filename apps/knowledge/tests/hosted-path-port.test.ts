/**
 * PORT-TO-API slice A — every surface whose hosted arm is already wired must
 * PROVE it, as a real process, against a real `/v1` handler.
 *
 * The audit (reports/T1-work/knowledge.md §4) lists these CLI commands and MCP
 * tools as "hosted path present". Present in the source is not evidence: the
 * only thing that distinguishes a ported surface from one that quietly opened
 * `knowledge.db` is a request arriving at the server and no `*.db*` file
 * appearing under the caller's HOME. So this file
 *
 *   1. runs the REAL server (`createServeHandler` over an in-process Postgres
 *      with the real migrations) on loopback,
 *   2. records every request line the handler answers,
 *   3. drives the REAL `knowledge` CLI and the REAL `knowledge-mcp` stdio
 *      server as child processes carrying only a hosted credential, and
 *   4. asserts, per surface, that the `/v1` route was hit — and at the end that
 *      the whole run left no SQLite file anywhere under HOME.
 *
 * `versions`/`diff` semantics are covered in entry-versioning-client.test.ts;
 * what is added here is the transport evidence for the rest of the slice and
 * the shared no-SQLite assertion over one HOME that saw every surface.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PGlite } from '@electric-sql/pglite';
import { createServeHandler } from '../src/serve';
import { resolveItemStore, type ItemStore } from '../src/item-store';
import { createMigratedPglite } from './fixtures/pglite-client';
import { budget } from './support/budget';

const SIGNING = 'test-signing-secret-not-a-real-key';
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const MCP = join(import.meta.dir, '..', 'src', 'mcp.js');

let db: PGlite;
let server: { port: number; stop: (closeActive?: boolean) => void };
let hostedEnv: Record<string, string>;
let home: string;

/** Every request line the real handler answered, in order. */
const requestLog: string[] = [];

/** Request lines recorded since the marker returned by `mark()`. */
function mark(): number {
  return requestLog.length;
}
function since(at: number): string[] {
  return requestLog.slice(at);
}

beforeAll(async () => {
  const created = await createMigratedPglite();
  db = created.db;
  const store = new ApiKeyStore(created.client);
  const verifier = verifyApiKey({
    app: 'knowledge',
    signingSecret: SIGNING,
    keyStatus: () => Promise.resolve('active' as const),
  });
  const handler = createServeHandler({ client: created.client, verifier, store, version: '9.9.9' });
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request: Request, ...rest: unknown[]) => {
      const url = new URL(request.url);
      requestLog.push(`${request.method} ${url.pathname}`);
      return (handler as (req: Request, ...args: unknown[]) => Response | Promise<Response>)(request, ...rest);
    },
  });

  home = mkdtempSync(join(tmpdir(), 'ok-hosted-port-home-'));
  hostedEnv = {
    HOME: home,
    USERPROFILE: home,
    HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_KNOWLEDGE_API_KEY: mintApiKey({
      app: 'knowledge',
      scopes: ['knowledge:read', 'knowledge:write'],
      signingSecret: SIGNING,
      // The project-registration routes scope every record to the principal's
      // tenant, so the credential needs one — a hosted key without `tid` is
      // refused there, which is the behaviour, not a harness detail.
      tid: 'tenant-hosted-port',
    }).token,
  };
});

afterAll(async () => {
  server?.stop(true);
  await db?.close().catch(() => {});
});

function httpStore(): ItemStore {
  return resolveItemStore({
    storePath: join(tmpdir(), 'never-used-db.json'),
    storePathOverridden: false,
    env: hostedEnv as unknown as NodeJS.ProcessEnv,
  });
}

/**
 * Spawn the CLI ASYNCHRONOUSLY. The server under test runs in THIS process, so
 * `Bun.spawnSync` would block the event loop and deadlock the child's request.
 */
async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Drop ambient knowledge configuration: the test decides the backend.
    if (key.includes('KNOWLEDGE') || value === undefined) continue;
    env[key] = value;
  }
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...env, ...hostedEnv, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Run one MCP session against the hosted credential and hand back the client. */
async function withMcp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.includes('KNOWLEDGE') || value === undefined) continue;
    env[key] = value;
  }
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [MCP],
    cwd: home,
    stderr: 'pipe',
    env: { ...env, ...hostedEnv },
  });
  const client = new Client({ name: 'knowledge-hosted-port-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

function toolJson(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.map((part) => part.text ?? '').join('');
  return JSON.parse(text) as Record<string, unknown>;
}

/** Every `*.db*` file anywhere under `dir` — the fail-closed acceptance probe. */
function findDbFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full);
      else if (/\.db($|-)/.test(entry)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe('knowledge CLI — hosted surfaces reach /v1 and never the on-box catalog', () => {
  test('search, search --context, context pack and ask all answer from GET /v1/notes/search', async () => {
    const store = httpStore();
    await store.create({ title: 'Retrieval budget policy', content: 'Context packs are capped at a token budget.' });
    await store.create({ title: 'Unrelated note', content: 'Nothing to do with budgets.' });

    const at = mark();
    const search = await runCli(['search', 'budget', '--json']);
    expect(search.stderr).toBe('');
    expect(search.exitCode).toBe(0);
    const searched = JSON.parse(search.stdout) as { ok: boolean; results: { title?: string }[] };
    expect(searched.ok).toBe(true);
    expect(searched.results.length).toBeGreaterThan(0);
    expect(since(at)).toContain('GET /v1/notes/search');

    // `search --context` is the same producer request re-shaped as excerpts.
    const atContext = mark();
    const context = await runCli(['search', 'budget', '--context', '--json']);
    expect(context.exitCode).toBe(0);
    expect(JSON.parse(context.stdout)).toMatchObject({ ok: true });
    expect(since(atContext)).toContain('GET /v1/notes/search');

    const atPack = mark();
    const pack = await runCli(['context', 'pack', 'budget', '--json']);
    expect(pack.exitCode).toBe(0);
    expect(JSON.parse(pack.stdout)).toMatchObject({ ok: true });
    expect(since(atPack)).toContain('GET /v1/notes/search');

    const atAsk = mark();
    const ask = await runCli(['ask', 'what is the retrieval budget', '--json']);
    expect(ask.exitCode).toBe(0);
    const asked = JSON.parse(ask.stdout) as { ok: boolean; generated?: boolean };
    expect(asked.ok).toBe(true);
    expect(since(atAsk)).toContain('GET /v1/notes/search');

    // `build` is the documented alias of `ask` and must not diverge.
    const atBuild = mark();
    const build = await runCli(['build', 'what is the retrieval budget', '--json']);
    expect(build.exitCode).toBe(0);
    expect(since(atBuild)).toContain('GET /v1/notes/search');
  }, budget(120_000));

  test('the semantic half refuses loudly instead of opening a local index', async () => {
    // The catalog/vector half has no hosted implementation (T1 §4: 53 B-catalog
    // surfaces). Refusing is the correct answer; silently returning an empty
    // ranking, or building an on-box index, are the two failures this pins.
    const at = mark();
    const semantic = await runCli(['search', 'budget', '--semantic', '--json']);
    expect(semantic.exitCode).not.toBe(0);
    expect(semantic.stderr).toContain('semantic_query_unavailable');
    expect(since(at).some((line) => line.includes('/v1/notes/search'))).toBe(false);
  }, budget(60_000));

  test('inventory reports the API corpus and names the API as its store', async () => {
    const at = mark();
    const inventory = await runCli(['inventory', '--json']);
    expect(inventory.exitCode).toBe(0);
    const parsed = JSON.parse(inventory.stdout) as {
      legacy_store: { path: string; total_items: number };
      paths: { knowledge_db_exists: boolean; json_store_exists: boolean };
      items: unknown[];
    };
    // The corpus the hosted inventory counted is the API's, named by its base
    // URL. A `~/.hasna/knowledge/db.json` answer here would mean the handler
    // read the local workspace instead.
    expect(parsed.legacy_store.path.startsWith('http://127.0.0.1:')).toBe(true);
    expect(parsed.legacy_store.total_items).toBeGreaterThan(0);
    expect(parsed.items.length).toBeGreaterThan(0);
    // ...and nothing on box was opened to produce it.
    expect(parsed.paths.knowledge_db_exists).toBe(false);
    expect(parsed.paths.json_store_exists).toBe(false);
    expect(since(at).some((line) => line.startsWith('GET /v1/notes'))).toBe(true);
  }, budget(60_000));

  test('versions, versions purge and diff cross the version routes', async () => {
    const store = httpStore();
    const created = await store.create({ title: 'Versioned subject', content: 'first body' });
    await store.update(created.id, { content: 'second body' });

    const atVersions = mark();
    const versions = await runCli(['versions', '--id', created.id, '--json']);
    expect(versions.exitCode).toBe(0);
    expect((JSON.parse(versions.stdout) as { total: number }).total).toBe(1);
    expect(since(atVersions)).toContain(`GET /v1/notes/${created.id}/versions`);

    const atDiff = mark();
    const diff = await runCli(['diff', '--id', created.id, '--json']);
    expect(diff.exitCode).toBe(0);
    expect((JSON.parse(diff.stdout) as { identical: boolean }).identical).toBe(false);
    expect(since(atDiff).some((line) => line.includes(`/v1/notes/${created.id}/versions`))).toBe(true);

    const atPurge = mark();
    const purge = await runCli(['versions', 'purge', '--id', created.id, '--yes', '--json']);
    expect(purge.exitCode).toBe(0);
    expect(since(atPurge)).toContain(`DELETE /v1/notes/${created.id}/versions`);
  }, budget(120_000));

  test('project-panel resolves the registered project over the hosted project routes', async () => {
    const slug = `panel-${Date.now()}`;
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

    const at = mark();
    const panel = await runCli(['project-panel', '--project', slug, '--json']);
    expect(panel.exitCode).toBe(0);
    expect(JSON.parse(panel.stdout)).toBeTruthy();
    // The panel must be built from the hosted resource listing, not from the
    // cwd-derived legacy inventory (allowLegacyFallback is false over HTTP).
    expect(since(at).some((line) => line.includes('/v1/projects/'))).toBe(true);
  }, budget(120_000));
});

describe('knowledge-mcp — hosted tool bodies reach /v1', () => {
  test('the hosted item/search/inventory tools all answer from the API', async () => {
    const store = httpStore();
    const item = await store.create({ title: 'MCP hosted subject', content: 'searchable mcp body' });

    await withMcp(async (client) => {
      const atSearch = mark();
      const okSearch = toolJson(await client.callTool({ name: 'ok_search', arguments: { query: 'searchable' } }));
      expect(okSearch.ok).toBe(true);
      expect(since(atSearch)).toContain('GET /v1/notes/search');

      const atKnowledgeSearch = mark();
      const knowledgeSearch = toolJson(await client.callTool({ name: 'knowledge_search', arguments: { query: 'searchable' } }));
      expect(knowledgeSearch.ok).toBe(true);
      expect(since(atKnowledgeSearch)).toContain('GET /v1/notes/search');

      const atPack = mark();
      const contextPack = toolJson(await client.callTool({ name: 'knowledge_context_pack', arguments: { query: 'searchable' } }));
      expect(contextPack.ok).toBe(true);
      expect(since(atPack)).toContain('GET /v1/notes/search');

      const atAsk = mark();
      const ask = toolJson(await client.callTool({ name: 'knowledge_ask', arguments: { prompt: 'what is searchable' } }));
      expect(ask.ok).toBe(true);
      expect(since(atAsk)).toContain('GET /v1/notes/search');

      const atGet = mark();
      const got = toolJson(await client.callTool({ name: 'knowledge_get', arguments: { kind: 'item', id: item.id } }));
      expect(got.ok).toBe(true);
      expect(since(atGet).some((line) => line.startsWith('GET /v1/notes'))).toBe(true);

      const atInventory = mark();
      const inventory = toolJson(await client.callTool({ name: 'knowledge_inventory', arguments: {} }));
      expect(inventory.ok).toBe(true);
      // The counted corpus is the API's (mcp.js:811 passes no store_path under
      // HTTP), and no on-box store was opened to produce it.
      const inventoryStore = inventory.legacy_store as { path: string; total_items: number };
      expect(inventoryStore.path.startsWith('http://127.0.0.1:')).toBe(true);
      expect(inventoryStore.total_items).toBeGreaterThan(0);
      expect((inventory.paths as { knowledge_db_exists: boolean }).knowledge_db_exists).toBe(false);
      expect(since(atInventory).some((line) => line.startsWith('GET /v1/notes'))).toBe(true);

      // ok_parse_source_ref is transport-independent: it must answer without
      // touching any store at all, hosted or local.
      const atParse = mark();
      const parsed = toolJson(await client.callTool({
        name: 'ok_parse_source_ref',
        arguments: { uri: 'https://example.com/doc.md' },
      }));
      expect(parsed.ok).toBe(true);
      expect(since(atParse)).toEqual([]);
    });
  }, budget(180_000));
});

describe('fail-closed acceptance', () => {
  test('the whole hosted run left no SQLite file under HOME', () => {
    // Every CLI command and MCP tool above ran with HOME set to this directory.
    // One `knowledge.db` here would mean a "hosted" surface opened the on-box
    // catalog behind the credential.
    expect(findDbFiles(home)).toEqual([]);
  });
});
