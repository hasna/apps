import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, withLock } from '../src/store';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

function waitForProcess(child: ReturnType<typeof spawn>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

describe('JSON store lock handling', () => {
  test('recovers a stale malformed lock without corrupting the store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-stale-lock-'));
    const storePath = join(dir, 'db.json');
    const lockPath = `${storePath}.lock`;
    writeFileSync(storePath, `${JSON.stringify({ items: [] }, null, 2)}\n`);
    writeFileSync(lockPath, '{not-json');
    const staleTime = new Date(Date.now() - 180000);
    utimesSync(lockPath, staleTime, staleTime);

    withLock(storePath, () => {
      const store = loadStore(storePath);
      store.items.push({
        id: 'k_recovered_lock',
        title: 'Recovered lock',
        content: 'stale lock recovery preserved writes',
        url: null,
        tags: [],
        created_at: '2026-07-04T00:00:00.000Z',
        updated_at: '2026-07-04T00:00:00.000Z',
      });
      saveStore(storePath, store);
    }, { createParent: true });

    expect(existsSync(lockPath)).toBe(false);
    expect(loadStore(storePath).items).toHaveLength(1);
  });

  test('serializes concurrent CLI writers with no lost items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-concurrent-lock-'));
    const storePath = join(dir, 'db.json');
    const writerCount = 24;
    const children = Array.from({ length: writerCount }, (_, index) => spawn('bun', [
      CLI,
      'add',
      `Concurrent ${index}`,
      `Content ${index}`,
      '--store',
      storePath,
      '--json',
    ], {
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    const results = await Promise.all(children.map(waitForProcess));
    expect(results.filter((result) => result.code !== 0)).toEqual([]);

    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as {
      items: Array<{ title: string }>;
    };
    expect(parsed.items).toHaveLength(writerCount);
    expect(new Set(parsed.items.map((item) => item.title)).size).toBe(writerCount);
    expect(existsSync(`${storePath}.lock`)).toBe(false);
  });

  test('serializes multiple writers racing to reclaim one stale lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-concurrent-stale-lock-'));
    const storePath = join(dir, 'db.json');
    const lockPath = `${storePath}.lock`;
    writeFileSync(storePath, `${JSON.stringify({ items: [] }, null, 2)}\n`);
    writeFileSync(lockPath, '{stale');
    const staleTime = new Date(Date.now() - 180000);
    utimesSync(lockPath, staleTime, staleTime);

    const writerCount = 16;
    const children = Array.from({ length: writerCount }, (_, index) => spawn('bun', [
      CLI,
      'add',
      `Stale concurrent ${index}`,
      `Content ${index}`,
      '--store',
      storePath,
      '--json',
    ], {
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    const results = await Promise.all(children.map(waitForProcess));
    expect(results.filter((result) => result.code !== 0)).toEqual([]);

    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as {
      items: Array<{ title: string }>;
    };
    expect(parsed.items).toHaveLength(writerCount);
    expect(new Set(parsed.items.map((item) => item.title)).size).toBe(writerCount);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.breaker`)).toBe(false);
  });
});
