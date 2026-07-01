/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ensureParentDir, globalKnowledgeHome, legacyGlobalStorePath, workspaceForHome } from './workspace';

export interface KnowledgeItem {
  id: string;
  short_id?: string | null;
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Store {
  items: KnowledgeItem[];
}

export function defaultStorePath(): string {
  return workspaceForHome(globalKnowledgeHome()).jsonStorePath;
}

export function ensureStore(path: string): void {
  if (!existsSync(path)) {
    ensureParentDir(path);
    if (path === defaultStorePath() && existsSync(legacyGlobalStorePath())) {
      writeFileSync(path, readFileSync(legacyGlobalStorePath(), 'utf8'));
    } else {
      writeFileSync(path, JSON.stringify({ items: [] }, null, 2));
    }
  }
}

export function loadStoreIfExists(path: string): Store & { exists: boolean } {
  if (!existsSync(path)) return { exists: false, items: [] };
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Store;
  if (!parsed || !Array.isArray(parsed.items)) {
    return { exists: true, items: [] };
  }
  return { exists: true, items: parsed.items };
}

function lockPath(path: string): string {
  return `${path}.lock`;
}

function acquireLock(lockPath: string, ownerId: string): void {
  const maxWait = 5000;
  const interval = 50;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      if (!existsSync(lockPath)) {
        writeFileSync(lockPath, JSON.stringify({ owner: ownerId, ts: Date.now() }));
        return;
      }
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { owner: string; ts: number };
      if (Date.now() - lock.ts > 10000) {
        unlinkSync(lockPath);
      }
    } catch {
      // lock file disappeared, try again
    }
    const start2 = Date.now();
    while (Date.now() - start2 < interval) {}
  }
  throw new Error(`Could not acquire lock on ${lockPath} after ${maxWait}ms`);
}

function releaseLock(lockPath: string, ownerId: string): void {
  try {
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { owner: string; ts: number };
      if (lock.owner === ownerId) {
        unlinkSync(lockPath);
      }
    }
  } catch {}
}

export function loadStore(path: string): Store {
  ensureStore(path);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Store;
  if (!parsed || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

export function saveStore(path: string, store: Store): void {
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, path);
}

export function withLock<T>(path: string, fn: () => T, options: { createParent?: boolean } = {}): T {
  const owner = randomUUID();
  const lpath = lockPath(path);
  if (options.createParent) ensureParentDir(lpath);
  acquireLock(lpath, owner);
  try {
    return fn();
  } finally {
    releaseLock(lpath, owner);
  }
}

export function makeId(): string {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeShortId(id: string): string {
  return id.replace(/^k_/, '').slice(0, 12);
}
