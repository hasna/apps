import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// OSS hygiene guard: the public repo must never contain internal machine names,
// fleet topology, private hostnames, or maintainer-specific paths. This is the
// denylist counterpart to the scrub performed before the public rename — if any
// of these strings reappear anywhere in the tree, this test fails with the
// offending file:line so the leak is caught before it is pushed.

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.build', 'dist', '.claude', '.hasna', 'shots']);
const SKIP_FILES = new Set(['bun.lock']);
const TEXT_FILE = /\.(mjs|js|json|md|swift|ts|yml|yaml|sh|html|css|txt|plist|xml)$/;

// Patterns are assembled from fragments so this guard file never matches itself.
const DENYLIST = [
  { name: 'internal mac hostnames', re: new RegExp('apple' + '0\\d', 'i') },
  { name: 'internal linux hostnames', re: new RegExp('spark' + '0\\d', 'i') },
  { name: 'fleet fallback machine ids', re: new RegExp('machine' + '00\\d', 'i') },
  // Product references to the Tailscale mesh VPN (docs, the LNP-safe install
  // check in sync/lnp.mjs, placeholder FQDNs like example.ts.net) are fine —
  // what must never appear is a REAL tailnet identifier. Auto-generated
  // MagicDNS tailnet names are `tail` + hex (tailxxxxxx.ts.net); internal
  // machine FQDNs are additionally caught by the hostname patterns above.
  { name: 'real tailnet identifiers', re: new RegExp('tail' + '[0-9a-f]{6}', 'i') },
  { name: 'internal ssh/user addresses', re: new RegExp('hasna' + '@') },
  { name: 'internal shortlink domain', re: new RegExp('has\\.' + 'na/') },
  { name: 'maintainer home paths', re: new RegExp('/(?:home|Users)/' + 'hasna\\b') },
  { name: 'maintainer secrets paths', re: new RegExp('hasna' + 'xyz|\\.secrets/' + 'hasna', 'i') },
];

async function readTree(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await readTree(path, files);
    else if (TEXT_FILE.test(entry.name) && !SKIP_FILES.has(entry.name)) files.push(path);
  }
  return files;
}

// UI-surface guard: the repo ships exactly ONE browser UI — `web/`, the directory
// README.md documents as "The app UI" and scripts/build_personalnotes.sh bundles into
// Resources/web. A second HTML surface elsewhere in the tree is either dead code or a
// rival "app UI", and either way readers can no longer tell which one is real. The
// branding half of the guard is the public-repo counterpart: this is an MIT-licensed
// OSS repo, so a shipped page must present itself as PersonalNotes and never carry
// another vendor's product name.

const HTML_FILE = /\.html$/;
const UI_DIR = 'web';
const PRODUCT_NAME = 'PersonalNotes';

async function readHtmlTree() {
  return (await readTree(ROOT)).filter((file) => HTML_FILE.test(file));
}

describe('oss hygiene', () => {
  test('repo contains no internal machine names, fleet hosts, or private paths', async () => {
    const self = new URL(import.meta.url).pathname;
    const files = (await readTree(ROOT)).filter((file) => file !== self);
    const violations = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n');
      for (const { name, re } of DENYLIST) {
        lines.forEach((line, i) => {
          if (re.test(line)) violations.push(`${relative(ROOT, file)}:${i + 1} [${name}] ${line.trim().slice(0, 120)}`);
        });
      }
    }
    expect(violations).toEqual([]);
  });

  test(`every HTML surface lives under ${UI_DIR}/ — the one documented app UI`, async () => {
    const strays = (await readHtmlTree())
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith(`${UI_DIR}/`));
    expect(strays).toEqual([]);
  });

  test(`every HTML surface is branded ${PRODUCT_NAME}, not another vendor's product`, async () => {
    const violations = [];
    for (const file of await readHtmlTree()) {
      const text = await readFile(file, 'utf8');
      const title = text.match(/<title>([\s\S]*?)<\/title>/i);
      const where = relative(ROOT, file);
      if (!title) violations.push(`${where} [no <title>]`);
      else if (!title[1].includes(PRODUCT_NAME)) violations.push(`${where} [foreign product title] ${title[1].trim()}`);
    }
    expect(violations).toEqual([]);
  });
});
