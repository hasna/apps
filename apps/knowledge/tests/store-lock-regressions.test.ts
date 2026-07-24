import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadStore,
  saveStore,
  setStoreLockTestControl,
  withLock,
  type StoreLockTestEvent,
} from '../src/store.ts';

function lockRecord(owner: string, token: string, pid: number): string {
  return `${JSON.stringify({ version: 1, owner, token, pid })}\n`;
}

describe('atomic monotonic store locks', () => {
  test('exclusive contenders time out monotonically while the 0600 owner remains intact', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-contender-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    let monotonic = 0;
    const originalDateNow = Date.now;
    setStoreLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds) => { monotonic += milliseconds; },
    });
    Date.now = () => monotonic % 2 === 0 ? Number.MAX_SAFE_INTEGER : 1;
    try {
      withLock(storePath, () => {
        const before = readFileSync(lockPath, 'utf8');
        expect(lstatSync(lockPath).mode & 0o777).toBe(0o600);
        expect(() => withLock(storePath, () => {
          throw new Error('contender entered protected section');
        })).toThrow(/Could not acquire lock/);
        expect(readFileSync(lockPath, 'utf8')).toBe(before);
      }, { createParent: true });
      expect(monotonic).toBeGreaterThanOrEqual(5_000);
    } finally {
      Date.now = originalDateNow;
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('a dead-owner crash lock is recovered by exact identity', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-stale-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    writeFileSync(lockPath, lockRecord('dead-owner', 'dead-token', 2_147_483_647), { mode: 0o600 });
    try {
      let entered = false;
      withLock(storePath, () => { entered = true; });
      expect(entered).toBe(true);
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('symlink locks fail closed without touching their target', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-symlink-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    const outside = join(fixture, 'outside.lock');
    writeFileSync(outside, 'outside-unchanged', { mode: 0o600 });
    symlinkSync(outside, lockPath);
    try {
      expect(() => withLock(storePath, () => undefined)).toThrow(/lock.*regular|symlink|identity/i);
      expect(readFileSync(outside, 'utf8')).toBe('outside-unchanged');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('symlinked lock parents fail closed without creating a lock through the alias', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-parent-symlink-'));
    const real = join(fixture, 'real');
    const alias = join(fixture, 'alias');
    const storePath = join(alias, 'db.json');
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, alias, 'dir');
    try {
      expect(() => withLock(storePath, () => undefined))
        .toThrow(/alias|symlink|parent identity|without following links/i);
      expect(() => lstatSync(join(real, 'db.json.lock'))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('release never removes a replacement lock after ownership loss', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-release-loss-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    let replaced = false;
    setStoreLockTestControl({
      onEvent(event: StoreLockTestEvent, detail) {
        if (event !== 'before-release' || replaced) return;
        replaced = true;
        unlinkSync(detail.path);
        writeFileSync(detail.path, lockRecord('replacement-owner', 'replacement-token', process.pid), { mode: 0o600 });
      },
    });
    try {
      withLock(storePath, () => undefined, { createParent: true });
      expect(replaced).toBe(true);
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
        owner: 'replacement-owner',
        token: 'replacement-token',
      });
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('stale cleanup never removes another owner refreshed at the cleanup boundary', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-stale-refresh-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    writeFileSync(lockPath, lockRecord('dead-owner', 'dead-token', 2_147_483_647), { mode: 0o600 });
    let monotonic = 0;
    let refreshed = false;
    setStoreLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds) => { monotonic += milliseconds; },
      onEvent(event: StoreLockTestEvent, detail) {
        if (event !== 'before-stale-remove' || refreshed) return;
        refreshed = true;
        unlinkSync(detail.path);
        writeFileSync(detail.path, lockRecord('refreshed-owner', 'refreshed-token', process.pid), { mode: 0o600 });
      },
    });
    try {
      expect(() => withLock(storePath, () => undefined)).toThrow(/Could not acquire lock/);
      expect(refreshed).toBe(true);
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
        owner: 'refreshed-owner',
        token: 'refreshed-token',
      });
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('unsafe lock modes fail closed instead of being treated as stale', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-mode-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    writeFileSync(lockPath, lockRecord('owner', 'token', process.pid), { mode: 0o600 });
    chmodSync(lockPath, 0o644);
    try {
      expect(() => withLock(storePath, () => undefined)).toThrow(/mode.*0600|confidentiality/i);
      expect(lstatSync(lockPath).mode & 0o777).toBe(0o644);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const event of ['before-create', 'after-create'] as const) {
    test(`parent rename/symlink swap at ${event} never creates or leaves a lock in either target`, () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-lock-parent-${event}-`));
      const parent = join(fixture, 'parent');
      const moved = join(fixture, 'parent-original');
      const outside = join(fixture, 'outside');
      const storePath = join(parent, 'db.json');
      mkdirSync(parent);
      mkdirSync(outside);
      let injected = false;
      setStoreLockTestControl({
        onEvent(observed) {
          if (observed !== event || injected) return;
          injected = true;
          renameSync(parent, moved);
          symlinkSync(outside, parent, 'dir');
        },
      });
      try {
        expect(() => withLock(storePath, () => undefined)).toThrow(/identity|alias|anchored directory|without following links/i);
        expect(injected).toBe(true);
        expect(existsSync(join(outside, 'db.json.lock'))).toBe(false);
        expect(existsSync(join(moved, 'db.json.lock'))).toBe(false);
      } finally {
        setStoreLockTestControl(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('parent replacement during stale refresh preserves the original owner and replacement directory', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-parent-stale-swap-'));
    const parent = join(fixture, 'parent');
    const moved = join(fixture, 'parent-original');
    const storePath = join(parent, 'db.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(parent);
    writeFileSync(lockPath, lockRecord('dead-owner', 'dead-token', 2_147_483_647), { mode: 0o600 });
    let injected = false;
    setStoreLockTestControl({
      onEvent(event) {
        if (event !== 'before-stale-remove' || injected) return;
        injected = true;
        renameSync(parent, moved);
        mkdirSync(parent);
        writeFileSync(join(parent, 'sentinel'), 'replacement-unchanged');
      },
    });
    try {
      expect(() => withLock(storePath, () => undefined)).toThrow(/identity|anchored directory/i);
      expect(readFileSync(join(moved, 'db.json.lock'), 'utf8')).toBe(
        lockRecord('dead-owner', 'dead-token', 2_147_483_647),
      );
      expect(readFileSync(join(parent, 'sentinel'), 'utf8')).toBe('replacement-unchanged');
      expect(existsSync(join(parent, 'db.json.lock'))).toBe(false);
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('parent replacement during release cleans the owned inode through its anchored original parent', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-parent-release-swap-'));
    const parent = join(fixture, 'parent');
    const moved = join(fixture, 'parent-original');
    const storePath = join(parent, 'db.json');
    mkdirSync(parent);
    let injected = false;
    setStoreLockTestControl({
      onEvent(event) {
        if (event !== 'before-release' || injected) return;
        injected = true;
        renameSync(parent, moved);
        mkdirSync(parent);
        writeFileSync(join(parent, 'sentinel'), 'replacement-unchanged');
      },
    });
    try {
      withLock(storePath, () => undefined);
      expect(existsSync(join(moved, 'db.json.lock'))).toBe(false);
      expect(existsSync(join(parent, 'db.json.lock'))).toBe(false);
      expect(readFileSync(join(parent, 'sentinel'), 'utf8')).toBe('replacement-unchanged');
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('locked store I/O aborts after parent rename/recreate without reading or writing the replacement', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-bound-store-parent-'));
    const parent = join(fixture, 'parent');
    const moved = join(fixture, 'parent-original');
    const storePath = join(parent, 'db.json');
    const replacementText = `${JSON.stringify({ items: [{ title: 'replacement-sentinel' }] })}\n`;
    mkdirSync(parent);
    writeFileSync(storePath, `${JSON.stringify({ items: [{ title: 'original' }] })}\n`, { mode: 0o600 });
    try {
      expect(() => withLock(storePath, () => {
        renameSync(parent, moved);
        mkdirSync(parent);
        writeFileSync(storePath, replacementText, { mode: 0o600 });
        const store = loadStore(storePath);
        store.items = [];
        saveStore(storePath, store);
      })).toThrow(/identity|anchored directory|logical lock/i);
      expect(readFileSync(storePath, 'utf8')).toBe(replacementText);
      expect(readFileSync(join(moved, 'db.json'), 'utf8'))
        .toBe(`${JSON.stringify({ items: [{ title: 'original' }] })}\n`);
      expect(existsSync(join(moved, 'db.json.lock'))).toBe(false);
      expect(existsSync(join(parent, 'db.json.lock'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('a replacement directory cannot acquire the same logical lock while the original owner is active', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-logical-owner-'));
    const parent = join(fixture, 'parent');
    const moved = join(fixture, 'parent-original');
    const storePath = join(parent, 'db.json');
    let monotonic = 0;
    mkdirSync(parent);
    setStoreLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds) => { monotonic += milliseconds; },
    });
    try {
      withLock(storePath, () => {
        renameSync(parent, moved);
        mkdirSync(parent);
        expect(() => withLock(storePath, () => {
          throw new Error('replacement owner entered protected section');
        })).toThrow(/logical lock|Could not acquire lock/i);
      });
      expect(monotonic).toBeGreaterThanOrEqual(5_000);
      expect(existsSync(join(moved, 'db.json.lock'))).toBe(false);
      expect(existsSync(join(parent, 'db.json.lock'))).toBe(false);
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('a replacement directory cannot acquire the same logical lock from a second process', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-cross-process-owner-'));
    const parent = join(fixture, 'parent');
    const moved = join(fixture, 'parent-original');
    const storePath = join(parent, 'db.json');
    const readyPath = join(fixture, 'owner-ready');
    const releasePath = join(fixture, 'owner-release');
    const moduleUrl = new URL('../src/store.ts', import.meta.url).href;
    mkdirSync(parent);

    const ownerSource = `
      import { existsSync, writeFileSync } from 'node:fs';
      import { withLock } from ${JSON.stringify(moduleUrl)};
      const [storePath, readyPath, releasePath] = process.argv.slice(1);
      const waitCell = new Int32Array(new SharedArrayBuffer(4));
      withLock(storePath, () => {
        writeFileSync(readyPath, 'ready');
        while (!existsSync(releasePath)) Atomics.wait(waitCell, 0, 0, 10);
      });
    `;
    const contenderSource = `
      import { setStoreLockTestControl, withLock } from ${JSON.stringify(moduleUrl)};
      const storePath = process.argv[1];
      let monotonic = 0;
      setStoreLockTestControl({
        monotonicNow: () => monotonic,
        wait: (milliseconds) => { monotonic += milliseconds; },
      });
      try {
        withLock(storePath, () => { process.stdout.write('entered'); });
        process.exit(2);
      } catch (error) {
        if (!String(error).includes('Could not acquire lock')) process.exit(3);
        process.stdout.write('blocked');
      }
    `;

    const owner = Bun.spawn({
      cmd: ['bun', '--eval', ownerSource, '--', storePath, readyPath, releasePath],
      cwd: fixture,
      env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let ownerReleased = false;
    try {
      const deadline = performance.now() + 10_000;
      while (!existsSync(readyPath) && performance.now() < deadline) await Bun.sleep(10);
      expect(existsSync(readyPath)).toBe(true);

      renameSync(parent, moved);
      mkdirSync(parent);
      const contender = Bun.spawn({
        cmd: ['bun', '--eval', contenderSource, '--', storePath],
        cwd: fixture,
        env: { ...process.env, BUN_CONFIG_INSTALL_AUTO: 'disable' },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(await contender.exited).toBe(0);
      expect(await new Response(contender.stdout).text()).toBe('blocked');
      expect(existsSync(join(parent, 'db.json.lock'))).toBe(false);
      writeFileSync(releasePath, 'release');
      expect(await owner.exited).toBe(0);
      ownerReleased = true;
      expect(existsSync(join(moved, 'db.json.lock'))).toBe(false);
      expect(readdirSync(fixture).filter((name) => name.startsWith('.knowledge-store-logical-')))
        .toEqual([]);
    } finally {
      if (!existsSync(releasePath)) writeFileSync(releasePath, 'release');
      if (!ownerReleased) await owner.exited;
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 20_000);

  test('store replacement finality deterministically rolls back a racing installed inode', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-lock-store-rollback-'));
    const storePath = join(fixture, 'db.json');
    const displaced = join(fixture, 'db.intended.json');
    const originalText = `${JSON.stringify({ items: [{ title: 'original' }] })}\n`;
    const racingText = `${JSON.stringify({ items: [{ title: 'racing' }] })}\n`;
    let injected = false;
    writeFileSync(storePath, originalText, { mode: 0o600 });
    setStoreLockTestControl({
      onEvent(event, detail) {
        if ((event as string) !== 'before-store-final-verify' || detail.path !== storePath || injected) return;
        injected = true;
        renameSync(storePath, displaced);
        writeFileSync(storePath, racingText, { mode: 0o600 });
      },
    });
    try {
      expect(() => withLock(storePath, () => {
        saveStore(storePath, { items: [{
          id: 'k_intended',
          title: 'intended',
          content: 'intended',
          url: null,
          tags: [],
          created_at: '2026-07-19T00:00:00.000Z',
          updated_at: '2026-07-19T00:00:00.000Z',
        }] });
      })).toThrow(/installed store|identity|replacement|final/i);
      expect(injected).toBe(true);
      expect(readFileSync(storePath, 'utf8')).toBe(originalText);
      const conflict = readdirSync(fixture).find((name) => name.startsWith('.knowledge-conflict-'));
      expect(conflict).toBeDefined();
      expect(readFileSync(join(fixture, conflict!), 'utf8')).toBe(racingText);
      expect(readFileSync(displaced, 'utf8')).toContain('intended');
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
