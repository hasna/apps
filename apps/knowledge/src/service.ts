import { createArtifactStore, normalizeArtifactKey } from './artifact-store';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import {
  clearKnowledgeAuth,
  knowledgeAuthStatus,
  normalizeKnowledgeApiOrigin,
  saveKnowledgeAuth,
  type KnowledgeAuthStatus,
} from './auth';
import { runKnowledgePrompt, type KnowledgePromptOptions } from './agent';
import {
  proposeKnowledgeSyncConflictResolutionWithAi,
  type KnowledgeSyncConflictAiProposalOptions,
} from './conflict-agent';
import {
  embeddingIndexStatus,
  indexKnowledgeEmbeddings,
  searchVectorIndex,
  type EmbeddingIndexOptions,
  type EmbeddingSearchOptions,
} from './embeddings';
import { consumeOpenFilesOutbox } from './outbox-consume';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { ingestOpenFilesManifest } from './manifest-ingest';
import {
  discoverKnowledgeMachineTopology,
  preflightKnowledgeMachine,
  resolveKnowledgeMachineRoute,
  resolveKnowledgeMachineWorkspace,
  type KnowledgeMachinePreflightOptions,
  type KnowledgeMachineRouteResolution,
  type KnowledgeMachineWorkspaceResolution,
  type KnowledgeMachineTopologyOptions,
} from './machines';
import { ingestSourceRef } from './source-ingest';
import { resolveOpenFilesSource } from './source-resolver';
import { providerStatus, listModelRegistry, type ProviderStatusResult, type ModelRegistryEntry } from './providers';
import { enqueueMissingEmbeddings, refreshEmbeddingIndex, reindexHealth, type ReindexRuntimeOptions } from './reindex';
import { knowledgeRegistryContract, RemoteKnowledgeClient, type RemoteKnowledgeRegistryContract } from './remote-client';
import { retrieveKnowledgeContext, type RetrievalOptions } from './retrieval';
import { hybridSearch, type HybridSearchOptions } from './search';
import { recordAuditEvent, resolveSafetyPolicy } from './safety';
import { runProviderWebSearch, type WebSearchOptions } from './web-search';
import {
  applyKnowledgeSyncBundle,
  createKnowledgeSyncSnapshot,
  createKnowledgeSyncBundle,
  getKnowledgeSyncConflict,
  getKnowledgeSyncStatus,
  KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
  KNOWLEDGE_SYNC_PROTOCOL_VERSION,
  listKnowledgeMachines,
  listKnowledgeSyncConflicts,
  proposeKnowledgeSyncConflictResolution,
  recordKnowledgeMachineResolverEvidence,
  resolveKnowledgeSyncConflict,
  type KnowledgeSyncConflict,
  type KnowledgeSyncConflictResolutionProposal,
  type KnowledgePeerSyncResult,
  type KnowledgeSyncApplyResult,
  type KnowledgeSyncBundle,
  type KnowledgeSyncMachineRow,
  type KnowledgeSyncSnapshotResult,
  type KnowledgeSyncStatus,
} from './sync';
import { compileWikiPage, fileAnswerToWiki, lintWiki, type WikiCompileOptions } from './wiki-compiler';
import {
  recordStorageObjects,
  resolveStorageContract,
  validateStorageConfig,
  type StorageContract,
  type StorageValidationResult,
} from './storage-contract';
import { initializeWikiLayout, recordWikiLayoutCatalog } from './wiki-layout';
import {
  canonicalHasnaXyzKnowledgeStorage,
  ensureKnowledgeWorkspace,
  projectKnowledgeHome,
  readKnowledgeConfig,
  resolveScopedWorkspace,
  workspaceForHome,
  writeKnowledgeConfig,
  type KnowledgeConfig,
  type KnowledgeWorkspace,
} from './workspace';

export interface KnowledgeServiceOptions {
  scope?: string;
  cwd?: string;
}

export interface KnowledgePathsResult {
  ok: true;
  scope: string;
  home: string;
  config_path: string;
  json_store_path: string;
  knowledge_db_path: string;
  artifacts_dir: string;
  indexes_dir: string;
  logs_dir: string;
  runs_dir: string;
  schemas_dir: string;
  wiki_dir: string;
  config: KnowledgeConfig;
  message: string;
}

export interface KnowledgeSetupResult {
  ok: true;
  mode: KnowledgeConfig['mode'];
  api_url: string | null;
  storage_type: KnowledgeConfig['storage']['type'];
  artifact_uri_prefix: string;
  canonical_hasna_xyz: StorageContract['canonical_hasna_xyz'];
  config_path: string;
  next: string[];
  message: string;
}

export interface KnowledgeSyncSnapshotOptions {
  includeTailscale?: boolean;
  machineId?: string;
}

export interface KnowledgeSyncBundleOptions {
  machineId?: string | null;
  tables?: string[];
  includeArtifactContent?: boolean;
  recordClocks?: boolean;
}

export interface KnowledgeSyncImportOptions {
  bundle: KnowledgeSyncBundle;
  dryRun?: boolean;
  direction?: 'pull' | 'push' | 'import';
  machineId?: string | null;
}

export interface KnowledgePeerSyncOptions {
  peerWorkspace: string;
  direction?: 'pull' | 'push' | 'both';
  dryRun?: boolean;
  tables?: string[];
  includeArtifactContent?: boolean;
  machineId?: string | null;
}

export interface KnowledgeRemotePeerSyncOptions extends Omit<KnowledgePeerSyncOptions, 'peerWorkspace'> {
  machine: string;
  peerWorkspace?: string;
  includeTailscale?: boolean;
}

export interface KnowledgeRemotePeerSyncResult extends KnowledgePeerSyncResult {
  transport: 'ssh';
  machine: string;
  resolved_machine: string;
  resolved_route: {
    source: KnowledgeMachineRouteResolution['source'];
    adapter: KnowledgeMachineRouteResolution['adapter'];
    target: string;
    route: KnowledgeMachineRouteResolution['route'];
    target_kind: KnowledgeMachineRouteResolution['targetKind'];
    confidence: KnowledgeMachineRouteResolution['confidence'];
    evidence: KnowledgeMachineRouteResolution['evidence'];
  };
  resolved_workspace: NonNullable<KnowledgePeerSyncResult['resolved_workspace']>;
  peer_workspace: string;
}

export interface KnowledgeSyncDoctorOptions {
  machine?: string | null;
  peerWorkspace?: string | null;
  includeTailscale?: boolean;
  tables?: string[];
}

export interface KnowledgeSyncRecommendedCommand {
  id: string;
  reason: string;
  command: string[];
  shell_command: string;
}

export interface KnowledgeOpenFilesBoundaryStatus {
  ok: boolean;
  source_of_truth: 'open-files';
  configured_root: string | null;
  configured_root_source: KnowledgeMachineWorkspaceResolution['open_files_root_source'] | null;
  source_refs: {
    open_files: number;
    metadata_mentions: number;
  };
  extracted_text_artifacts: number;
  raw_source_bytes_owned_by: 'open-files';
  raw_payload_sentinel_hits: number;
  message: string;
}

export interface KnowledgeArtifactManifestStatus {
  ok: boolean;
  read_only: true;
  storage_type: StorageContract['storage_type'];
  artifact_uri_prefix: string;
  s3: StorageContract['artifact_store']['s3'];
  artifacts: {
    total: number;
    by_kind: Array<{ kind: string; count: number }>;
    with_hash: number;
    missing_hash: number;
    with_size: number;
    missing_size: number;
    total_size_bytes: number;
  };
  modified_time: {
    with_modified_at: number;
    missing_modified_at: number;
    invalid_modified_at: number;
    examples: string[];
  };
  provenance: {
    with_provenance: number;
    missing_provenance: number;
    with_artifact_key: number;
    missing_artifact_key: number;
    artifact_key_mismatches: number;
    generated_from: Array<{ value: string; count: number }>;
    examples: string[];
  };
  uri_prefix: {
    matching: number;
    mismatched: number;
    examples: string[];
  };
  keys: {
    with_key: number;
    missing_key: number;
    prefixed_with_storage_prefix: number;
    prefixed_examples: string[];
  };
  sync_manifest: {
    copied_by_sync: true;
    generated_artifacts_only: true;
    includes_raw_source_bytes: false;
    hash_algorithm: 'sha256';
    portable_keys: boolean;
    tracks_modified_time: boolean;
    preserves_provenance: boolean;
  };
  raw_payload_sentinel_hits: number;
  warnings: string[];
  message: string;
}

export interface KnowledgeArtifactManifestKeyRepairCandidate {
  id: string;
  artifact_uri: string;
  kind: string;
  current_key: string;
  repaired_key: string;
  hash: string | null;
  size_bytes: number | null;
}

export interface KnowledgeArtifactManifestKeyRepairResult {
  ok: boolean;
  dry_run: boolean;
  approval_required: boolean;
  storage_type: StorageContract['storage_type'];
  storage_prefix: string | null;
  candidates: KnowledgeArtifactManifestKeyRepairCandidate[];
  repaired: number;
  audit_event_id: string | null;
  message: string;
}

export interface KnowledgeSyncDoctorResult {
  ok: boolean;
  read_only: true;
  generated_at: string;
  scope: string;
  workspace_home: string;
  database: {
    sqlite_schema_version: number;
    table_counts: Record<string, number>;
  };
  storage: {
    contract: StorageContract;
    validation: StorageValidationResult;
    artifact_manifest: KnowledgeArtifactManifestStatus;
  };
  sync: {
    machines: number;
    snapshots: number;
    clocks: number;
    imports: number;
    open_conflicts: number;
    table_clocks: KnowledgeSyncStatus['clocks']['rows'];
  };
  open_files: KnowledgeOpenFilesBoundaryStatus;
  resolved_route: KnowledgeRemotePeerSyncResult['resolved_route'] | null;
  resolved_workspace: KnowledgePeerSyncResult['resolved_workspace'] | null;
  recommended_commands: KnowledgeSyncRecommendedCommand[];
  warnings: string[];
  message: string;
}

export interface KnowledgeSyncConflictResolveOptions {
  id: string;
  strategy?: string;
  approvedBy?: string;
  approveWrite?: boolean;
  proposedPatchUri?: string | null;
}

export interface KnowledgeSyncConflictAiProposalServiceOptions {
  id: string;
  modelRef?: string;
  fake?: boolean;
  env?: KnowledgeSyncConflictAiProposalOptions['env'];
}

export type KnowledgeSyncConflictResolveResult = {
  ok: false;
  approval_required: true;
  conflict: KnowledgeSyncConflict;
  proposal: KnowledgeSyncConflictResolutionProposal;
  message: string;
} | {
  ok: true;
  approval_required: false;
  conflict: KnowledgeSyncConflict;
  audit_event_id: string;
  message: string;
};

function resolvePeerWorkspace(input: string): KnowledgeWorkspace {
  const target = resolve(input);
  if (existsSync(join(target, 'knowledge.db')) || existsSync(join(target, 'config.json'))) {
    return ensureKnowledgeWorkspace(target);
  }
  return ensureKnowledgeWorkspace(workspaceForHome(projectKnowledgeHome(target)).home);
}

function workspaceMachineId(workspace: KnowledgeWorkspace): string {
  return `${hostname()}:${createHash('sha256').update(workspace.home).digest('hex').slice(0, 12)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function knowledgeCliCommand(args: string[]): KnowledgeSyncRecommendedCommand['shell_command'] {
  return ['knowledge', ...args].map(shellQuote).join(' ');
}

function remoteKnowledgeCommand(peerWorkspace: string, args: string[]): string {
  return `cd ${shellQuote(peerWorkspace)} && knowledge ${args.map(shellQuote).join(' ')}`;
}

function serviceMachineIsLocal(machine: string | null | undefined): boolean {
  return !machine || machine === 'local' || machine === 'localhost';
}

function workspaceSummary(resolvedWorkspace: KnowledgeMachineWorkspaceResolution, projectRoot: string): NonNullable<KnowledgePeerSyncResult['resolved_workspace']> {
  return {
    source: resolvedWorkspace.source,
    adapter: resolvedWorkspace.adapter,
    project_root: projectRoot,
    project_root_source: resolvedWorkspace.project_root_source,
    workspace_root: resolvedWorkspace.workspace_root,
    workspace_root_source: resolvedWorkspace.workspace_root_source,
    open_files_root: resolvedWorkspace.open_files_root,
    open_files_root_source: resolvedWorkspace.open_files_root_source,
    trust_status: resolvedWorkspace.trust_status,
    auth_status: resolvedWorkspace.auth_status,
    current: resolvedWorkspace.current,
    primary: resolvedWorkspace.primary,
    diagnostics: resolvedWorkspace.diagnostics,
    repair_hints: resolvedWorkspace.repair_hints,
    evidence: resolvedWorkspace.evidence,
    warnings: resolvedWorkspace.warnings,
  };
}

function routeSummary(resolvedMachine: KnowledgeMachineRouteResolution): KnowledgeRemotePeerSyncResult['resolved_route'] {
  return {
    source: resolvedMachine.source,
    adapter: resolvedMachine.adapter,
    target: resolvedMachine.target,
    route: resolvedMachine.route,
    target_kind: resolvedMachine.targetKind,
    confidence: resolvedMachine.confidence,
    evidence: resolvedMachine.evidence,
  };
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function registryMachineMatches(row: KnowledgeSyncMachineRow, machine: string): boolean {
  return row.machine_id === machine
    || row.hostname === machine
    || row.ssh_target === machine
    || row.tailscale_dns === machine
    || parseJsonStringArray(row.tailscale_ips_json).includes(machine);
}

function findRegistryMachine(dbPath: string, machine: string): KnowledgeSyncMachineRow | null {
  return listKnowledgeMachines(dbPath).find((row) => registryMachineMatches(row, machine)) ?? null;
}

function registryResolverEvidence(row: KnowledgeSyncMachineRow): Record<string, unknown> {
  return recordValue(parseMetadataJson(row.metadata_json).resolver_evidence);
}

function registryResolverCapabilities(row: KnowledgeSyncMachineRow): Record<string, unknown> {
  return recordValue(parseMetadataJson(row.capabilities_json).resolver);
}

function registryRouteKind(row: KnowledgeSyncMachineRow): KnowledgeMachineRouteResolution['route'] {
  const resolver = registryResolverCapabilities(row);
  const kind = stringValue(resolver.route_kind);
  if (kind === 'local' || kind === 'lan' || kind === 'tailscale' || kind === 'ssh' || kind === 'unknown') return kind;
  if (row.tailscale_dns && row.ssh_target === row.tailscale_dns) return 'tailscale';
  return row.ssh_target ? 'ssh' : 'unknown';
}

function registryRouteTargetKind(row: KnowledgeSyncMachineRow): KnowledgeMachineRouteResolution['targetKind'] {
  const resolver = registryResolverCapabilities(row);
  const kind = stringValue(resolver.route_target_kind);
  if (kind === 'local' || kind === 'lan' || kind === 'tailscale' || kind === 'ssh' || kind === 'unknown') return kind;
  return registryRouteKind(row);
}

function registryRouteConfidence(row: KnowledgeSyncMachineRow): KnowledgeMachineRouteResolution['confidence'] {
  return stringValue(registryResolverCapabilities(row).route_confidence) ?? 'medium';
}

function routeFromRegistry(row: KnowledgeSyncMachineRow, machine: string, fallback: KnowledgeMachineRouteResolution): KnowledgeMachineRouteResolution {
  const evidence = registryResolverEvidence(row);
  return {
    target: row.ssh_target ?? row.tailscale_dns ?? row.hostname ?? row.machine_id,
    route: registryRouteKind(row),
    targetKind: registryRouteTargetKind(row),
    confidence: registryRouteConfidence(row),
    source: 'registry',
    adapter: fallback.adapter,
    evidence: {
      registry: true,
      requested_machine_id: machine,
      machine_id: row.machine_id,
      recorded_at: row.updated_at,
      route: recordValue(evidence.route),
    },
    warnings: [...new Set([...fallback.warnings, 'registry_route_fallback'])],
  };
}

function workspaceFromRegistry(row: KnowledgeSyncMachineRow, machine: string, fallback: KnowledgeMachineWorkspaceResolution): KnowledgeMachineWorkspaceResolution | null {
  if (!row.workspace_home) return null;
  const evidence = registryResolverEvidence(row);
  const workspaceEvidence = recordValue(evidence.workspace);
  const resolver = registryResolverCapabilities(row);
  return {
    ok: true,
    source: 'registry',
    adapter: fallback.adapter,
    requested_machine_id: machine,
    machine_id: row.machine_id,
    project_id: stringValue(workspaceEvidence.project_id) ?? fallback.project_id,
    repo_name: stringValue(workspaceEvidence.repo_name) ?? fallback.repo_name,
    project_root: row.workspace_home,
    project_root_source: stringValue(resolver.project_root_source) ?? 'registry',
    workspace_root: stringValue(workspaceEvidence.workspace_root),
    workspace_root_source: stringValue(resolver.workspace_root_source) ?? 'registry',
    open_files_root: stringValue(workspaceEvidence.open_files_root),
    open_files_root_source: stringValue(resolver.open_files_root_source) ?? 'registry',
    trust_status: stringValue(resolver.trust_status) ?? 'unknown',
    auth_status: stringValue(resolver.auth_status) ?? 'unknown',
    current: false,
    primary: false,
    diagnostics: [],
    repair_hints: [],
    evidence: {
      registry: true,
      requested_machine_id: machine,
      machine_id: row.machine_id,
      recorded_at: row.updated_at,
      workspace: workspaceEvidence,
    },
    warnings: [...new Set([...fallback.warnings, 'registry_workspace_fallback'])],
  };
}

function workspaceReadinessMessage(resolvedWorkspace: KnowledgePeerSyncResult['resolved_workspace']): string | null {
  if (!resolvedWorkspace) return null;
  const nonOkDiagnostics = resolvedWorkspace.diagnostics.filter((entry) => entry.severity !== 'ok');
  const firstRepair = resolvedWorkspace.repair_hints[0];
  if (!nonOkDiagnostics.length && !resolvedWorkspace.warnings.length && !firstRepair) return null;
  return [
    nonOkDiagnostics.length ? `workspace diagnostics: ${nonOkDiagnostics.map((entry) => `${entry.id}=${entry.status}`).join(', ')}` : null,
    resolvedWorkspace.warnings.length ? `warnings: ${resolvedWorkspace.warnings.join(', ')}` : null,
    firstRepair ? `repair: ${firstRepair.shell_command}` : null,
  ].filter(Boolean).join('; ');
}

function syncCommand(input: {
  id: string;
  reason: string;
  args: string[];
}): KnowledgeSyncRecommendedCommand {
  return {
    id: input.id,
    reason: input.reason,
    command: ['knowledge', ...input.args],
    shell_command: knowledgeCliCommand(input.args),
  };
}

function countQuery(dbPath: string, sql: string): number {
  const db = openKnowledgeDb(dbPath);
  try {
    return Number(db.query<{ count: number }, []>(sql).get()?.count ?? 0);
  } finally {
    db.close();
  }
}

function openFilesBoundaryStatus(
  dbPath: string,
  resolvedWorkspace: KnowledgePeerSyncResult['resolved_workspace'] | null,
): KnowledgeOpenFilesBoundaryStatus {
  const openFilesRefs = countQuery(dbPath, "SELECT COUNT(*) AS count FROM sources WHERE uri LIKE 'open-files://%'");
  const metadataMentions = countQuery(dbPath, "SELECT COUNT(*) AS count FROM sources WHERE metadata_json LIKE '%open-files://%' OR metadata_json LIKE '%source_ref%'");
  const extractedTextArtifacts = countQuery(dbPath, 'SELECT COUNT(*) AS count FROM source_revisions WHERE extracted_text_uri IS NOT NULL');
  const rawPayloadSentinelHits = countQuery(dbPath, [
    "SELECT COUNT(*) AS count FROM sources",
    "WHERE metadata_json LIKE '%raw_bytes%'",
    "OR metadata_json LIKE '%raw_content%'",
    "OR metadata_json LIKE '%content_base64%'",
    "OR metadata_json LIKE '%source_bytes%'",
  ].join(' '));
  const ok = rawPayloadSentinelHits === 0;
  return {
    ok,
    source_of_truth: 'open-files',
    configured_root: resolvedWorkspace?.open_files_root ?? null,
    configured_root_source: resolvedWorkspace?.open_files_root_source ?? null,
    source_refs: {
      open_files: openFilesRefs,
      metadata_mentions: metadataMentions,
    },
    extracted_text_artifacts: extractedTextArtifacts,
    raw_source_bytes_owned_by: 'open-files',
    raw_payload_sentinel_hits: rawPayloadSentinelHits,
    message: ok
      ? `${openFilesRefs} open-files source ref(s); raw source bytes remain owned by open-files`
      : `${rawPayloadSentinelHits} raw source payload metadata sentinel(s) found`,
  };
}

const RAW_ARTIFACT_PAYLOAD_METADATA_KEYS = new Set([
  'raw',
  'raw_bytes',
  'raw_content',
  'content_base64',
  'source_bytes',
  'source_content',
  'body',
  'body_bytes',
]);

function metadataHasRawPayloadSentinel(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => metadataHasRawPayloadSentinel(entry, depth + 1));
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_ARTIFACT_PAYLOAD_METADATA_KEYS.has(key.toLowerCase())) return true;
    if (metadataHasRawPayloadSentinel(entry, depth + 1)) return true;
  }
  return false;
}

function parseMetadataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function storagePrefixKey(storage: StorageContract): string | null {
  const prefix = storage.artifact_store.s3?.prefix?.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/` : null;
}

function artifactManifestStatus(dbPath: string, storage: StorageContract): KnowledgeArtifactManifestStatus {
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query<{
      artifact_uri: string;
      kind: string;
      hash: string | null;
      size_bytes: number | null;
      metadata_json: string;
    }, []>(
      `SELECT artifact_uri, kind, hash, size_bytes, metadata_json
       FROM storage_objects
       ORDER BY artifact_uri ASC`,
    ).all();

    const byKind = new Map<string, number>();
    let withHash = 0;
    let withSize = 0;
    let totalSizeBytes = 0;
    let matchingPrefix = 0;
    let missingKey = 0;
    let prefixedKey = 0;
    let rawPayloadSentinelHits = 0;
    let withModifiedAt = 0;
    let invalidModifiedAt = 0;
    let withProvenance = 0;
    let withProvenanceArtifactKey = 0;
    let provenanceArtifactKeyMismatches = 0;
    const generatedFrom = new Map<string, number>();
    const mismatchedExamples: string[] = [];
    const prefixedExamples: string[] = [];
    const invalidModifiedExamples: string[] = [];
    const provenanceExamples: string[] = [];
    const expectedPrefix = storage.artifact_store.uri_prefix;
    const s3StoragePrefix = storagePrefixKey(storage);

    for (const row of rows) {
      byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
      if (row.hash?.startsWith('sha256:')) withHash += 1;
      if (typeof row.size_bytes === 'number' && row.size_bytes >= 0) {
        withSize += 1;
        totalSizeBytes += row.size_bytes;
      }
      if (row.artifact_uri.startsWith(expectedPrefix)) {
        matchingPrefix += 1;
      } else if (mismatchedExamples.length < 5) {
        mismatchedExamples.push(row.artifact_uri);
      }

      const metadata = parseMetadataJson(row.metadata_json);
      if (metadataHasRawPayloadSentinel(metadata)) rawPayloadSentinelHits += 1;
      const key = typeof metadata.key === 'string' ? metadata.key : null;
      if (!key) {
        missingKey += 1;
      } else if (s3StoragePrefix && key.startsWith(s3StoragePrefix)) {
        prefixedKey += 1;
        if (prefixedExamples.length < 5) prefixedExamples.push(key);
      }
      const modifiedAt = typeof metadata.artifact_modified_at === 'string' ? metadata.artifact_modified_at : null;
      if (modifiedAt) {
        if (Number.isNaN(Date.parse(modifiedAt))) {
          invalidModifiedAt += 1;
          if (invalidModifiedExamples.length < 5) invalidModifiedExamples.push(row.artifact_uri);
        } else {
          withModifiedAt += 1;
        }
      }

      const provenance = metadata.provenance && typeof metadata.provenance === 'object' && !Array.isArray(metadata.provenance)
        ? metadata.provenance as Record<string, unknown>
        : null;
      if (provenance) {
        withProvenance += 1;
        const artifactKey = typeof provenance.artifact_key === 'string' ? provenance.artifact_key : null;
        const generated = typeof provenance.generated_from === 'string' ? provenance.generated_from : 'unknown';
        generatedFrom.set(generated, (generatedFrom.get(generated) ?? 0) + 1);
        if (artifactKey) {
          withProvenanceArtifactKey += 1;
          if (key && artifactKey !== key) {
            provenanceArtifactKeyMismatches += 1;
            if (provenanceExamples.length < 5) provenanceExamples.push(`${row.artifact_uri}:provenance.artifact_key=${artifactKey}:key=${key}`);
          }
        } else if (provenanceExamples.length < 5) {
          provenanceExamples.push(`${row.artifact_uri}:missing_provenance_artifact_key`);
        }
      } else if (provenanceExamples.length < 5) {
        provenanceExamples.push(`${row.artifact_uri}:missing_provenance`);
      }
    }

    const missingHash = rows.length - withHash;
    const missingSize = rows.length - withSize;
    const missingModifiedAt = rows.length - withModifiedAt - invalidModifiedAt;
    const missingProvenance = rows.length - withProvenance;
    const missingProvenanceArtifactKey = withProvenance - withProvenanceArtifactKey;
    const mismatchedPrefix = rows.length - matchingPrefix;
    const warnings = [
      missingHash > 0 ? `artifact_manifest_missing_hash:${missingHash}` : null,
      missingSize > 0 ? `artifact_manifest_missing_size:${missingSize}` : null,
      missingKey > 0 ? `artifact_manifest_missing_key:${missingKey}` : null,
      mismatchedPrefix > 0 ? `artifact_manifest_uri_prefix_mismatch:${mismatchedPrefix}` : null,
      prefixedKey > 0 ? `artifact_manifest_s3_key_contains_storage_prefix:${prefixedKey}` : null,
      invalidModifiedAt > 0 ? `artifact_manifest_invalid_modified_at:${invalidModifiedAt}` : null,
      missingProvenance > 0 ? `artifact_manifest_missing_provenance:${missingProvenance}` : null,
      missingProvenanceArtifactKey > 0 ? `artifact_manifest_missing_provenance_artifact_key:${missingProvenanceArtifactKey}` : null,
      provenanceArtifactKeyMismatches > 0 ? `artifact_manifest_provenance_key_mismatch:${provenanceArtifactKeyMismatches}` : null,
      rawPayloadSentinelHits > 0 ? `artifact_manifest_raw_payload_sentinels:${rawPayloadSentinelHits}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    const ok = warnings.length === 0;

    return {
      ok,
      read_only: true,
      storage_type: storage.storage_type,
      artifact_uri_prefix: expectedPrefix,
      s3: storage.artifact_store.s3,
      artifacts: {
        total: rows.length,
        by_kind: [...byKind.entries()]
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => a.kind.localeCompare(b.kind)),
        with_hash: withHash,
        missing_hash: missingHash,
        with_size: withSize,
        missing_size: missingSize,
        total_size_bytes: totalSizeBytes,
      },
      modified_time: {
        with_modified_at: withModifiedAt,
        missing_modified_at: missingModifiedAt,
        invalid_modified_at: invalidModifiedAt,
        examples: invalidModifiedExamples,
      },
      provenance: {
        with_provenance: withProvenance,
        missing_provenance: missingProvenance,
        with_artifact_key: withProvenanceArtifactKey,
        missing_artifact_key: missingProvenanceArtifactKey,
        artifact_key_mismatches: provenanceArtifactKeyMismatches,
        generated_from: [...generatedFrom.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => a.value.localeCompare(b.value)),
        examples: provenanceExamples,
      },
      uri_prefix: {
        matching: matchingPrefix,
        mismatched: mismatchedPrefix,
        examples: mismatchedExamples,
      },
      keys: {
        with_key: rows.length - missingKey,
        missing_key: missingKey,
        prefixed_with_storage_prefix: prefixedKey,
        prefixed_examples: prefixedExamples,
      },
      sync_manifest: {
        copied_by_sync: true,
        generated_artifacts_only: true,
        includes_raw_source_bytes: false,
        hash_algorithm: 'sha256',
        portable_keys: prefixedKey === 0 && missingKey === 0,
        tracks_modified_time: withModifiedAt > 0 && invalidModifiedAt === 0,
        preserves_provenance: missingProvenance === 0 && missingProvenanceArtifactKey === 0 && provenanceArtifactKeyMismatches === 0,
      },
      raw_payload_sentinel_hits: rawPayloadSentinelHits,
      warnings,
      message: ok
        ? `${rows.length} generated artifact manifest row(s) ready for ${storage.storage_type} sync`
        : `Generated artifact manifest needs attention: ${warnings.join(', ')}`,
    };
  } finally {
    db.close();
  }
}

function artifactManifestKeyRepairCandidates(dbPath: string, storage: StorageContract): KnowledgeArtifactManifestKeyRepairCandidate[] {
  const prefix = storagePrefixKey(storage);
  if (!prefix) return [];
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query<{
      id: string;
      artifact_uri: string;
      kind: string;
      hash: string | null;
      size_bytes: number | null;
      metadata_json: string;
    }, []>(
      `SELECT id, artifact_uri, kind, hash, size_bytes, metadata_json
       FROM storage_objects
       ORDER BY artifact_uri ASC`,
    ).all();
    const candidates: KnowledgeArtifactManifestKeyRepairCandidate[] = [];
    for (const row of rows) {
      const metadata = parseMetadataJson(row.metadata_json);
      const currentKey = typeof metadata.key === 'string' ? metadata.key : null;
      if (!currentKey?.startsWith(prefix)) continue;
      const repaired = currentKey.slice(prefix.length);
      if (!repaired) continue;
      candidates.push({
        id: row.id,
        artifact_uri: row.artifact_uri,
        kind: row.kind,
        current_key: currentKey,
        repaired_key: normalizeArtifactKey(repaired),
        hash: row.hash,
        size_bytes: row.size_bytes,
      });
    }
    return candidates;
  } finally {
    db.close();
  }
}

function doctorRecommendations(input: {
  scope: string;
  machine: string | null;
  peerWorkspace: string | null;
  tables?: string[];
  resolvedWorkspace: KnowledgePeerSyncResult['resolved_workspace'] | null;
  openConflicts: number;
}): KnowledgeSyncRecommendedCommand[] {
  const scopeArgs = ['--scope', input.scope, '--json'];
  const tableArgs = input.tables?.length ? ['--tables', input.tables.join(',')] : [];
  const commands: KnowledgeSyncRecommendedCommand[] = [
    syncCommand({
      id: 'sync_status',
      reason: 'Inspect local sync registry, clocks, snapshots, and conflicts.',
      args: ['sync', 'status', ...scopeArgs],
    }),
  ];
  if (input.machine && !serviceMachineIsLocal(input.machine)) {
    commands.push(syncCommand({
      id: 'sync_dry_run_remote',
      reason: 'Preview remote machine sync before changing either workspace.',
      args: [
        'sync',
        'dry-run',
        '--machine',
        input.machine,
        ...(input.peerWorkspace ? ['--peer-workspace', input.peerWorkspace] : []),
        ...tableArgs,
        ...scopeArgs,
      ],
    }));
  } else if (input.peerWorkspace) {
    commands.push(syncCommand({
      id: 'sync_dry_run_peer',
      reason: 'Preview local peer sync before changing either workspace.',
      args: ['sync', 'dry-run', '--peer-workspace', input.peerWorkspace, ...tableArgs, ...scopeArgs],
    }));
  }
  for (const hint of input.resolvedWorkspace?.repair_hints ?? []) {
    commands.push({
      id: hint.id,
      reason: hint.reason,
      command: hint.command,
      shell_command: hint.shell_command,
    });
  }
  if (input.openConflicts > 0) {
    commands.push(syncCommand({
      id: 'sync_conflicts',
      reason: 'Review open conflicts before relying on bidirectional sync.',
      args: ['sync', 'conflicts', ...scopeArgs],
    }));
  }
  return commands;
}

function runSshCommand(machine: string, command: string, input: string | undefined, resolved: KnowledgeMachineRouteResolution): string {
  const result = spawnSync('ssh', [resolved.target, command], {
    encoding: 'utf8',
    env: process.env,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    const route = resolved.source === 'open-machines' ? ` via ${resolved.route ?? 'resolved'}:${resolved.target}` : '';
    throw new Error(`ssh ${machine}${route} failed: ${(result.stderr || result.stdout || String(result.status)).trim()}`);
  }
  return result.stdout || '';
}

function parseRemoteJson(machine: string, action: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const preview = raw.trim().slice(0, 240);
    throw new Error(`Remote knowledge ${action} on ${machine} did not return JSON. Install a compatible @hasna/knowledge CLI on the remote machine. Output: ${preview || String(error)}`);
  }
}

function assertRemoteSyncBundle(machine: string, value: unknown): asserts value is KnowledgeSyncBundle {
  if (
    typeof value !== 'object'
    || value === null
    || !('format' in value)
    || (value as { format?: unknown }).format !== 'knowledge-sync-bundle'
  ) {
    throw new Error(`Remote knowledge sync export on ${machine} did not return a knowledge sync bundle. Install @hasna/knowledge 0.2.32 or newer on the remote machine.`);
  }
  const protocolVersion = (value as { protocol_version?: unknown }).protocol_version;
  const minProtocolVersion = (value as { min_protocol_version?: unknown }).min_protocol_version;
  if (
    typeof protocolVersion !== 'number'
    || typeof minProtocolVersion !== 'number'
    || protocolVersion < KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION
    || minProtocolVersion > KNOWLEDGE_SYNC_PROTOCOL_VERSION
  ) {
    throw new Error(`Remote knowledge sync export on ${machine} uses an unsupported sync protocol. Install @hasna/knowledge 0.2.32 or newer on both machines.`);
  }
}

function assertRemoteSyncApplyResult(machine: string, value: unknown): asserts value is KnowledgeSyncApplyResult {
  if (
    typeof value !== 'object'
    || value === null
    || !('ok' in value)
    || !('target' in value)
    || !('tables' in value)
    || !('artifacts' in value)
    || !('conflicts_created' in value)
  ) {
    throw new Error(`Remote knowledge sync import on ${machine} did not return a sync import result. Install @hasna/knowledge 0.2.32 or newer on the remote machine.`);
  }
  const protocolVersion = (value as { protocol_version?: unknown }).protocol_version;
  const minProtocolVersion = (value as { min_protocol_version?: unknown }).min_protocol_version;
  if (
    typeof protocolVersion !== 'number'
    || typeof minProtocolVersion !== 'number'
    || protocolVersion < KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION
    || minProtocolVersion > KNOWLEDGE_SYNC_PROTOCOL_VERSION
  ) {
    throw new Error(`Remote knowledge sync import on ${machine} uses an unsupported sync protocol. Install @hasna/knowledge 0.2.32 or newer on both machines.`);
  }
}

function normalizeMode(value: string | undefined): KnowledgeConfig['mode'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'local' || normalized === 'offline') return 'local';
  if (normalized === 'hosted' || normalized === 'remote' || normalized === 'knowledge.hasna.xyz') return 'hosted';
  throw new Error('Invalid setup mode. Use hosted or local.');
}

export class KnowledgeService {
  private ensuredWorkspace?: KnowledgeWorkspace;
  private cachedConfig?: KnowledgeConfig;

  constructor(private readonly options: KnowledgeServiceOptions = {}) {}

  get scope(): string {
    return this.options.scope ?? 'global';
  }

  get workspace(): KnowledgeWorkspace {
    return this.ensuredWorkspace ?? resolveScopedWorkspace(this.options.scope, this.options.cwd);
  }

  ensureWorkspace(): KnowledgeWorkspace {
    if (!this.ensuredWorkspace) this.ensuredWorkspace = ensureKnowledgeWorkspace(this.workspace.home);
    return this.ensuredWorkspace;
  }

  jsonStorePath(): string {
    return this.ensureWorkspace().jsonStorePath;
  }

  config(): KnowledgeConfig {
    if (!this.cachedConfig) {
      const workspace = this.ensureWorkspace();
      this.cachedConfig = readKnowledgeConfig(workspace.configPath);
    }
    return this.cachedConfig;
  }

  safetyPolicy() {
    return resolveSafetyPolicy(this.config(), this.ensureWorkspace());
  }

  artifactStore() {
    return createArtifactStore(this.config(), this.ensureWorkspace());
  }

  storageContract(): StorageContract {
    return resolveStorageContract(this.config(), this.ensureWorkspace(), this.scope);
  }

  validateStorage(): StorageValidationResult {
    return validateStorageConfig(this.config(), this.ensureWorkspace());
  }

  setup(options: { mode?: string; apiUrl?: string; canonicalHasnaXyz?: boolean } = {}): KnowledgeSetupResult {
    const workspace = this.ensureWorkspace();
    const current = this.config();
    const mode = normalizeMode(options.mode) ?? current.mode;
    const apiUrl = options.apiUrl
      ? normalizeKnowledgeApiOrigin(options.apiUrl)
      : current.hosted?.api_url
        ? normalizeKnowledgeApiOrigin(current.hosted.api_url)
        : null;
    const nextConfig: KnowledgeConfig = {
      ...current,
      mode,
      hosted: {
        ...(current.hosted ?? {}),
        ...(apiUrl ? { api_url: apiUrl } : {}),
      },
      storage: options.canonicalHasnaXyz
        ? canonicalHasnaXyzKnowledgeStorage()
        : current.storage,
    };
    writeKnowledgeConfig(workspace.configPath, nextConfig);
    this.cachedConfig = nextConfig;
    const storage = resolveStorageContract(nextConfig, workspace, this.scope);
    return {
      ok: true,
      mode,
      api_url: nextConfig.hosted?.api_url ?? null,
      storage_type: nextConfig.storage.type,
      artifact_uri_prefix: storage.artifact_store.uri_prefix,
      canonical_hasna_xyz: storage.canonical_hasna_xyz,
      config_path: workspace.configPath,
      next: mode === 'hosted'
        ? ['knowledge auth login --api-key <key>', 'knowledge storage status --json', 'knowledge remote contracts --json']
        : ['knowledge search <query>', 'knowledge <prompt>'],
      message: `Set knowledge mode to ${mode}`,
    };
  }

  authStatus(env: Record<string, string | undefined> = process.env): KnowledgeAuthStatus {
    return knowledgeAuthStatus(this.config(), env);
  }

  saveAuth(input: {
    apiKey: string;
    email?: string;
    orgId?: string;
    orgSlug?: string;
    userId?: string;
    apiUrl?: string;
  }, env: Record<string, string | undefined> = process.env) {
    const apiUrl = input.apiUrl ?? this.config().hosted?.api_url;
    return saveKnowledgeAuth({
      api_key: input.apiKey,
      email: input.email,
      org_id: input.orgId,
      org_slug: input.orgSlug,
      user_id: input.userId,
      api_url: apiUrl,
    }, env);
  }

  clearAuth(env: Record<string, string | undefined> = process.env) {
    return clearKnowledgeAuth(env);
  }

  remoteContract(): RemoteKnowledgeRegistryContract {
    const storage = this.storageContract();
    return knowledgeRegistryContract({
      mode: this.config().mode,
      sourceSchemes: this.config().sources.allowed_schemes,
      storageType: storage.artifact_store.type,
      artifactUriPrefix: storage.artifact_store.uri_prefix,
    });
  }

  remoteClient(env: Record<string, string | undefined> = process.env): RemoteKnowledgeClient | null {
    return RemoteKnowledgeClient.fromConfig(this.config(), env);
  }

  paths(): KnowledgePathsResult {
    const workspace = this.ensureWorkspace();
    return {
      ok: true,
      scope: this.scope,
      home: workspace.home,
      config_path: workspace.configPath,
      json_store_path: workspace.jsonStorePath,
      knowledge_db_path: workspace.knowledgeDbPath,
      artifacts_dir: workspace.artifactsDir,
      indexes_dir: workspace.indexesDir,
      logs_dir: workspace.logsDir,
      runs_dir: workspace.runsDir,
      schemas_dir: workspace.schemasDir,
      wiki_dir: workspace.wikiDir,
      config: this.config(),
      message: workspace.home,
    };
  }

  initDb() {
    return migrateKnowledgeDb(this.ensureWorkspace().knowledgeDbPath);
  }

  dbStats() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return getKnowledgeDbStats(workspace.knowledgeDbPath);
  }

  async initWiki() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    const result = await initializeWikiLayout(this.artifactStore());
    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(db, result.artifacts);
      recordWikiLayoutCatalog(db, result.artifacts);
    } finally {
      db.close();
    }
    return result;
  }

  async compileWiki(options: Omit<WikiCompileOptions, 'dbPath' | 'store'> = {}) {
    const workspace = this.ensureWorkspace();
    return compileWikiPage({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore(),
    });
  }

  async fileAnswer(options: {
    prompt: string;
    answer: string;
    approveWrite?: boolean;
    limit?: number;
    semantic?: boolean;
    modelRef?: string;
    dimensions?: number;
    fake?: boolean;
  }) {
    const workspace = this.ensureWorkspace();
    const context = await this.retrieveContext({
      query: options.prompt,
      limit: options.limit,
      semantic: options.semantic,
      modelRef: options.modelRef,
      dimensions: options.dimensions,
      fake: options.fake,
    });
    return fileAnswerToWiki({
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore(),
      prompt: options.prompt,
      answer: options.answer,
      context,
      approveWrite: options.approveWrite,
    });
  }

  lintWiki() {
    const workspace = this.ensureWorkspace();
    return lintWiki({ dbPath: workspace.knowledgeDbPath });
  }

  async ingestManifest(input: string) {
    const workspace = this.ensureWorkspace();
    return ingestOpenFilesManifest({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async ingestSource(sourceRef: string, purpose?: string) {
    const workspace = this.ensureWorkspace();
    return ingestSourceRef({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async resolveSource(sourceRef: string, options: { purpose?: string; limit?: number } = {}) {
    const workspace = this.ensureWorkspace();
    return resolveOpenFilesSource({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose: options.purpose,
      limit: options.limit,
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async consumeOutbox(input: string) {
    const workspace = this.ensureWorkspace();
    return consumeOpenFilesOutbox({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  reindexHealth(options: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return reindexHealth({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  enqueueReindex(options: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return enqueueMissingEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async refreshEmbeddings(options: Omit<ReindexRuntimeOptions & { full?: boolean; limit?: number }, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return refreshEmbeddingIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  providerStatus(env: Record<string, string | undefined> = process.env): ProviderStatusResult {
    return providerStatus(this.config(), env);
  }

  modelRegistry(): ModelRegistryEntry[] {
    return listModelRegistry(this.config());
  }

  embeddingStatus() {
    const workspace = this.ensureWorkspace();
    return embeddingIndexStatus(workspace.knowledgeDbPath);
  }

  async indexEmbeddings(options: Omit<EmbeddingIndexOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return indexKnowledgeEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async semanticSearch(options: Omit<EmbeddingSearchOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return searchVectorIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async search(options: Omit<HybridSearchOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return hybridSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async retrieveContext(options: Omit<RetrievalOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return retrieveKnowledgeContext({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async runPrompt(options: Omit<KnowledgePromptOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return runKnowledgePrompt({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async webSearch(options: Omit<WebSearchOptions, 'dbPath' | 'config' | 'safetyPolicy'>) {
    const workspace = this.ensureWorkspace();
    return runProviderWebSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async machineTopology(options: Omit<KnowledgeMachineTopologyOptions, 'knowledge'> = {}) {
    const workspace = this.ensureWorkspace();
    return discoverKnowledgeMachineTopology({
      ...options,
      knowledge: {
        scope: this.scope,
        workspace_home: workspace.home,
      },
    });
  }

  async machinePreflight(options: Omit<KnowledgeMachinePreflightOptions, 'knowledge'> = {}) {
    const workspace = this.ensureWorkspace();
    return preflightKnowledgeMachine({
      ...options,
      knowledge: {
        scope: this.scope,
        workspace_home: workspace.home,
      },
    });
  }

  syncStatus() {
    const workspace = this.ensureWorkspace();
    return getKnowledgeSyncStatus({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home,
    });
  }

  async syncDoctor(options: KnowledgeSyncDoctorOptions = {}): Promise<KnowledgeSyncDoctorResult> {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    const status = this.syncStatus();
    const storage = this.storageContract();
    const validation = this.validateStorage();
    const artifactManifest = artifactManifestStatus(workspace.knowledgeDbPath, storage);
    const machine = options.machine?.trim() || null;
    const peerWorkspace = options.peerWorkspace?.trim() || null;
    const warnings: string[] = [];
    let resolvedRoute: KnowledgeSyncDoctorResult['resolved_route'] = null;
    let resolvedWorkspace: KnowledgeSyncDoctorResult['resolved_workspace'] = null;

    if (machine && !serviceMachineIsLocal(machine)) {
      const route = await resolveKnowledgeMachineRoute({
        machineId: machine,
        includeTailscale: options.includeTailscale,
      });
      resolvedRoute = routeSummary(route);
      warnings.push(...route.warnings);
    }

    if (machine || peerWorkspace) {
      const workspaceResolution = await resolveKnowledgeMachineWorkspace({
        machineId: machine ?? workspaceMachineId(workspace),
        peerWorkspace,
        includeTailscale: options.includeTailscale,
      });
      if (machine && !peerWorkspace && (resolvedRoute?.source === 'raw' || !workspaceResolution.ok || !workspaceResolution.project_root)) {
        const registryRow = findRegistryMachine(workspace.knowledgeDbPath, machine);
        if (registryRow) {
          if (resolvedRoute?.source === 'raw' && registryRow.ssh_target) {
            resolvedRoute = routeSummary(routeFromRegistry(registryRow, machine, {
              target: resolvedRoute.target,
              route: resolvedRoute.route,
              targetKind: resolvedRoute.target_kind,
              confidence: resolvedRoute.confidence,
              source: resolvedRoute.source,
              adapter: resolvedRoute.adapter,
              evidence: resolvedRoute.evidence,
              warnings: [],
            }));
          }
          if (!workspaceResolution.ok || !workspaceResolution.project_root) {
            const registryWorkspace = workspaceFromRegistry(registryRow, machine, workspaceResolution);
            if (registryWorkspace) {
              resolvedWorkspace = workspaceSummary(registryWorkspace, registryWorkspace.project_root);
              warnings.push(...registryWorkspace.warnings);
            }
          }
        }
      }
      resolvedWorkspace = workspaceResolution.ok && workspaceResolution.project_root
        ? workspaceSummary(workspaceResolution, workspaceResolution.project_root)
        : resolvedWorkspace ?? {
            ...workspaceSummary(workspaceResolution, peerWorkspace ?? ''),
            project_root: workspaceResolution.project_root ?? peerWorkspace ?? '',
          };
      warnings.push(...workspaceResolution.warnings);
    }

    if (!validation.ok) warnings.push(...validation.errors.map((error) => `storage:${error}`));
    const openFiles = openFilesBoundaryStatus(workspace.knowledgeDbPath, resolvedWorkspace);
    if (!openFiles.ok) warnings.push('open_files_boundary_raw_payload_sentinels');
    if (!artifactManifest.ok) warnings.push(...artifactManifest.warnings);
    const diagnosticFailures = resolvedWorkspace?.diagnostics.filter((entry) => entry.severity === 'fail') ?? [];
    const ok = validation.ok && artifactManifest.ok && openFiles.ok && diagnosticFailures.length === 0 && (resolvedWorkspace?.project_root !== '' || !resolvedWorkspace);
    const recommendedCommands = doctorRecommendations({
      scope: this.scope,
      machine,
      peerWorkspace,
      tables: options.tables,
      resolvedWorkspace,
      openConflicts: status.conflicts.open,
    });

    return {
      ok,
      read_only: true,
      generated_at: new Date().toISOString(),
      scope: this.scope,
      workspace_home: workspace.home,
      database: {
        sqlite_schema_version: status.sqlite_schema_version,
        table_counts: status.table_counts,
      },
      storage: {
        contract: storage,
        validation,
        artifact_manifest: artifactManifest,
      },
      sync: {
        machines: status.machines.total,
        snapshots: status.snapshots.total,
        clocks: status.clocks.total,
        imports: status.imports.total,
        open_conflicts: status.conflicts.open,
        table_clocks: status.clocks.rows,
      },
      open_files: openFiles,
      resolved_route: resolvedRoute,
      resolved_workspace: resolvedWorkspace,
      recommended_commands: recommendedCommands,
      warnings: [...new Set(warnings)],
      message: ok
        ? `Sync readiness ok: ${status.clocks.total} table clock(s), ${status.conflicts.open} open conflict(s)`
        : `Sync readiness needs attention: ${[...new Set(warnings)].join(', ') || 'workspace diagnostics failed'}`,
    };
  }

  repairArtifactManifestKeys(options: {
    approveWrite?: boolean;
    approvedBy?: string;
    dryRun?: boolean;
  } = {}): KnowledgeArtifactManifestKeyRepairResult {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    const storage = this.storageContract();
    const storagePrefix = storagePrefixKey(storage);
    const candidates = artifactManifestKeyRepairCandidates(workspace.knowledgeDbPath, storage);
    const dryRun = options.dryRun === true || options.approveWrite !== true;
    if (candidates.length === 0) {
      return {
        ok: true,
        dry_run: dryRun,
        approval_required: false,
        storage_type: storage.storage_type,
        storage_prefix: storagePrefix,
        candidates,
        repaired: 0,
        audit_event_id: null,
        message: 'No legacy S3 artifact manifest keys found',
      };
    }
    if (options.dryRun === true) {
      return {
        ok: true,
        dry_run: true,
        approval_required: false,
        storage_type: storage.storage_type,
        storage_prefix: storagePrefix,
        candidates,
        repaired: 0,
        audit_event_id: null,
        message: `Would repair ${candidates.length} legacy S3 artifact manifest key(s)`,
      };
    }
    if (options.approveWrite !== true || !options.approvedBy) {
      return {
        ok: false,
        dry_run: true,
        approval_required: true,
        storage_type: storage.storage_type,
        storage_prefix: storagePrefix,
        candidates,
        repaired: 0,
        audit_event_id: null,
        message: 'Artifact key repair requires --approve-write and --approved-by <name>',
      };
    }

    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      const now = new Date().toISOString();
      const update = db.transaction((entries: KnowledgeArtifactManifestKeyRepairCandidate[]) => {
        const statement = db.query('UPDATE storage_objects SET metadata_json = ?, updated_at = ? WHERE id = ?');
        const currentRows = db.query<{ id: string; metadata_json: string }, []>(
          'SELECT id, metadata_json FROM storage_objects',
        ).all();
        const metadataById = new Map(currentRows.map((row) => [row.id, parseMetadataJson(row.metadata_json)]));
        for (const entry of entries) {
          const metadata = metadataById.get(entry.id) ?? {};
          metadata.key = entry.repaired_key;
          statement.run(JSON.stringify(metadata), now, entry.id);
        }
      });
      update(candidates);
      const auditEventId = recordAuditEvent(db, {
        event_type: 'artifact_manifest_key_repair',
        action: 'storage.artifact_manifest.repair_keys',
        target_uri: `knowledge-storage://${workspace.home}/storage_objects`,
        decision: 'allow',
        metadata: {
          approved_by: options.approvedBy,
          repaired: candidates.length,
          storage_type: storage.storage_type,
          storage_prefix: storagePrefix,
          artifact_uris: candidates.map((entry) => entry.artifact_uri),
        },
      });
      return {
        ok: true,
        dry_run: false,
        approval_required: false,
        storage_type: storage.storage_type,
        storage_prefix: storagePrefix,
        candidates,
        repaired: candidates.length,
        audit_event_id: auditEventId,
        message: `Repaired ${candidates.length} legacy S3 artifact manifest key(s)`,
      };
    } finally {
      db.close();
    }
  }

  async createSyncSnapshot(options: KnowledgeSyncSnapshotOptions = {}): Promise<KnowledgeSyncSnapshotResult> {
    const workspace = this.ensureWorkspace();
    const topology = await this.machineTopology({
      includeTailscale: options.includeTailscale !== false,
    });
    return createKnowledgeSyncSnapshot({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home,
      storage: this.storageContract(),
      topology,
      machineId: options.machineId,
    });
  }

  syncConflicts(options: { status?: string; limit?: number } = {}) {
    const workspace = this.ensureWorkspace();
    return listKnowledgeSyncConflicts(workspace.knowledgeDbPath, options);
  }

  syncConflict(id: string) {
    const workspace = this.ensureWorkspace();
    const conflict = getKnowledgeSyncConflict(workspace.knowledgeDbPath, id);
    if (!conflict) throw new Error(`Sync conflict not found: ${id}`);
    return conflict;
  }

  proposeSyncConflictResolution(id: string) {
    const workspace = this.ensureWorkspace();
    return proposeKnowledgeSyncConflictResolution(workspace.knowledgeDbPath, id);
  }

  async proposeSyncConflictResolutionWithAi(options: KnowledgeSyncConflictAiProposalServiceOptions) {
    const workspace = this.ensureWorkspace();
    return proposeKnowledgeSyncConflictResolutionWithAi({
      dbPath: workspace.knowledgeDbPath,
      id: options.id,
      config: this.config(),
      modelRef: options.modelRef,
      fake: options.fake,
      env: options.env,
    });
  }

  resolveSyncConflict(options: KnowledgeSyncConflictResolveOptions): KnowledgeSyncConflictResolveResult {
    const workspace = this.ensureWorkspace();
    const proposal = proposeKnowledgeSyncConflictResolution(workspace.knowledgeDbPath, options.id);
    if (options.approveWrite !== true || !options.approvedBy) {
      return {
        ok: false,
        approval_required: true,
        conflict: proposal.conflict,
        proposal,
        message: 'Sync conflict resolution requires --approve-write and --approved-by <name>',
      };
    }
    const conflict = resolveKnowledgeSyncConflict(workspace.knowledgeDbPath, {
      id: options.id,
      strategy: options.strategy ?? proposal.proposed_strategy,
      approvedBy: options.approvedBy,
      proposedPatchUri: options.proposedPatchUri,
    });
    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      const auditEventId = recordAuditEvent(db, {
        event_type: 'sync_conflict_resolution',
        action: 'sync.conflict.resolve',
        target_uri: `knowledge-sync-conflict://${options.id}`,
        decision: 'allow',
        metadata: {
          conflict_id: options.id,
          entity_kind: conflict.entity_kind,
          entity_id: conflict.entity_id,
          strategy: conflict.resolution_strategy,
          approved_by: conflict.approved_by,
          proposed_patch_uri: conflict.proposed_patch_uri,
        },
      });
      return {
        ok: true,
        approval_required: false,
        conflict,
        audit_event_id: auditEventId,
        message: `Resolved sync conflict ${options.id}`,
      };
    } finally {
      db.close();
    }
  }

  syncMachines() {
    const workspace = this.ensureWorkspace();
    return listKnowledgeMachines(workspace.knowledgeDbPath);
  }

  exportSyncBundle(options: KnowledgeSyncBundleOptions = {}): KnowledgeSyncBundle {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return createKnowledgeSyncBundle({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home,
      storage: this.storageContract(),
      machineId: options.machineId ?? null,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent,
      recordClocks: options.recordClocks !== false,
    });
  }

  async importSyncBundle(options: KnowledgeSyncImportOptions): Promise<KnowledgeSyncApplyResult> {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return applyKnowledgeSyncBundle({
      targetDbPath: workspace.knowledgeDbPath,
      targetScope: this.scope,
      targetWorkspaceHome: workspace.home,
      targetStorage: this.storageContract(),
      targetStore: this.artifactStore(),
      bundle: options.bundle,
      direction: options.direction ?? 'import',
      dryRun: options.dryRun,
      localMachineId: options.machineId ?? null,
    });
  }

  async syncRemotePeer(options: KnowledgeRemotePeerSyncOptions): Promise<KnowledgeRemotePeerSyncResult> {
    const direction = options.direction ?? 'both';
    const dryRun = options.dryRun === true;
    const localWorkspace = this.ensureWorkspace();
    migrateKnowledgeDb(localWorkspace.knowledgeDbPath);
    const tableArgs = options.tables?.length ? ['--tables', options.tables.join(',')] : [];
    const artifactArgs = options.includeArtifactContent === false ? ['--no-artifact-content'] : [];
    const scopeArgs = ['--scope', this.scope, '--json'];
    let resolvedMachine = await resolveKnowledgeMachineRoute({
      machineId: options.machine,
      includeTailscale: options.includeTailscale,
    });
    let resolvedWorkspace = await resolveKnowledgeMachineWorkspace({
      machineId: options.machine,
      peerWorkspace: options.peerWorkspace,
      includeTailscale: options.includeTailscale,
    });
    if (resolvedMachine.source === 'raw' || !resolvedWorkspace.ok || !resolvedWorkspace.project_root) {
      const registryRow = findRegistryMachine(localWorkspace.knowledgeDbPath, options.machine);
      if (registryRow) {
        if (resolvedMachine.source === 'raw' && registryRow.ssh_target) {
          resolvedMachine = routeFromRegistry(registryRow, options.machine, resolvedMachine);
        }
        if (!resolvedWorkspace.ok || !resolvedWorkspace.project_root) {
          const registryWorkspace = workspaceFromRegistry(registryRow, options.machine, resolvedWorkspace);
          if (registryWorkspace) resolvedWorkspace = registryWorkspace;
        }
      }
    }
    if (!resolvedWorkspace.ok || !resolvedWorkspace.project_root) {
      throw new Error([
        `Unable to resolve peer workspace for ${options.machine}.`,
        `Pass --peer-workspace <repo-or-knowledge-home> or configure workspace path mapping in machines.`,
        resolvedWorkspace.warnings.length ? `Warnings: ${resolvedWorkspace.warnings.join(', ')}` : null,
      ].filter(Boolean).join(' '));
    }
    const peerWorkspace = resolvedWorkspace.project_root;
    const result: KnowledgeRemotePeerSyncResult = {
      ok: true,
      dry_run: dryRun,
      direction,
      transport: 'ssh',
      machine: options.machine,
      resolved_machine: resolvedMachine.target,
      resolved_route: routeSummary(resolvedMachine),
      resolved_workspace: workspaceSummary(resolvedWorkspace, resolvedWorkspace.project_root),
      peer_workspace: peerWorkspace,
      message: '',
    };

    if (direction === 'pull' || direction === 'both') {
      const remoteExport = remoteKnowledgeCommand(peerWorkspace, [
        'sync', 'export',
        ...scopeArgs,
        ...tableArgs,
        ...artifactArgs,
      ]);
      const raw = runSshCommand(options.machine, remoteExport, undefined, resolvedMachine);
      const bundle = parseRemoteJson(options.machine, 'sync export', raw);
      assertRemoteSyncBundle(options.machine, bundle);
      result.pull = await this.importSyncBundle({
        bundle,
        dryRun,
        direction: 'pull',
        machineId: options.machineId ?? null,
      });
    }

    if (direction === 'push' || direction === 'both') {
      const bundle = this.exportSyncBundle({
        machineId: options.machineId ?? null,
        tables: options.tables,
        includeArtifactContent: options.includeArtifactContent,
        recordClocks: !dryRun,
      });
      const remoteImport = remoteKnowledgeCommand(peerWorkspace, [
        'sync', 'import',
        ...scopeArgs,
        ...(dryRun ? ['--dry-run'] : []),
      ]);
      const applyResult = parseRemoteJson(options.machine, 'sync import', runSshCommand(options.machine, remoteImport, JSON.stringify(bundle), resolvedMachine));
      assertRemoteSyncApplyResult(options.machine, applyResult);
      result.push = applyResult;
    }

    result.ok = (result.pull?.ok ?? true) && (result.push?.ok ?? true);
    if (!dryRun) {
      recordKnowledgeMachineResolverEvidence(localWorkspace.knowledgeDbPath, {
        machineId: options.machine,
        route: resolvedMachine,
        workspace: resolvedWorkspace,
      });
    }
    result.message = [
      workspaceReadinessMessage(result.resolved_workspace),
      result.pull ? `pull: ${result.pull.message}` : null,
      result.push ? `push: ${result.push.message}` : null,
    ].filter(Boolean).join('; ');
    return result;
  }

  async syncPeer(options: KnowledgePeerSyncOptions): Promise<KnowledgePeerSyncResult> {
    const direction = options.direction ?? 'both';
    const localWorkspace = this.ensureWorkspace();
    migrateKnowledgeDb(localWorkspace.knowledgeDbPath);

    const peerWorkspaceInput = resolve(options.peerWorkspace);
    const peerWorkspace = resolvePeerWorkspace(peerWorkspaceInput);
    migrateKnowledgeDb(peerWorkspace.knowledgeDbPath);
    const peerConfig = readKnowledgeConfig(peerWorkspace.configPath);
    const peerStorage = resolveStorageContract(peerConfig, peerWorkspace, this.scope);
    const peerStore = createArtifactStore(peerConfig, peerWorkspace);
    const localMachineId = options.machineId ?? workspaceMachineId(localWorkspace);
    const peerMachineId = workspaceMachineId(peerWorkspace);
    const resolvedWorkspace = await resolveKnowledgeMachineWorkspace({
      machineId: options.machineId ?? peerMachineId,
      peerWorkspace: peerWorkspaceInput,
      includeTailscale: false,
    });

    const localBundle = () => createKnowledgeSyncBundle({
      dbPath: localWorkspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: localWorkspace.home,
      storage: this.storageContract(),
      machineId: localMachineId,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent,
      recordClocks: options.dryRun !== true,
    });
    const peerBundle = () => createKnowledgeSyncBundle({
      dbPath: peerWorkspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: peerWorkspace.home,
      storage: peerStorage,
      machineId: peerMachineId,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent,
      recordClocks: options.dryRun !== true,
    });

    const result: KnowledgePeerSyncResult = {
      ok: true,
      dry_run: options.dryRun === true,
      direction,
      resolved_workspace: workspaceSummary(resolvedWorkspace, resolvedWorkspace.project_root ?? peerWorkspaceInput),
      message: '',
    };

    if (direction === 'pull' || direction === 'both') {
      result.pull = await applyKnowledgeSyncBundle({
        targetDbPath: localWorkspace.knowledgeDbPath,
        targetScope: this.scope,
        targetWorkspaceHome: localWorkspace.home,
        targetStorage: this.storageContract(),
        targetStore: this.artifactStore(),
        bundle: peerBundle(),
        targetBundle: localBundle(),
        direction: 'pull',
        dryRun: options.dryRun,
        localMachineId,
      });
    }

    if (direction === 'push' || direction === 'both') {
      result.push = await applyKnowledgeSyncBundle({
        targetDbPath: peerWorkspace.knowledgeDbPath,
        targetScope: this.scope,
        targetWorkspaceHome: peerWorkspace.home,
        targetStorage: peerStorage,
        targetStore: peerStore,
        bundle: localBundle(),
        targetBundle: peerBundle(),
        direction: 'push',
        dryRun: options.dryRun,
        localMachineId: peerMachineId,
      });
    }

    result.ok = (result.pull?.ok ?? true) && (result.push?.ok ?? true);
    result.message = [
      workspaceReadinessMessage(result.resolved_workspace),
      result.pull ? `pull: ${result.pull.message}` : null,
      result.push ? `push: ${result.push.message}` : null,
    ].filter(Boolean).join('; ');
    return result;
  }
}

export function createKnowledgeService(options: KnowledgeServiceOptions = {}): KnowledgeService {
  return new KnowledgeService(options);
}
