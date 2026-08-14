import { createHash } from 'node:crypto';
import { openKnowledgeDbReadonly } from './knowledge-db';
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { KnowledgeWorkspace } from './workspace';
import { defaultKnowledgeConfig, workspaceForHome } from './workspace';
import { saveStore, withLock, type KnowledgeItem, type Store } from './store';

export interface WorkspaceTreeSummary {
  path: string;
  exists: boolean;
  file_count: number;
  total_bytes: number;
  tree_sha256: string | null;
  json_items: number | null;
  sqlite: {
    exists: boolean;
    integrity_check: string | null;
    table_counts: Record<string, number>;
  };
  artifacts: {
    exists: boolean;
    file_count: number;
    total_bytes: number;
    tree_sha256: string | null;
  };
  files: string[];
}

export interface KnowledgeLegacyWorkspaceMigrationResult {
  ok: boolean;
  dry_run: boolean;
  approval_required: boolean;
  scope: string;
  current_home: string;
  legacy_home: string;
  backup_home: string | null;
  tombstone_path: string | null;
  legacy_before: WorkspaceTreeSummary;
  current_before: WorkspaceTreeSummary;
  backup_after: WorkspaceTreeSummary | null;
  current_after: WorkspaceTreeSummary | null;
  checks: Record<string, boolean>;
  warnings: string[];
  message: string;
}

export interface KnowledgeLegacyWorkspaceMergeStats {
  current_items: number;
  legacy_items: number;
  duplicate_ids_identical: number;
  duplicate_ids_conflicting: number;
  short_id_conflicts: number;
  stranded_items: number;
  merged_items: number;
  expected_total_items: number;
  final_items: number | null;
}

export interface KnowledgeLegacyWorkspaceMergeConflict {
  type: 'id_conflict' | 'short_id_conflict';
  id: string;
  legacy_id?: string;
  current_id?: string;
  legacy_title?: string;
  current_title?: string;
}

export interface KnowledgeLegacyWorkspaceMergeResult {
  ok: boolean;
  dry_run: boolean;
  approval_required: boolean;
  scope: string;
  current_home: string;
  legacy_home: string;
  backup_home: string | null;
  legacy_before: WorkspaceTreeSummary;
  current_before: WorkspaceTreeSummary;
  backup_after: WorkspaceTreeSummary | null;
  current_after: WorkspaceTreeSummary | null;
  merge: KnowledgeLegacyWorkspaceMergeStats;
  conflicts: KnowledgeLegacyWorkspaceMergeConflict[];
  checks: Record<string, boolean>;
  warnings: string[];
  message: string;
}

export interface KnowledgeLegacyWorkspaceMergeOptions {
  scope: string;
  current: KnowledgeWorkspace;
  legacy: KnowledgeWorkspace;
  approveWrite?: boolean;
  approvedBy?: string;
  now?: Date;
}

export interface KnowledgeLegacyWorkspaceMigrationOptions {
  scope: string;
  current: KnowledgeWorkspace;
  legacy: KnowledgeWorkspace;
  approveWrite?: boolean;
  approvedBy?: string;
  now?: Date;
}

function walkFiles(root: string, base = root): string[] {
  if (!existsSync(root)) return [];
  const stat = lstatSync(root);
  if (stat.isFile()) return [relative(base, root) || '.'];
  if (!stat.isDirectory()) return [];
  return readdirSync(root)
    .flatMap((entry) => walkFiles(join(root, entry), base))
    .sort();
}

function hashFiles(root: string, files: string[]): { sha256: string | null; bytes: number } {
  if (files.length === 0) return { sha256: null, bytes: 0 };
  const tree = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const path = join(root, file);
    const body = readFileSync(path);
    const fileHash = createHash('sha256').update(body).digest('hex');
    bytes += body.byteLength;
    tree.update(file);
    tree.update('\0');
    tree.update(fileHash);
    tree.update('\0');
  }
  return { sha256: tree.digest('hex'), bytes };
}

function jsonItemCount(path: string): number | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] };
  return Array.isArray(parsed.items) ? parsed.items.length : null;
}

function sqliteSummary(path: string): WorkspaceTreeSummary['sqlite'] {
  if (!existsSync(path)) {
    return { exists: false, integrity_check: null, table_counts: {} };
  }
  const db = openKnowledgeDbReadonly(path);
  try {
    const integrity = db.query<Record<string, string>, []>('PRAGMA integrity_check').get();
    const integrityCheck = integrity ? Object.values(integrity)[0] ?? null : null;
    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all();
    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      const quoted = `"${table.name.replaceAll('"', '""')}"`;
      const count = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${quoted}`).get();
      tableCounts[table.name] = count?.n ?? 0;
    }
    return { exists: true, integrity_check: integrityCheck, table_counts: tableCounts };
  } finally {
    db.close();
  }
}

export function summarizeWorkspaceTree(
  workspace: KnowledgeWorkspace,
  options: { includeSqlite?: boolean } = {},
): WorkspaceTreeSummary {
  const files = walkFiles(workspace.home);
  const treeHash = hashFiles(workspace.home, files);
  const artifactFiles = walkFiles(workspace.artifactsDir);
  const artifactHash = hashFiles(workspace.artifactsDir, artifactFiles);
  const sqliteExists = existsSync(workspace.knowledgeDbPath);
  return {
    path: workspace.home,
    exists: existsSync(workspace.home),
    file_count: files.length,
    total_bytes: treeHash.bytes,
    tree_sha256: treeHash.sha256,
    json_items: jsonItemCount(workspace.jsonStorePath),
    sqlite: options.includeSqlite === false
      ? { exists: sqliteExists, integrity_check: null, table_counts: {} }
      : sqliteSummary(workspace.knowledgeDbPath),
    artifacts: {
      exists: existsSync(workspace.artifactsDir),
      file_count: artifactFiles.length,
      total_bytes: artifactHash.bytes,
      tree_sha256: artifactHash.sha256,
    },
    files,
  };
}

function isDefaultScaffold(workspace: KnowledgeWorkspace, summary: WorkspaceTreeSummary): boolean {
  if (!summary.exists) return true;
  const materialFiles = summary.files.filter((file) => file !== 'config.json');
  if (materialFiles.length > 0) return false;
  if (!summary.files.includes('config.json')) return true;
  try {
    return JSON.stringify(JSON.parse(readFileSync(workspace.configPath, 'utf8')))
      === JSON.stringify(defaultKnowledgeConfig());
  } catch {
    return false;
  }
}

function summariesMatch(left: WorkspaceTreeSummary, right: WorkspaceTreeSummary): boolean {
  return left.file_count === right.file_count
    && left.total_bytes === right.total_bytes
    && left.tree_sha256 === right.tree_sha256
    && left.json_items === right.json_items
    && left.sqlite.integrity_check === right.sqlite.integrity_check
    && JSON.stringify(left.sqlite.table_counts) === JSON.stringify(right.sqlite.table_counts)
    && left.artifacts.file_count === right.artifacts.file_count
    && left.artifacts.total_bytes === right.artifacts.total_bytes
    && left.artifacts.tree_sha256 === right.artifacts.tree_sha256;
}

function migrationTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function itemSignature(item: KnowledgeItem): string {
  return stableJson(item);
}

function itemShortId(item: KnowledgeItem): string | null {
  return typeof item.short_id === 'string' && item.short_id.trim().length > 0 ? item.short_id : null;
}

function readMergeStore(path: string): Store {
  if (!existsSync(path)) return { items: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Store;
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Invalid knowledge JSON store shape at ${path}`);
  }
  return { items: parsed.items };
}

function mergeStats(
  currentStore: Store,
  legacyStore: Store,
): {
  stats: KnowledgeLegacyWorkspaceMergeStats;
  conflicts: KnowledgeLegacyWorkspaceMergeConflict[];
  mergedStore: Store;
} {
  const currentById = new Map(currentStore.items.map((item) => [item.id, item]));
  const reservedKeys = new Map<string, { item: KnowledgeItem; keyKind: 'id' | 'short_id'; source: 'current' | 'legacy' }>();
  for (const item of currentStore.items) {
    const existingId = reservedKeys.get(item.id);
    if (existingId && existingId.item.id !== item.id) {
      // Existing canonical ambiguity is reported below when legacy collides with it.
    }
    reservedKeys.set(item.id, { item, keyKind: 'id', source: 'current' });
    const shortId = itemShortId(item);
    if (shortId && !reservedKeys.has(shortId)) {
      reservedKeys.set(shortId, { item, keyKind: 'short_id', source: 'current' });
    }
  }

  const conflicts: KnowledgeLegacyWorkspaceMergeConflict[] = [];
  let duplicateIdsIdentical = 0;
  let duplicateIdsConflicting = 0;
  let shortIdConflicts = 0;
  const stranded: KnowledgeItem[] = [];

  for (const legacyItem of legacyStore.items) {
    const currentItem = currentById.get(legacyItem.id);
    if (currentItem) {
      if (itemSignature(currentItem) === itemSignature(legacyItem)) {
        duplicateIdsIdentical += 1;
      } else {
        duplicateIdsConflicting += 1;
        conflicts.push({
          type: 'id_conflict',
          id: legacyItem.id,
          legacy_title: legacyItem.title,
          current_title: currentItem.title,
        });
      }
      continue;
    }

    const keys = [
      { key: legacyItem.id, keyKind: 'id' as const },
      ...(itemShortId(legacyItem) ? [{ key: itemShortId(legacyItem)!, keyKind: 'short_id' as const }] : []),
    ];
    let itemHasConflict = false;
    for (const { key, keyKind } of keys) {
      const existing = reservedKeys.get(key);
      if (!existing) continue;
      if (keyKind === 'id' && existing.keyKind === 'id') {
        duplicateIdsConflicting += 1;
        conflicts.push({
          type: 'id_conflict',
          id: key,
          legacy_id: legacyItem.id,
          current_id: existing.item.id,
          legacy_title: legacyItem.title,
          current_title: existing.item.title,
        });
      } else {
        shortIdConflicts += 1;
        conflicts.push({
          type: 'short_id_conflict',
          id: key,
          legacy_id: legacyItem.id,
          current_id: existing.item.id,
          legacy_title: legacyItem.title,
          current_title: existing.item.title,
        });
      }
      itemHasConflict = true;
    }
    if (itemHasConflict) {
      continue;
    }

    stranded.push(legacyItem);
    for (const { key, keyKind } of keys) {
      reservedKeys.set(key, { item: legacyItem, keyKind, source: 'legacy' });
    }
  }

  const mergedStore = { items: [...currentStore.items, ...stranded] };
  return {
    stats: {
      current_items: currentStore.items.length,
      legacy_items: legacyStore.items.length,
      duplicate_ids_identical: duplicateIdsIdentical,
      duplicate_ids_conflicting: duplicateIdsConflicting,
      short_id_conflicts: shortIdConflicts,
      stranded_items: stranded.length,
      merged_items: conflicts.length === 0 ? stranded.length : 0,
      expected_total_items: currentStore.items.length + stranded.length,
      final_items: null,
    },
    conflicts,
    mergedStore,
  };
}

function withStoreLocks<T>(paths: string[], fn: () => T): T {
  const uniquePaths = [...new Set(paths)].sort();
  const run = (index: number): T => {
    if (index >= uniquePaths.length) return fn();
    return withLock(uniquePaths[index]!, () => run(index + 1), { createParent: true });
  };
  return run(0);
}

export function mergeLegacyKnowledgeWorkspace(
  options: KnowledgeLegacyWorkspaceMergeOptions,
): KnowledgeLegacyWorkspaceMergeResult {
  const now = options.now ?? new Date();
  const dryRun = options.approveWrite !== true;
  const legacyBefore = summarizeWorkspaceTree(options.legacy);
  const currentBefore = summarizeWorkspaceTree(options.current);
  const checks = {
    legacy_exists: legacyBefore.exists,
    legacy_store_exists: existsSync(options.legacy.jsonStorePath),
    current_store_exists: existsSync(options.current.jsonStorePath),
    approval_present: options.approveWrite === true && Boolean(options.approvedBy),
    legacy_backup_written: false,
    no_conflicts: false,
    final_count_matches_expected: false,
  };
  const warnings: string[] = [];

  if (!legacyBefore.exists || !checks.legacy_store_exists) {
    return {
      ok: true,
      dry_run: dryRun,
      approval_required: false,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: null,
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: null,
      current_after: currentBefore,
      merge: {
        current_items: readMergeStore(options.current.jsonStorePath).items.length,
        legacy_items: 0,
        duplicate_ids_identical: 0,
        duplicate_ids_conflicting: 0,
        short_id_conflicts: 0,
        stranded_items: 0,
        merged_items: 0,
        expected_total_items: readMergeStore(options.current.jsonStorePath).items.length,
        final_items: currentBefore.json_items,
      },
      conflicts: [],
      checks: {
        ...checks,
        no_conflicts: true,
        final_count_matches_expected: true,
      },
      warnings,
      message: `No legacy knowledge JSON store found at ${options.legacy.jsonStorePath}`,
    };
  }

  const currentStore = readMergeStore(options.current.jsonStorePath);
  const legacyStore = readMergeStore(options.legacy.jsonStorePath);
  const planned = mergeStats(currentStore, legacyStore);
  checks.no_conflicts = planned.conflicts.length === 0;
  if (planned.conflicts.length > 0) warnings.push('merge_conflicts_detected');
  if (!checks.approval_present) warnings.push('write_approval_required');

  if (dryRun || !checks.approval_present || planned.conflicts.length > 0) {
    return {
      ok: planned.conflicts.length === 0,
      dry_run: true,
      approval_required: !checks.approval_present,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: `${options.legacy.home}.merge-backup-${migrationTimestamp(now)}`,
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: null,
      current_after: null,
      merge: planned.stats,
      conflicts: planned.conflicts,
      checks,
      warnings,
      message: planned.conflicts.length === 0
        ? `Dry run: would merge ${planned.stats.stranded_items} legacy item(s) into ${options.current.jsonStorePath}`
        : `Refusing legacy merge with ${planned.conflicts.length} conflict(s)`,
    };
  }

  return withStoreLocks([options.current.jsonStorePath, options.legacy.jsonStorePath], () => {
    const lockedCurrentStore = readMergeStore(options.current.jsonStorePath);
    const lockedLegacyStore = readMergeStore(options.legacy.jsonStorePath);
    const lockedPlan = mergeStats(lockedCurrentStore, lockedLegacyStore);
    checks.no_conflicts = lockedPlan.conflicts.length === 0;
    if (lockedPlan.conflicts.length > 0) {
      return {
        ok: false,
        dry_run: true,
        approval_required: false,
        scope: options.scope,
        current_home: options.current.home,
        legacy_home: options.legacy.home,
        backup_home: null,
        legacy_before: summarizeWorkspaceTree(options.legacy),
        current_before: summarizeWorkspaceTree(options.current),
        backup_after: null,
        current_after: null,
        merge: lockedPlan.stats,
        conflicts: lockedPlan.conflicts,
        checks,
        warnings: [...warnings, 'merge_conflicts_detected_after_lock'],
        message: `Refusing legacy merge with ${lockedPlan.conflicts.length} conflict(s)`,
      };
    }

    if (lockedPlan.stats.stranded_items === 0) {
      lockedPlan.stats.final_items = lockedCurrentStore.items.length;
      checks.final_count_matches_expected = lockedCurrentStore.items.length === lockedPlan.stats.expected_total_items;
      return {
        ok: checks.no_conflicts && checks.final_count_matches_expected,
        dry_run: false,
        approval_required: false,
        scope: options.scope,
        current_home: options.current.home,
        legacy_home: options.legacy.home,
        backup_home: null,
        legacy_before: summarizeWorkspaceTree(options.legacy),
        current_before: summarizeWorkspaceTree(options.current),
        backup_after: null,
        current_after: summarizeWorkspaceTree(options.current),
        merge: lockedPlan.stats,
        conflicts: [],
        checks,
        warnings,
        message: `Legacy merge already up to date for ${options.current.jsonStorePath}`,
      };
    }

    const backupHome = `${options.legacy.home}.merge-backup-${migrationTimestamp(now)}`;
    mkdirSync(dirname(backupHome), { recursive: true });
    cpSync(options.legacy.home, backupHome, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    const backupWorkspace = workspaceForHome(backupHome);
    const backupAfter = summarizeWorkspaceTree(backupWorkspace);
    checks.legacy_backup_written = summariesMatch(summarizeWorkspaceTree(options.legacy), backupAfter);
    if (!checks.legacy_backup_written) {
      throw new Error(`Legacy knowledge merge backup verification failed: ${backupHome}`);
    }

    saveStore(options.current.jsonStorePath, lockedPlan.mergedStore);
    const finalStore = readMergeStore(options.current.jsonStorePath);
    lockedPlan.stats.final_items = finalStore.items.length;
    checks.final_count_matches_expected = finalStore.items.length === lockedPlan.stats.expected_total_items;
    const currentAfter = summarizeWorkspaceTree(options.current);
    const ok = checks.legacy_backup_written && checks.no_conflicts && checks.final_count_matches_expected;

    return {
      ok,
      dry_run: false,
      approval_required: false,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: backupHome,
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: backupAfter,
      current_after: currentAfter,
      merge: lockedPlan.stats,
      conflicts: [],
      checks,
      warnings,
      message: ok
        ? `Merged ${lockedPlan.stats.merged_items} legacy item(s) into ${options.current.jsonStorePath}`
        : `Merged legacy knowledge store, but verification failed for ${options.current.jsonStorePath}`,
    };
  });
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isRetriableFsLock(error: unknown): boolean {
  return error instanceof Error && /\b(EBUSY|EPERM)\b/.test(error.message);
}

function removeWorkspaceWithRetries(path: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: false });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableFsLock(error)) throw error;
      sleepSync(50 * (attempt + 1));
    }
  }
  throw lastError;
}

function chmodOwnerOnlyTree(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  chmodSync(path, stat.isDirectory() ? 0o700 : 0o600);
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) chmodOwnerOnlyTree(join(path, entry));
}

function isRetainedTombstoneFile(file: string): boolean {
  return file === 'TOMBSTONE.md'
    || file === 'migration.json'
    || file === 'knowledge.db'
    || file === 'knowledge.db-shm'
    || file === 'knowledge.db-wal'
    || file === 'knowledge.db-journal';
}

function prepareLegacyTombstoneDirectory(home: string): void {
  for (const file of readdirSync(home)) {
    if (file === 'TOMBSTONE.md' || file === 'migration.json') continue;
    try {
      rmSync(join(home, file), { recursive: true, force: false });
    } catch (error) {
      if (!isRetriableFsLock(error) || !file.startsWith('knowledge.db')) throw error;
    }
  }
}

function moveWorkspace(sourceHome: string, targetHome: string): void {
  try {
    renameSync(sourceHome, targetHome);
    return;
  } catch (error) {
    cpSync(sourceHome, targetHome, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    try {
      removeWorkspaceWithRetries(sourceHome);
    } catch (removeError) {
      if (isRetriableFsLock(removeError)) {
        prepareLegacyTombstoneDirectory(sourceHome);
        return;
      }
      rmSync(targetHome, { recursive: true, force: true });
      throw removeError;
    }
    if (error instanceof Error && error.message.includes('EXDEV')) return;
  }
}

function isMigrationTombstone(
  workspace: KnowledgeWorkspace,
  summary: WorkspaceTreeSummary,
  currentHome: string,
): boolean {
  if (!summary.exists) return false;
  if (!summary.files.includes('TOMBSTONE.md') || !summary.files.includes('migration.json')) return false;
  if (summary.files.some((file) => !isRetainedTombstoneFile(file))) return false;
  try {
    const metadata = JSON.parse(readFileSync(join(workspace.home, 'migration.json'), 'utf8')) as {
      new_path?: unknown;
      backup_path?: unknown;
    };
    return metadata.new_path === currentHome && typeof metadata.backup_path === 'string';
  } catch {
    return false;
  }
}

export function migrateLegacyKnowledgeWorkspace(
  options: KnowledgeLegacyWorkspaceMigrationOptions,
): KnowledgeLegacyWorkspaceMigrationResult {
  const now = options.now ?? new Date();
  const dryRun = options.approveWrite !== true;
  const currentBefore = summarizeWorkspaceTree(options.current);
  const currentIsDefaultScaffold = isDefaultScaffold(options.current, currentBefore);
  const willMutateLegacy = options.approveWrite === true
    && Boolean(options.approvedBy)
    && (!currentBefore.exists || currentIsDefaultScaffold);
  const legacyBefore = summarizeWorkspaceTree(options.legacy, { includeSqlite: !willMutateLegacy });
  const checks = {
    legacy_exists: legacyBefore.exists,
    current_absent_or_default_scaffold: !currentBefore.exists || currentIsDefaultScaffold,
    approval_present: options.approveWrite === true && Boolean(options.approvedBy),
    legacy_is_tombstone: false,
    backup_matches_legacy: false,
    migrated_matches_backup: false,
    tombstone_written: false,
  };
  const warnings: string[] = [];

  if (!legacyBefore.exists) {
    return {
      ok: true,
      dry_run: dryRun,
      approval_required: false,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: null,
      tombstone_path: null,
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: null,
      current_after: null,
      checks,
      warnings,
      message: `No legacy knowledge workspace found at ${options.legacy.home}`,
    };
  }

  checks.legacy_is_tombstone = isMigrationTombstone(options.legacy, legacyBefore, options.current.home);
  if (checks.legacy_is_tombstone) {
    return {
      ok: true,
      dry_run: dryRun,
      approval_required: false,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: null,
      tombstone_path: join(options.legacy.home, 'TOMBSTONE.md'),
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: null,
      current_after: currentBefore,
      checks: {
        ...checks,
        tombstone_written: true,
      },
      warnings,
      message: `Legacy knowledge workspace already migrated to ${options.current.home}`,
    };
  }

  if (!checks.current_absent_or_default_scaffold) {
    warnings.push('current_workspace_contains_data');
  }
  if (!checks.approval_present) {
    warnings.push('write_approval_required');
  }

  if (dryRun || !checks.current_absent_or_default_scaffold || !checks.approval_present) {
    return {
      ok: checks.current_absent_or_default_scaffold,
      dry_run: true,
      approval_required: true,
      scope: options.scope,
      current_home: options.current.home,
      legacy_home: options.legacy.home,
      backup_home: `${options.legacy.home}.backup-${migrationTimestamp(now)}`,
      tombstone_path: join(options.legacy.home, 'TOMBSTONE.md'),
      legacy_before: legacyBefore,
      current_before: currentBefore,
      backup_after: null,
      current_after: null,
      checks,
      warnings,
      message: checks.current_absent_or_default_scaffold
        ? `Dry run: would migrate ${options.legacy.home} to ${options.current.home}`
        : `Cannot migrate while ${options.current.home} contains data`,
    };
  }

  const backupHome = `${options.legacy.home}.backup-${migrationTimestamp(now)}`;
  mkdirSync(dirname(options.current.home), { recursive: true });
  mkdirSync(dirname(backupHome), { recursive: true });
  cpSync(options.legacy.home, backupHome, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  chmodOwnerOnlyTree(backupHome);
  const backupWorkspace = workspaceForHome(backupHome);
  const backupSnapshot = summarizeWorkspaceTree(backupWorkspace, { includeSqlite: false });
  checks.backup_matches_legacy = summariesMatch(legacyBefore, backupSnapshot);
  if (!checks.backup_matches_legacy) {
    throw new Error(`Legacy knowledge backup verification failed: ${backupHome}`);
  }

  if (currentBefore.exists && currentIsDefaultScaffold) {
    rmSync(options.current.home, { recursive: true, force: true });
  }
  moveWorkspace(options.legacy.home, options.current.home);
  const currentSnapshot = summarizeWorkspaceTree(options.current, { includeSqlite: false });
  checks.migrated_matches_backup = summariesMatch(backupSnapshot, currentSnapshot);
  const backupAfter = summarizeWorkspaceTree(backupWorkspace);
  const currentAfter = summarizeWorkspaceTree(options.current);
  const legacyBeforeOutput = { ...backupAfter, path: options.legacy.home };

  mkdirSync(options.legacy.home, { recursive: true });
  const tombstonePath = join(options.legacy.home, 'TOMBSTONE.md');
  writeFileSync(tombstonePath, [
    '# Migrated OpenKnowledge Workspace',
    '',
    `Migrated at: ${now.toISOString()}`,
    `Approved by: ${options.approvedBy}`,
    `New path: ${options.current.home}`,
    `Backup path: ${backupHome}`,
    '',
    'This directory is a diagnostic tombstone only. OpenKnowledge reads and writes the canonical .hasna/knowledge workspace.',
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(tombstonePath, 0o600);
  const migrationJsonPath = join(options.legacy.home, 'migration.json');
  writeFileSync(migrationJsonPath, `${JSON.stringify({
    migrated_at: now.toISOString(),
    approved_by: options.approvedBy,
    new_path: options.current.home,
    backup_path: backupHome,
    legacy_before: legacyBeforeOutput,
    backup_after: backupAfter,
    current_after: currentAfter,
  }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(migrationJsonPath, 0o600);
  checks.tombstone_written = existsSync(tombstonePath);

  const ok = checks.backup_matches_legacy && checks.migrated_matches_backup && checks.tombstone_written;
  return {
    ok,
    dry_run: false,
    approval_required: false,
    scope: options.scope,
    current_home: options.current.home,
    legacy_home: options.legacy.home,
    backup_home: backupHome,
    tombstone_path: tombstonePath,
    legacy_before: legacyBeforeOutput,
    current_before: currentBefore,
    backup_after: backupAfter,
    current_after: currentAfter,
    checks,
    warnings,
    message: ok
      ? `Migrated legacy knowledge workspace to ${options.current.home}`
      : `Migrated legacy knowledge workspace, but verification failed for ${options.current.home}`,
  };
}
