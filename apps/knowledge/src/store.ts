/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
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

export interface LegacyGlobalStoreImportOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface LegacyGlobalStoreImportResult {
  ok: boolean;
  dry_run: boolean;
  legacy_path: string;
  canonical_path: string;
  legacy_exists: boolean;
  canonical_existed: boolean;
  canonical_created: boolean;
  would_create_canonical: boolean;
  imported: number;
  skipped_existing: number;
  skipped_invalid: number;
  backup_path: string | null;
  report_path: string | null;
  errors: string[];
  message: string;
}

export function defaultStorePath(): string {
  return workspaceForHome(globalKnowledgeHome()).jsonStorePath;
}

export function ensureStore(path: string): void {
  // Legacy global installs kept their store at ~/.open-knowledge/db.json. Merge it
  // into the canonical Hasna knowledge store (read-only source) on first global use.
  if (path === defaultStorePath() && existsSync(legacyGlobalStorePath())) {
    importLegacyGlobalStore();
  }
  if (!existsSync(path)) {
    ensureParentDir(path);
    writeFileSync(path, `${JSON.stringify({ items: [] }, null, 2)}\n`);
  }
}

function timestampForPath(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

function storeIdentityKeys(item: KnowledgeItem): string[] {
  const keys = [`id:${item.id}`];
  if (typeof item.short_id === 'string' && item.short_id.length > 0) {
    keys.push(`short_id:${item.short_id}`);
  }
  return keys;
}

function indexStoreItems(items: KnowledgeItem[]): Set<string> {
  const index = new Set<string>();
  for (const item of items) {
    for (const key of storeIdentityKeys(item)) index.add(key);
  }
  return index;
}

function storeContainsItem(index: Set<string>, item: KnowledgeItem): boolean {
  return storeIdentityKeys(item).some((key) => index.has(key));
}

function writeJsonFile(path: string, value: unknown): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readStoreFileForImport(path: string): { store: Store; skippedInvalid: number } {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || !Array.isArray((value as Store).items)) {
    return { store: { items: [] }, skippedInvalid: 0 };
  }
  const store: Store = { items: [] };
  let skippedInvalid = 0;
  for (const item of (value as Store).items) {
    if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0) {
      store.items.push(item);
    } else {
      skippedInvalid += 1;
    }
  }
  return { store, skippedInvalid };
}

/**
 * Merge the legacy `~/.open-knowledge/db.json` store into the canonical global store.
 * The legacy file is treated as a read-only source: it is never moved, rewritten, or
 * deleted. Canonical records win on `id`/`short_id` collisions. When an existing
 * canonical store is changed a pre-import backup is written under the exports dir and
 * an import report is written under the runs dir.
 */
export function importLegacyGlobalStore(options: LegacyGlobalStoreImportOptions = {}): LegacyGlobalStoreImportResult {
  if (options.dryRun === true) return importLegacyGlobalStoreUnlocked(options);
  return withLock(defaultStorePath(), () => importLegacyGlobalStoreUnlocked(options), { createParent: true });
}

function importLegacyGlobalStoreUnlocked(options: LegacyGlobalStoreImportOptions = {}): LegacyGlobalStoreImportResult {
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  const workspace = workspaceForHome(globalKnowledgeHome());
  const legacyPath = legacyGlobalStorePath();
  const canonicalPath = workspace.jsonStorePath;
  const legacyExists = existsSync(legacyPath);
  const canonicalExisted = existsSync(canonicalPath);
  const result: LegacyGlobalStoreImportResult = {
    ok: true,
    dry_run: dryRun,
    legacy_path: legacyPath,
    canonical_path: canonicalPath,
    legacy_exists: legacyExists,
    canonical_existed: canonicalExisted,
    canonical_created: false,
    would_create_canonical: false,
    imported: 0,
    skipped_existing: 0,
    skipped_invalid: 0,
    backup_path: null,
    report_path: null,
    errors: [],
    message: legacyExists ? 'Legacy global store already imported' : 'No legacy global store found',
  };

  if (!legacyExists) return result;

  let legacyStore: Store;
  try {
    const legacy = readStoreFileForImport(legacyPath);
    legacyStore = legacy.store;
    result.skipped_invalid = legacy.skippedInvalid;
  } catch (error) {
    result.ok = false;
    result.errors.push(`Could not read legacy store: ${error instanceof Error ? error.message : String(error)}`);
    result.message = 'Legacy global store import failed';
    return result;
  }

  let canonicalStore: Store = { items: [] };
  if (canonicalExisted) {
    try {
      canonicalStore = readStoreFileForImport(canonicalPath).store;
    } catch (error) {
      result.ok = false;
      result.errors.push(`Could not read canonical store: ${error instanceof Error ? error.message : String(error)}`);
      result.message = 'Legacy global store import failed';
      return result;
    }
  }

  const index = indexStoreItems(canonicalStore.items);
  const merged: Store = { items: [...canonicalStore.items] };
  for (const item of legacyStore.items) {
    if (!item?.id) {
      result.skipped_invalid += 1;
      continue;
    }
    if (storeContainsItem(index, item)) {
      result.skipped_existing += 1;
      continue;
    }
    merged.items.push(item);
    for (const key of storeIdentityKeys(item)) index.add(key);
    result.imported += 1;
  }

  result.would_create_canonical = !canonicalExisted && result.imported > 0;
  result.canonical_created = !dryRun && result.would_create_canonical;
  result.message = result.imported > 0
    ? `Imported ${result.imported} legacy item(s) into canonical knowledge store`
    : 'Legacy global store already imported';

  if (dryRun || result.imported === 0) return result;

  const suffix = `${timestampForPath(now)}-${randomUUID().slice(0, 8)}`;
  if (canonicalExisted) {
    result.backup_path = join(workspace.exportsDir, `legacy-open-knowledge-db-before-import-${suffix}.json`);
    writeJsonFile(result.backup_path, canonicalStore);
  }
  writeJsonFile(canonicalPath, merged);
  result.report_path = join(workspace.runsDir, `legacy-open-knowledge-import-${suffix}.json`);
  writeJsonFile(result.report_path, result);
  return result;
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

const heldLockPaths = new Set<string>();

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
  // Same-process reentrancy: if this path's lock is already held on the current call
  // stack, run inline instead of self-deadlocking on the on-disk lock file.
  if (heldLockPaths.has(lpath)) return fn();
  if (options.createParent) ensureParentDir(lpath);
  acquireLock(lpath, owner);
  heldLockPaths.add(lpath);
  try {
    return fn();
  } finally {
    heldLockPaths.delete(lpath);
    releaseLock(lpath, owner);
  }
}

export function makeId(): string {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeShortId(id: string): string {
  return id.replace(/^k_/, '').slice(0, 12);
}
