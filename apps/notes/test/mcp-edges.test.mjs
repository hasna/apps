// mcp/notes-mcp.mjs edge tests — agent-authored (SOL consult refused: fleet
// ChatGPT codex lane at capacity; see the task receipt).
//
// The functional suite proves the MCP happy paths and framing; this file pins
// the destructive-action gate (every destructive tool previews unless
// confirm:true) and the fail-loud error paths (missing args, unknown tools,
// locked titles, purge gates) over real stdio framing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveNote, getNote } from '../tools/notes-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mcpPath = join(repoRoot, 'mcp', 'notes-mcp.mjs');
const uuidFor = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

class McpClient {
  constructor(env) {
    this.child = spawn(process.execPath, [mcpPath], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  close() {
    this.child.kill();
  }

  send(id, method, params) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
    this.child.stdin.write(body);
    this.child.stdin.write('\n');
    return new Promise((resolve) => { this.waiters.push(resolve); this.drain(); });
  }

  drain() {
    while (this.waiters.length) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) return;
      const line = this.buffer.subarray(0, nl).toString('utf8').trim();
      this.buffer = this.buffer.subarray(nl + 1);
      if (!line) continue;
      this.waiters.shift()(JSON.parse(line));
    }
  }
}

function parseToolText(response) {
  return JSON.parse(response.result.content[0].text);
}

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'notes-mcp-edges-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

async function createNote(client, nextId, { title = 'Gate note', body = 'body' } = {}) {
  const res = await client.send(nextId, 'tools/call', {
    name: 'notes_create',
    arguments: { title, body },
  });
  assert.ok(res.result, JSON.stringify(res));
  return parseToolText(res);
}

test('MCP: destructive tools return a confirmation preview instead of mutating, until confirm:true', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());
  const init = await client.send(1, 'initialize', {});
  assert.equal(init.result.serverInfo.name, 'notes');

  const note = await createNote(client, 2);

  // notes_delete without confirm -> preview only, note survives.
  const preview = parseToolText(await client.send(3, 'tools/call', {
    name: 'notes_delete', arguments: { id: note.id },
  }));
  assert.equal(preview.ok, false);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.approval.toolName, 'notes_delete');
  assert.equal(preview.preview.permanent, false);
  assert.equal(preview.preview.toStatus, 'trash');
  assert.equal((await getNote(note.id, root)).status, 'active', 'preview must not mutate');

  // notes_delete permanent without confirm -> permanent preview, still alive.
  const permanentPreview = parseToolText(await client.send(4, 'tools/call', {
    name: 'notes_delete', arguments: { id: note.id, permanent: true },
  }));
  assert.equal(permanentPreview.preview.permanent, true);
  assert.equal((await getNote(note.id, root)).status, 'active');

  // notes_delete permanent + confirm -> really deleted.
  const deleted = parseToolText(await client.send(5, 'tools/call', {
    name: 'notes_delete', arguments: { id: note.id, permanent: true, confirm: true },
  }));
  assert.equal(deleted.ok, true);
  assert.equal(await getNote(note.id, root), null);
});

test('MCP: notes_trash previews unless confirmed; trash_cleanup previews its count then purges', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());
  await client.send(1, 'initialize', {});

  const note = await createNote(client, 2);

  const trashPreview = parseToolText(await client.send(3, 'tools/call', {
    name: 'notes_trash', arguments: { id: note.id },
  }));
  assert.equal(trashPreview.requiresConfirmation, true);
  assert.equal(trashPreview.preview.toStatus, 'trash');
  assert.equal((await getNote(note.id, root)).status, 'active');

  const trashed = parseToolText(await client.send(4, 'tools/call', {
    name: 'notes_trash', arguments: { id: note.id, confirm: true },
  }));
  assert.equal(trashed.status, 'trash');

  // An expired trash note: cleanup previews unless confirmed.
  await saveNote({
    id: uuidFor(1), title: 'Expired', body: '', labels: [], status: 'trash',
    trashedAt: '2025-01-01T00:00:00Z', trashExpiresAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
  }, root);

  const cleanupPreview = parseToolText(await client.send(5, 'tools/call', { name: 'trash_cleanup', arguments: {} }));
  assert.equal(cleanupPreview.requiresConfirmation, true);
  assert.equal(cleanupPreview.preview.count, 1);
  assert.equal((await getNote(uuidFor(1), root)).status, 'trash', 'unconfirmed cleanup must not purge');

  const cleaned = parseToolText(await client.send(6, 'tools/call', { name: 'trash_cleanup', arguments: { confirm: true } }));
  assert.equal(cleaned.count, 1);
  assert.equal(await getNote(uuidFor(1), root), null);
});

test('MCP: notes_purge requires confirmation and then hard-deletes', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());
  await client.send(1, 'initialize', {});
  const note = await createNote(client, 2);

  const preview = parseToolText(await client.send(3, 'tools/call', { name: 'notes_purge', arguments: { id: note.id } }));
  assert.equal(preview.preview.permanent, true);
  assert.equal((await getNote(note.id, root)).title, 'Gate note');

  const purged = parseToolText(await client.send(4, 'tools/call', { name: 'notes_purge', arguments: { id: note.id, confirm: true } }));
  assert.equal(purged.ok, true);
  assert.equal(purged.permanent, true);
  assert.equal(await getNote(note.id, root), null);
});

test('MCP: missing and unknown inputs fail loud as isError results, never silently', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());
  await client.send(1, 'initialize', {});

  const noId = await client.send(2, 'tools/call', { name: 'notes_get', arguments: {} });
  assert.equal(noId.result.isError, true);
  assert.match(noId.result.content[0].text, /id_required/);

  const missing = await client.send(3, 'tools/call', { name: 'notes_get', arguments: { id: uuidFor(99) } });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /note_not_found/);

  const unknown = await client.send(4, 'tools/call', { name: 'not_a_tool', arguments: {} });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /unknown_tool/);

  const noDays = await client.send(5, 'tools/call', { name: 'settings_set_trash_retention', arguments: {} });
  assert.equal(noDays.result.isError, true);
  assert.match(noDays.result.content[0].text, /days_required/);

  const badMethod = await client.send(6, 'nonsense/method', {});
  assert.equal(badMethod.error.code, -32601);
});

test('MCP: title_generate apply refuses without an id and refuses locked titles unless force', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());
  await client.send(1, 'initialize', {});

  const noId = await client.send(2, 'tools/call', { name: 'title_generate', arguments: { text: 'x', apply: true } });
  assert.equal(noId.result.isError, true);
  assert.match(noId.result.content[0].text, /id_required_for_apply/);

  // notes_create locks manual titles.
  const note = await createNote(client, 3, { title: 'Locked Title' });
  const locked = await client.send(4, 'tools/call', { name: 'title_generate', arguments: { id: note.id, apply: true } });
  assert.equal(locked.result.isError, true);
  assert.match(locked.result.content[0].text, /title_locked/);
  assert.equal((await getNote(note.id, root)).title, 'Locked Title', 'a refused apply must not mutate');

  const forced = parseToolText(await client.send(5, 'tools/call', { name: 'title_generate', arguments: { id: note.id, apply: true, force: true } }));
  assert.equal(forced.applied, true);
  assert.ok(forced.title.length > 0);
  assert.notEqual((await getNote(note.id, root)).title, 'Locked Title');
});
