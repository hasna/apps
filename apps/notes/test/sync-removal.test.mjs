// Regression tests for the multi-machine sync removal (notes cloud-transition
// workflow, task 5b2d66b4-0b5f-4680-8144-022b8a548e57). Every assertion below
// describes the single-server target state: the client is a plain HTTP API
// client, and no sync machinery or machine-manifest surface ships in the CLI or
// the server. Written FIRST, before the removal. The macOS-app and web-UI
// sections were dropped with the desktop app itself (now owned by
// hasna-products/personalnotes).
import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function readText(path) {
  return readFile(path, 'utf8');
}

describe('sync removal — package surface', () => {
  test('package.json exports and ships no sync/cloud modules', async () => {
    const pkg = JSON.parse(await readText(join(repoRoot, 'package.json')));
    expect(pkg.exports['./sync']).toBeUndefined();
    expect(pkg.exports['./cloud']).toBeUndefined();
    expect(pkg.files).not.toContain('sync');
    expect(pkg.files).not.toContain('cloud/index.mjs');
  });

  test('sync/ and cloud/ source directories are gone', async () => {
    await expect(stat(join(repoRoot, 'sync'))).rejects.toThrow();
    await expect(stat(join(repoRoot, 'cloud'))).rejects.toThrow();
  });

  test('notes-lib exports no machine-manifest functions', async () => {
    const lib = await import('../tools/notes-lib.mjs');
    expect(lib.listMachineDetails).toBeUndefined();
    expect(lib.getMachineDetails).toBeUndefined();
    expect(lib.loadMachineManifest).toBeUndefined();
    expect(lib.parseMachineManifestJSON).toBeUndefined();
    // Informational note-level attribution stays (part of the wire dialect).
    expect(typeof lib.machineIdentity).toBe('function');
    expect(typeof lib.moveNoteToMachine).toBe('function');
  });

  test('notes-env reads no retired PERSONALNOTES_* compatibility alias', async () => {
    const text = await readText(join(repoRoot, 'tools', 'notes-env.mjs'));
    expect(text).not.toContain("'PERSONAL'");
    expect(text).not.toContain('+ \'NOTES_\'');
    expect(text).not.toMatch(/RETIRED_PREFIX/);
  });
});

describe('sync removal — CLI', () => {
  test('CLI help lists no sync/cloud/billing/auth/machines verbs', async () => {
    const help = await runNode(join(repoRoot, 'bin', 'notes.mjs'), ['help']);
    expect(help.code).toBe(0, help.stderr);
    for (const verb of ['sync', 'cloud', 'billing', 'auth', 'machines']) {
      expect(help.stdout).not.toMatch(new RegExp(`^  notes ${verb}\\b`, 'm'));
      expect(help.stdout).not.toMatch(new RegExp(`\\bnotes ${verb}\\b`, 'i'));
    }
  });

  test('sync/cloud/billing/auth/machines commands are unknown', async () => {
    for (const args of [
      ['sync'],
      ['sync', 'status'],
      ['cloud', 'status'],
      ['cloud', 'sync'],
      ['billing', 'status'],
      ['auth', 'whoami'],
      ['machines', 'list'],
    ]) {
      const res = await runNode(join(repoRoot, 'bin', 'notes.mjs'), args);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('unknown_command');
    }
  });

  test('bin/notes.mjs imports no sync module', async () => {
    const text = await readText(join(repoRoot, 'bin', 'notes.mjs'));
    expect(text).not.toMatch(/\.\.\/sync\//);
    expect(text).not.toMatch(/\.\.\/cloud\//);
  });
});

describe('sync removal — MCP', () => {
  test('MCP server exposes no machines or hosted-sync tools', async () => {
    const text = await readText(join(repoRoot, 'mcp', 'notes-mcp.mjs'));
    expect(text).not.toMatch(/machines_list/);
    expect(text).not.toMatch(/machines_details/);
    expect(text).not.toMatch(/notes_sync/);
  });

  test('bin/notes-mcp.mjs has no hosted/cloud branch', async () => {
    const text = await readText(join(repoRoot, 'bin', 'notes-mcp.mjs'));
    expect(text).not.toMatch(/\.\.\/cloud\//);
    expect(text).not.toMatch(/notes_sync/);
  });
});

describe('sync removal — server', () => {
  test('server notes module exposes no sync entry point', async () => {
    const notesMod = await import('../server/notes.mjs');
    expect(notesMod.syncNotes).toBeUndefined();
  });

  test('server app registers no /v1/sync route', async () => {
    const text = await readText(join(repoRoot, 'server', 'app.mjs'));
    expect(text).not.toMatch(/\/v1\/sync/);
  });

  test('server schema has no sync_batches table', async () => {
    const { openDb } = await import('../server/db.mjs');
    const db = openDb(':memory:');
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_batches'")
      .get();
    expect(table).toBeNull();
    db.close();
  });

  test('server env reads no retired PERSONALNOTES_SERVER_* alias', async () => {
    const text = await readText(join(repoRoot, 'server', 'env.mjs'));
    expect(text).not.toMatch(/RETIRED_PREFIX/);
    expect(text).not.toMatch(/'PERSONAL'/);
  });
});
