import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function readTree(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.build', 'dist'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await readTree(path, files);
    else if (/\.(mjs|js|json|md|swift|ts|yml|yaml)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe('package boundary', () => {
  test('uses the notes public package identity', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.name).toBe('@hasna/notes');
    expect(pkg.bin.notes).toBe('bin/notes.mjs');
    expect(pkg.bin['notes-mcp']).toBe('bin/notes-mcp.mjs');
    expect(pkg.exports['.']).toBe('./sdk/index.mjs');
    expect(pkg.exports['./sdk']).toBe('./sdk/index.mjs');
    expect(pkg.exports['./compat/markdown-format']).toBe('./compat/markdown-format.mjs');
    expect(pkg.exports['./events']).toBe('./tools/notes-events.mjs');
    expect(pkg.dependencies['@hasna/events']).toBe('0.1.16');
    // Multi-machine sync modules were removed (0.2.0) — no ./sync or ./cloud
    // exports, and no sync/ or cloud/ files in the package.
    expect(pkg.exports['./sync']).toBeUndefined();
    expect(pkg.exports['./cloud']).toBeUndefined();
    expect(pkg.files).not.toContain('sync');
    expect(pkg.files).not.toContain('cloud/index.mjs');
    expect(pkg.files).not.toContain('server/db.mjs');
    expect(pkg.files).not.toContain('tools/notes-agent.mjs');
    expect(pkg.files).toContain('server/sql.mjs');
  });

  test('public root is remote-only and compatibility format export has no CRUD', async () => {
    const root = await import('@hasna/notes');
    expect(() => new root.NotesClient({})).toThrow(/HASNA_NOTES_API_URL/);
    expect(() => new root.NotesClient({ HASNA_NOTES_API_URL: 'https://notes.example.test' })).toThrow(/HASNA_NOTES_API_KEY/);
    expect(typeof root.NotesClient).toBe('function');
    expect(root.saveNote).toBeUndefined();
    expect(root.loadNotes).toBeUndefined();
    expect(root.getNote).toBeUndefined();
    expect(root.deleteNote).toBeUndefined();

    const compat = await import('@hasna/notes/compat/markdown-format');
    expect(typeof compat.parseNote).toBe('function');
    expect(typeof compat.serializeNote).toBe('function');
    expect(compat.saveNote).toBeUndefined();
    expect(compat.loadNotes).toBeUndefined();
    expect(compat.getNote).toBeUndefined();
    expect(compat.deleteNote).toBeUndefined();
    expect(Object.keys(compat).every((key) => !/(save|load|delete|list|get).*note/i.test(key))).toBe(true);
  });

  test('public package does not include platform-only secrets or deployment code', async () => {
    const root = new URL('..', import.meta.url).pathname;
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const files = [];
    for (const entry of [...pkg.files, 'package.json']) {
      await readTree(join(root, entry), files).catch(async () => {
        files.push(join(root, entry));
      });
    }
    const combined = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(combined).not.toContain('@hasnatools/');
    expect(combined).not.toContain('platform-notes');
    expect(combined).not.toContain('STRIPE_SECRET_KEY');
    expect(combined).not.toContain('STRIPE_WEBHOOK_SECRET');
    // Literal assembled from fragments so the repo-wide oss-hygiene denylist
    // (which bans this maintainer secrets path) never matches this guard itself.
    expect(combined).not.toContain('~/.secrets/' + 'hasna');
  });
});
