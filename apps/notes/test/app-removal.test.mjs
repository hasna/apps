// Regression guard for the macOS-app drop (owner directive 2026-08-22). The
// desktop app, its bundled web UI, its AI sidecar, its brand assets, and the
// tooling and design docs that served only those surfaces now live in
// hasna-products/personalnotes. @hasna/notes is headless — an HTTPS notes
// CLI, an MCP server, an importable SDK, and a self-hosted HTTP server — so
// every path below must stay absent, and no shipped code or build config may
// reference one. A dangling reference is worse than a leftover file: it is an
// entry point that fails on its first filesystem read, and tools/render-appicon
// would have recreated the deleted app-icon tree if anyone had run it.
//
// Markdown is deliberately exempt from the reference guard: README.md and
// CHANGELOG.md name the removed paths on purpose, as the removal note.
import { describe, expect, test } from 'bun:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF = fileURLToPath(import.meta.url);

// Paths that left with the app: directories the app owned outright, plus exact
// files inside directories this package still has.
const APP_ONLY_PATHS = [
  'Package.swift',
  'Sources',
  'web',
  'assets',
  'ai-sidecar/server.mjs',
  'ai-sidecar/package.json',
  'scripts/build_notes.sh',
  'scripts/deploy_notes.sh',
  'scripts/notes-deploy-lib.sh',
  'tools/shoot.mjs',
  'tools/render-appicon.mjs',
  'docs/design-rules-macos26.md',
  'docs/ui-contracts.md',
  'docs/brand-visual-system.md',
];

// Substrings that can only be a reference to a surface this package no longer
// has. Assembled as plain strings so a match reports the offending file:line.
const DANGLING_REFERENCES = [
  'web/index.html',
  'web/app.js',
  'assets/brand',
  'AppIcon',
  'tools/shots',
  'shoot.mjs',
  'render-appicon',
  'Sources/HasnaNotes',
  'Package.swift',
  'design-rules-macos26',
  'ui-contracts',
  'brand-visual-system',
];

const SKIP_DIRS = new Set(['.git', 'node_modules', '.build', 'dist', '.claude', '.hasna']);
const SKIP_FILES = new Set(['bun.lock']);
const CODE_FILE =
  /(\.(mjs|js|cjs|ts|tsx|json|yml|yaml|sh|swift|html|css|plist)$)|^(Dockerfile|\.dockerignore|\.gitignore)$/;

async function readTree(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await readTree(path, files);
    else if (CODE_FILE.test(entry.name) && !SKIP_FILES.has(entry.name)) files.push(path);
  }
  return files;
}

async function scan(files, needles) {
  const hits = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const needle of needles) {
      lines.forEach((line, i) => {
        if (line.includes(needle)) hits.push(`${relative(repoRoot, file)}:${i + 1} [${needle}]`);
      });
    }
  }
  return hits;
}

describe('macOS app removal', () => {
  test('app-only sources, assets, tooling, and docs are absent', async () => {
    const present = [];
    for (const rel of APP_ONLY_PATHS) {
      const found = await stat(join(repoRoot, rel)).then(() => true, () => false);
      if (found) present.push(rel);
    }
    expect(present).toEqual([]);
    // Positive control: the same probe must see a path that IS here, so the
    // empty result above is evidence of absence and not a broken stat call.
    expect(await stat(join(repoRoot, 'tools/notes-lib.mjs')).then(() => true, () => false)).toBe(true);
  });

  test('.gitignore carries no app-only ignore entry', async () => {
    const text = await readFile(join(repoRoot, '.gitignore'), 'utf8');
    // tools/shots/ was the screenshot harness's output directory.
    expect(text).not.toContain('tools/shots');
    // Control: the file was actually read and a real entry is matchable.
    expect(text).toContain('node_modules/');
  });

  test('the docs directory documents only the headless package', async () => {
    const docs = (await readdir(join(repoRoot, 'docs'))).sort();
    expect(docs).toEqual(['cli.md', 'notes-vs-personalnotes.md', 'storage.md', 'sync.md']);
  });

  test('no shipped code or build config references a removed app surface', async () => {
    const files = (await readTree(repoRoot)).filter((file) => file !== SELF);
    // Control: the scanner reads real content, so an empty violation list below
    // cannot be an artefact of an empty file set or an unread file.
    expect((await scan(files, ['@hasna/notes'])).length).toBeGreaterThan(0);
    expect(await scan(files, DANGLING_REFERENCES)).toEqual([]);
  });
});
