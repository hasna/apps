import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_PATH, DEFAULT_API_URL } from '../sync/client.mjs';
import { createCloudClient, NotesCloudClient } from '../cloud/index.mjs';
import { createClient, NotesClient } from '../sync/index.mjs';

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
    expect(pkg.exports['./events']).toBe('./tools/notes-events.mjs');
    expect(pkg.dependencies['@hasna/events']).toBe('0.1.15');
    expect(pkg.exports['./sync']).toBe('./sync/index.mjs');
    // Deprecated shim kept one release for existing importers.
    expect(pkg.exports['./cloud']).toBe('./cloud/index.mjs');
    expect(NotesCloudClient).toBe(NotesClient);
    expect(createCloudClient).toBe(createClient);
  });

  test('sync client defaults to the local server API and user config path', () => {
    expect(DEFAULT_API_URL).toBe('http://127.0.0.1:8788');
    expect(CONFIG_PATH).toContain('.config/hasna-notes/config.json');
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
