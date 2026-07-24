import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
});
