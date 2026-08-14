import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLockContentionCode, loadStore, saveStore, withLock } from '../src/store';

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

describe('lock contention is classified by errno, not by platform luck', () => {
  // REGRESSION: hasna/knowledge windows-latest CI, run 30847733877 attempt 2.
  //   "JSON store lock handling > serializes concurrent CLI writers with no lost items"
  //   EPERM: operation not permitted, open '...\knowledge-concurrent-lock-qCORDr\db.json.lock'
  //
  // tryAcquireLock() classified ONLY EEXIST as "someone else holds the lock, retry" and
  // rethrew everything else. On Windows a concurrent unlink of the lock file (releaseLock)
  // puts it in a delete-pending state, and every open against a delete-pending file fails
  // with EPERM until the last handle closes. So the single most ordinary outcome of lock
  // contention -- the holder released while we were opening -- was a hard failure for the
  // loser of the race. That is a defect in shipped code, not a test artifact: any two
  // concurrent `knowledge` writers on Windows could hit it.
  //
  // This is the deterministic half of the guard. It runs identically on every platform.
  // The end-to-end half is "serializes concurrent CLI writers with no lost items" above,
  // which can only reproduce the EPERM on Windows.
  test('EEXIST, EPERM and EBUSY all mean "held, retry"', () => {
    expect(isLockContentionCode('EEXIST')).toBe(true);
    // Windows delete-pending. The whole point of the regression.
    expect(isLockContentionCode('EPERM')).toBe(true);
    // Windows sharing violation.
    expect(isLockContentionCode('EBUSY')).toBe(true);
  });

  // The set must stay narrow, or a genuinely broken environment becomes a 10-second
  // spin ending in a misleading "could not acquire lock" instead of the real errno.
  test('permission and disk errors are NOT contention and must still fail fast', () => {
    expect(isLockContentionCode('EACCES')).toBe(false);
    expect(isLockContentionCode('ENOSPC')).toBe(false);
    expect(isLockContentionCode('EROFS')).toBe(false);
    expect(isLockContentionCode('ENOENT')).toBe(false);
    expect(isLockContentionCode(undefined)).toBe(false);
  });

  // Behavioural proof of the clause above: an unwritable parent must surface EACCES
  // promptly rather than being swallowed into the retry loop. Guards the over-broad fix.
  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'an unwritable lock directory fails fast with the real errno',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'knowledge-lock-perm-'));
      const readOnly = join(dir, 'ro');
      mkdirSync(readOnly);
      chmodSync(readOnly, 0o555);
      try {
        const started = Date.now();
        let caught: unknown;
        try {
          withLock(join(readOnly, 'db.json'), () => undefined);
        } catch (error) {
          caught = error;
        }
        const elapsed = Date.now() - started;
        expect(caught).toBeDefined();
        expect(String((caught as { code?: unknown })?.code)).toBe('EACCES');
        // LOCK_MAX_WAIT_MS is 10000; a fast failure is well under it.
        expect(elapsed).toBeLessThan(5000);
      } finally {
        chmodSync(readOnly, 0o755);
      }
    },
  );
});
