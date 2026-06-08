import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp.js';
import {
  DEFAULT_MCP_HTTP_PORT,
  isHttpMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
} from '../src/mcp-http.js';

const storePath = join(mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-')), 'db.json');

describe('knowledge MCP HTTP transport', () => {
  test('defaults port to 8819', () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8819);
    expect(resolveMcpHttpPort(['node'], {})).toBe(8819);
    expect(resolveMcpHttpPort(['node', '--port', '9001'], {})).toBe(9001);
    expect(resolveMcpHttpPort(['node'], { MCP_HTTP_PORT: '9002' })).toBe(9002);
  });

  test('isHttpMode detects flag and env', () => {
    expect(isHttpMode(['node'], {})).toBe(false);
    expect(isHttpMode(['node', '--http'], {})).toBe(true);
    expect(isHttpMode(['node'], { MCP_HTTP: '1' })).toBe(true);
  });
});

describe('knowledge buildServer stdio registration', () => {
  test('registers tools over in-memory transport', async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'ok_stats')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'knowledge_build')).toBe(true);

    const resources = await client.listResources();
    expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/config')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'knowledge://project/runs')).toBe(true);

    await client.close();
    await server.close();
  });
});

describe('knowledge streamable HTTP server', () => {
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;

  beforeAll(async () => {
    handle = await startMcpHttpServer(buildServer, { port: 0 });
  });

  afterAll(async () => {
    await handle.close();
  });

  test('GET /health returns ok', async () => {
    const res = await fetch(`http://${handle.host}:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', name: 'knowledge' });
  });

  test('initialize and call ok_stats over streamable HTTP', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);

    const result = await client.callTool({ name: 'ok_stats', arguments: { store_path: storePath } });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    await client.close();
  });

  test('serves three concurrent clients from one process', async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://${handle.host}:${handle.port}/mcp`),
        );
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(transport);
        const tools = await client.listTools();
        return { client, count: tools.tools.length };
      }),
    );

    expect(clients.every((entry) => entry.count > 0)).toBe(true);
    await Promise.all(clients.map((entry) => entry.client.close()));
  });
});
