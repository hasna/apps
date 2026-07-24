import { afterEach, describe, expect, test } from 'bun:test';
import { request } from 'node:http';
import { connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_MCP_HTTP_BODY_BYTES,
  readBoundedMcpJsonBody,
  startMcpHttpServer,
} from '../src/mcp-http.js';
import { buildServer } from '../src/mcp.js';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');

async function waitForListening(process: ReturnType<typeof Bun.spawn>): Promise<{
  port: number;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  stderr: string;
}> {
  const reader = (process.stderr as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let stderr = '';
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP launcher did not listen:\n${stderr}`)), 5_000);
    timer.unref?.();
  });
  for (;;) {
    const result = await Promise.race([reader.read(), timeout]);
    if (result.done) throw new Error(`MCP launcher exited before listening:\n${stderr}`);
    stderr += decoder.decode(result.value, { stream: true });
    const matched = /listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/i.exec(stderr);
    if (matched) return { port: Number(matched[1]), reader, stderr };
  }
}

let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (closeServer) await closeServer();
  closeServer = undefined;
});

function initializeBody(clientName = 'pair-11-http'): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    },
  });
}

async function mcpPayload(response: Response): Promise<any> {
  const text = await response.text();
  const data = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice('data: '.length) : text);
}

function rawPost(
  port: number,
  chunks: readonly (string | Buffer)[],
  headers: Record<string, string | number> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
    }, (res) => {
      const output: Buffer[] = [];
      res.on('data', (chunk) => output.push(Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(output).toString('utf8'),
      }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

function rawSocketRequest(port: number, requestText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('connect', () => socket.write(requestText));
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

describe('knowledge MCP HTTP local Stage-A authority', () => {
  test('serves the real local MCP handler and validates malformed methods and JSON before construction', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-local-'));
    const env = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };
    let buildCalls = 0;
    try {
      const handle = await startMcpHttpServer(() => {
        buildCalls += 1;
        return buildServer({ surface: 'mcp-http', cwd, env, scope: 'project' });
      }, { port: 0, host: '127.0.0.1', env, cwd, scope: 'project' });
      closeServer = handle.close;
      const baseUrl = `http://${handle.host}:${handle.port}`;

      expect(await (await fetch(`${baseUrl}/health`)).json()).toEqual({ status: 'ok', name: 'knowledge' });
      expect(await (await fetch(`${baseUrl}/ready`)).json()).toEqual({ status: 'ready', name: 'knowledge' });

      const method = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
      expect(method.status).toBe(405);
      const malformed = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad-json',
      });
      expect(malformed.status).toBe(400);
      const misleadingContentType = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/jsonp' },
        body: '{}',
      });
      expect(misleadingContentType.status).toBe(415);
      expect(buildCalls).toBe(0);

      const body = initializeBody();
      const valid = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body,
      });
      expect(valid.status).toBe(200);
      expect(await mcpPayload(valid)).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'knowledge' } },
      });
      expect(buildCalls).toBe(1);
    } finally {
      if (closeServer) await closeServer();
      closeServer = undefined;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('rejects hosted authority before listener or MCP construction', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-hosted-'));
    let buildCalls = 0;
    try {
      await expect(startMcpHttpServer(() => {
        buildCalls += 1;
        return buildServer();
      }, {
        port: 0,
        host: '127.0.0.1',
        env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
        cwd,
      })).rejects.toMatchObject({ code: 'KNOWLEDGE_HOSTED_CONTAINED', status: 503 });
      expect(buildCalls).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('enforces exact byte boundaries including multibyte JSON and rejects missing/chunked length', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-bounds-'));
    const env = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };
    const body = initializeBody('multibyte-λ');
    const bodyBytes = Buffer.byteLength(body);
    try {
      const handle = await startMcpHttpServer(
        () => buildServer({ surface: 'mcp-http', cwd, env, scope: 'project' }),
        {
          port: 0,
          host: '127.0.0.1',
          env,
          cwd,
          maxBodyBytes: bodyBytes,
        },
      );
      closeServer = handle.close;
      const exact = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
      });
      expect(exact.status).toBe(200);

      await closeServer();
      closeServer = undefined;
      const strict = await startMcpHttpServer(
        () => { throw new Error('oversized body reached MCP construction'); },
        { port: 0, host: '127.0.0.1', env, cwd, maxBodyBytes: bodyBytes - 1 },
      );
      closeServer = strict.close;
      const offByOne = await fetch(`http://${strict.host}:${strict.port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(offByOne.status).toBe(413);
      expect(await offByOne.json()).toMatchObject({
        error: { data: { code: 'MCP_HTTP_BODY_TOO_LARGE' } },
      });

      const chunked = await rawPost(strict.port, ['{', '}']);
      expect(chunked.status).toBe(400);
      expect(JSON.parse(chunked.body)).toMatchObject({
        error: { data: { code: 'MCP_HTTP_TRANSFER_ENCODING_REJECTED' } },
      });
      const missing = await rawSocketRequest(
        strict.port,
        'POST /mcp HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n\r\n{}',
      );
      expect(missing).toContain('411 Length Required');
      expect(missing).toContain('MCP_HTTP_LENGTH_REQUIRED');
      expect(MAX_MCP_HTTP_BODY_BYTES).toBe(1_048_576);
    } finally {
      if (closeServer) await closeServer();
      closeServer = undefined;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('bounds streaming chunk count and elapsed body time before concatenation or MCP construction', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-stream-bounds-'));
    const env = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };
    let buildCalls = 0;
    try {
      const fake = new EventEmitter() as EventEmitter & {
        rawHeaders: string[];
        headers: Record<string, string>;
        complete: boolean;
        pause(): void;
      };
      fake.rawHeaders = ['Content-Type', 'application/json', 'Content-Length', '7'];
      fake.headers = { 'content-type': 'application/json' };
      fake.complete = true;
      fake.pause = () => undefined;
      const bounded = readBoundedMcpJsonBody(fake, { maxChunks: 2, timeoutMs: 1_000 });
      fake.emit('data', Buffer.from('{'));
      fake.emit('data', Buffer.from('"x"'));
      fake.emit('data', Buffer.from(':1}'));
      await expect(bounded).rejects.toMatchObject({ status: 413, code: 'MCP_HTTP_TOO_MANY_CHUNKS' });

      const mismatched = new EventEmitter() as typeof fake;
      mismatched.rawHeaders = ['Content-Type', 'application/json', 'Content-Length', '7'];
      mismatched.headers = { 'content-type': 'application/json' };
      mismatched.complete = true;
      mismatched.pause = () => undefined;
      const lyingLength = readBoundedMcpJsonBody(mismatched, { timeoutMs: 1_000 });
      mismatched.emit('data', Buffer.from('{}'));
      mismatched.emit('end');
      await expect(lyingLength).rejects.toMatchObject({ status: 400, code: 'MCP_HTTP_LENGTH_MISMATCH' });

      expect(() => readBoundedMcpJsonBody(fake, { maxBytes: MAX_MCP_HTTP_BODY_BYTES + 1 }))
        .toThrow(/maxBytes.*no greater/i);

      const slow = new EventEmitter() as typeof fake;
      slow.rawHeaders = ['Content-Type', 'application/json', 'Content-Length', '100'];
      slow.headers = { 'content-type': 'application/json' };
      slow.complete = false;
      slow.pause = () => undefined;
      const timedOut = readBoundedMcpJsonBody(slow, { timeoutMs: 10 });
      slow.emit('data', Buffer.from('{'));
      await expect(timedOut).rejects.toMatchObject({ status: 408, code: 'MCP_HTTP_BODY_TIMEOUT' });
      expect(buildCalls).toBe(0);
    } finally {
      if (closeServer) await closeServer();
      closeServer = undefined;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('source and built launchers serve valid MCP, reject malformed requests, and deny hosted authority before listening', async () => {
    for (const entry of [
      join(repositoryRoot, 'src', 'mcp-entry.js'),
      join(repositoryRoot, 'bin', 'knowledge-mcp.js'),
    ]) {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-launcher-'));
      const home = join(fixture, 'home');
      mkdirSync(home);
      const env = sanitizedLocalTestEnv({
        HOME: home,
        USERPROFILE: home,
        HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
        BUN_CONFIG_INSTALL_AUTO: 'disable',
      });
      const process = Bun.spawn(['bun', entry, '--http', '--port', '0'], {
        cwd: fixture,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const listening = await waitForListening(process);
        reader = listening.reader;
        const baseUrl = `http://127.0.0.1:${listening.port}`;
        expect((await fetch(`${baseUrl}/mcp`, { method: 'GET' })).status).toBe(405);
        expect((await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{malformed',
        })).status).toBe(400);
        const valid = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: initializeBody(entry.endsWith('mcp-entry.js') ? 'source-launcher' : 'built-launcher'),
        });
        expect(valid.status).toBe(200);
        expect(await mcpPayload(valid)).toMatchObject({ result: { serverInfo: { name: 'knowledge' } } });
        expect(existsSync(join(fixture, '.hasna'))).toBe(false);
        expect(existsSync(join(home, '.hasna'))).toBe(false);
      } finally {
        process.kill('SIGTERM');
        await process.exited;
        await reader?.cancel().catch(() => undefined);
        rmSync(fixture, { recursive: true, force: true });
      }

      const hostedFixture = mkdtempSync(join(tmpdir(), 'knowledge-mcp-http-hosted-launcher-'));
      const hostedHome = join(hostedFixture, 'home');
      mkdirSync(hostedHome);
      try {
        const denied = Bun.spawnSync(['bun', entry, '--http', '--port', '0'], {
          cwd: hostedFixture,
          env: sanitizedLocalTestEnv({
            HOME: hostedHome,
            USERPROFILE: hostedHome,
            HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted',
            BUN_CONFIG_INSTALL_AUTO: 'disable',
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const stderr = new TextDecoder().decode(denied.stderr);
        expect(denied.exitCode).toBe(1);
        expect(stderr).toContain('KNOWLEDGE_HOSTED_CONTAINED');
        expect(stderr).not.toMatch(/listening on/i);
        expect(existsSync(join(hostedFixture, '.hasna'))).toBe(false);
        expect(existsSync(join(hostedHome, '.hasna'))).toBe(false);
      } finally {
        rmSync(hostedFixture, { recursive: true, force: true });
      }
    }
  });
});
