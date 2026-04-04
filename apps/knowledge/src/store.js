import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, readFileSync as readFile } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function defaultStorePath() {
  return `${homedir()}/.open-knowledge/db.json`;
}

function ensureStore(path) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ items: [] }, null, 2));
  }
}

function lockPath(path) {
  return `${path}.lock`;
}

function acquireLock(lockPath, ownerId) {
  const maxWait = 5000;
  const interval = 50;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      if (!existsSync(lockPath)) {
        writeFileSync(lockPath, JSON.stringify({ owner: ownerId, ts: Date.now() }));
        return true;
      }
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (Date.now() - lock.ts > 10000) {
        unlinkSync(lockPath);
      }
    } catch {
      // lock file disappeared, try again
    }
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    if (typeof Bun !== 'undefined') {
      Bun.sleep(interval);
    } else {
      const start2 = Date.now();
      while (Date.now() - start2 < interval) {}
    }
  }
  throw new Error(`Could not acquire lock on ${lockPath} after ${maxWait}ms`);
}

function releaseLock(lockPath, ownerId) {
  try {
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lock.owner === ownerId) {
        unlinkSync(lockPath);
      }
    }
  } catch {}
}

export function loadStore(path) {
  ensureStore(path);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

export function saveStore(path, store) {
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, path);
}

export function withLock(path, fn) {
  const owner = randomUUID();
  const lpath = lockPath(path);
  acquireLock(lpath, owner);
  try {
    return fn();
  } finally {
    releaseLock(lpath, owner);
  }
}

export function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
