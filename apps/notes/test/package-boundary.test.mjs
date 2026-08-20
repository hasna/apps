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
    expect(pkg.exports['./events']).toBe('./tools/notes-events.mjs');
    expect(pkg.dependencies['@hasna/events']).toBe('0.1.16');
    // Multi-machine sync modules were removed (0.2.0) — no ./sync or ./cloud
    // exports, and no sync/ or cloud/ files in the package.
    expect(pkg.exports['./sync']).toBeUndefined();
    expect(pkg.exports['./cloud']).toBeUndefined();
    expect(pkg.files).not.toContain('sync');
    expect(pkg.files).not.toContain('cloud/index.mjs');
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
