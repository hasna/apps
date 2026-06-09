import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';
import type { Database } from 'bun:sqlite';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { recordStorageObjects, type GeneratedStorageObject, type StorageContract } from './storage-contract';
import { normalizeArtifactKey, type ArtifactStore } from './artifact-store';
import type { KnowledgeMachineEntry, KnowledgeMachineTopology } from './machines';

export interface KnowledgeSyncMachineRow {
  machine_id: string;
  hostname: string | null;
  platform: string | null;
  user_label: string | null;
  workspace_home: string | null;
  tailscale_dns: string | null;
  tailscale_ips_json: string;
  ssh_target: string | null;
  last_seen_at: string | null;
  capabilities_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSyncSnapshotRow {
  id: string;
  machine_id: string;
  scope: string;
  workspace_home: string;
  sqlite_schema_version: number;
  artifact_root_uri: string;
  content_hash: string;
  tables_json: string;
  artifact_hashes_json: string;
  created_at: string;
}

export interface KnowledgeSyncConflictRow {
  id: string;
  entity_kind: string;
  entity_id: string;
  local_machine_id: string;
  remote_machine_id: string;
  local_hash: string | null;
  remote_hash: string | null;
  base_hash: string | null;
  status: string;
  resolution_strategy: string | null;
  proposed_patch_uri: string | null;
  approved_by: string | null;
  resolved_at: string | null;
  metadata_json: string;
  created_at: string;
}

export interface KnowledgeSyncStatus {
  ok: true;
  scope: string;
  workspace_home: string;
  sqlite_schema_version: number;
  local_machine_id: string | null;
  machines: {
    total: number;
    rows: KnowledgeSyncMachineRow[];
  };
  snapshots: {
    total: number;
    latest: KnowledgeSyncSnapshotRow | null;
  };
  changes: {
    total: number;
    by_operation: Array<{ operation: string; count: number }>;
  };
  conflicts: {
    total: number;
    by_status: Array<{ status: string; count: number }>;
    open: number;
  };
  table_counts: Record<string, number>;
  message: string;
}

export interface KnowledgeSyncSnapshotResult {
  ok: true;
  snapshot: KnowledgeSyncSnapshotRow & {
    tables: Record<string, number>;
    artifact_hashes: Array<{ artifact_uri: string; kind: string; hash: string | null; size_bytes: number | null }>;
  };
  machines_upserted: number;
  message: string;
}

export interface KnowledgeSyncConflictInput {
  entityKind: string;
  entityId: string;
  localMachineId: string;
  remoteMachineId: string;
  localHash?: string | null;
  remoteHash?: string | null;
  baseHash?: string | null;
  status?: string;
  resolutionStrategy?: string | null;
  proposedPatchUri?: string | null;
  approvedBy?: string | null;
  resolvedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export const KNOWLEDGE_SYNC_TABLES = [
  'sources',
  'wiki_pages',
  'source_revisions',
  'chunks',
  'chunk_embeddings',
  'wiki_backlinks',
  'citations',
  'knowledge_indexes',
  'runs',
  'run_events',
  'provider_usage',
  'redaction_findings',
  'storage_objects',
  'audit_events',
  'approval_gates',
  'vector_index_entries',
  'reindex_queue',
  'knowledge_machines',
  'knowledge_sync_snapshots',
  'knowledge_sync_changes',
  'knowledge_sync_conflicts',
] as const;

export type KnowledgeSyncTable = (typeof KNOWLEDGE_SYNC_TABLES)[number];

type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<KnowledgeSyncTable, string[]> = {
  sources: ['id'],
  wiki_pages: ['id'],
  source_revisions: ['id'],
  chunks: ['id'],
  chunk_embeddings: ['id'],
  wiki_backlinks: ['from_page_id', 'to_page_id'],
  citations: ['id'],
  knowledge_indexes: ['id'],
  runs: ['id'],
  run_events: ['id'],
  provider_usage: ['id'],
  redaction_findings: ['id'],
  storage_objects: ['id'],
  audit_events: ['id'],
  approval_gates: ['id'],
  vector_index_entries: ['id'],
  reindex_queue: ['id'],
  knowledge_machines: ['machine_id'],
  knowledge_sync_snapshots: ['id'],
  knowledge_sync_changes: ['id'],
  knowledge_sync_conflicts: ['id'],
};

const TABLE_SYNC_EXCLUDES = new Set<KnowledgeSyncTable>([
  'storage_objects',
  'knowledge_sync_changes',
]);

export interface KnowledgeSyncBundleTable {
  table: KnowledgeSyncTable;
  primary_keys: string[];
  rows: Row[];
}

export interface KnowledgeSyncBundleArtifact {
  id: string;
  artifact_uri: string;
  key: string | null;
  kind: string;
  content_type: string | null;
  hash: string | null;
  size_bytes: number | null;
  metadata_json: string;
  content_base64?: string;
}

export interface KnowledgeSyncBundle {
  ok: true;
  format: 'knowledge-sync-bundle';
  version: 1;
  generated_at: string;
  source: {
    scope: string;
    workspace_home: string;
    sqlite_schema_version: number;
    machine_id: string | null;
    artifact_root_uri: string;
  };
  tables: KnowledgeSyncBundleTable[];
  artifacts: KnowledgeSyncBundleArtifact[];
  warnings: string[];
  message: string;
}

export interface KnowledgeSyncTableApplyResult {
  table: KnowledgeSyncTable;
  source_rows: number;
  target_rows: number;
  inserted: number;
  skipped: number;
  conflicts: number;
}

export interface KnowledgeSyncArtifactApplyResult {
  source_artifacts: number;
  target_artifacts: number;
  copied: number;
  skipped: number;
  conflicts: number;
  missing_content: number;
}

export interface KnowledgeSyncApplyResult {
  ok: boolean;
  dry_run: boolean;
  direction: 'pull' | 'push' | 'import';
  source: KnowledgeSyncBundle['source'];
  target: {
    scope: string;
    workspace_home: string;
    sqlite_schema_version: number;
    artifact_root_uri: string;
  };
  tables: KnowledgeSyncTableApplyResult[];
  artifacts: KnowledgeSyncArtifactApplyResult;
  conflicts_created: number;
  warnings: string[];
  message: string;
}

export interface KnowledgePeerSyncResult {
  ok: boolean;
  dry_run: boolean;
  direction: 'pull' | 'push' | 'both';
  pull?: KnowledgeSyncApplyResult;
  push?: KnowledgeSyncApplyResult;
  message: string;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function makeSyncId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function count(db: Database, table: string): number {
  const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function filterExistingTables(db: Database, tables: KnowledgeSyncTable[]): KnowledgeSyncTable[] {
  return tables.filter((table) => tableExists(db, table));
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

function localColumns(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function filterLocalColumns(db: Database, table: string, columns: string[]): string[] {
  const allowed = localColumns(db, table);
  return columns.filter((column) => allowed.has(column));
}

function resolveSyncTables(tables?: string[]): KnowledgeSyncTable[] {
  if (!tables || tables.length === 0) return [...KNOWLEDGE_SYNC_TABLES];
  const allowed = new Set<string>(KNOWLEDGE_SYNC_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown knowledge sync table(s): ${invalid.join(', ')}`);
  return requested as KnowledgeSyncTable[];
}

function rowKey(table: KnowledgeSyncTable, row: Row): string {
  const primaryKeys = PRIMARY_KEYS[table];
  return primaryKeys.map((key) => `${key}=${JSON.stringify(row[key] ?? null)}`).join('&');
}

function hashValue(value: unknown): string {
  return sha256(stableJson(value));
}

function normalizeRowForHash(row: Row, artifactUriToKey: Map<string, string>): Row {
  const normalized: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'artifact_uri' && typeof value === 'string' && artifactUriToKey.has(value)) {
      normalized[key] = `artifact:${artifactUriToKey.get(value)}`;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function rowHash(row: Row, artifactUriToKey: Map<string, string> = new Map()): string {
  return hashValue(normalizeRowForHash(row, artifactUriToKey));
}

function tableRows(db: Database, table: KnowledgeSyncTable): Row[] {
  if (!tableExists(db, table)) return [];
  return db.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY rowid ASC`).all() as Row[];
}

function upsertSqliteRows(db: Database, table: KnowledgeSyncTable, rows: Row[]): number {
  if (rows.length === 0) return 0;
  const columns = filterLocalColumns(db, table, Object.keys(rows[0]!));
  if (columns.length === 0) return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const keyList = primaryKeys.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0]!;
  const setClause = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')
    : `${quoteIdent(fallbackKey)} = excluded.${quoteIdent(fallbackKey)}`;
  const statement = db.query(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`,
  );
  const insert = db.transaction((batch: Row[]) => {
    for (const row of batch) statement.run(...columns.map((column) => coerceForSqlite(row[column])));
  });
  insert(rows);
  return rows.length;
}

function assertInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`);
}

function keyForArtifactRow(row: { artifact_uri: string; metadata_json: string }, artifactsDir: string): string | null {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  if (typeof metadata.key === 'string') return metadata.key;
  if (!row.artifact_uri.startsWith('file://')) return null;
  try {
    const path = fileURLToPath(row.artifact_uri);
    const root = resolve(artifactsDir);
    const target = resolve(path);
    if (!assertInside(root, target)) return null;
    const rel = relative(root, target).replace(/\\/g, '/');
    return rel ? normalizeArtifactKey(rel) : null;
  } catch {
    return null;
  }
}

function artifactUriToKey(artifacts: KnowledgeSyncBundleArtifact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const artifact of artifacts) {
    if (artifact.key) map.set(artifact.artifact_uri, artifact.key);
  }
  return map;
}

function artifactFingerprint(artifact: KnowledgeSyncBundleArtifact): string {
  return hashValue({
    key: artifact.key,
    kind: artifact.kind,
    hash: artifact.hash,
    size_bytes: artifact.size_bytes,
  });
}

function artifactIdentity(artifact: KnowledgeSyncBundleArtifact): string {
  return artifact.key ?? artifact.artifact_uri;
}

function tableCounts(db: Database): Record<string, number> {
  return Object.fromEntries(KNOWLEDGE_SYNC_TABLES.map((table) => [table, tableExists(db, table) ? count(db, table) : 0]));
}

function artifactHashes(db: Database): Array<{ artifact_uri: string; kind: string; hash: string | null; size_bytes: number | null }> {
  return db.query<{ artifact_uri: string; kind: string; hash: string | null; size_bytes: number | null }, []>(
    `SELECT artifact_uri, kind, hash, size_bytes
     FROM storage_objects
     ORDER BY artifact_uri ASC`,
  ).all();
}

function machineFromTopologyEntry(entry: KnowledgeMachineEntry, now: string): KnowledgeSyncMachineRow {
  return {
    machine_id: entry.machine_id,
    hostname: entry.hostname,
    platform: entry.platform,
    user_label: entry.user,
    workspace_home: entry.workspace_path,
    tailscale_dns: entry.tailscale.dns_name,
    tailscale_ips_json: JSON.stringify(entry.tailscale.ips),
    ssh_target: entry.ssh.command_target,
    last_seen_at: entry.local || entry.tailscale.online === true || entry.heartbeat_status === 'online' ? now : entry.last_heartbeat_at,
    capabilities_json: JSON.stringify({
      route_hints: entry.route_hints,
      heartbeat_status: entry.heartbeat_status,
      manifest_declared: entry.manifest_declared,
    }),
    metadata_json: JSON.stringify({
      ...entry.metadata,
      source: entry.source,
      tags: entry.tags,
      tailscale: entry.tailscale,
      ssh: entry.ssh,
    }),
    created_at: now,
    updated_at: now,
  };
}

export function upsertKnowledgeMachine(db: Database, input: KnowledgeSyncMachineRow): void {
  db.query(`
    INSERT INTO knowledge_machines (
      machine_id, hostname, platform, user_label, workspace_home, tailscale_dns,
      tailscale_ips_json, ssh_target, last_seen_at, capabilities_json,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET
      hostname = excluded.hostname,
      platform = excluded.platform,
      user_label = excluded.user_label,
      workspace_home = excluded.workspace_home,
      tailscale_dns = excluded.tailscale_dns,
      tailscale_ips_json = excluded.tailscale_ips_json,
      ssh_target = excluded.ssh_target,
      last_seen_at = excluded.last_seen_at,
      capabilities_json = excluded.capabilities_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    input.machine_id,
    input.hostname,
    input.platform,
    input.user_label,
    input.workspace_home,
    input.tailscale_dns,
    input.tailscale_ips_json,
    input.ssh_target,
    input.last_seen_at,
    input.capabilities_json,
    input.metadata_json,
    input.created_at,
    input.updated_at,
  );
}

export function refreshMachineRegistryFromTopology(db: Database, topology: KnowledgeMachineTopology, now = nowIso()): number {
  for (const entry of topology.machines) upsertKnowledgeMachine(db, machineFromTopologyEntry(entry, now));
  return topology.machines.length;
}

export function listKnowledgeMachines(dbPath: string): KnowledgeSyncMachineRow[] {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query<KnowledgeSyncMachineRow, []>(
      'SELECT * FROM knowledge_machines ORDER BY machine_id ASC',
    ).all();
  } finally {
    db.close();
  }
}

export function createKnowledgeSyncBundle(options: {
  dbPath: string;
  scope: string;
  workspaceHome: string;
  storage: StorageContract;
  machineId?: string | null;
  tables?: string[];
  includeArtifactContent?: boolean;
  now?: Date;
}): KnowledgeSyncBundle {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const warnings: string[] = [];
  try {
    const requestedTables = filterExistingTables(db, resolveSyncTables(options.tables));
    const tables: KnowledgeSyncBundleTable[] = requestedTables
      .filter((table) => !TABLE_SYNC_EXCLUDES.has(table))
      .map((table) => ({
        table,
        primary_keys: PRIMARY_KEYS[table],
        rows: tableRows(db, table),
      }));
    const artifactRows = db.query<{
      id: string;
      artifact_uri: string;
      kind: string;
      content_type: string | null;
      hash: string | null;
      size_bytes: number | null;
      metadata_json: string;
    }, []>(
      `SELECT id, artifact_uri, kind, content_type, hash, size_bytes, metadata_json
       FROM storage_objects
       ORDER BY artifact_uri ASC`,
    ).all();
    const artifacts = artifactRows.map((row): KnowledgeSyncBundleArtifact => {
      const key = keyForArtifactRow(row, options.storage.local_layout.directories.artifacts);
      const artifact: KnowledgeSyncBundleArtifact = { ...row, key };
      if (options.includeArtifactContent !== false && key && row.artifact_uri.startsWith('file://')) {
        try {
          const path = fileURLToPath(row.artifact_uri);
          if (existsSync(path)) artifact.content_base64 = readFileSync(path).toString('base64');
          else warnings.push(`artifact_missing:${row.artifact_uri}`);
        } catch (error) {
          warnings.push(`artifact_read_failed:${row.artifact_uri}:${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (options.includeArtifactContent !== false && row.artifact_uri.startsWith('s3://')) {
        warnings.push(`artifact_content_not_embedded:${row.artifact_uri}`);
      }
      return artifact;
    });
    return {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      generated_at: nowIso(options.now),
      source: {
        scope: options.scope,
        workspace_home: options.workspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        machine_id: options.machineId ?? null,
        artifact_root_uri: options.storage.artifact_store.uri_prefix,
      },
      tables,
      artifacts,
      warnings,
      message: `${tables.reduce((sum, table) => sum + table.rows.length, 0)} row(s), ${artifacts.length} artifact(s) exported`,
    };
  } finally {
    db.close();
  }
}

function validateBundle(bundle: KnowledgeSyncBundle): void {
  if (!bundle || bundle.format !== 'knowledge-sync-bundle' || bundle.version !== 1) {
    throw new Error('Invalid knowledge sync bundle.');
  }
}

function getBundleTable(bundle: KnowledgeSyncBundle, table: KnowledgeSyncTable): KnowledgeSyncBundleTable | null {
  return bundle.tables.find((entry) => entry.table === table) ?? null;
}

function tableRowMap(table: KnowledgeSyncTable, rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [rowKey(table, row), row]));
}

function bundleArtifactMap(bundle: KnowledgeSyncBundle): Map<string, KnowledgeSyncBundleArtifact> {
  return new Map(bundle.artifacts.map((artifact) => [artifactIdentity(artifact), artifact]));
}

async function materializeArtifacts(options: {
  db: Database;
  bundle: KnowledgeSyncBundle;
  targetBundle: KnowledgeSyncBundle;
  targetStorage: StorageContract;
  targetStore: ArtifactStore;
  dryRun: boolean;
  direction: KnowledgeSyncApplyResult['direction'];
  localMachineId: string;
  warnings: string[];
}): Promise<{ result: KnowledgeSyncArtifactApplyResult; uriMap: Map<string, string>; conflicts: KnowledgeSyncConflictInput[] }> {
  const targetArtifacts = bundleArtifactMap(options.targetBundle);
  const uriMap = new Map<string, string>();
  const conflicts: KnowledgeSyncConflictInput[] = [];
  const result: KnowledgeSyncArtifactApplyResult = {
    source_artifacts: options.bundle.artifacts.length,
    target_artifacts: options.targetBundle.artifacts.length,
    copied: 0,
    skipped: 0,
    conflicts: 0,
    missing_content: 0,
  };

  for (const artifact of options.bundle.artifacts) {
    const identity = artifactIdentity(artifact);
    const target = targetArtifacts.get(identity);
    if (target && artifactFingerprint(target) === artifactFingerprint(artifact)) {
      if (target.artifact_uri) uriMap.set(artifact.artifact_uri, target.artifact_uri);
      result.skipped += 1;
      continue;
    }
    if (target && artifactFingerprint(target) !== artifactFingerprint(artifact)) {
      result.conflicts += 1;
      conflicts.push({
        entityKind: 'storage_object',
        entityId: identity,
        localMachineId: options.localMachineId,
        remoteMachineId: options.bundle.source.machine_id ?? 'unknown',
        localHash: artifactFingerprint(target),
        remoteHash: artifactFingerprint(artifact),
        metadata: {
          direction: options.direction,
          target_artifact_uri: target.artifact_uri,
          source_artifact_uri: artifact.artifact_uri,
        },
      });
      continue;
    }
    if (!artifact.content_base64 && artifact.artifact_uri.startsWith('file://')) {
      result.missing_content += 1;
      options.warnings.push(`artifact_content_missing:${artifact.artifact_uri}`);
      continue;
    }
    if (options.dryRun) {
      result.copied += 1;
      continue;
    }

    let nextUri = artifact.artifact_uri;
    if (artifact.key && artifact.content_base64) {
      const write = await options.targetStore.put({
        key: artifact.key,
        body: Buffer.from(artifact.content_base64, 'base64'),
        content_type: artifact.content_type ?? undefined,
      });
      nextUri = write.uri;
      uriMap.set(artifact.artifact_uri, nextUri);
    } else if (!artifact.artifact_uri.startsWith('s3://')) {
      options.warnings.push(`artifact_skipped_unsupported:${artifact.artifact_uri}`);
      continue;
    }

    const metadata = parseJson<Record<string, unknown>>(artifact.metadata_json, {});
    const object: GeneratedStorageObject = {
      uri: nextUri,
      key: artifact.key ?? metadata.key as string ?? artifact.artifact_uri,
      kind: artifact.kind,
      content_type: artifact.content_type ?? undefined,
      hash: artifact.hash ?? undefined,
      size_bytes: artifact.size_bytes ?? undefined,
      metadata: {
        ...metadata,
        synced_from_artifact_uri: artifact.artifact_uri,
        synced_from_machine_id: options.bundle.source.machine_id ?? undefined,
      },
    };
    recordStorageObjects(options.db, [object]);
    result.copied += 1;
  }

  return { result, uriMap, conflicts };
}

function transformImportedRow(row: Row, artifactUriMap: Map<string, string>): Row {
  const next = { ...row };
  if (typeof next.artifact_uri === 'string' && artifactUriMap.has(next.artifact_uri)) {
    next.artifact_uri = artifactUriMap.get(next.artifact_uri)!;
  }
  return next;
}

function insertSyncChange(db: Database, input: {
  direction: KnowledgeSyncApplyResult['direction'];
  sourceMachineId: string;
  localMachineId: string;
  entityKind: string;
  entityId: string;
  nextHash: string;
  row?: Row;
}): void {
  const now = nowIso();
  db.query(`
    INSERT INTO knowledge_sync_changes (
      id, origin_machine_id, updated_by_machine_id, entity_kind, entity_id,
      operation, base_hash, next_hash, source_ref, source_revision_id,
      artifact_uri, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeSyncId('syncchg'),
    input.sourceMachineId,
    input.localMachineId,
    input.entityKind,
    input.entityId,
    input.direction,
    null,
    input.nextHash,
    typeof input.row?.source_ref === 'string' ? input.row.source_ref : typeof input.row?.source_uri === 'string' ? input.row.source_uri : null,
    typeof input.row?.source_revision_id === 'string' ? input.row.source_revision_id : null,
    typeof input.row?.artifact_uri === 'string' ? input.row.artifact_uri : null,
    JSON.stringify({ source_machine_id: input.sourceMachineId }),
    now,
  );
}

function insertConflict(db: Database, input: KnowledgeSyncConflictInput): void {
  const now = nowIso();
  db.query(`
    INSERT INTO knowledge_sync_conflicts (
      id, entity_kind, entity_id, local_machine_id, remote_machine_id,
      local_hash, remote_hash, base_hash, status, resolution_strategy,
      proposed_patch_uri, approved_by, resolved_at, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeSyncId('syncconf'),
    input.entityKind,
    input.entityId,
    input.localMachineId,
    input.remoteMachineId,
    input.localHash ?? null,
    input.remoteHash ?? null,
    input.baseHash ?? null,
    input.status ?? 'open',
    input.resolutionStrategy ?? null,
    input.proposedPatchUri ?? null,
    input.approvedBy ?? null,
    input.resolvedAt ?? null,
    JSON.stringify(input.metadata ?? {}),
    now,
  );
}

export async function applyKnowledgeSyncBundle(options: {
  targetDbPath: string;
  targetScope: string;
  targetWorkspaceHome: string;
  targetStorage: StorageContract;
  targetStore: ArtifactStore;
  bundle: KnowledgeSyncBundle;
  targetBundle?: KnowledgeSyncBundle;
  direction: 'pull' | 'push' | 'import';
  dryRun?: boolean;
  localMachineId?: string | null;
}): Promise<KnowledgeSyncApplyResult> {
  validateBundle(options.bundle);
  migrateKnowledgeDb(options.targetDbPath);
  const db = openKnowledgeDb(options.targetDbPath);
  const warnings = [...options.bundle.warnings];
  const localMachineId = options.localMachineId ?? 'local';
  try {
    const targetBundle = options.targetBundle ?? createKnowledgeSyncBundle({
      dbPath: options.targetDbPath,
      scope: options.targetScope,
      workspaceHome: options.targetWorkspaceHome,
      storage: options.targetStorage,
      machineId: localMachineId,
      includeArtifactContent: false,
    });
    const artifactResult = await materializeArtifacts({
      db,
      bundle: options.bundle,
      targetBundle,
      targetStorage: options.targetStorage,
      targetStore: options.targetStore,
      dryRun: options.dryRun === true,
      direction: options.direction,
      localMachineId,
      warnings,
    });
    const sourceArtifactUriToKey = artifactUriToKey(options.bundle.artifacts);
    const targetArtifactUriToKey = artifactUriToKey(targetBundle.artifacts);
    const tableResults: KnowledgeSyncTableApplyResult[] = [];
    let conflictsCreated = 0;

    for (const sourceTable of options.bundle.tables) {
      if (sourceTable.table === 'storage_objects' || TABLE_SYNC_EXCLUDES.has(sourceTable.table)) continue;
      if (!tableExists(db, sourceTable.table)) continue;
      const targetTable = getBundleTable(targetBundle, sourceTable.table);
      const targetRows = tableRowMap(sourceTable.table, targetTable?.rows ?? []);
      const rowsToWrite: Row[] = [];
      const result: KnowledgeSyncTableApplyResult = {
        table: sourceTable.table,
        source_rows: sourceTable.rows.length,
        target_rows: targetTable?.rows.length ?? 0,
        inserted: 0,
        skipped: 0,
        conflicts: 0,
      };

      for (const sourceRow of sourceTable.rows) {
        const key = rowKey(sourceTable.table, sourceRow);
        const targetRow = targetRows.get(key);
        const incomingHash = rowHash(sourceRow, sourceArtifactUriToKey);
        if (!targetRow) {
          result.inserted += 1;
          rowsToWrite.push(transformImportedRow(sourceRow, artifactResult.uriMap));
          continue;
        }
        const currentHash = rowHash(targetRow, targetArtifactUriToKey);
        if (currentHash === incomingHash) {
          result.skipped += 1;
          continue;
        }
        result.conflicts += 1;
        if (!options.dryRun) {
          insertConflict(db, {
            entityKind: sourceTable.table,
            entityId: key,
            localMachineId,
            remoteMachineId: options.bundle.source.machine_id ?? 'unknown',
            localHash: currentHash,
            remoteHash: incomingHash,
            metadata: {
              direction: options.direction,
              source_workspace_home: options.bundle.source.workspace_home,
              target_workspace_home: options.targetWorkspaceHome,
            },
          });
          conflictsCreated += 1;
        }
      }

      if (!options.dryRun && rowsToWrite.length > 0) {
        const writtenRows = rowsToWrite.map((row) => transformImportedRow(row, artifactResult.uriMap));
        upsertSqliteRows(db, sourceTable.table, writtenRows);
        for (const row of writtenRows) {
          insertSyncChange(db, {
            direction: options.direction,
            sourceMachineId: options.bundle.source.machine_id ?? 'unknown',
            localMachineId,
            entityKind: sourceTable.table,
            entityId: rowKey(sourceTable.table, row),
            nextHash: rowHash(row, artifactUriToKey(options.bundle.artifacts)),
            row,
          });
        }
      }
      tableResults.push(result);
    }

    for (const conflict of artifactResult.conflicts) {
      if (!options.dryRun) {
        insertConflict(db, conflict);
        conflictsCreated += 1;
      }
    }

    const inserted = tableResults.reduce((sum, table) => sum + table.inserted, 0);
    const conflicts = tableResults.reduce((sum, table) => sum + table.conflicts, 0) + artifactResult.result.conflicts;
    return {
      ok: conflicts === 0,
      dry_run: options.dryRun === true,
      direction: options.direction,
      source: options.bundle.source,
      target: {
        scope: options.targetScope,
        workspace_home: options.targetWorkspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        artifact_root_uri: options.targetStorage.artifact_store.uri_prefix,
      },
      tables: tableResults,
      artifacts: artifactResult.result,
      conflicts_created: conflictsCreated,
      warnings,
      message: `${options.dryRun ? 'Would import' : 'Imported'} ${inserted} row(s), copied ${artifactResult.result.copied} artifact(s), ${conflicts} conflict(s)`,
    };
  } finally {
    db.close();
  }
}

export function createKnowledgeSyncSnapshot(options: {
  dbPath: string;
  scope: string;
  workspaceHome: string;
  storage: StorageContract;
  topology?: KnowledgeMachineTopology;
  machineId?: string;
  now?: Date;
}): KnowledgeSyncSnapshotResult {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const createdAt = nowIso(options.now);
  try {
    const machinesUpserted = options.topology ? refreshMachineRegistryFromTopology(db, options.topology, createdAt) : 0;
    const tables = tableCounts(db);
    const artifacts = artifactHashes(db);
    const machineId = options.machineId ?? options.topology?.local_machine_id ?? 'unknown';
    const artifactRootUri = options.storage.artifact_store.uri_prefix;
    const contentHash = sha256(stableJson({
      machine_id: machineId,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      artifact_root_uri: artifactRootUri,
      tables,
      artifacts,
    }));
    const row: KnowledgeSyncSnapshotRow = {
      id: makeSyncId('syncsnap'),
      machine_id: machineId,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      artifact_root_uri: artifactRootUri,
      content_hash: contentHash,
      tables_json: JSON.stringify(tables),
      artifact_hashes_json: JSON.stringify(artifacts),
      created_at: createdAt,
    };
    db.query(`
      INSERT INTO knowledge_sync_snapshots (
        id, machine_id, scope, workspace_home, sqlite_schema_version,
        artifact_root_uri, content_hash, tables_json, artifact_hashes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.machine_id,
      row.scope,
      row.workspace_home,
      row.sqlite_schema_version,
      row.artifact_root_uri,
      row.content_hash,
      row.tables_json,
      row.artifact_hashes_json,
      row.created_at,
    );
    return {
      ok: true,
      snapshot: {
        ...row,
        tables,
        artifact_hashes: artifacts,
      },
      machines_upserted: machinesUpserted,
      message: `Recorded sync snapshot ${row.id}`,
    };
  } finally {
    db.close();
  }
}

export function getKnowledgeSyncStatus(options: {
  dbPath: string;
  scope: string;
  workspaceHome: string;
  localMachineId?: string | null;
}): KnowledgeSyncStatus {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const machines = db.query<KnowledgeSyncMachineRow, []>('SELECT * FROM knowledge_machines ORDER BY machine_id ASC').all();
    const latest = db.query<KnowledgeSyncSnapshotRow, []>(
      'SELECT * FROM knowledge_sync_snapshots ORDER BY created_at DESC LIMIT 1',
    ).get() ?? null;
    const conflictStatuses = db.query<{ status: string; count: number }, []>(
      'SELECT status, COUNT(*) AS count FROM knowledge_sync_conflicts GROUP BY status ORDER BY status',
    ).all();
    const changeOps = db.query<{ operation: string; count: number }, []>(
      'SELECT operation, COUNT(*) AS count FROM knowledge_sync_changes GROUP BY operation ORDER BY operation',
    ).all();
    const totalConflicts = conflictStatuses.reduce((sum, row) => sum + row.count, 0);
    const openConflicts = conflictStatuses
      .filter((row) => row.status !== 'resolved' && row.status !== 'ignored')
      .reduce((sum, row) => sum + row.count, 0);
    return {
      ok: true,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      local_machine_id: options.localMachineId ?? null,
      machines: {
        total: machines.length,
        rows: machines,
      },
      snapshots: {
        total: count(db, 'knowledge_sync_snapshots'),
        latest,
      },
      changes: {
        total: count(db, 'knowledge_sync_changes'),
        by_operation: changeOps,
      },
      conflicts: {
        total: totalConflicts,
        by_status: conflictStatuses,
        open: openConflicts,
      },
      table_counts: tableCounts(db),
      message: `${machines.length} machine(s), ${openConflicts} open sync conflict(s)`,
    };
  } finally {
    db.close();
  }
}

export function recordKnowledgeSyncConflict(dbPath: string, input: KnowledgeSyncConflictInput): KnowledgeSyncConflictRow {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = nowIso();
  const row: KnowledgeSyncConflictRow = {
    id: makeSyncId('syncconf'),
    entity_kind: input.entityKind,
    entity_id: input.entityId,
    local_machine_id: input.localMachineId,
    remote_machine_id: input.remoteMachineId,
    local_hash: input.localHash ?? null,
    remote_hash: input.remoteHash ?? null,
    base_hash: input.baseHash ?? null,
    status: input.status ?? 'open',
    resolution_strategy: input.resolutionStrategy ?? null,
    proposed_patch_uri: input.proposedPatchUri ?? null,
    approved_by: input.approvedBy ?? null,
    resolved_at: input.resolvedAt ?? null,
    metadata_json: JSON.stringify(input.metadata ?? {}),
    created_at: now,
  };
  try {
    db.query(`
      INSERT INTO knowledge_sync_conflicts (
        id, entity_kind, entity_id, local_machine_id, remote_machine_id,
        local_hash, remote_hash, base_hash, status, resolution_strategy,
        proposed_patch_uri, approved_by, resolved_at, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.entity_kind,
      row.entity_id,
      row.local_machine_id,
      row.remote_machine_id,
      row.local_hash,
      row.remote_hash,
      row.base_hash,
      row.status,
      row.resolution_strategy,
      row.proposed_patch_uri,
      row.approved_by,
      row.resolved_at,
      row.metadata_json,
      row.created_at,
    );
    return row;
  } finally {
    db.close();
  }
}

export function listKnowledgeSyncConflicts(dbPath: string, options: { status?: string; limit?: number } = {}) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  try {
    const rows = options.status
      ? db.query<KnowledgeSyncConflictRow, [string, number]>(
        'SELECT * FROM knowledge_sync_conflicts WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      ).all(options.status, limit)
      : db.query<KnowledgeSyncConflictRow, [number]>(
        'SELECT * FROM knowledge_sync_conflicts ORDER BY created_at DESC LIMIT ?',
      ).all(limit);
    return rows.map((row) => ({
      ...row,
      metadata: parseJson(row.metadata_json, {}),
    }));
  } finally {
    db.close();
  }
}

export function syncTablesFromSnapshot(snapshot: KnowledgeSyncSnapshotRow): Record<string, number> {
  return parseJson<Record<string, number>>(snapshot.tables_json, {});
}

export function syncArtifactsFromSnapshot(snapshot: KnowledgeSyncSnapshotRow): Array<{ artifact_uri: string; kind: string; hash: string | null; size_bytes: number | null }> {
  return parseJson(snapshot.artifact_hashes_json, []);
}

export { CURRENT_SCHEMA_VERSION as KNOWLEDGE_SYNC_SCHEMA_VERSION };
