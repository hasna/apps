import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const mcpPath = join(repoRoot, 'mcp', 'notes-mcp.mjs');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of ['HASNA_NOTES_API_URL', 'HASNA_NOTES_API_KEY', 'HASNA_NOTES_DATABASE_URL']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

class McpClient {
  constructor(extra = {}) {
    this.child = spawn(process.execPath, [mcpPath], {
      cwd: repoRoot,
      env: cleanEnv({
        HASNA_NOTES_API_URL: 'https://notes.example.test',
        HASNA_NOTES_API_KEY: 'fixture-key',
        ...extra,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.waiters = [];
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => { this.buffer += chunk; this.drain(); });
  }

  close() { this.child.kill(); }

  send(id, method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve) => { this.waiters.push(resolve); this.drain(); });
  }

  drain() {
    while (this.waiters.length) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.waiters.shift()(JSON.parse(line));
    }
  }
}

test('MCP fails closed before stdio when HTTPS client configuration is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'notes-mcp-closed-'));
  try {
    const result = spawnSync(process.execPath, [mcpPath], {
      env: cleanEnv({ HOME: home, HASNA_DATA_HOME: join(home, 'xdg') }),
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HASNA_NOTES_API_URL/);
    assert.equal(existsSync(join(home, '.hasna')), false);
    assert.equal(existsSync(join(home, 'xdg')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('MCP rejects a client DSN without printing it', () => {
  const dsn = 'postgres://user:secret@example.test/notes';
  const result = spawnSync(process.execPath, [mcpPath], {
    env: cleanEnv({
      HASNA_NOTES_API_URL: 'https://notes.example.test',
      HASNA_NOTES_API_KEY: 'fixture-key',
      HASNA_NOTES_DATABASE_URL: dsn,
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /server-only/);
  assert.doesNotMatch(result.stderr, /secret|postgres:\/\//);
});

test('MCP initializes and exposes only remote-safe tools', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const initialized = await client.send(1, 'initialize');
  assert.equal(initialized.result.serverInfo.name, 'notes');
  const listed = await client.send(2, 'tools/list');
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'notes_list', 'notes_get', 'notes_create', 'notes_update', 'notes_delete',
    'notes_archive', 'notes_restore', 'labels_list', 'labels_assign',
    'labels_unassign', 'markdown_commands', 'markdown_render',
    'markdown_plain_text', 'markdown_apply_command',
  ]);
  for (const forbidden of ['notes_purge', 'trash_cleanup', 'settings_set_trash_retention', 'agent_run']) {
    assert.equal(names.includes(forbidden), false);
  }
});

test('MCP pure helpers work and invalid inputs fail loud without network access', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  await client.send(1, 'initialize');
  const commands = await client.send(2, 'tools/call', { name: 'markdown_commands', arguments: {} });
  assert.equal(commands.result.isError, undefined);
  assert.match(commands.result.content[0].text, /bold/);

  const missing = await client.send(3, 'tools/call', { name: 'notes_get', arguments: {} });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /id_required/);

  const unknown = await client.send(4, 'tools/call', { name: 'not_a_tool', arguments: {} });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /unknown_tool/);

  const method = await client.send(5, 'nonsense/method');
  assert.equal(method.error.code, -32601);
});
