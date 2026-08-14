import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ensureStore,
  loadStore,
  loadStoreIfExists,
  makeId,
  makeShortId,
  saveStore,
  withLock,
  type KnowledgeItem,
} from '../src/store';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const storeModuleUrl = pathToFileURL(join(repoRoot, 'src', 'store.ts')).href;

function item(id: string, shortId?: string): KnowledgeItem {
  return {
    id,
    short_id: shortId,
    title: id,
    content: `Content for ${id}`,
    url: null,
    tags: [],
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  };
}

describe('JSON store', () => {
  test('ensureStore creates an owner-only empty store and preserves an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-ensure-'));
    const path = join(dir, 'nested', 'db.json');

    ensureStore(path);

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ items: [] });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);

    const existing = `${JSON.stringify({ items: [item('k_existing')] }, null, 2)}\n`;
    writeFileSync(path, existing);
    ensureStore(path);
    expect(readFileSync(path, 'utf8')).toBe(existing);
  });

  test('imports valid legacy items while preserving collisions, invalid rows, and the legacy source', () => {
    const home = mkdtempSync(join(tmpdir(), 'knowledge-store-import-'));
    const legacyPath = join(home, '.open-knowledge', 'db.json');
    const canonicalPath = join(home, '.hasna', 'knowledge', 'db.json');
    mkdirSync(dirname(legacyPath), { recursive: true });
    mkdirSync(dirname(canonicalPath), { recursive: true });
    const canonical = { items: [item('k_existing', 'existing')] };
    const legacy = {
      items: [
        item('k_existing', 'different'),
        item('k_short_collision', 'existing'),
        item('k_imported', 'imported'),
        null,
      ],
    };
    const legacyContents = `${JSON.stringify(legacy, null, 2)}\n`;
    writeFileSync(canonicalPath, `${JSON.stringify(canonical, null, 2)}\n`);
    writeFileSync(legacyPath, legacyContents);

    const script = `
      const store = await import(${JSON.stringify(storeModuleUrl)});
      const result = store.importLegacyGlobalStore({ now: new Date('2026-07-29T12:34:56.789Z') });
      console.log(JSON.stringify({ default_path: store.defaultStorePath(), result }));
    `;
    const child = spawnSync(process.execPath, ['--eval', script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });

    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    const output = JSON.parse(child.stdout.trim()) as {
      default_path: string;
      result: {
        ok: boolean;
        imported: number;
        skipped_existing: number;
        skipped_invalid: number;
        canonical_created: boolean;
        backup_path: string | null;
        report_path: string | null;
      };
    };
    expect(output.default_path).toBe(canonicalPath);
    expect(output.result).toMatchObject({
      ok: true,
      imported: 1,
      skipped_existing: 2,
      skipped_invalid: 1,
      canonical_created: false,
    });
    expect(JSON.parse(readFileSync(canonicalPath, 'utf8')).items.map((entry: KnowledgeItem) => entry.id)).toEqual([
      'k_existing',
      'k_imported',
    ]);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyContents);
    expect(output.result.backup_path).not.toBeNull();
    expect(output.result.report_path).not.toBeNull();
    expect(JSON.parse(readFileSync(output.result.backup_path!, 'utf8'))).toEqual(canonical);
    expect(JSON.parse(readFileSync(output.result.report_path!, 'utf8'))).toMatchObject({
      imported: 1,
      skipped_existing: 2,
    });
  });

  test('loadStoreIfExists distinguishes a missing file, invalid store shape, and valid contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-optional-'));
    const path = join(dir, 'db.json');

    expect(loadStoreIfExists(path)).toEqual({ exists: false, items: [] });

    writeFileSync(path, JSON.stringify({ items: null }));
    expect(loadStoreIfExists(path)).toEqual({ exists: true, items: [] });

    writeFileSync(path, JSON.stringify({ items: [item('k_loaded')] }));
    expect(loadStoreIfExists(path)).toEqual({ exists: true, items: [item('k_loaded')] });

    writeFileSync(path, '{broken');
    expect(() => loadStoreIfExists(path)).toThrow();
  });

  test('loadStore initializes missing files, rejects malformed JSON, and normalizes invalid shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-load-'));
    const path = join(dir, 'db.json');

    expect(loadStore(path)).toEqual({ items: [] });
    expect(existsSync(path)).toBe(true);

    writeFileSync(path, JSON.stringify({ items: 'not-an-array' }));
    expect(loadStore(path)).toEqual({ items: [] });

    writeFileSync(path, '{broken');
    expect(() => loadStore(path)).toThrow();
  });

  test('saveStore atomically writes nested stores with owner-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-save-'));
    const path = join(dir, 'nested', 'db.json');

    saveStore(path, { items: [item('k_saved')] });

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ items: [item('k_saved')] });
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(path))).toEqual(['db.json']);
  });

  test('withLock supports same-process reentrancy and always removes its lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-lock-'));
    const path = join(dir, 'nested', 'db.json');

    const result = withLock(path, () => withLock(path, () => 'nested result'), { createParent: true });
    expect(result).toBe('nested result');
    expect(existsSync(`${path}.lock`)).toBe(false);

    expect(() => withLock(path, () => {
      throw new Error('callback failed');
    })).toThrow('callback failed');
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  test('withLock does not invoke the callback when its parent is missing and creation was not requested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-store-lock-parent-'));
    const path = join(dir, 'missing', 'db.json');
    let called = false;

    expect(() => withLock(path, () => {
      called = true;
    })).toThrow();
    expect(called).toBe(false);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  test('generates full and short IDs at their documented boundaries', () => {
    const first = makeId();
    const second = makeId();

    expect(first).toMatch(/^k_[a-z0-9]+_[a-z0-9]{6}$/);
    expect(second).not.toBe(first);
    expect(makeShortId('k_1234567890abcdef')).toBe('1234567890ab');
    expect(makeShortId('already-short')).toBe('already-shor');
    expect(makeShortId('')).toBe('');
  });
});
