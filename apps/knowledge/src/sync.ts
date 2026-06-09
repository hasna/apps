import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { recordStorageObjects, type GeneratedStorageObject, type StorageContract } from './storage-contract';
import { normalizeArtifactKey, type ArtifactStore } from './artifact-store';
import type { KnowledgeMachineEntry, KnowledgeMachineTopology, KnowledgeMachineWorkspaceResolution } from './machines';

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

export interface KnowledgeSyncTableClockRow {
  table_name: string;
  machine_id: string;
  logical_clock: number;
  high_water_hash: string | null;
  high_water_bundle_id: string | null;
  origin_machine_id: string | null;
  updated_by_machine_id: string | null;
  last_applied_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSyncImportRow {
  bundle_id: string;
  source_machine_id: string;
  target_machine_id: string;
  direction: string;
  status: string;
  content_hash: string;
  table_clocks_json: string;
  tables_json: string;
  generated_at: string;
  applied_at: string;
  metadata_json: string;
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
  clocks: {
    total: number;
    rows: KnowledgeSyncTableClockRow[];
  };
  imports: {
    total: number;
    latest: KnowledgeSyncImportRow | null;
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

export type KnowledgeSyncConflict = KnowledgeSyncConflictRow & {
  metadata: Record<string, unknown>;
};

export interface KnowledgeSyncConflictProposalCitation {
  id: string;
  kind: 'source_ref' | 'artifact' | 'row' | 'metadata';
  ref: string;
  hash: string | null;
  quote: string | null;
}

export interface KnowledgeSyncConflictProposedPatch {
  kind: 'manual_merge' | 'choose_local' | 'choose_remote' | 'no_op' | 'custom';
  target: string;
  strategy: string;
  summary: string;
  diff: string | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeSyncConflictReadOnlyToolCall {
  name: string;
  input: Record<string, unknown>;
  output_summary: string;
}

export interface KnowledgeSyncConflictProposalAgent {
  generated: boolean;
  provider: string;
  model: string;
  run_id: string | null;
  read_only_tools: KnowledgeSyncConflictReadOnlyToolCall[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

export interface KnowledgeSyncConflictResolutionProposal {
  ok: true;
  conflict: KnowledgeSyncConflict;
  requires_approval: true;
  mode: 'deterministic' | 'ai';
  proposed_strategy: string;
  summary: string;
  merge_prompt: string;
  proposed_patch: KnowledgeSyncConflictProposedPatch | null;
  citations: KnowledgeSyncConflictProposalCitation[];
  confidence: number | null;
  agent: KnowledgeSyncConflictProposalAgent | null;
  warnings: string[];
  message: string;
}

export interface KnowledgeSyncConflictEvidence {
  conflict: KnowledgeSyncConflict;
  local_row: Row | null;
  remote_row: Row | null;
  source_refs: string[];
  citations: KnowledgeSyncConflictProposalCitation[];
  read_only_tools: KnowledgeSyncConflictReadOnlyToolCall[];
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
  'knowledge_sync_table_clocks',
  'knowledge_sync_imports',
] as const;

export const KNOWLEDGE_SYNC_PROTOCOL_VERSION = 2;
export const KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION = 1;

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
  knowledge_sync_table_clocks: ['table_name', 'machine_id'],
  knowledge_sync_imports: ['bundle_id'],
};

const TABLE_SYNC_EXCLUDES = new Set<KnowledgeSyncTable>([
  'storage_objects',
  'knowledge_sync_changes',
  'knowledge_sync_table_clocks',
  'knowledge_sync_imports',
]);

export interface KnowledgeSyncBundleTable {
  table: KnowledgeSyncTable;
  primary_keys: string[];
  rows: Row[];
}

export interface KnowledgeSyncBundleTableClock {
  table: KnowledgeSyncTable;
  machine_id: string;
  logical_clock: number;
  high_water_hash: string;
  high_water_bundle_id: string | null;
  row_count: number;
  updated_at: string;
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
  protocol_version: typeof KNOWLEDGE_SYNC_PROTOCOL_VERSION;
  min_protocol_version: typeof KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION;
  bundle_id: string;
  content_hash: string;
  generated_at: string;
  source: {
    scope: string;
    workspace_home: string;
    sqlite_schema_version: number;
    machine_id: string | null;
    artifact_root_uri: string;
  };
  table_clocks: KnowledgeSyncBundleTableClock[];
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
  updated: number;
  deleted: number;
  skipped: number;
  conflicts: number;
  stale_skipped: number;
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
  protocol_version: typeof KNOWLEDGE_SYNC_PROTOCOL_VERSION;
  min_protocol_version: typeof KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION;
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
  bundle_id: string;
  replayed: boolean;
  clocks: {
    advanced: number;
    stale_tables: number;
  };
  warnings: string[];
  message: string;
}

export interface KnowledgePeerSyncResult {
  ok: boolean;
  dry_run: boolean;
  direction: 'pull' | 'push' | 'both';
  resolved_workspace?: {
    source: KnowledgeMachineWorkspaceResolution['source'];
    adapter: KnowledgeMachineWorkspaceResolution['adapter'];
    project_root: string;
    project_root_source: KnowledgeMachineWorkspaceResolution['project_root_source'];
    workspace_root: string | null;
    workspace_root_source: KnowledgeMachineWorkspaceResolution['workspace_root_source'];
    open_files_root: string | null;
    open_files_root_source: KnowledgeMachineWorkspaceResolution['open_files_root_source'];
    trust_status: KnowledgeMachineWorkspaceResolution['trust_status'];
    auth_status: KnowledgeMachineWorkspaceResolution['auth_status'];
    current: boolean;
    primary: boolean;
    diagnostics: KnowledgeMachineWorkspaceResolution['diagnostics'];
    repair_hints: KnowledgeMachineWorkspaceResolution['repair_hints'];
    evidence: KnowledgeMachineWorkspaceResolution['evidence'];
    warnings: string[];
  };
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

function defaultSyncMachineId(input?: string | null): string {
  const explicit = input?.trim();
  if (explicit) return explicit;
  return process.env.HASNA_MACHINE_ID
    ?? process.env.OPEN_MACHINES_MACHINE_ID
    ?? process.env.MACHINE_ID
    ?? hostname();
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

const RAW_PAYLOAD_METADATA_KEYS = new Set([
  'raw',
  'raw_bytes',
  'raw_content',
  'content_base64',
  'source_bytes',
  'source_content',
  'body_bytes',
]);

function sanitizeConflictEvidenceValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated-depth]';
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeConflictEvidenceValue(entry, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_PAYLOAD_METADATA_KEYS.has(key.toLowerCase())) continue;
    output[key] = sanitizeConflictEvidenceValue(entry, depth + 1);
  }
  return output;
}

function sanitizeConflictEvidenceRow(row: Row | null | undefined): Row | null {
  if (!row) return null;
  return sanitizeConflictEvidenceValue(row) as Row;
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

function tableContentHash(table: KnowledgeSyncTable, rows: Row[], artifactUriToKey: Map<string, string> = new Map()): string {
  return hashValue(rows
    .map((row) => ({
      key: rowKey(table, row),
      hash: rowHash(row, artifactUriToKey),
    }))
    .sort((a, b) => a.key.localeCompare(b.key)));
}

function tableClock(db: Database, table: KnowledgeSyncTable, machineId: string): KnowledgeSyncTableClockRow | null {
  return db.query<KnowledgeSyncTableClockRow, [string, string]>(
    'SELECT * FROM knowledge_sync_table_clocks WHERE table_name = ? AND machine_id = ?',
  ).get(table, machineId) ?? null;
}

function listTableClocks(db: Database): KnowledgeSyncTableClockRow[] {
  if (!tableExists(db, 'knowledge_sync_table_clocks')) return [];
  return db.query<KnowledgeSyncTableClockRow, []>(
    'SELECT * FROM knowledge_sync_table_clocks ORDER BY table_name ASC, machine_id ASC',
  ).all();
}

function updateTableClock(db: Database, input: {
  table: KnowledgeSyncTable;
  machineId: string;
  logicalClock: number;
  highWaterHash: string | null;
  highWaterBundleId?: string | null;
  originMachineId?: string | null;
  updatedByMachineId?: string | null;
  lastAppliedAt?: string | null;
  metadata?: Record<string, unknown>;
  now?: string;
}): KnowledgeSyncTableClockRow {
  const now = input.now ?? nowIso();
  const existing = tableClock(db, input.table, input.machineId);
  const createdAt = existing?.created_at ?? now;
  db.query(`
    INSERT INTO knowledge_sync_table_clocks (
      table_name, machine_id, logical_clock, high_water_hash, high_water_bundle_id,
      origin_machine_id, updated_by_machine_id, last_applied_at, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(table_name, machine_id) DO UPDATE SET
      logical_clock = excluded.logical_clock,
      high_water_hash = excluded.high_water_hash,
      high_water_bundle_id = excluded.high_water_bundle_id,
      origin_machine_id = excluded.origin_machine_id,
      updated_by_machine_id = excluded.updated_by_machine_id,
      last_applied_at = excluded.last_applied_at,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    input.table,
    input.machineId,
    input.logicalClock,
    input.highWaterHash,
    input.highWaterBundleId ?? null,
    input.originMachineId ?? input.machineId,
    input.updatedByMachineId ?? input.machineId,
    input.lastAppliedAt ?? now,
    JSON.stringify(input.metadata ?? {}),
    createdAt,
    now,
  );
  const row = tableClock(db, input.table, input.machineId);
  if (!row) throw new Error(`Failed to record sync clock for ${input.table}:${input.machineId}`);
  return row;
}

function prepareExportTableClock(db: Database, input: {
  table: KnowledgeSyncTable;
  machineId: string;
  highWaterHash: string;
  rowCount: number;
  record: boolean;
  now: string;
}): KnowledgeSyncBundleTableClock {
  const existing = tableClock(db, input.table, input.machineId);
  const logicalClock = existing?.high_water_hash === input.highWaterHash
    ? existing.logical_clock
    : (existing?.logical_clock ?? 0) + 1;
  const row = input.record
    ? updateTableClock(db, {
        table: input.table,
        machineId: input.machineId,
        logicalClock,
        highWaterHash: input.highWaterHash,
        highWaterBundleId: null,
        originMachineId: existing?.origin_machine_id ?? input.machineId,
        updatedByMachineId: input.machineId,
        lastAppliedAt: input.now,
        metadata: {
          source: 'export',
          row_count: input.rowCount,
        },
        now: input.now,
      })
    : {
        table_name: input.table,
        machine_id: input.machineId,
        logical_clock: logicalClock,
        high_water_hash: input.highWaterHash,
        high_water_bundle_id: existing?.high_water_bundle_id ?? null,
        origin_machine_id: existing?.origin_machine_id ?? input.machineId,
        updated_by_machine_id: input.machineId,
        last_applied_at: input.now,
        metadata_json: '{}',
        created_at: existing?.created_at ?? input.now,
        updated_at: input.now,
      };
  return {
    table: input.table,
    machine_id: input.machineId,
    logical_clock: row.logical_clock,
    high_water_hash: input.highWaterHash,
    high_water_bundle_id: row.high_water_bundle_id,
    row_count: input.rowCount,
    updated_at: row.updated_at,
  };
}

function finalizeExportTableClock(db: Database, clock: KnowledgeSyncBundleTableClock, bundleId: string, record: boolean, now: string): void {
  clock.high_water_bundle_id = bundleId;
  if (!record) return;
  updateTableClock(db, {
    table: clock.table,
    machineId: clock.machine_id,
    logicalClock: clock.logical_clock,
    highWaterHash: clock.high_water_hash,
    highWaterBundleId: bundleId,
    originMachineId: clock.machine_id,
    updatedByMachineId: clock.machine_id,
    lastAppliedAt: now,
    metadata: {
      source: 'export',
      row_count: clock.row_count,
    },
    now,
  });
}

function bundleTableClock(bundle: KnowledgeSyncBundle, table: KnowledgeSyncTable): KnowledgeSyncBundleTableClock | null {
  return bundle.table_clocks?.find((clock) => clock.table === table) ?? null;
}

function staleIncomingClock(existing: KnowledgeSyncTableClockRow | null, incoming: KnowledgeSyncBundleTableClock | null): boolean {
  if (!existing || !incoming) return false;
  return incoming.logical_clock < existing.logical_clock;
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

function parseRowKeyValues(table: KnowledgeSyncTable, key: string): SQLQueryBindings[] | null {
  const primaryKeys = PRIMARY_KEYS[table];
  const values: SQLQueryBindings[] = [];
  let rest = key;
  for (let index = 0; index < primaryKeys.length; index += 1) {
    const primaryKey = primaryKeys[index]!;
    const prefix = `${primaryKey}=`;
    if (!rest.startsWith(prefix)) return null;
    const remaining = rest.slice(prefix.length);
    const nextPrimaryKey = primaryKeys[index + 1];
    const marker = nextPrimaryKey ? `&${nextPrimaryKey}=` : null;
    const markerIndex = marker ? remaining.indexOf(marker) : -1;
    const encoded = markerIndex >= 0 ? remaining.slice(0, markerIndex) : remaining;
    try {
      values.push(JSON.parse(encoded) as SQLQueryBindings);
    } catch {
      return null;
    }
    rest = markerIndex >= 0 && marker ? remaining.slice(markerIndex + 1) : '';
  }
  return rest.length === 0 ? values : null;
}

function primaryKeyWhereClause(table: KnowledgeSyncTable): string {
  return PRIMARY_KEYS[table].map((key) => `${quoteIdent(key)} = ?`).join(' AND ');
}

function latestImportedRowHashes(db: Database, table: KnowledgeSyncTable, sourceMachineId: string): Map<string, string | null> {
  if (!tableExists(db, 'knowledge_sync_changes')) return new Map();
  const rows = db.query<{ entity_id: string; next_hash: string | null }, [string, string]>(
    `SELECT entity_id, next_hash
     FROM knowledge_sync_changes
     WHERE origin_machine_id = ? AND entity_kind = ?
     ORDER BY created_at ASC, id ASC`,
  ).all(sourceMachineId, table);
  const latest = new Map<string, string | null>();
  for (const row of rows) latest.set(row.entity_id, row.next_hash);
  return latest;
}

function removeChunkDerivedRows(db: Database, chunkId: string): void {
  if (tableExists(db, 'chunks_fts')) db.query('DELETE FROM chunks_fts WHERE chunk_id = ?').run(chunkId);
  if (tableExists(db, 'chunk_embeddings')) db.query('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(chunkId);
  if (tableExists(db, 'vector_index_entries')) db.query('DELETE FROM vector_index_entries WHERE chunk_id = ?').run(chunkId);
  if (tableExists(db, 'citations')) db.query('DELETE FROM citations WHERE chunk_id = ?').run(chunkId);
}

function deleteSqliteRowByKey(db: Database, table: KnowledgeSyncTable, key: string): boolean {
  const values = parseRowKeyValues(table, key);
  if (!values) return false;
  const where = primaryKeyWhereClause(table);
  const existing = db.query(`SELECT * FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1`).get(...values) as Row | null;
  if (!existing) return false;
  if (table === 'chunks' && typeof existing.id === 'string') removeChunkDerivedRows(db, existing.id);
  db.query(`DELETE FROM ${quoteIdent(table)} WHERE ${where}`).run(...values);
  return true;
}

function refreshChunkFtsRows(db: Database, rows: Row[]): void {
  if (!tableExists(db, 'chunks_fts')) return;
  for (const row of rows) {
    const chunkId = typeof row.id === 'string' ? row.id : null;
    const text = typeof row.text === 'string' ? row.text : null;
    if (!chunkId || text === null) continue;
    let title = '';
    let sourceUri = '';
    const sourceRevisionId = typeof row.source_revision_id === 'string' ? row.source_revision_id : null;
    if (sourceRevisionId) {
      const source = db.query<{ title: string | null; uri: string | null }, [string]>(
        `SELECT s.title, s.uri
         FROM source_revisions sr
         JOIN sources s ON s.id = sr.source_id
         WHERE sr.id = ?
         LIMIT 1`,
      ).get(sourceRevisionId);
      title = source?.title ?? '';
      sourceUri = source?.uri ?? '';
    }
    if (!sourceUri && typeof row.metadata_json === 'string') {
      const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
      sourceUri = typeof metadata.source_uri === 'string' ? metadata.source_uri : '';
    }
    db.query('DELETE FROM chunks_fts WHERE chunk_id = ?').run(chunkId);
    db.query('INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)').run(chunkId, text, title, sourceUri);
  }
}

function refreshDerivedRowsForImport(db: Database, table: KnowledgeSyncTable, rows: Row[]): void {
  if (table === 'chunks') refreshChunkFtsRows(db, rows);
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

function canReferenceExistingS3Artifact(artifact: KnowledgeSyncBundleArtifact, targetStorage: StorageContract): boolean {
  return artifact.artifact_uri.startsWith('s3://')
    && targetStorage.artifact_store.type === 's3'
    && artifact.artifact_uri.startsWith(targetStorage.artifact_store.uri_prefix);
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
  recordClocks?: boolean;
  now?: Date;
}): KnowledgeSyncBundle {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const warnings: string[] = [];
  const generatedAt = nowIso(options.now);
  const sourceMachineId = defaultSyncMachineId(options.machineId);
  const recordClocks = options.recordClocks !== false;
  try {
    const requestedTables = filterExistingTables(db, resolveSyncTables(options.tables));
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
    const sourceArtifactUriToKey = artifactUriToKey(artifacts);
    const tables: KnowledgeSyncBundleTable[] = requestedTables
      .filter((table) => !TABLE_SYNC_EXCLUDES.has(table))
      .map((table) => ({
        table,
        primary_keys: PRIMARY_KEYS[table],
        rows: tableRows(db, table),
      }));
    const tableClocks = tables.map((table) => prepareExportTableClock(db, {
      table: table.table,
      machineId: sourceMachineId,
      highWaterHash: tableContentHash(table.table, table.rows, sourceArtifactUriToKey),
      rowCount: table.rows.length,
      record: recordClocks,
      now: generatedAt,
    }));
    const contentHash = sha256(stableJson({
      source: {
        scope: options.scope,
        workspace_home: options.workspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        machine_id: sourceMachineId,
        artifact_root_uri: options.storage.artifact_store.uri_prefix,
      },
      tables: tables.map((table) => ({
        table: table.table,
        primary_keys: table.primary_keys,
        rows: table.rows.map((row) => ({
          key: rowKey(table.table, row),
          hash: rowHash(row, sourceArtifactUriToKey),
        })).sort((a, b) => a.key.localeCompare(b.key)),
      })),
      table_clocks: tableClocks.map((clock) => ({
        table: clock.table,
        machine_id: clock.machine_id,
        logical_clock: clock.logical_clock,
        high_water_hash: clock.high_water_hash,
        row_count: clock.row_count,
      })),
      artifacts: artifacts.map((artifact) => ({
        identity: artifactIdentity(artifact),
        fingerprint: artifactFingerprint(artifact),
      })).sort((a, b) => a.identity.localeCompare(b.identity)),
    }));
    const bundleId = `syncbundle_${contentHash.replace('sha256:', '').slice(0, 32)}`;
    for (const clock of tableClocks) finalizeExportTableClock(db, clock, bundleId, recordClocks, generatedAt);
    return {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      protocol_version: KNOWLEDGE_SYNC_PROTOCOL_VERSION,
      min_protocol_version: KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
      bundle_id: bundleId,
      content_hash: contentHash,
      generated_at: generatedAt,
      source: {
        scope: options.scope,
        workspace_home: options.workspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        machine_id: sourceMachineId,
        artifact_root_uri: options.storage.artifact_store.uri_prefix,
      },
      table_clocks: tableClocks,
      tables,
      artifacts,
      warnings,
      message: `${tables.reduce((sum, table) => sum + table.rows.length, 0)} row(s), ${artifacts.length} artifact(s) exported`,
    };
  } finally {
    db.close();
  }
}

function validateSyncProtocol(input: { protocol_version?: unknown; min_protocol_version?: unknown }, label: string): void {
  const protocolVersion = typeof input.protocol_version === 'number' ? input.protocol_version : null;
  const minProtocolVersion = typeof input.min_protocol_version === 'number' ? input.min_protocol_version : null;
  if (
    protocolVersion === null
    || minProtocolVersion === null
    || protocolVersion < KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION
    || minProtocolVersion > KNOWLEDGE_SYNC_PROTOCOL_VERSION
  ) {
    throw new Error(`Unsupported ${label} protocol. Expected knowledge sync protocol v${KNOWLEDGE_SYNC_PROTOCOL_VERSION} with min v${KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION}.`);
  }
}

function validateBundle(bundle: KnowledgeSyncBundle): void {
  if (!bundle || bundle.format !== 'knowledge-sync-bundle' || bundle.version !== 1) {
    throw new Error('Invalid knowledge sync bundle.');
  }
  validateSyncProtocol(bundle, 'knowledge sync bundle');
}

function getBundleTable(bundle: KnowledgeSyncBundle, table: KnowledgeSyncTable): KnowledgeSyncBundleTable | null {
  return bundle.tables.find((entry) => entry.table === table) ?? null;
}

function syncBundleContentHash(bundle: KnowledgeSyncBundle): string {
  if (typeof bundle.content_hash === 'string' && bundle.content_hash.length > 0) return bundle.content_hash;
  return sha256(stableJson({
    source: bundle.source,
    tables: bundle.tables.map((table) => ({
      table: table.table,
      rows: table.rows.map((row) => ({
        key: rowKey(table.table, row),
        hash: rowHash(row, artifactUriToKey(bundle.artifacts)),
      })).sort((a, b) => a.key.localeCompare(b.key)),
    })),
    artifacts: bundle.artifacts.map((artifact) => ({
      identity: artifactIdentity(artifact),
      fingerprint: artifactFingerprint(artifact),
    })).sort((a, b) => a.identity.localeCompare(b.identity)),
  }));
}

function syncBundleId(bundle: KnowledgeSyncBundle): string {
  if (typeof bundle.bundle_id === 'string' && bundle.bundle_id.length > 0) return bundle.bundle_id;
  return `syncbundle_${syncBundleContentHash(bundle).replace('sha256:', '').slice(0, 32)}`;
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
          local_artifact: sanitizeConflictEvidenceValue(target),
          remote_artifact: sanitizeConflictEvidenceValue(artifact),
        },
      });
      continue;
    }
    const hasEmbeddedContent = Boolean(artifact.key && artifact.content_base64);
    const canReferenceExistingS3 = canReferenceExistingS3Artifact(artifact, options.targetStorage);
    if (!hasEmbeddedContent && !canReferenceExistingS3) {
      result.missing_content += 1;
      options.warnings.push(`artifact_content_missing:${artifact.artifact_uri}`);
      continue;
    }
    if (options.dryRun) {
      result.copied += 1;
      continue;
    }

    let nextUri = artifact.artifact_uri;
    if (hasEmbeddedContent && artifact.key && artifact.content_base64) {
      const write = await options.targetStore.put({
        key: artifact.key,
        body: Buffer.from(artifact.content_base64, 'base64'),
        content_type: artifact.content_type ?? undefined,
      });
      nextUri = write.uri;
      uriMap.set(artifact.artifact_uri, nextUri);
    } else if (canReferenceExistingS3) {
      uriMap.set(artifact.artifact_uri, nextUri);
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
  logicalClock: number;
  bundleId: string;
  row?: Row;
}): void {
  const now = nowIso();
  db.query(`
    INSERT INTO knowledge_sync_changes (
      id, origin_machine_id, updated_by_machine_id, entity_kind, entity_id,
      operation, base_hash, next_hash, source_ref, source_revision_id,
      artifact_uri, logical_clock, bundle_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.logicalClock,
    input.bundleId,
    JSON.stringify({ source_machine_id: input.sourceMachineId, bundle_id: input.bundleId }),
    now,
  );
}

function insertConflict(db: Database, input: KnowledgeSyncConflictInput): boolean {
  const duplicate = db.query<{ id: string }, [
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    string | null,
  ]>(`
    SELECT id FROM knowledge_sync_conflicts
    WHERE entity_kind = ?
      AND entity_id = ?
      AND local_machine_id = ?
      AND remote_machine_id = ?
      AND COALESCE(local_hash, '') = COALESCE(?, '')
      AND COALESCE(remote_hash, '') = COALESCE(?, '')
      AND COALESCE(base_hash, '') = COALESCE(?, '')
      AND status = 'open'
    LIMIT 1
  `).get(
    input.entityKind,
    input.entityId,
    input.localMachineId,
    input.remoteMachineId,
    input.localHash ?? null,
    input.remoteHash ?? null,
    input.baseHash ?? null,
  );
  if (duplicate) return false;
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
  return true;
}

function getSyncImport(db: Database, bundleId: string): KnowledgeSyncImportRow | null {
  return db.query<KnowledgeSyncImportRow, [string]>(
    'SELECT * FROM knowledge_sync_imports WHERE bundle_id = ?',
  ).get(bundleId) ?? null;
}

function recordSyncImport(db: Database, input: {
  bundle: KnowledgeSyncBundle;
  bundleId: string;
  contentHash: string;
  sourceMachineId: string;
  targetMachineId: string;
  direction: KnowledgeSyncApplyResult['direction'];
  status: string;
  tableResults: KnowledgeSyncTableApplyResult[];
  conflicts: number;
  artifacts: KnowledgeSyncArtifactApplyResult;
  now?: string;
}): void {
  const now = input.now ?? nowIso();
  db.query(`
    INSERT INTO knowledge_sync_imports (
      bundle_id, source_machine_id, target_machine_id, direction, status,
      content_hash, table_clocks_json, tables_json, generated_at, applied_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bundle_id) DO UPDATE SET
      status = excluded.status,
      applied_at = excluded.applied_at,
      metadata_json = excluded.metadata_json
  `).run(
    input.bundleId,
    input.sourceMachineId,
    input.targetMachineId,
    input.direction,
    input.status,
    input.contentHash,
    JSON.stringify(input.bundle.table_clocks ?? []),
    JSON.stringify(input.tableResults),
    input.bundle.generated_at,
    now,
    JSON.stringify({
      conflicts: input.conflicts,
      artifacts: input.artifacts,
      source_workspace_home: input.bundle.source.workspace_home,
    }),
  );
}

function replayedApplyResult(options: {
  bundle: KnowledgeSyncBundle;
  targetBundle: KnowledgeSyncBundle;
  targetScope: string;
  targetWorkspaceHome: string;
  targetStorage: StorageContract;
  direction: KnowledgeSyncApplyResult['direction'];
  warnings: string[];
  bundleId: string;
}): KnowledgeSyncApplyResult {
  return {
    ok: true,
    protocol_version: KNOWLEDGE_SYNC_PROTOCOL_VERSION,
    min_protocol_version: KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
    dry_run: false,
    direction: options.direction,
    source: options.bundle.source,
    target: {
      scope: options.targetScope,
      workspace_home: options.targetWorkspaceHome,
      sqlite_schema_version: options.targetBundle.source.sqlite_schema_version,
      artifact_root_uri: options.targetStorage.artifact_store.uri_prefix,
    },
    tables: options.bundle.tables
      .filter((table) => !TABLE_SYNC_EXCLUDES.has(table.table))
      .map((table) => ({
        table: table.table,
        source_rows: table.rows.length,
        target_rows: getBundleTable(options.targetBundle, table.table)?.rows.length ?? 0,
        inserted: 0,
        updated: 0,
        deleted: 0,
        skipped: table.rows.length,
        conflicts: 0,
        stale_skipped: 0,
      })),
    artifacts: {
      source_artifacts: options.bundle.artifacts.length,
      target_artifacts: options.targetBundle.artifacts.length,
      copied: 0,
      skipped: options.bundle.artifacts.length,
      conflicts: 0,
      missing_content: 0,
    },
    conflicts_created: 0,
    bundle_id: options.bundleId,
    replayed: true,
    clocks: {
      advanced: 0,
      stale_tables: 0,
    },
    warnings: [...options.warnings, `bundle_replay_skipped:${options.bundleId}`],
    message: `Skipped already-applied bundle ${options.bundleId}`,
  };
}

function canSkipBundleReplay(bundle: KnowledgeSyncBundle, targetBundle: KnowledgeSyncBundle): boolean {
  const sourceArtifactUriToKey = artifactUriToKey(bundle.artifacts);
  const targetArtifactUriToKey = artifactUriToKey(targetBundle.artifacts);
  for (const sourceTable of bundle.tables) {
    if (TABLE_SYNC_EXCLUDES.has(sourceTable.table)) continue;
    const targetTable = getBundleTable(targetBundle, sourceTable.table);
    const incomingClock = bundleTableClock(bundle, sourceTable.table);
    const incomingHash = incomingClock?.high_water_hash
      ?? tableContentHash(sourceTable.table, sourceTable.rows, sourceArtifactUriToKey);
    const currentHash = tableContentHash(sourceTable.table, targetTable?.rows ?? [], targetArtifactUriToKey);
    if (currentHash !== incomingHash) return false;
  }
  return true;
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
  const warnings = [...options.bundle.warnings];
  const dryRun = options.dryRun === true;
  const localMachineId = defaultSyncMachineId(options.localMachineId);
  const sourceMachineId = options.bundle.source.machine_id ?? 'unknown';
  const bundleId = syncBundleId(options.bundle);
  const contentHash = syncBundleContentHash(options.bundle);
  const targetBundle = options.targetBundle ?? createKnowledgeSyncBundle({
    dbPath: options.targetDbPath,
    scope: options.targetScope,
    workspaceHome: options.targetWorkspaceHome,
    storage: options.targetStorage,
    machineId: localMachineId,
    includeArtifactContent: false,
    recordClocks: !dryRun,
  });
  const db = openKnowledgeDb(options.targetDbPath);
  try {
    if (!dryRun && getSyncImport(db, bundleId) && canSkipBundleReplay(options.bundle, targetBundle)) {
      return replayedApplyResult({
        bundle: options.bundle,
        targetBundle,
        targetScope: options.targetScope,
        targetWorkspaceHome: options.targetWorkspaceHome,
        targetStorage: options.targetStorage,
        direction: options.direction,
        warnings,
        bundleId,
      });
    }
    const artifactResult = await materializeArtifacts({
      db,
      bundle: options.bundle,
      targetBundle,
      targetStorage: options.targetStorage,
      targetStore: options.targetStore,
      dryRun,
      direction: options.direction,
      localMachineId,
      warnings,
    });
    const sourceArtifactUriToKey = artifactUriToKey(options.bundle.artifacts);
    const targetArtifactUriToKey = artifactUriToKey(targetBundle.artifacts);
    const tableResults: KnowledgeSyncTableApplyResult[] = [];
    let conflictsCreated = 0;
    let clocksAdvanced = 0;
    let staleTables = 0;

    for (const sourceTable of options.bundle.tables) {
      if (sourceTable.table === 'storage_objects' || TABLE_SYNC_EXCLUDES.has(sourceTable.table)) continue;
      if (!tableExists(db, sourceTable.table)) continue;
      const incomingClock = bundleTableClock(options.bundle, sourceTable.table);
      const existingClock = tableClock(db, sourceTable.table, sourceMachineId);
      const targetTable = getBundleTable(targetBundle, sourceTable.table);
      const targetRows = tableRowMap(sourceTable.table, targetTable?.rows ?? []);
      const incomingRowKeys = new Set(sourceTable.rows.map((row) => rowKey(sourceTable.table, row)));
      const importedRowHashes = latestImportedRowHashes(db, sourceTable.table, sourceMachineId);
      const rowsToWrite: Row[] = [];
      const result: KnowledgeSyncTableApplyResult = {
        table: sourceTable.table,
        source_rows: sourceTable.rows.length,
        target_rows: targetTable?.rows.length ?? 0,
        inserted: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        conflicts: 0,
        stale_skipped: 0,
      };

      if (!incomingClock) {
        warnings.push(`legacy_clock_missing:${sourceTable.table}`);
      } else if (staleIncomingClock(existingClock, incomingClock)) {
        staleTables += 1;
        result.skipped += sourceTable.rows.length;
        result.stale_skipped = sourceTable.rows.length;
        warnings.push(`stale_table_skipped:${sourceTable.table}:${sourceMachineId}:${incomingClock.logical_clock}`);
        tableResults.push(result);
        continue;
      }

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
        const importedHash = importedRowHashes.get(key);
        if (importedRowHashes.has(key) && importedHash === currentHash) {
          result.updated += 1;
          rowsToWrite.push(transformImportedRow(sourceRow, artifactResult.uriMap));
          continue;
        }
        result.conflicts += 1;
        if (!dryRun) {
          if (insertConflict(db, {
            entityKind: sourceTable.table,
            entityId: key,
            localMachineId,
            remoteMachineId: sourceMachineId,
            localHash: currentHash,
            remoteHash: incomingHash,
            baseHash: existingClock?.high_water_hash ?? null,
            metadata: {
              direction: options.direction,
              bundle_id: bundleId,
              incoming_logical_clock: incomingClock?.logical_clock ?? null,
              current_logical_clock: existingClock?.logical_clock ?? null,
              source_workspace_home: options.bundle.source.workspace_home,
              target_workspace_home: options.targetWorkspaceHome,
              local_row: sanitizeConflictEvidenceRow(targetRow),
              remote_row: sanitizeConflictEvidenceRow(sourceRow),
            },
          })) conflictsCreated += 1;
        }
      }

      if (!dryRun && rowsToWrite.length > 0) {
        const writtenRows = rowsToWrite.map((row) => transformImportedRow(row, artifactResult.uriMap));
        upsertSqliteRows(db, sourceTable.table, writtenRows);
        refreshDerivedRowsForImport(db, sourceTable.table, writtenRows);
        for (const row of writtenRows) {
          insertSyncChange(db, {
            direction: options.direction,
            sourceMachineId: options.bundle.source.machine_id ?? 'unknown',
            localMachineId,
            entityKind: sourceTable.table,
            entityId: rowKey(sourceTable.table, row),
            nextHash: rowHash(row, artifactUriToKey(options.bundle.artifacts)),
            logicalClock: incomingClock?.logical_clock ?? 0,
            bundleId,
            row,
          });
        }
      }
      for (const [key, importedHash] of importedRowHashes) {
        if (incomingRowKeys.has(key)) continue;
        const targetRow = targetRows.get(key);
        if (!targetRow) continue;
        const currentHash = rowHash(targetRow, targetArtifactUriToKey);
        if (importedHash && currentHash !== importedHash) {
          result.conflicts += 1;
          if (!dryRun) {
            if (insertConflict(db, {
              entityKind: sourceTable.table,
              entityId: key,
              localMachineId,
              remoteMachineId: sourceMachineId,
              localHash: currentHash,
              remoteHash: null,
              baseHash: importedHash,
              metadata: {
                direction: options.direction,
                bundle_id: bundleId,
                reason: 'remote_owned_row_missing_from_incoming_bundle',
                source_workspace_home: options.bundle.source.workspace_home,
                target_workspace_home: options.targetWorkspaceHome,
                local_row: sanitizeConflictEvidenceRow(targetRow),
                remote_row: null,
              },
            })) conflictsCreated += 1;
          }
          continue;
        }
        result.deleted += 1;
        if (!dryRun) deleteSqliteRowByKey(db, sourceTable.table, key);
      }
      if (!dryRun && incomingClock) {
        updateTableClock(db, {
          table: sourceTable.table,
          machineId: sourceMachineId,
          logicalClock: incomingClock.logical_clock,
          highWaterHash: incomingClock.high_water_hash,
          highWaterBundleId: bundleId,
          originMachineId: sourceMachineId,
          updatedByMachineId: localMachineId,
          lastAppliedAt: nowIso(),
          metadata: {
            source: 'import',
            direction: options.direction,
            row_count: sourceTable.rows.length,
            inserted: result.inserted,
            updated: result.updated,
            deleted: result.deleted,
            skipped: result.skipped,
            conflicts: result.conflicts,
          },
        });
        clocksAdvanced += 1;
      }
      tableResults.push(result);
    }

    for (const conflict of artifactResult.conflicts) {
      if (!dryRun) {
        if (insertConflict(db, {
          ...conflict,
          baseHash: conflict.baseHash ?? null,
          metadata: {
            ...conflict.metadata,
            bundle_id: bundleId,
          },
        })) conflictsCreated += 1;
      }
    }

    const inserted = tableResults.reduce((sum, table) => sum + table.inserted, 0);
    const conflicts = tableResults.reduce((sum, table) => sum + table.conflicts, 0) + artifactResult.result.conflicts;
    if (!dryRun) {
      recordSyncImport(db, {
        bundle: options.bundle,
        bundleId,
        contentHash,
        sourceMachineId,
        targetMachineId: localMachineId,
        direction: options.direction,
        status: conflicts === 0 ? 'applied' : 'conflicted',
        tableResults,
        conflicts,
        artifacts: artifactResult.result,
      });
    }
    return {
      ok: conflicts === 0,
      protocol_version: KNOWLEDGE_SYNC_PROTOCOL_VERSION,
      min_protocol_version: KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
      dry_run: dryRun,
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
      bundle_id: bundleId,
      replayed: false,
      clocks: {
        advanced: clocksAdvanced,
        stale_tables: staleTables,
      },
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
    const artifactUriMap = new Map<string, string>();
    for (const table of filterExistingTables(db, resolveSyncTables()).filter((entry) => !TABLE_SYNC_EXCLUDES.has(entry))) {
      const rows = tableRows(db, table);
      const highWaterHash = tableContentHash(table, rows, artifactUriMap);
      const existing = tableClock(db, table, machineId);
      const logicalClock = existing?.high_water_hash === highWaterHash
        ? existing.logical_clock
        : (existing?.logical_clock ?? 0) + 1;
      updateTableClock(db, {
        table,
        machineId,
        logicalClock,
        highWaterHash,
        highWaterBundleId: row.id,
        originMachineId: existing?.origin_machine_id ?? machineId,
        updatedByMachineId: machineId,
        lastAppliedAt: createdAt,
        metadata: {
          source: 'snapshot',
          row_count: rows.length,
        },
        now: createdAt,
      });
    }
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
    const clocks = listTableClocks(db);
    const latestImport = db.query<KnowledgeSyncImportRow, []>(
      'SELECT * FROM knowledge_sync_imports ORDER BY applied_at DESC LIMIT 1',
    ).get() ?? null;
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
      clocks: {
        total: clocks.length,
        rows: clocks,
      },
      imports: {
        total: count(db, 'knowledge_sync_imports'),
        latest: latestImport,
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

function hydrateConflict(row: KnowledgeSyncConflictRow): KnowledgeSyncConflict {
  return {
    ...row,
    metadata: parseJson(row.metadata_json, {}),
  };
}

export function getKnowledgeSyncConflict(dbPath: string, id: string): KnowledgeSyncConflict | null {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const row = db.query<KnowledgeSyncConflictRow, [string]>(
      'SELECT * FROM knowledge_sync_conflicts WHERE id = ?',
    ).get(id);
    return row ? hydrateConflict(row) : null;
  } finally {
    db.close();
  }
}

export function listKnowledgeSyncConflicts(dbPath: string, options: { status?: string; limit?: number } = {}): KnowledgeSyncConflict[] {
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
    return rows.map(hydrateConflict);
  } finally {
    db.close();
  }
}

function conflictTable(value: string): KnowledgeSyncTable | null {
  return (KNOWLEDGE_SYNC_TABLES as readonly string[]).includes(value) ? value as KnowledgeSyncTable : null;
}

function catalogRowForConflict(db: Database, conflict: KnowledgeSyncConflict): Row | null {
  const table = conflictTable(conflict.entity_kind);
  if (!table || !tableExists(db, table)) return null;
  const values = parseRowKeyValues(table, conflict.entity_id);
  if (!values) return null;
  const where = primaryKeyWhereClause(table);
  return db.query(`SELECT * FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1`).get(...values) as Row | null;
}

function rowFromMetadata(metadata: Record<string, unknown>, keys: string[]): Row | null {
  for (const key of keys) {
    const value = metadata[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return sanitizeConflictEvidenceRow(value as Row);
  }
  return null;
}

function addSourceRef(refs: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (
    trimmed.startsWith('open-files://')
    || trimmed.startsWith('s3://')
    || trimmed.startsWith('file://')
    || trimmed.startsWith('https://')
    || trimmed.startsWith('http://')
  ) refs.add(trimmed);
}

function collectSourceRefs(value: unknown, refs = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || value === null || value === undefined) return refs;
  if (typeof value === 'string') {
    addSourceRef(refs, value);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSourceRefs(entry, refs, depth + 1);
    return refs;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'source_ref' || key === 'source_uri' || key === 'artifact_uri' || key.endsWith('_uri')) addSourceRef(refs, entry);
      collectSourceRefs(entry, refs, depth + 1);
    }
  }
  return refs;
}

function conflictCitations(input: {
  conflict: KnowledgeSyncConflict;
  localRow: Row | null;
  remoteRow: Row | null;
  sourceRefs: string[];
}): KnowledgeSyncConflictProposalCitation[] {
  const citations: KnowledgeSyncConflictProposalCitation[] = [{
    id: 'conflict',
    kind: 'metadata',
    ref: `knowledge-sync-conflict://${input.conflict.id}`,
    hash: input.conflict.base_hash,
    quote: `Conflict on ${input.conflict.entity_kind}:${input.conflict.entity_id}`,
  }];
  if (input.localRow) {
    citations.push({
      id: 'local-row',
      kind: 'row',
      ref: `${input.conflict.entity_kind}:${input.conflict.entity_id}:local`,
      hash: input.conflict.local_hash,
      quote: JSON.stringify(input.localRow).slice(0, 300),
    });
  }
  if (input.remoteRow) {
    citations.push({
      id: 'remote-row',
      kind: 'row',
      ref: `${input.conflict.entity_kind}:${input.conflict.entity_id}:remote`,
      hash: input.conflict.remote_hash,
      quote: JSON.stringify(input.remoteRow).slice(0, 300),
    });
  }
  input.sourceRefs.slice(0, 10).forEach((ref, index) => {
    citations.push({
      id: `source-${index + 1}`,
      kind: ref.startsWith('file://') || ref.startsWith('s3://') ? 'artifact' : 'source_ref',
      ref,
      hash: null,
      quote: null,
    });
  });
  return citations;
}

export function getKnowledgeSyncConflictEvidence(dbPath: string, id: string): KnowledgeSyncConflictEvidence {
  const conflict = getKnowledgeSyncConflict(dbPath, id);
  if (!conflict) throw new Error(`Sync conflict not found: ${id}`);
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const localRow = sanitizeConflictEvidenceRow(catalogRowForConflict(db, conflict));
    const remoteRow = rowFromMetadata(conflict.metadata, ['remote_row', 'source_row', 'incoming_row']);
    const refs = collectSourceRefs({
      conflict: {
        entity_kind: conflict.entity_kind,
        entity_id: conflict.entity_id,
        metadata: conflict.metadata,
      },
      local_row: localRow,
      remote_row: remoteRow,
    });
    const sourceRefs = [...refs].slice(0, 25);
    const readOnlyTools: KnowledgeSyncConflictReadOnlyToolCall[] = [
      {
        name: 'knowledge_sync_conflict_get',
        input: { id },
        output_summary: `${conflict.entity_kind}:${conflict.entity_id} status=${conflict.status}`,
      },
      {
        name: 'knowledge_catalog_row_get',
        input: { table: conflict.entity_kind, key: conflict.entity_id },
        output_summary: localRow ? 'local row found' : 'local row unavailable',
      },
      {
        name: 'knowledge_source_ref_extract',
        input: { id },
        output_summary: `${sourceRefs.length} source/artifact ref(s) found`,
      },
    ];
    return {
      conflict,
      local_row: localRow,
      remote_row: remoteRow,
      source_refs: sourceRefs,
      citations: conflictCitations({ conflict, localRow, remoteRow, sourceRefs }),
      read_only_tools: readOnlyTools,
    };
  } finally {
    db.close();
  }
}

export function proposeKnowledgeSyncConflictResolution(dbPath: string, id: string): KnowledgeSyncConflictResolutionProposal {
  const conflict = getKnowledgeSyncConflict(dbPath, id);
  if (!conflict) throw new Error(`Sync conflict not found: ${id}`);
  const proposedStrategy = conflict.entity_kind === 'wiki_pages' ? 'manual-merge' : 'review-and-select';
  const summary = [
    `Conflict ${conflict.id} affects ${conflict.entity_kind}:${conflict.entity_id}.`,
    `Local machine ${conflict.local_machine_id} has ${conflict.local_hash ?? 'unknown hash'}.`,
    `Remote machine ${conflict.remote_machine_id} has ${conflict.remote_hash ?? 'unknown hash'}.`,
  ].join(' ');
  const mergePrompt = [
    'Review this knowledge sync conflict before any durable write.',
    `Entity: ${conflict.entity_kind}:${conflict.entity_id}`,
    `Local machine/hash: ${conflict.local_machine_id} / ${conflict.local_hash ?? 'unknown'}`,
    `Remote machine/hash: ${conflict.remote_machine_id} / ${conflict.remote_hash ?? 'unknown'}`,
    `Base hash: ${conflict.base_hash ?? 'unknown'}`,
    `Metadata: ${JSON.stringify(conflict.metadata)}`,
    'Return a concise merge recommendation with citations to the competing records. Do not write changes without approval.',
  ].join('\n');
  return {
    ok: true,
    conflict,
    requires_approval: true,
    mode: 'deterministic',
    proposed_strategy: proposedStrategy,
    summary,
    merge_prompt: mergePrompt,
    proposed_patch: null,
    citations: conflictCitations({ conflict, localRow: null, remoteRow: null, sourceRefs: [] }),
    confidence: null,
    agent: null,
    warnings: conflict.status === 'resolved' ? ['conflict_already_resolved'] : [],
    message: `Prepared approval-gated merge proposal for ${conflict.id}`,
  };
}

export function resolveKnowledgeSyncConflict(dbPath: string, input: {
  id: string;
  strategy: string;
  approvedBy: string;
  proposedPatchUri?: string | null;
}): KnowledgeSyncConflict {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = nowIso();
  try {
    const existing = db.query<KnowledgeSyncConflictRow, [string]>(
      'SELECT * FROM knowledge_sync_conflicts WHERE id = ?',
    ).get(input.id);
    if (!existing) throw new Error(`Sync conflict not found: ${input.id}`);
    db.query(`
      UPDATE knowledge_sync_conflicts
      SET status = 'resolved',
          resolution_strategy = ?,
          proposed_patch_uri = ?,
          approved_by = ?,
          resolved_at = ?
      WHERE id = ?
    `).run(input.strategy, input.proposedPatchUri ?? existing.proposed_patch_uri, input.approvedBy, now, input.id);
    const row = db.query<KnowledgeSyncConflictRow, [string]>(
      'SELECT * FROM knowledge_sync_conflicts WHERE id = ?',
    ).get(input.id);
    if (!row) throw new Error(`Sync conflict not found after resolve: ${input.id}`);
    return hydrateConflict(row);
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
