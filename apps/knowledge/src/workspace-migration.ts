import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import {
  cpSync,
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
  const db = new Database(path, { readonly: true });
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

export function summarizeWorkspaceTree(workspace: KnowledgeWorkspace): WorkspaceTreeSummary {
  const files = walkFiles(workspace.home);
  const treeHash = hashFiles(workspace.home, files);
  const artifactFiles = walkFiles(workspace.artifactsDir);
  const artifactHash = hashFiles(workspace.artifactsDir, artifactFiles);
  return {
    path: workspace.home,
    exists: existsSync(workspace.home),
    file_count: files.length,
    total_bytes: treeHash.bytes,
    tree_sha256: treeHash.sha256,
    json_items: jsonItemCount(workspace.jsonStorePath),
    sqlite: sqliteSummary(workspace.knowledgeDbPath),
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

function isMigrationTombstone(
  workspace: KnowledgeWorkspace,
  summary: WorkspaceTreeSummary,
  currentHome: string,
): boolean {
  if (!summary.exists) return false;
  if (!summary.files.includes('TOMBSTONE.md') || !summary.files.includes('migration.json')) return false;
  if (summary.files.some((file) => file !== 'TOMBSTONE.md' && file !== 'migration.json')) return false;
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
  const legacyBefore = summarizeWorkspaceTree(options.legacy);
  const currentBefore = summarizeWorkspaceTree(options.current);
  const currentIsDefaultScaffold = isDefaultScaffold(options.current, currentBefore);
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
  const backupWorkspace = workspaceForHome(backupHome);
  const backupAfter = summarizeWorkspaceTree(backupWorkspace);
  checks.backup_matches_legacy = summariesMatch(legacyBefore, backupAfter);
  if (!checks.backup_matches_legacy) {
    throw new Error(`Legacy knowledge backup verification failed: ${backupHome}`);
  }

  if (currentBefore.exists && currentIsDefaultScaffold) {
    rmSync(options.current.home, { recursive: true, force: true });
  }
  renameSync(options.legacy.home, options.current.home);
  const currentAfter = summarizeWorkspaceTree(options.current);
  checks.migrated_matches_backup = summariesMatch(backupAfter, currentAfter);

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
  ].join('\n'));
  writeFileSync(join(options.legacy.home, 'migration.json'), `${JSON.stringify({
    migrated_at: now.toISOString(),
    approved_by: options.approvedBy,
    new_path: options.current.home,
    backup_path: backupHome,
    legacy_before: legacyBefore,
    backup_after: backupAfter,
    current_after: currentAfter,
  }, null, 2)}\n`);
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
    legacy_before: legacyBefore,
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
