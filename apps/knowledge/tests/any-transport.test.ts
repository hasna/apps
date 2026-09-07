/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ANY-TRANSPORT guarantee (owner directive 2026-08-15): every command must
 * work in ANY transport — hosted API (any API URL + API key) or local
 * (sqlite). These hermetic tests prove the previous transport-conditional
 * blocks are gone:
 *
 *   - the local-catalog guard (`assertSqliteClientTransport`) no longer
 *     refuses catalog commands (db/wiki/reindex/embeddings/sync/safety/web)
 *     when a credential resolves to the HTTP API;
 *   - `--semantic` / `--fake` search and ask degrade over the HTTP item corpus
 *     with a warning instead of throwing `semantic_query_unavailable`;
 *   - `embeddings search` reads the local vector index in every transport;
 *   - `inventory --store <path>` stays an explicit on-box override under HTTP;
 *   - the MCP `knowledge_get` tool reads catalog record kinds from the
 *     machine-local catalog under HTTP (no refusal);
 *   - the `webhooks` command group (shared @hasna/events channels contract)
 *     responds under both transports.
 *
 * All HTTP tests target 127.0.0.1 so the NODE_ENV=test outbound guard stays
 * armed while the loopback requests flow (the positive control that the
 * hermetic API path still works under the guard).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { KNOWLEDGE_BOUNDED_QUERY_CAPABILITY } from '../src/query-contract';
import { createKnowledgeService } from '../src/service';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { projectKnowledgeHome } from '../src/workspace';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP = join(__dirname, '..', 'src', 'mcp.js');
const CLI = join(__dirname, '..', 'src', 'cli.ts');

const now = new Date().toISOString();
const PRODUCER_ITEM = {
  id: 'k_probe',
  short_id: 'probe',
  title: 'Probe doctrine',
  content: 'Probe content for any-transport retrieval.',
  url: null,
  tags: ['probe'],
  metadata: {},
  archived: false,
  created_at: now,
  updated_at: now,
};

interface LoopbackServer {
  port: number;
  stop(closeActiveConnections?: boolean): void;
  requests: URL[];
}

function startLoopbackServer(): LoopbackServer {
  const requests: URL[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      if (url.pathname === '/v1/notes/search') {
        return Response.json({
          items: [{ item: PRODUCER_ITEM, rank: 0.9 }],
          total: 1,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      }
      if (url.pathname === '/v1/notes' && request.method === 'GET') {
        return Response.json({ items: [PRODUCER_ITEM], total: 1 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
  });
  return { port: server.port, stop: () => server.stop(true), requests };
}

const savedEnv: Record<string, string | undefined> = {};
let loopback: LoopbackServer;

beforeAll(() => {
  loopback = startLoopbackServer();
  for (const key of ['NODE_ENV', 'HASNA_KNOWLEDGE_API_URL', 'HASNA_KNOWLEDGE_API_KEY']) {
    savedEnv[key] = process.env[key];
  }
  process.env.NODE_ENV = 'test';
  process.env.HASNA_KNOWLEDGE_API_URL = `http://127.0.0.1:${loopback.port}`;
  process.env.HASNA_KNOWLEDGE_API_KEY = 'fixture-credential';
});

afterAll(() => {
  loopback.stop();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const tempDirs: string[] = [];
function tempHome(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  loopback.requests.length = 0;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.HOME;
  delete process.env.USERPROFILE;
});

function serviceAt(home: string, cwd?: string) {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const service = createKnowledgeService({ scope: 'project', cwd });
  return {
    service,
    restore() {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    },
  };
}

describe('catalog commands run under the HTTP transport (guard removed)', () => {
  test('db init / db stats / wiki / reindex / embeddings / sync doctor / web search all run on the machine-local catalog without contacting the item API', async () => {
    const home = tempHome('any-transport-catalog-');
    const { service, restore } = serviceAt(home);
    try {
      const init = service.initDb();
      expect(init.schema_version).toBeGreaterThan(0);

      const stats = service.dbStats();
      expect(stats.schema_version).toBe(init.schema_version);
      expect(stats.sources).toBe(0);

      const wiki = service.initWiki();

      const wikiLint = service.lintWiki();
      expect(wikiLint.ok).toBe(true);

      const reindex = service.enqueueReindex({ fake: true });
      expect(typeof reindex.enqueued).toBe('number');

      await service.indexEmbeddings({ fake: true });

      const embeddingsSearch = await service.semanticSearch({ query: 'probe', fake: true });
      expect(Array.isArray(embeddingsSearch.results)).toBe(true);

      const doctor = await service.syncDoctor({});
      expect(doctor.ok).toBe(true);
      expect(doctor.database.sqlite_schema_version).toBe(init.schema_version);

      const safety = service.safetyPolicy();
      expect(safety.readOnlySourceAccess).toBe(true);

      const web = await service.webSearch({ query: 'probe', fake: true });
      expect(Array.isArray(web.sources)).toBe(true);
      expect(web.run_id.startsWith('run_')).toBe(true);

      // Catalog operations are machine-local: no item API request was made.
      expect(loopback.requests).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('semantic/fake retrieval degrades over the HTTP item corpus instead of throwing', () => {
  test('search --semantic --fake returns keyword results + semantic_search_requires_local_catalog warning', async () => {
    const home = tempHome('any-transport-search-');
    const { service, restore } = serviceAt(home);
    try {
      const result = await service.search({ query: 'probe', semantic: true, fake: true });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0]!.kind).toBe('legacy_item');
      expect(result.warnings).toContain('semantic_search_requires_local_catalog');
      // The item corpus came from the loopback API.
      expect(loopback.requests.some((url) => url.pathname === '/v1/notes/search')).toBe(true);
    } finally {
      restore();
    }
  });

  test('ask --generate --fake produces a deterministic offline answer over the HTTP item corpus', async () => {
    const home = tempHome('any-transport-ask-');
    const { service, restore } = serviceAt(home);
    try {
      const result = await service.runPrompt({
        prompt: 'Summarize the probe doctrine',
        generate: true,
        fake: true,
      });
      expect(result.generated).toBe(true);
      expect(result.answer.startsWith('Fake generated answer')).toBe(true);
      expect(result.warnings).not.toContain('semantic_query_unavailable');
    } finally {
      restore();
    }
  });

  test('embeddings search reads the local vector index under HTTP (no refusal)', async () => {
    const home = tempHome('any-transport-vec-');
    const { service, restore } = serviceAt(home);
    try {
      service.initDb();
      await service.indexEmbeddings({ fake: true });
      const result = await service.semanticSearch({ query: 'anything', fake: true });
      expect(Array.isArray(result.results)).toBe(true);
      expect(loopback.requests).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('inventory --store stays an explicit on-box override under HTTP', () => {
  test('resolveInventory with storePath reads the on-box store and never calls the item API', async () => {
    const home = tempHome('any-transport-store-');
    const { service, restore } = serviceAt(home);
    try {
      const storePath = join(home, 'override-store.json');
      writeFileSync(storePath, JSON.stringify({
        items: [{
          id: 'k_local_only',
          short_id: 'local',
          title: 'Local only',
          content: 'On-box override',
          url: null,
          tags: [],
          metadata: {},
          archived: false,
          created_at: now,
          updated_at: now,
        }],
        version: 1,
      }));
      const inventory = await service.resolveInventory({ limit: 10, storePath });
      expect(inventory.summary.legacy_items).toBe(1);
      expect(inventory.items[0]!.id).toBe('k_local_only');
      expect(loopback.requests).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('CLI under the HTTP transport', () => {
  function childEnv(home: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.HASNA_KNOWLEDGE_API_URL = `http://127.0.0.1:${loopback.port}`;
    env.HASNA_KNOWLEDGE_API_KEY = 'fixture-credential';
    env.HOME = home;
    env.USERPROFILE = home;
    return env;
  }

  // Async spawn ON PURPOSE: the loopback server lives in this test process, and
  // `spawnSync` blocks the event loop, so the child could never complete the
  // connection to a server the parent cannot run while blocked.
  async function runCli(args: string[], home: string) {
    const proc = Bun.spawn(['bun', CLI, ...args], { env: childEnv(home), stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }

  test('db init + db stats exit 0 with the HTTP transport configured', async () => {
    const home = tempHome('any-transport-cli-');
    const init = await runCli(['db', 'init', '--scope', 'project', '--json'], home);
    expect(init.exitCode).toBe(0);
    const stats = await runCli(['db', 'stats', '--scope', 'project', '--json'], home);
    expect(stats.exitCode).toBe(0);
    const parsed = JSON.parse(stats.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.schema_version).toBeGreaterThan(0);
  });

  test('search --semantic --fake exits 0 with a warning, and wiki init exits 0', async () => {
    const home = tempHome('any-transport-cli2-');
    const init = await runCli(['db', 'init', '--scope', 'project', '--json'], home);
    expect(init.exitCode).toBe(0);
    const search = await runCli(['search', 'probe', '--semantic', '--fake', '--scope', 'project', '--json'], home);
    expect(search.exitCode).toBe(0);
    const parsed = JSON.parse(search.stdout);
    expect(parsed.warnings).toContain('semantic_search_requires_local_catalog');
    const wiki = await runCli(['wiki', 'init', '--scope', 'project', '--json'], home);
    expect(wiki.exitCode).toBe(0);
  });

  test('webhooks add/list/remove work end to end', async () => {
    const home = tempHome('any-transport-webhooks-');
    const add = await runCli(['webhooks', 'add', 'loops', '--id', 'any-transport-probe', '--transport', 'command', '--json'], home);
    expect(add.exitCode).toBe(0);
    const list = await runCli(['webhooks', 'list', '--json'], home);
    expect(list.exitCode).toBe(0);
    const parsed = JSON.parse(list.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((channel: { id: string }) => channel.id === 'any-transport-probe')).toBe(true);
    const remove = await runCli(['webhooks', 'remove', 'any-transport-probe', '--json'], home);
    expect(remove.exitCode).toBe(0);
  });
});

describe('MCP knowledge_get reads catalog record kinds under the HTTP transport', () => {
  test('knowledge_get kind=source returns the local catalog record instead of refusing', async () => {
    const home = tempHome('any-transport-mcp-');
    const dir = mkdtempSync(join(tmpdir(), 'any-transport-mcp-project-'));
    tempDirs.push(dir);
    try {
      // Seed the machine-local catalog exactly as the MCP child will resolve it.
      const dbPath = join(projectKnowledgeHome(dir, home), 'knowledge.db');
      const manifestPath = join(dir, 'manifest.jsonl');
      writeFileSync(manifestPath, `${JSON.stringify({
        source_ref: 'open-files://file/src_probe/revision/rev_probe',
        file_id: 'src_probe',
        path: 'docs/probe.md',
        name: 'probe.md',
        mime: 'text/markdown',
        hash: 'sha256:probe',
        status: 'active',
        permissions: { mode: 'read_only', allowed_purposes: ['knowledge_answer'] },
        extracted_text: 'Probe source text for MCP catalog reads.',
      })}\n`);
      await ingestOpenFilesManifest({ dbPath, input: manifestPath });

      const transport = new StdioClientTransport({
        command: 'bun',
        args: [MCP],
        cwd: dir,
        stderr: 'pipe',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${loopback.port}`,
          HASNA_KNOWLEDGE_API_KEY: 'fixture-credential',
        },
      });
      const client = new Client({ name: 'knowledge-any-transport-test', version: '0.0.0' });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => tool.name === 'knowledge_get')).toBe(true);
        const rawGet = String((await client.callTool({
          name: 'knowledge_get',
          arguments: { kind: 'source', id: 'open-files://file/src_probe', scope: 'project' },
        })).content[0]!.text);
        const get = JSON.parse(rawGet);
        expect(get.ok).toBe(true);
        expect(get.kind).toBe('source');
        expect(get.source.uri).toBe('open-files://file/src_probe');
        expect(get.source.revisions?.[0]?.revision ?? get.revisions?.[0]?.revision).toBe('rev_probe');
      } finally {
        await client.close();
        transport.close();
      }
    } finally {
      // The MCP child is a fresh process per spawn; leftover workspace dirs
      // are cleaned by the outer afterEach.
    }
  });
});