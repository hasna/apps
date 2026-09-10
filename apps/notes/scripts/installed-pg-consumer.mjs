// Copied outside the producer checkout. Every application import is installed.
import assert from 'node:assert/strict';
import { readFile, realpath, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { NotesClient } from '@hasna/notes/sdk';

const sdkOnly = process.argv.includes('--sdk-only');
assert(sdkOnly || process.platform === 'linux', 'Full CLI/MCP acceptance requires Linux without a machine Keychain');
const cwd = await realpath(process.cwd());
const packageDir = await realpath(join(cwd, 'node_modules/@hasna/notes'));
assert.equal(relative(cwd, packageDir), 'node_modules/@hasna/notes');
assert.equal(relative(packageDir, await realpath(fileURLToPath(import.meta.resolve('@hasna/notes/sdk')))), 'sdk/index.mjs');
const metadata = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
assert.equal(metadata.version, process.env.QA_NOTES_VERSION);
const databaseUrl = process.env.QA_NOTES_DATABASE_URL;
delete process.env.QA_NOTES_DATABASE_URL;
const url = new URL(databaseUrl);
assert(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1'
  && Number(url.port) > 1024 && url.username === 'postgres' && url.pathname === '/notes_installed_ci'
  && !url.password && !url.search && !url.hash, 'Owned test database required');

const { openPgAdapter } = await import(join(packageDir, 'server/pg-adapter.mjs'));
const { notesPgMigrations } = await import(join(packageDir, 'server/pg-migrations.ts'));
const { MigrationLedger } = await import(join(packageDir, 'src/generated/storage-kit/index.js'));
const { createApp, resolveConfig } = await import(join(packageDir, 'server/app.mjs'));
const db = openPgAdapter({ connectionString: databaseUrl, applicationName: 'notes-installed-acceptance' });
const children = new Set();
let server;
const groups = [], requestCounts = {};
const actualFetch = globalThis.fetch;

// Application output is bounded and never included in failures: it may contain
// an OTP or reflected key. Reports contain group names and request counts only.
function child(binary, args, env) {
  const process = spawn(globalThis.process.execPath, ['--no-env-file', '--preload', join(cwd, 'network-guard.mjs'), binary, ...args],
    { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(process);
  const closed = new Promise(resolve => process.once('close', (code, signal) => { children.delete(process); resolve({ code, signal }); }));
  process.on('error', () => {});
  return { process, closed };
}
async function close(owned) {
  if (!children.has(owned.process)) return owned.closed;
  owned.process.stdin.end();
  const timer = setTimeout(() => owned.process.kill('SIGKILL'), 1000);
  try { return await owned.closed; } finally { clearTimeout(timer); }
}
async function cli(args, env, expected = 0) {
  const owned = child(join(packageDir, metadata.bin.notes), args, env);
  let stdout = '', total = 0, overflow = false, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; owned.process.kill('SIGKILL'); }, 10000);
  for (const [stream, save] of [[owned.process.stdout, true], [owned.process.stderr, false]]) stream.on('data', chunk => {
    total += chunk.length;
    if (total > 65536) { overflow = true; owned.process.kill('SIGKILL'); }
    else if (save) stdout += chunk.toString();
  });
  owned.process.stdin.end();
  try {
    const result = await owned.closed;
    assert(!overflow && !timedOut, 'CLI exceeded output/time bound');
    if (expected === 0) assert.equal(result.code, 0, 'CLI failed');
    else assert(result.code !== null && result.code !== 0, 'CLI refusal unexpectedly succeeded');
    return expected === 0 ? JSON.parse(stdout) : null;
  } finally { clearTimeout(timer); await close(owned); }
}
async function mcp(env) {
  const owned = child(join(packageDir, metadata.bin['notes-mcp']), [], env);
  let nextId = 1, bytes = 0, buffer = '', failed = false;
  const pending = new Map();
  const fail = () => {
    failed = true;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('MCP process or protocol failed')); }
    pending.clear();
    owned.process.kill('SIGKILL');
  };
  owned.process.once('error', fail);
  owned.process.stdin.on('error', fail);
  owned.process.once('close', () => { if (pending.size) fail(); });
  owned.process.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) fail(); });
  owned.process.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 1048576) return fail();
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const reply = JSON.parse(line), waiting = pending.get(reply.id);
        assert(waiting && reply.jsonrpc === '2.0' && !reply.error);
        pending.delete(reply.id); clearTimeout(waiting.timer); waiting.resolve(reply.result);
      } catch { fail(); }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (failed || !children.has(owned.process)) return reject(new Error('MCP process unavailable'));
    const id = nextId++, timer = setTimeout(fail, 10000);
    pending.set(id, { resolve, reject, timer });
    owned.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'notes-installed-acceptance', version: '1.0.0' } });
    assert.equal(initialized.serverInfo.version, metadata.version);
    owned.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const inventory = await request('tools/list');
    assert(inventory.tools.some(tool => tool.name === 'notes_create'));
    return {
      names: inventory.tools.map(tool => tool.name).sort(),
      async call(name, args = {}, refusal = false) {
        const result = await request('tools/call', { name, arguments: args });
        assert.equal(result.isError === true, refusal, 'Unexpected MCP result status');
        assert.equal(result.content.length, 1); assert.equal(result.content[0].type, 'text');
        return JSON.parse(result.content[0].text);
      },
      close: () => close(owned),
    };
  } catch (error) { await close(owned); throw error; }
}

try {
  assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'").all()).length, 0);
  assert.equal((await db.query('SHOW server_encoding').get()).server_encoding, 'UTF8');
  const migrations = await new MigrationLedger(db.client, notesPgMigrations()).migrate();
  assert.equal(migrations.applied.length, notesPgMigrations().length);
  const config = resolveConfig({ HASNA_NOTES_API_SIGNING_KEY: 'notes-owned-acceptance-signing-key-32b!' }, ['--dev']);
  config.log = () => {};
  const app = await createApp({ db, config });
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname.replace(/\/notes\/[^/]+$/, '/notes/:id');
    const route = request.method + ' ' + pathname;
    requestCounts[route] = (requestCounts[route] ?? 0) + 1;
    return app.fetch(request, { ip: '127.0.0.1' });
  } });
  const origin = server.url.origin;
  globalThis.fetch = (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, origin, 'External request refused');
    return actualFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  };
  await writeFile(join(cwd, 'network-guard.mjs'), `const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.origin!==process.env.QA_NOTES_API_ORIGIN)throw Error('External Notes request refused');return original(input,{...init,redirect:'error',signal:AbortSignal.timeout(5000)});};`);
  const post = async (path, body) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function login(email) {
    const sentResponse = await post('/v1/auth/login', { email }); assert.equal(sentResponse.status, 200);
    const sent = await sentResponse.json(); assert.equal(typeof sent.requestId, 'string'); assert.equal(typeof sent.devCode, 'string');
    const missing = await post('/v1/auth/verify', { email, code: sent.devCode }); assert(!missing.ok); await missing.arrayBuffer();
    const response = await post('/v1/auth/verify', { email, code: sent.devCode, requestId: sent.requestId, name: 'Owned acceptance' });
    assert.equal(response.status, 200); const verified = await response.json(); assert(verified.apiKey.startsWith('hasna_notes_')); return verified.apiKey;
  }
  const keyA = await login('installed-a@example.test'), keyB = await login('installed-b@example.test');
  groups.push('installed-postgres-migrations-and-otp-request-id');
  const state = join(cwd, 'owned-state'); await mkdir(state);
  const envFor = key => ({ PATH: process.env.PATH, TMPDIR: state, HASNA_HOME: state, HASNA_CONFIG_HOME: join(state, 'config'),
    HASNA_NOTES_API_URL: origin, HASNA_NOTES_API_KEY: key, QA_NOTES_API_ORIGIN: origin, NO_COLOR: '1', TERM: 'dumb' });
  const envA = envFor(keyA), envB = envFor(keyB), a = new NotesClient(envA), b = new NotesClient(envB);
  const note = await a.create({ title: 'Installed SDK note', bodyMarkdown: 'Unicode café 😀\n**Markdown**', labels: ['sdk'], frontmatterJson: { value: ['é', null, true] } });
  assert.equal((await a.get(note.id)).bodyMarkdown, note.bodyMarkdown);
  let expected = await a.update(note.id, { title: 'Updated SDK note' });
  for (const operation of [() => b.get(note.id), () => b.update(note.id, { title: 'foreign' }), () => b.delete(note.id)]) {
    await assert.rejects(operation, error => error.status === 404);
    assert.deepEqual(await a.get(note.id), expected);
  }
  const foreign = await b.create({ title: 'Foreign tenant note', bodyMarkdown: 'B only' });
  groups.push('sdk-crud-and-tenant-isolation');
  let mcpNote;
  if (!sdkOnly) {
    assert.equal((await cli(['get', note.id, '--json'], envA)).id, note.id);
    await cli(['update', note.id, '--body', 'CLI updated 😀', '--json'], envA);
    expected = await a.get(note.id); assert.equal(expected.bodyMarkdown, 'CLI updated 😀');
    const deleted = await cli(['create', '--title', 'CLI delete fixture', '--json'], envA);
    assert.equal((await cli(['delete', deleted.id, '--yes', '--json'], envA)).deleted, true);
    const beforeRefusals = JSON.stringify(requestCounts), noKey = { ...envA }; delete noKey.HASNA_NOTES_API_KEY;
    for (const bad of [noKey, { ...envA, HASNA_NOTES_DATABASE_URL: '' }, { ...envA, HASNA_NOTES_STORAGE_MODE: 'retired-fixture' }]) await cli(['list', '--json'], bad, 1);
    assert.equal(JSON.stringify(requestCounts), beforeRefusals);
    groups.push('installed-cli-crud-and-pre-network-refusals');
    let primary, second;
    try {
      primary = await mcp(envA); second = await mcp(envB);
      mcpNote = await primary.call('notes_create', { title: 'MCP note', body: 'MCP Unicode 😀' });
      await primary.call('notes_update', { id: mcpNote.id, body: 'MCP update' });
      await primary.call('labels_assign', { id: mcpNote.id, label: 'mcp' });
      await primary.call('notes_archive', { id: mcpNote.id });
      mcpNote = await primary.call('notes_get', { id: mcpNote.id }); assert.equal(mcpNote.archived, true);
      await primary.close(); primary = await mcp(envA);
      assert.deepEqual(await primary.call('notes_get', { id: mcpNote.id }), mcpNote);
      for (const [name, args] of [['notes_get', { id: mcpNote.id }], ['notes_update', { id: mcpNote.id, body: 'foreign' }], ['notes_delete', { id: mcpNote.id, confirm: true }]]) {
        assert.equal((await second.call(name, args, true)).error, 'note not found');
        assert.deepEqual(await primary.call('notes_get', { id: mcpNote.id }), mcpNote);
      }
      const removed = await primary.call('notes_create', { title: 'MCP delete fixture' });
      assert.equal((await primary.call('notes_delete', { id: removed.id })).requiresConfirmation, true);
      assert.equal((await primary.call('notes_delete', { id: removed.id, confirm: true })).deleted, true);
      assert.deepEqual(await cli(['get', mcpNote.id, '--json'], envA), mcpNote);
    } finally { try { await second?.close(); } finally { await primary?.close(); } }
    groups.push('installed-mcp-crud-confirmation-restart-and-tenant-isolation');
  }
  const snapshot = async () => JSON.stringify(await db.query("SELECT to_jsonb(n) AS row FROM notes n ORDER BY id").all());
  const beforeExport = await snapshot(), exportedA = await a.export(), exportedB = await b.export();
  const response = await fetch(origin + '/v1/export', { method: 'POST', headers: { authorization: `Bearer ${keyA}` } });
  assert.equal(response.status, 200); const http = await response.json();
  const sorted = rows => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(sorted(exportedA.notes), sorted([expected, ...(mcpNote ? [mcpNote] : [])]));
  assert.deepEqual(http.notes, exportedA.notes); assert.deepEqual(exportedB.notes, [foreign]);
  assert.equal(await snapshot(), beforeExport);
  groups.push('http-sdk-export-fidelity-and-nonmutation');
  assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='sync_batches'").all()).length, 0);
  await a.delete(note.id); await assert.rejects(() => a.get(note.id), error => error.status === 404);
  groups.push('sdk-delete-and-no-legacy-schema');
  console.log(JSON.stringify({ status: 'passed', version: metadata.version, groups, requestCounts,
    migrationsApplied: migrations.applied.length, platform: process.platform, fullFourSurface: !sdkOnly,
    database: 'owned PostgreSQL UTF8', network: 'loopback fetch guard; no native socket containment claim', liveMail: false, liveCredentials: false }));
} catch {
  console.log(JSON.stringify({ status: 'failed', completedGroups: groups }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = actualFetch;
  for (const process of children) process.kill('SIGKILL');
  await Promise.all([...children].map(process => new Promise(resolve => process.once('close', resolve))));
  try { await server?.stop(true); } finally { await db.close(); }
}
