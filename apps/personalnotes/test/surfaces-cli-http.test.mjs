// CLI + MCP route through the HTTP API when HASNA_NOTES_API_URL is configured.
// Boots a real server on one data root, then drives the CLI (and MCP) with a DIFFERENT
// local root — proving the writes land on the SERVER, not the client's filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli', 'hasna-notes.mjs');
const mcpPath = join(repoRoot, 'mcp', 'hasna-notes-mcp.mjs');

function run(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (env.__stdin) {
      child.stdin.write(env.__stdin);
    }
    child.stdin.end();
  });
}

async function boot(t) {
  const serverRoot = await mkdtemp(join(tmpdir(), 'pn-http-srv-'));
  const clientRoot = await mkdtemp(join(tmpdir(), 'pn-http-cli-'));
  const prev = process.env.HASNA_NOTES_ROOT;
  process.env.HASNA_NOTES_ROOT = serverRoot;
  const server = startServer({ port: 0, version: '0.0.0' });
  const baseUrl = `http://${server.hostname}:${server.port}`;
  t.after(async () => {
    server.stop(true);
    if (prev === undefined) delete process.env.HASNA_NOTES_ROOT;
    else process.env.HASNA_NOTES_ROOT = prev;
    await rm(serverRoot, { recursive: true, force: true });
    await rm(clientRoot, { recursive: true, force: true });
  });
  // Client env points at the API and at an EMPTY, isolated local root.
  const clientEnv = { HASNA_NOTES_API_URL: baseUrl, HASNA_NOTES_ROOT: clientRoot };
  return { serverRoot, clientRoot, baseUrl, clientEnv };
}

test('CLI create/list/get roundtrip goes through the API', async (t) => {
  const { serverRoot, clientRoot, clientEnv } = await boot(t);

  const created = await run(cliPath, ['create', '--title', 'Via API', '--body', 'from cli', '--json'], clientEnv);
  assert.equal(created.code, 0, created.stderr);
  const note = JSON.parse(created.stdout);
  assert.ok(note.id);

  // The note landed on the SERVER root, not the client's local root.
  const serverFiles = await readdir(join(serverRoot, 'notes'));
  assert.equal(serverFiles.filter((f) => f.endsWith('.md')).length, 1, 'server persisted the note');
  assert.ok(!existsSync(join(clientRoot, 'notes')), 'client did not write locally');

  // list via API sees it
  const listed = await run(cliPath, ['list', '--json'], clientEnv);
  assert.equal(listed.code, 0, listed.stderr);
  const page = JSON.parse(listed.stdout);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, note.id);

  // get via API
  const got = await run(cliPath, ['get', note.id, '--json'], clientEnv);
  assert.equal(got.code, 0, got.stderr);
  assert.equal(JSON.parse(got.stdout).title, 'Via API');
});

function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return `Content-Length: ${body.length}\r\n\r\n${body.toString('utf8')}`;
}

test('MCP list tool routes through the API', async (t) => {
  const { clientEnv } = await boot(t);

  // seed one note via the CLI (also through the API)
  const seed = await run(cliPath, ['create', '--title', 'Seed', '--json'], clientEnv);
  assert.equal(seed.code, 0, seed.stderr);

  // MCP speaks JSON-RPC over stdio with LSP-style Content-Length framing.
  const rpc = frame({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'notes_list', arguments: { limit: 5 } } });
  const res = await run(mcpPath, [], { ...clientEnv, __stdin: rpc });
  assert.equal(res.code, 0, res.stderr);
  // The framed response payload should reference the seeded note title.
  assert.match(res.stdout, /Seed/, `MCP output: ${res.stdout}\n${res.stderr}`);
});
