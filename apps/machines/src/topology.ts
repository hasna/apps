import { existsSync } from "node:fs";
import { arch, hostname, platform, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { getLocalMachineId, latestHeartbeatByMachine, listHeartbeats } from "./db.js";
import { machineDisplayName, normalizeFriendlyName, readManifest } from "./manifests.js";
import { getManifestPath } from "./paths.js";
import { REDACTED_VALUE, publicMetadataKeys, redactErrorMessage, redactMetadataForTopology, redactSensitiveValue } from "./redaction.js";
import type { MachineManifest, MachinePlatform } from "./types.js";
import { getPackageVersion } from "./version.js";

export const MACHINES_CONSUMER_CONTRACT_VERSION = 1;
export const MACHINES_PACKAGE_NAME = "@hasna/machines";
export const MACHINES_CONSUMER_ENTRYPOINT = "@hasna/machines/consumer";
export const MACHINES_CONSUMER_SCHEMA_URI = "https://schemas.example.com/machines/consumer/v1/machines-consumer.schema.json";
export const MACHINES_CONSUMER_SCHEMA_ARTIFACT = "schemas/machines-consumer.schema.json";
export const DEFAULT_MACHINE_RESOLVER_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_HEARTBEAT_ONLINE_TTL_MS = 2 * 60 * 1000;
export const DEFAULT_MACHINE_LIST_LIMIT = 10;
export const MACHINE_LIST_ORDER = "updated_at_desc";

export interface TopologyCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type TopologyCommandRunner = (command: string) => TopologyCommandResult;

export interface MachineTopologyOptions {
  includeTailscale?: boolean;
  runner?: TopologyCommandRunner;
  now?: Date;
  resolverTtlMs?: number | null;
  heartbeatTtlMs?: number | null;
  limit?: number | null;
  offset?: number;
}

export interface MachineRouteHint {
  kind: "local" | "lan" | "tailscale" | "ssh";
  target: string;
  reachable: boolean | null;
}

export interface MachineTopologyEntry {
  machine_id: string;
  friendly_name: string | null;
  display_name: string;
  updated_at: string | null;
  hostname: string | null;
  platform: MachinePlatform | string | null;
  os: string | null;
  user: string | null;
  workspace_path: string | null;
  manifest_declared: boolean;
  heartbeat_status: "online" | "offline" | "unknown";
  last_heartbeat_at: string | null;
  agent: {
    pid: number | null;
    daemon_version: string | null;
    mode: string | null;
    private_metadata: boolean;
    platform: string | null;
    os_version: string | null;
    os_build: string | null;
    arch: string | null;
    uptime_seconds: number | null;
    tool_versions: Record<string, unknown> | null;
    tailscale: Record<string, unknown> | null;
    storage_sync_status: string | null;
    storage_sync_last_error: string | null;
    doctor_summary: Record<string, unknown> | null;
  };
  tailscale: {
    dns_name: string | null;
    ips: string[];
    online: boolean | null;
    active: boolean | null;
    last_seen: string | null;
  };
  ssh: {
    address: string | null;
    route: MachineRouteKind;
    command_target: string | null;
  };
  route_hints: MachineRouteHint[];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface MachinesContractPackage {
  name: typeof MACHINES_PACKAGE_NAME;
  version: string;
}

export interface MachinesConsumerCapabilities {
  topology: true;
  compatibility: true;
  route_resolution: true;
  cli_json_fallback: true;
  workspace_path_mapping?: true;
  workspace_diagnostics?: true;
  schema_artifacts?: true;
  cacheability_metadata?: true;
  resolver_snapshots?: true;
  field_capability_descriptors?: true;
  project_assignments?: true;
  friendly_machine_names?: true;
  machine_list_pagination?: true;
  note_machine_context?: true;
  machine_trash_policies?: true;
  machine_details?: true;
  browserplan_fleet?: true;
  machine_health?: true;
  fleet_routing?: true;
  command_matrix?: true;
  loop_preflight?: true;
  dispatch_fleet_smoke?: true;
}

export type MachinesConsumerEnvelope =
  | "topology"
  | "route"
  | "workspace"
  | "compatibility"
  | "resolver_snapshot"
  | "project_assignments"
  | "note_machine_context"
  | "machine_trash_policies"
  | "machine_details"
  | "browserplan_fleet"
  | "machine_health"
  | "routing"
  | "command_matrix"
  | "loop_preflight";

export interface MachinesConsumerFieldCapabilities {
  topology: {
    machine_identity: true;
    friendly_names: true;
    display_name_fallback: true;
    recent_ordering: true;
    pagination: true;
    route_hints: true;
    tailscale_status: true;
    manifest_metadata: true;
  };
  route: {
    cacheability: true;
    confidence: true;
    resolver_evidence: true;
  };
  workspace: {
    cacheability: true;
    path_mapping: true;
    diagnostics: true;
    repair_hints: true;
    trust_auth: true;
  };
  compatibility: {
    commands: true;
    packages: true;
    workspaces: true;
  };
  resolver_snapshot: {
    cacheability: true;
    redacted_provenance: true;
  };
  project_assignments: {
    open_projects_compatibility: true;
    machine_project_index: true;
    manifest_metadata_source: true;
  };
  note_machine_context: {
    ownership_machine_ids: true;
    source_target_machine_ids: true;
    display_name_fallback: true;
    sync_targets: true;
    actor_context: true;
    unknown_machine_fallback: true;
  };
  machine_trash_policies: {
    per_machine: true;
    retention_metadata: true;
    manifest_metadata_source: true;
    display_name_fallback: true;
  };
  machine_details: {
    friendly_name_fallback: true;
    status_label: true;
    safe_display_metadata: true;
    role_capabilities: true;
    recent_sync_timestamps: true;
    source_metadata: true;
  };
  browserplan_fleet: {
    machine001_machine011_target: true;
    spark_exclusion: true;
    remote_operation_hooks: true;
    install_state_detection: true;
    route_reachability: true;
    workspace_summary: true;
  };
  agent_abstractions: {
    compact_json_defaults: true;
    bounded_machine_lists: true;
    raw_artifact_refs: true;
    private_route_redaction: true;
    dry_run_plans: true;
    loop_readiness: true;
    command_matrix: true;
    machine_health: true;
    fleet_routing: true;
  };
  dispatch_fleet_smoke?: {
    dry_run: true;
    redacted_output: true;
    package_version: true;
    route_health: true;
    daemon_restart_readiness: true;
  };
}

export interface MachinesConsumerContract {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package_name: typeof MACHINES_PACKAGE_NAME;
  entrypoint: typeof MACHINES_CONSUMER_ENTRYPOINT;
  schema_uri: typeof MACHINES_CONSUMER_SCHEMA_URI;
  schema_artifact: typeof MACHINES_CONSUMER_SCHEMA_ARTIFACT;
  capabilities: MachinesConsumerCapabilities;
  field_capabilities: MachinesConsumerFieldCapabilities;
  cacheability: {
    default_ttl_ms: typeof DEFAULT_MACHINE_RESOLVER_TTL_MS;
    stale_requires_refresh: true;
  };
  envelopes: MachinesConsumerEnvelope[];
  stable_exports: string[];
}

export const MACHINES_CONSUMER_CAPABILITIES: MachinesConsumerCapabilities = {
  topology: true,
  compatibility: true,
  route_resolution: true,
  cli_json_fallback: true,
  workspace_path_mapping: true,
  workspace_diagnostics: true,
  schema_artifacts: true,
  cacheability_metadata: true,
  resolver_snapshots: true,
  field_capability_descriptors: true,
  project_assignments: true,
  friendly_machine_names: true,
  machine_list_pagination: true,
  note_machine_context: true,
  machine_trash_policies: true,
  machine_details: true,
  browserplan_fleet: true,
  machine_health: true,
  fleet_routing: true,
  command_matrix: true,
  loop_preflight: true,
  dispatch_fleet_smoke: true,
};

export const MACHINES_CONSUMER_FIELD_CAPABILITIES: MachinesConsumerFieldCapabilities = {
  topology: {
    machine_identity: true,
    friendly_names: true,
    display_name_fallback: true,
    recent_ordering: true,
    pagination: true,
    route_hints: true,
    tailscale_status: true,
    manifest_metadata: true,
  },
  route: {
    cacheability: true,
    confidence: true,
    resolver_evidence: true,
  },
  workspace: {
    cacheability: true,
    path_mapping: true,
    diagnostics: true,
    repair_hints: true,
    trust_auth: true,
  },
  compatibility: {
    commands: true,
    packages: true,
    workspaces: true,
  },
  resolver_snapshot: {
    cacheability: true,
    redacted_provenance: true,
  },
  project_assignments: {
    open_projects_compatibility: true,
    machine_project_index: true,
    manifest_metadata_source: true,
  },
  note_machine_context: {
    ownership_machine_ids: true,
    source_target_machine_ids: true,
    display_name_fallback: true,
    sync_targets: true,
    actor_context: true,
    unknown_machine_fallback: true,
  },
  machine_trash_policies: {
    per_machine: true,
    retention_metadata: true,
    manifest_metadata_source: true,
    display_name_fallback: true,
  },
  machine_details: {
    friendly_name_fallback: true,
    status_label: true,
    safe_display_metadata: true,
    role_capabilities: true,
    recent_sync_timestamps: true,
    source_metadata: true,
  },
  browserplan_fleet: {
    machine001_machine011_target: true,
    spark_exclusion: true,
    remote_operation_hooks: true,
    install_state_detection: true,
    route_reachability: true,
    workspace_summary: true,
  },
  agent_abstractions: {
    compact_json_defaults: true,
    bounded_machine_lists: true,
    raw_artifact_refs: true,
    private_route_redaction: true,
    dry_run_plans: true,
    loop_readiness: true,
    command_matrix: true,
    machine_health: true,
    fleet_routing: true,
  },
  dispatch_fleet_smoke: {
    dry_run: true,
    redacted_output: true,
    package_version: true,
    route_health: true,
    daemon_restart_readiness: true,
  },
};

export const MACHINES_CONSUMER_CONTRACT: MachinesConsumerContract = {
  schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
  package_name: MACHINES_PACKAGE_NAME,
  entrypoint: MACHINES_CONSUMER_ENTRYPOINT,
  schema_uri: MACHINES_CONSUMER_SCHEMA_URI,
  schema_artifact: MACHINES_CONSUMER_SCHEMA_ARTIFACT,
  capabilities: MACHINES_CONSUMER_CAPABILITIES,
  field_capabilities: MACHINES_CONSUMER_FIELD_CAPABILITIES,
  cacheability: {
    default_ttl_ms: DEFAULT_MACHINE_RESOLVER_TTL_MS,
    stale_requires_refresh: true,
  },
  envelopes: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments", "note_machine_context", "machine_trash_policies", "machine_details", "browserplan_fleet", "machine_health", "routing", "command_matrix", "loop_preflight"],
  stable_exports: [
    "MACHINES_CONSUMER_CONTRACT",
    "MACHINES_CONSUMER_CONTRACT_VERSION",
    "MACHINES_CONSUMER_CAPABILITIES",
    "MACHINES_CONSUMER_FIELD_CAPABILITIES",
    "MACHINES_CONSUMER_SCHEMA_BUNDLE",
    "MACHINES_CONSUMER_SCHEMA_URI",
    "MACHINES_PACKAGE_NAME",
    "DEFAULT_MACHINE_LIST_LIMIT",
    "discoverMachineTopology",
    "getLocalMachineTopology",
    "resolveMachineRoute",
    "resolveMachineWorkspace",
    "createMachineResolverSnapshot",
    "listMachineProjectAssignments",
    "resolveNoteMachineContext",
    "listMachineTrashPolicies",
    "machineReferenceForNote",
    "getMachineDetails",
    "getBrowserPlanFleet",
    "getFleetMachineHealth",
    "getFleetRouting",
    "getCommandMatrix",
    "getFleetLoopPreflight",
    "getDispatchFleetSmoke",
    "normalizeBrowserPlanMachineId",
    "getMachinesConsumerSchemaBundle",
    "validateMachinesConsumerEnvelope",
    "checkMachineCompatibility",
    "resolveMachineCommand",
    "runMachineCommand",
    "buildSshCommand",
    "resolveSshTarget",
    "getPackageVersion",
  ],
};

export function getMachinesConsumerCapabilities(): MachinesConsumerCapabilities {
  return { ...MACHINES_CONSUMER_CAPABILITIES };
}

export interface MachineTopology {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  local_machine_id: string;
  local_hostname: string;
  current_platform: MachinePlatform | string;
  manifest_path_known: boolean;
  pagination: MachineListPagination;
  machines: MachineTopologyEntry[];
  warnings: string[];
}

export interface MachineListPagination {
  limit: number | null;
  offset: number;
  total: number;
  count: number;
  hasMore: boolean;
  nextOffset: number | null;
  has_more: boolean;
  next_offset: number | null;
  order: typeof MACHINE_LIST_ORDER;
}

export type MachineRouteKind = "local" | "lan" | "tailscale" | "ssh" | "unknown";
export type MachineRouteConfidence = "exact" | "high" | "medium" | "low" | "none";
export type MachineResolverAuthority =
  | "open-machines"
  | "manifest"
  | "manifest_metadata"
  | "live_topology"
  | "argument"
  | "inferred"
  | "fallback"
  | "unresolved"
  | "mixed"
  | "unknown";

export interface MachineResolverCacheability {
  observed_at: string;
  verified_at: string | null;
  expires_at: string | null;
  ttl_ms: number | null;
  source_authority: MachineResolverAuthority;
  confidence: MachineRouteConfidence;
  cacheable: boolean;
  stale: boolean;
  reasons: string[];
}

export interface MachineRouteResolution {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  ok: boolean;
  machine_id: string | null;
  requested_machine_id: string;
  generated_at: string;
  route: MachineRouteKind;
  source: MachineRouteKind;
  target: string | null;
  command_target: string | null;
  confidence: MachineRouteConfidence;
  local: boolean;
  evidence: {
    topology: boolean;
    matched_by: "machine_id" | "hostname" | "tailscale" | "route_target" | "local_alias" | "fallback" | null;
    manifest_declared: boolean | null;
    heartbeat_status: MachineTopologyEntry["heartbeat_status"] | null;
    tailscale_online: boolean | null;
    selected_hint: MachineRouteHint | null;
  };
  cacheability: MachineResolverCacheability;
  warnings: string[];
}

export interface MachineRouteOptions extends MachineTopologyOptions {
  topology?: MachineTopology;
}

export interface PublicOutputOptions {
  privateMetadata?: boolean;
}

export type MachineWorkspacePathSource =
  | "argument"
  | "manifest"
  | "manifest_metadata"
  | "inferred"
  | "unresolved";

export type MachineWorkspaceTrustStatus = "trusted" | "untrusted" | "unknown";
export type MachineWorkspaceAuthStatus = "authenticated" | "unauthenticated" | "unknown";

export interface MachineWorkspacePath {
  path: string | null;
  source: MachineWorkspacePathSource;
}

export type MachineWorkspaceDiagnosticStatus =
  | "ok"
  | "missing"
  | "inferred"
  | "stale"
  | "untrusted"
  | "unknown_auth"
  | "missing_manifest";

export interface MachineWorkspaceDiagnostic {
  id: string;
  status: MachineWorkspaceDiagnosticStatus;
  severity: "ok" | "warn" | "fail";
  message: string;
  path: string | null;
  source: MachineWorkspacePathSource | "manifest" | "trust" | "auth";
  path_exists: boolean | null;
}

export interface MachineWorkspaceRepairHint {
  id: string;
  reason: string;
  command: string[];
  shell_command: string;
  apply_command: string[];
  apply_shell_command: string;
}

export interface MachineWorkspaceProject {
  project_id: string;
  repo_name: string | null;
  canonical: boolean;
}

export interface MachineWorkspaceResolution {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  ok: boolean;
  requested_machine_id: string;
  machine_id: string | null;
  generated_at: string;
  project: MachineWorkspaceProject;
  machine: {
    current: boolean;
    primary: boolean;
    trust_status: MachineWorkspaceTrustStatus;
    auth_status: MachineWorkspaceAuthStatus;
  };
  paths: {
    workspace_root: MachineWorkspacePath;
    project_root: MachineWorkspacePath;
    open_files_root: MachineWorkspacePath;
  };
  diagnostics: MachineWorkspaceDiagnostic[];
  repair_hints: MachineWorkspaceRepairHint[];
  evidence: {
    topology: boolean;
    matched_by: MachineRouteResolution["evidence"]["matched_by"];
    manifest_declared: boolean | null;
    metadata_keys: string[];
  };
  cacheability: MachineResolverCacheability;
  warnings: string[];
}

export interface MachineWorkspaceOptions extends MachineTopologyOptions {
  machineId: string;
  projectId: string;
  repoName?: string;
  openFilesRepoName?: string;
  primaryMachineId?: string;
  workspaceRoot?: string;
  projectRoot?: string;
  openFilesRoot?: string;
  topology?: MachineTopology;
}

interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  Active?: boolean;
  LastSeen?: string;
}

interface TailscaleStatus {
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
}

function normalizePlatform(value: string = platform()): MachinePlatform | string {
  const normalized = value.toLowerCase();
  if (normalized === "darwin" || normalized === "macos") return "macos";
  if (normalized === "win32" || normalized === "windows") return "windows";
  if (normalized === "linux") return "linux";
  return value;
}

function defaultRunner(command: string): TopologyCommandResult {
  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

function hasCommand(command: string, runner: TopologyCommandRunner): boolean {
  return runner(`command -v ${command} >/dev/null 2>&1`).exitCode === 0;
}

function parseTailscaleStatus(raw: string): TailscaleStatus | null {
  try {
    const parsed = JSON.parse(raw) as TailscaleStatus;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadTailscalePeers(runner: TopologyCommandRunner, warnings: string[]): Map<string, TailscalePeer> {
  const peers = new Map<string, TailscalePeer>();
  if (!hasCommand("tailscale", runner)) {
    warnings.push("tailscale_not_available");
    return peers;
  }
  const result = runner("tailscale status --json");
  if (result.exitCode !== 0) {
    warnings.push(`tailscale_status_failed:${result.stderr.trim() || result.exitCode}`);
    return peers;
  }
  const status = parseTailscaleStatus(result.stdout);
  if (!status) {
    warnings.push("tailscale_status_invalid_json");
    return peers;
  }
  const addPeer = (peer?: TailscalePeer) => {
    if (!peer) return;
    const id = peer.HostName || peer.DNSName?.split(".")[0];
    if (id) peers.set(id, peer);
  };
  addPeer(status.Self);
  for (const peer of Object.values(status.Peer ?? {})) addPeer(peer);
  return peers;
}

function machineKeys(machine: MachineManifest): string[] {
  return [
    machine.id,
    machine.hostname,
    machine.tailscaleName?.split(".")[0],
    machine.tailscaleName,
    machine.sshAddress?.split("@").pop(),
  ].filter((value): value is string => Boolean(value));
}

function findTailscalePeer(machine: MachineManifest | null, machineId: string, peers: Map<string, TailscalePeer>): TailscalePeer | null {
  if (machine) {
    for (const key of machineKeys(machine)) {
      const peer = peers.get(key) ?? peers.get(key.replace(/\.$/, ""));
      if (peer) return peer;
    }
  }
  return peers.get(machineId) ?? null;
}

function envReachableHosts(): Set<string> {
  const raw = process.env["HASNA_MACHINES_REACHABLE_HOSTS"];
  return new Set((raw || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function manifestHostReachable(target: string): boolean | null {
  const overrides = envReachableHosts();
  if (overrides.size === 0) return null;
  return overrides.has(target);
}

function userFromSshAddress(address?: string | null): string | null {
  if (!address) return null;
  const at = address.indexOf("@");
  if (at <= 0) return null;
  return address.slice(0, at);
}

function commandTargetForRoute(target: MachineRouteHint, user?: string | null): string {
  if (target.kind === "local" || target.target.includes("@") || !user) return target.target;
  return `${user}@${target.target}`;
}

function routeHints(input: {
  machineId: string;
  localMachineId: string;
  manifest?: MachineManifest;
  peer?: TailscalePeer | null;
}): MachineRouteHint[] {
  const hints: MachineRouteHint[] = [];
  if (input.machineId === input.localMachineId) {
    hints.push({ kind: "local", target: "localhost", reachable: true });
  }
  if (input.manifest?.sshAddress) {
    hints.push({ kind: "ssh", target: input.manifest.sshAddress, reachable: manifestHostReachable(input.manifest.sshAddress) });
  }
  if (input.manifest?.hostname) {
    hints.push({ kind: "lan", target: input.manifest.hostname, reachable: manifestHostReachable(input.manifest.hostname) });
  }
  const tailscaleTarget = input.manifest?.tailscaleName ?? input.peer?.DNSName ?? input.peer?.TailscaleIPs?.[0];
  if (tailscaleTarget) {
    hints.push({ kind: "tailscale", target: tailscaleTarget.replace(/\.$/, ""), reachable: input.peer?.Online ?? null });
  }
  return hints;
}

function routeRank(hint: MachineRouteHint): number {
  if (hint.kind === "local") return 0;
  if (hint.reachable === true && hint.kind === "ssh") return 1;
  if (hint.reachable === true && hint.kind === "lan") return 2;
  if (hint.reachable === true && hint.kind === "tailscale") return 3;
  if (hint.reachable === false) return 8;
  if (hint.kind === "ssh") return 4;
  if (hint.kind === "lan") return 5;
  if (hint.kind === "tailscale") return 6;
  return 9;
}

function selectRouteHint(hints: MachineRouteHint[]): MachineRouteHint | null {
  return [...hints].sort((left, right) => routeRank(left) - routeRank(right))[0] ?? null;
}

function parseHeartbeatJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function heartbeatStatus(
  heartbeat: ReturnType<typeof listHeartbeats>[number] | undefined,
  now: Date,
  heartbeatTtlMs: number | null | undefined,
): MachineTopologyEntry["heartbeat_status"] {
  const status = heartbeat?.status === "online" || heartbeat?.status === "offline" ? heartbeat.status : undefined;
  if (!status) return "unknown";
  if (status !== "online") return status;
  const ttlMs = heartbeatTtlMs === undefined ? DEFAULT_HEARTBEAT_ONLINE_TTL_MS : heartbeatTtlMs;
  if (ttlMs === null) return "online";
  const freshnessAt = heartbeat?.observed_at ?? heartbeat?.updated_at;
  const updatedAt = freshnessAt ? Date.parse(freshnessAt) : NaN;
  if (!Number.isFinite(updatedAt)) return "unknown";
  const ageMs = now.getTime() - updatedAt;
  return ageMs > ttlMs ? "offline" : "online";
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const latest = values
    .map((value) => ({ value, ms: parseDateMs(value) }))
    .filter((entry): entry is { value: string; ms: number } => entry.value !== null && entry.value !== undefined && entry.ms !== null)
    .sort((left, right) => right.ms - left.ms)[0];
  return latest?.value ?? null;
}

function normalizeListOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function normalizeListLimit(limit: number | null | undefined): number | null {
  if (limit === null) return null;
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_MACHINE_LIST_LIMIT;
  return Math.max(1, Math.floor(limit));
}

function compareMachineListOrder(left: MachineTopologyEntry, right: MachineTopologyEntry): number {
  const leftMs = parseDateMs(left.updated_at);
  const rightMs = parseDateMs(right.updated_at);
  if (leftMs !== null || rightMs !== null) {
    if (leftMs === null) return 1;
    if (rightMs === null) return -1;
    if (leftMs !== rightMs) return rightMs - leftMs;
  }
  return left.machine_id.localeCompare(right.machine_id);
}

function paginateMachineEntries(entries: MachineTopologyEntry[], options: MachineTopologyOptions): {
  machines: MachineTopologyEntry[];
  pagination: MachineListPagination;
} {
  const ordered = [...entries].sort(compareMachineListOrder);
  const offset = normalizeListOffset(options.offset);
  const limit = normalizeListLimit(options.limit);
  const total = ordered.length;
  const machines = limit === null
    ? ordered.slice(offset)
    : ordered.slice(offset, offset + limit);
  const nextOffset = offset + machines.length < total ? offset + machines.length : null;
  const hasMore = nextOffset !== null;
  return {
    machines,
    pagination: {
      limit,
      offset,
      total,
      count: machines.length,
      hasMore,
      nextOffset,
      has_more: hasMore,
      next_offset: nextOffset,
      order: MACHINE_LIST_ORDER,
    },
  };
}

function buildEntry(input: {
  machineId: string;
  localMachineId: string;
  manifest?: MachineManifest;
  peer?: TailscalePeer | null;
  heartbeat?: ReturnType<typeof listHeartbeats>[number];
  now: Date;
  heartbeatTtlMs?: number | null;
}): MachineTopologyEntry {
  const manifest = input.manifest;
  const peer = input.peer;
  const hints = routeHints({
    machineId: input.machineId,
    localMachineId: input.localMachineId,
    manifest,
    peer,
  });
  const selectedRoute = selectRouteHint(hints);
  const route = selectedRoute?.kind === "ssh" ? "ssh" : selectedRoute?.kind ?? "unknown";
  const routeUser = userFromSshAddress(manifest?.sshAddress)
    ?? (typeof manifest?.metadata?.user === "string" ? manifest.metadata.user : null);
  const friendlyName = manifest ? normalizeFriendlyName(manifest.friendlyName) : null;
  const displayName = manifest ? machineDisplayName(manifest) : input.machineId;
  return {
    machine_id: input.machineId,
    friendly_name: friendlyName,
    display_name: displayName,
    updated_at: latestIso([manifest?.updatedAt, input.heartbeat?.updated_at, peer?.LastSeen]),
    hostname: manifest?.hostname ?? peer?.HostName ?? null,
    platform: manifest?.platform ?? (peer?.OS ? normalizePlatform(peer.OS) : null),
    os: peer?.OS ?? null,
    user: typeof manifest?.metadata?.user === "string" ? manifest.metadata.user : null,
    workspace_path: manifest?.workspacePath ?? null,
    manifest_declared: Boolean(manifest),
    heartbeat_status: heartbeatStatus(input.heartbeat, input.now, input.heartbeatTtlMs),
    last_heartbeat_at: input.heartbeat?.updated_at ?? null,
    agent: {
      pid: input.heartbeat?.pid ?? null,
      daemon_version: input.heartbeat?.daemon_version ?? null,
      mode: input.heartbeat?.agent_mode ?? null,
      private_metadata: Boolean(input.heartbeat?.private_metadata),
      platform: input.heartbeat?.platform ?? null,
      os_version: input.heartbeat?.os_version ?? null,
      os_build: input.heartbeat?.os_build ?? null,
      arch: input.heartbeat?.arch ?? null,
      uptime_seconds: input.heartbeat?.uptime_seconds ?? null,
      tool_versions: parseHeartbeatJson(input.heartbeat?.tool_versions_json),
      tailscale: parseHeartbeatJson(input.heartbeat?.tailscale_json),
      storage_sync_status: input.heartbeat?.storage_sync_status ?? null,
      storage_sync_last_error: input.heartbeat?.storage_sync_last_error ?? null,
      doctor_summary: parseHeartbeatJson(input.heartbeat?.doctor_summary_json),
    },
    tailscale: {
      dns_name: manifest?.tailscaleName ?? peer?.DNSName?.replace(/\.$/, "") ?? null,
      ips: peer?.TailscaleIPs ?? [],
      online: peer?.Online ?? null,
      active: peer?.Active ?? null,
      last_seen: peer?.LastSeen ?? null,
    },
    ssh: {
      address: manifest?.sshAddress ?? null,
      route,
      command_target: selectedRoute ? commandTargetForRoute(selectedRoute, routeUser) : null,
    },
    route_hints: hints,
    tags: manifest?.tags ?? [],
    metadata: redactMetadataForTopology(manifest?.metadata),
  };
}

export function discoverMachineTopology(options: MachineTopologyOptions = {}): MachineTopology {
  const now = options.now ?? new Date();
  const runner = options.runner ?? defaultRunner;
  const warnings: string[] = [];
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = latestHeartbeatByMachine(heartbeats);
  const localMachineId = getLocalMachineId();
  const peers = options.includeTailscale === false ? new Map<string, TailscalePeer>() : loadTailscalePeers(runner, warnings);
  const machineIds = new Set<string>([
    localMachineId,
    ...manifest.machines.map((machine) => machine.id),
    ...heartbeats.map((heartbeat) => heartbeat.machine_id),
    ...peers.keys(),
  ]);
  const manifestById = new Map(manifest.machines.map((machine) => [machine.id, machine]));
  const allMachines = [...machineIds].sort().map((machineId) => {
    const manifestMachine = manifestById.get(machineId);
    return buildEntry({
      machineId,
      localMachineId,
      manifest: manifestMachine,
      peer: findTailscalePeer(manifestMachine ?? null, machineId, peers),
      heartbeat: heartbeatByMachine.get(machineId),
      now,
      heartbeatTtlMs: options.heartbeatTtlMs,
    });
  });
  const { machines, pagination } = paginateMachineEntries(allMachines, options);
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: {
      name: MACHINES_PACKAGE_NAME,
      version: getPackageVersion(),
    },
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: now.toISOString(),
    local_machine_id: localMachineId,
    local_hostname: hostname(),
    current_platform: normalizePlatform(),
    manifest_path_known: existsSync(getManifestPath()),
    pagination,
    machines,
    warnings,
  };
}

function redactFleetString(value: string): string {
  if (!value) return value;
  return redactErrorMessage(value);
}

function redactPublicRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(host|hostname|dns|ip|ips|user|username|serial|address|target|url|token|secret|password|credential)/i.test(key)) {
      redacted[key] = REDACTED_VALUE;
      continue;
    }
    if (typeof entry === "string") {
      redacted[key] = redactFleetString(entry);
    } else if (Array.isArray(entry)) {
      redacted[key] = entry.map((item) => {
        if (typeof item === "string") return redactFleetString(item);
        if (item && typeof item === "object") return redactPublicRecord(item as Record<string, unknown>);
        return item;
      });
    } else if (entry && typeof entry === "object") {
      redacted[key] = redactPublicRecord(entry as Record<string, unknown>);
    } else {
      redacted[key] = entry;
    }
  }
  return redactSensitiveValue(redacted) as Record<string, unknown>;
}

export function redactTopologyForOutput(topology: MachineTopology, options: PublicOutputOptions = {}): MachineTopology {
  if (options.privateMetadata) return topology;
  return {
    ...topology,
    local_hostname: REDACTED_VALUE,
    warnings: topology.warnings.map(redactFleetString),
    machines: topology.machines.map((machine) => ({
      ...machine,
      hostname: machine.hostname ? REDACTED_VALUE : null,
      user: machine.user ? REDACTED_VALUE : null,
      tailscale: {
        ...machine.tailscale,
        dns_name: machine.tailscale.dns_name ? REDACTED_VALUE : null,
        ips: machine.tailscale.ips.map(() => REDACTED_VALUE),
      },
      ssh: {
        ...machine.ssh,
        address: machine.ssh.address ? REDACTED_VALUE : null,
        command_target: machine.ssh.command_target ? REDACTED_VALUE : null,
      },
      route_hints: machine.route_hints.map((hint) => ({
        ...hint,
        target: REDACTED_VALUE,
      })),
      agent: {
        ...machine.agent,
        tailscale: redactPublicRecord(machine.agent.tailscale),
        storage_sync_last_error: machine.agent.storage_sync_last_error
          ? redactFleetString(machine.agent.storage_sync_last_error)
          : null,
        doctor_summary: redactPublicRecord(machine.agent.doctor_summary),
      },
    })),
  };
}

function normalizeMachineAlias(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

function routeTargetMatches(machine: MachineTopologyEntry, requested: string): boolean {
  const normalized = normalizeMachineAlias(requested);
  const values = [
    machine.ssh.address,
    machine.ssh.command_target,
    machine.tailscale.dns_name,
    machine.tailscale.dns_name?.split(".")[0],
    ...machine.tailscale.ips,
    ...machine.route_hints.map((hint) => hint.target),
    ...machine.route_hints.map((hint) => hint.target.split("@").pop() ?? hint.target),
  ].filter((value): value is string => Boolean(value));
  return values.some((value) => normalizeMachineAlias(value) === normalized);
}

function findRouteMachine(topology: MachineTopology, requestedMachineId: string): {
  machine: MachineTopologyEntry | null;
  matchedBy: MachineRouteResolution["evidence"]["matched_by"];
} {
  const requested = normalizeMachineAlias(requestedMachineId);
  if (requested === "local" || requested === "localhost" || requested === normalizeMachineAlias(hostname()) || requested === normalizeMachineAlias(topology.local_machine_id)) {
    return {
      machine: topology.machines.find((machine) => machine.machine_id === topology.local_machine_id) ?? null,
      matchedBy: "local_alias",
    };
  }

  const machineIdMatch = topology.machines.find((machine) => normalizeMachineAlias(machine.machine_id) === requested);
  if (machineIdMatch) return { machine: machineIdMatch, matchedBy: "machine_id" };

  const hostnameMatch = topology.machines.find((machine) => machine.hostname && normalizeMachineAlias(machine.hostname) === requested);
  if (hostnameMatch) return { machine: hostnameMatch, matchedBy: "hostname" };

  const tailscaleMatch = topology.machines.find((machine) => {
    if (!machine.tailscale.dns_name) return false;
    const dns = normalizeMachineAlias(machine.tailscale.dns_name);
    return dns === requested || dns.split(".")[0] === requested;
  });
  if (tailscaleMatch) return { machine: tailscaleMatch, matchedBy: "tailscale" };

  const routeMatch = topology.machines.find((machine) => routeTargetMatches(machine, requestedMachineId));
  if (routeMatch) return { machine: routeMatch, matchedBy: "route_target" };

  return { machine: null, matchedBy: null };
}

function routeConfidence(input: {
  machine: MachineTopologyEntry;
  hint: MachineRouteHint | null;
  matchedBy: MachineRouteResolution["evidence"]["matched_by"];
}): MachineRouteConfidence {
  if (input.matchedBy === "local_alias") return "exact";
  if (input.hint?.kind === "local") return "exact";
  if (input.hint?.reachable === true) return "high";
  if (input.machine.manifest_declared && (input.hint?.kind === "ssh" || input.hint?.kind === "lan")) return "medium";
  if (input.hint) return "low";
  return "none";
}

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function routeAuthority(input: {
  machine: MachineTopologyEntry | null;
  selectedHint: MachineRouteHint | null;
  matchedBy: MachineRouteResolution["evidence"]["matched_by"];
}): MachineResolverAuthority {
  if (!input.machine) return "unresolved";
  if (input.matchedBy === "fallback") return "fallback";
  if (input.selectedHint?.kind === "local") return "live_topology";
  if (input.selectedHint?.kind === "tailscale" || input.machine.tailscale.online !== null) return "live_topology";
  if (input.machine.manifest_declared) return "manifest";
  return "open-machines";
}

function workspaceAuthority(paths: MachineWorkspaceResolution["paths"]): MachineResolverAuthority {
  const sources = [paths.workspace_root.source, paths.project_root.source, paths.open_files_root.source];
  if (sources.some((source) => source === "argument")) return "argument";
  if (sources.some((source) => source === "manifest_metadata")) return "manifest_metadata";
  if (sources.some((source) => source === "manifest")) return "manifest";
  if (sources.some((source) => source === "inferred")) return "inferred";
  if (sources.every((source) => source === "unresolved")) return "unresolved";
  return "open-machines";
}

function cacheability(input: {
  ok: boolean;
  observedAt: Date;
  now: Date;
  ttlMs: number | null | undefined;
  authority: MachineResolverAuthority;
  confidence: MachineRouteConfidence;
  reasons: string[];
}): MachineResolverCacheability {
  const ttlMs = input.ttlMs === undefined ? DEFAULT_MACHINE_RESOLVER_TTL_MS : input.ttlMs;
  const expiresAt = typeof ttlMs === "number" && ttlMs > 0 ? addMilliseconds(input.observedAt, ttlMs) : null;
  const stale = expiresAt ? input.now.getTime() > new Date(expiresAt).getTime() : false;
  const confidenceCacheable = input.confidence !== "none" && input.confidence !== "low";
  const cacheable = input.ok && confidenceCacheable && !stale && input.authority !== "unresolved";
  const reasons = [...input.reasons];
  if (!input.ok) reasons.push("resolver_not_ok");
  if (!confidenceCacheable) reasons.push(`low_confidence:${input.confidence}`);
  if (stale) reasons.push("stale");
  if (input.authority === "unresolved") reasons.push("unresolved_authority");
  return {
    observed_at: input.observedAt.toISOString(),
    verified_at: input.ok ? input.now.toISOString() : null,
    expires_at: expiresAt,
    ttl_ms: typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : null,
    source_authority: input.authority,
    confidence: input.confidence,
    cacheable,
    stale,
    reasons: [...new Set(reasons)].sort(),
  };
}

function worstConfidence(values: MachineRouteConfidence[]): MachineRouteConfidence {
  const rank: Record<MachineRouteConfidence, number> = {
    exact: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
  };
  return [...values].sort((left, right) => rank[right] - rank[left])[0] ?? "none";
}

function mergeAuthorities(values: MachineResolverAuthority[]): MachineResolverAuthority {
  const filtered = values.filter((value) => value !== "unknown");
  if (filtered.length === 0) return "unknown";
  const first = filtered[0];
  return filtered.every((value) => value === first) ? first : "mixed";
}

function mergeCacheability(input: {
  observedAt: Date;
  now: Date;
  ttlMs: number | null | undefined;
  authorities: MachineResolverAuthority[];
  cacheabilities: MachineResolverCacheability[];
}): MachineResolverCacheability {
  const confidence = worstConfidence(input.cacheabilities.map((entry) => entry.confidence));
  const reasons = input.cacheabilities.flatMap((entry) => entry.reasons);
  const ok = input.cacheabilities.every((entry) => entry.cacheable);
  return cacheability({
    ok,
    observedAt: input.observedAt,
    now: input.now,
    ttlMs: input.ttlMs,
    authority: mergeAuthorities(input.authorities),
    confidence,
    reasons,
  });
}

export function resolveMachineRoute(machineId: string, options: MachineRouteOptions = {}): MachineRouteResolution {
  const now = options.now ?? new Date();
  const topology = options.topology ?? discoverMachineTopology({ ...options, limit: null, offset: 0 });
  const warnings = [...topology.warnings];
  const { machine, matchedBy } = findRouteMachine(topology, machineId);
  const generatedAt = now.toISOString();

  if (!machine) {
    warnings.push(`machine_not_found:${machineId}`);
    return {
      schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
      package: { name: MACHINES_PACKAGE_NAME, version: getPackageVersion() },
      ok: false,
      machine_id: null,
      requested_machine_id: machineId,
      generated_at: generatedAt,
      route: "unknown",
      source: "unknown",
      target: null,
      command_target: null,
      confidence: "none",
      local: false,
      evidence: {
        topology: true,
        matched_by: null,
        manifest_declared: null,
        heartbeat_status: null,
        tailscale_online: null,
        selected_hint: null,
      },
      cacheability: cacheability({
        ok: false,
        observedAt: now,
        now,
        ttlMs: options.resolverTtlMs,
        authority: "unresolved",
        confidence: "none",
        reasons: [`machine_not_found:${machineId}`],
      }),
      warnings,
    };
  }

  const selectedHint = selectRouteHint(machine.route_hints);
  const route = selectedHint?.kind ?? machine.ssh.route ?? "unknown";
  const local = route === "local" || machine.machine_id === topology.local_machine_id;
  const confidence = routeConfidence({ machine, hint: selectedHint, matchedBy });
  const ok = Boolean(selectedHint?.target);
  const commandTarget = selectedHint
    ? commandTargetForRoute(selectedHint, userFromSshAddress(machine.ssh.address) ?? machine.user)
    : null;
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: topology.package,
    ok,
    machine_id: machine.machine_id,
    requested_machine_id: machineId,
    generated_at: generatedAt,
    route,
    source: route,
    target: selectedHint?.target ?? null,
    command_target: commandTarget,
    confidence,
    local,
    evidence: {
      topology: true,
      matched_by: matchedBy,
      manifest_declared: machine.manifest_declared,
      heartbeat_status: machine.heartbeat_status,
      tailscale_online: machine.tailscale.online,
      selected_hint: selectedHint,
    },
    cacheability: cacheability({
      ok,
      observedAt: now,
      now,
      ttlMs: options.resolverTtlMs,
      authority: routeAuthority({ machine, selectedHint, matchedBy }),
      confidence,
      reasons: selectedHint ? [] : ["route_target_unresolved"],
    }),
    warnings,
  };
}

export function redactRouteForOutput(route: MachineRouteResolution, options: PublicOutputOptions = {}): MachineRouteResolution {
  if (options.privateMetadata) return route;
  return {
    ...route,
    target: route.target ? REDACTED_VALUE : null,
    command_target: route.command_target ? REDACTED_VALUE : null,
    warnings: route.warnings.map(redactFleetString),
    evidence: {
      ...route.evidence,
      selected_hint: route.evidence.selected_hint
        ? { ...route.evidence.selected_hint, target: REDACTED_VALUE }
        : null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function metadataBoolean(metadata: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function metadataStringArray(metadata: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = metadata[key];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function readMappedPath(input: {
  metadata: Record<string, unknown>;
  containers: string[];
  keys: string[];
}): string | null {
  for (const containerName of input.containers) {
    const container = input.metadata[containerName];
    if (!isRecord(container)) continue;
    for (const key of input.keys) {
      const value = container[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (isRecord(value)) {
        const path = metadataString(value, ["path", "root", "workspacePath", "workspace_path"]);
        if (path) return path;
      }
    }
  }
  return null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinPath(left: string, right: string): string {
  return `${trimTrailingSlash(left)}/${right.replace(/^\/+/, "")}`;
}

function inferRepoRoot(workspaceRoot: string | null, repoName: string | null): string | null {
  if (!workspaceRoot || !repoName) return null;
  const root = trimTrailingSlash(workspaceRoot);
  if (root.endsWith(`/${repoName}`) || root === repoName) return root;
  if (root.endsWith("/workspace") || root.endsWith("/Workspace")) {
    return joinPath(root, `hasna/opensource/${repoName}`);
  }
  return joinPath(root, repoName);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellCommand(command: string[]): string {
  return command.map(shellQuote).join(" ");
}

function canCheckPathForMachine(machine: MachineTopologyEntry | null, localMachineId: string): boolean {
  if (!machine) return false;
  if (machine.machine_id === localMachineId) return true;
  return machine.route_hints.some((hint) => hint.kind === "local");
}

function checkedPathExists(path: string | null, check: boolean): boolean | null {
  if (!path || !check) return null;
  return existsSync(path);
}

function repairHint(input: {
  machineId: string;
  projectId: string;
  repoName: string | null;
  openFilesRepoName: string;
  reason: string;
}): MachineWorkspaceRepairHint {
  const command = [
    "machines",
    "workspace",
    "repair",
    "--machine",
    input.machineId,
    "--project",
    input.projectId,
  ];
  if (input.repoName) command.push("--repo", input.repoName);
  if (input.openFilesRepoName) command.push("--open-files-repo", input.openFilesRepoName);
  command.push("--json");
  const applyCommand = [...command.slice(0, -1), "--apply", "--json"];
  return {
    id: `repair:${input.machineId}:${input.projectId}`,
    reason: input.reason,
    command,
    shell_command: shellCommand(command),
    apply_command: applyCommand,
    apply_shell_command: shellCommand(applyCommand),
  };
}

function pathDiagnostic(input: {
  id: "workspace_root" | "project_root" | "open_files_root";
  label: string;
  path: MachineWorkspacePath;
  pathExists: boolean | null;
  required: boolean;
}): MachineWorkspaceDiagnostic {
  if (!input.path.path) {
    return {
      id: input.id,
      status: "missing",
      severity: input.required ? "fail" : "warn",
      message: `${input.label} is unresolved.`,
      path: null,
      source: input.path.source,
      path_exists: null,
    };
  }
  if (input.pathExists === false) {
    return {
      id: input.id,
      status: "stale",
      severity: "fail",
      message: `${input.label} points to a path that does not exist on this machine.`,
      path: input.path.path,
      source: input.path.source,
      path_exists: false,
    };
  }
  if (input.path.source === "inferred") {
    return {
      id: input.id,
      status: "inferred",
      severity: "warn",
      message: `${input.label} was inferred from the workspace root; write an explicit manifest mapping for repeatable downstream sync.`,
      path: input.path.path,
      source: input.path.source,
      path_exists: input.pathExists,
    };
  }
  return {
    id: input.id,
    status: "ok",
    severity: "ok",
    message: `${input.label} is explicit enough for downstream sync.`,
    path: input.path.path,
    source: input.path.source,
    path_exists: input.pathExists,
  };
}

function workspaceDiagnostics(input: {
  machine: MachineTopologyEntry | null;
  localMachineId: string;
  resolution: Pick<MachineWorkspaceResolution, "machine_id" | "requested_machine_id" | "project" | "machine" | "paths" | "evidence">;
  openFilesRepoName: string;
}): { diagnostics: MachineWorkspaceDiagnostic[]; repairHints: MachineWorkspaceRepairHint[] } {
  const checkPaths = canCheckPathForMachine(input.machine, input.localMachineId);
  const diagnostics: MachineWorkspaceDiagnostic[] = [];
  if (!input.machine) {
    diagnostics.push({
      id: "manifest",
      status: "missing_manifest",
      severity: "fail",
      message: "Machine is not present in topology or manifest.",
      path: null,
      source: "manifest",
      path_exists: null,
    });
  } else if (!input.resolution.evidence.manifest_declared) {
    diagnostics.push({
      id: "manifest",
      status: "missing_manifest",
      severity: "warn",
      message: "Machine came from live topology but is not declared in the manifest.",
      path: null,
      source: "manifest",
      path_exists: null,
    });
  }
  diagnostics.push(pathDiagnostic({
    id: "workspace_root",
    label: "Workspace root",
    path: input.resolution.paths.workspace_root,
    pathExists: checkedPathExists(input.resolution.paths.workspace_root.path, checkPaths),
    required: false,
  }));
  diagnostics.push(pathDiagnostic({
    id: "project_root",
    label: "Project root",
    path: input.resolution.paths.project_root,
    pathExists: checkedPathExists(input.resolution.paths.project_root.path, checkPaths),
    required: true,
  }));
  diagnostics.push(pathDiagnostic({
    id: "open_files_root",
    label: "Open-files root",
    path: input.resolution.paths.open_files_root,
    pathExists: checkedPathExists(input.resolution.paths.open_files_root.path, checkPaths),
    required: false,
  }));
  if (input.resolution.machine.trust_status !== "trusted") {
    diagnostics.push({
      id: "trust",
      status: "untrusted",
      severity: "warn",
      message: `Machine trust status is ${input.resolution.machine.trust_status}; manifest repair apply requires trust or --allow-untrusted.`,
      path: null,
      source: "trust",
      path_exists: null,
    });
  }
  if (input.resolution.machine.auth_status !== "authenticated") {
    diagnostics.push({
      id: "auth",
      status: "unknown_auth",
      severity: "warn",
      message: `Machine auth status is ${input.resolution.machine.auth_status}; remote sync may still fail if SSH is unavailable.`,
      path: null,
      source: "auth",
      path_exists: null,
    });
  }
  const needsRepair = diagnostics.some((entry) => (
    entry.id === "project_root" || entry.id === "open_files_root"
  ) && (entry.status === "missing" || entry.status === "inferred" || entry.status === "stale"));
  const repairHints = needsRepair
    ? [repairHint({
        machineId: input.resolution.machine_id ?? input.resolution.requested_machine_id,
        projectId: input.resolution.project.project_id,
        repoName: input.resolution.project.repo_name,
        openFilesRepoName: input.openFilesRepoName,
        reason: "Write explicit workspace_paths and open_files_roots manifest metadata.",
      })]
    : [];
  return { diagnostics, repairHints };
}

function projectPathFromMetadata(metadata: Record<string, unknown>, projectId: string, repoName: string | null): string | null {
  const keys = [projectId, repoName].filter((value): value is string => Boolean(value));
  return readMappedPath({
    metadata,
    containers: ["project_assignments", "projectAssignments", "workspace_paths", "workspacePaths", "repo_paths", "repoPaths", "project_paths", "projectPaths", "projects"],
    keys,
  });
}

function openFilesPathFromMetadata(metadata: Record<string, unknown>, projectId: string, repoName: string | null): string | null {
  const direct = metadataString(metadata, ["open_files_root", "openFilesRoot", "open_files_path", "openFilesPath"]);
  if (direct) return direct;
  const keys = [projectId, repoName, "open-files", "open_files", "default"].filter((value): value is string => Boolean(value));
  for (const containerName of ["project_assignments", "projectAssignments"]) {
    const container = metadata[containerName];
    if (!isRecord(container)) continue;
    for (const key of keys) {
      const value = container[key];
      if (isRecord(value)) {
        const path = metadataString(value, ["open_files_root", "openFilesRoot", "open_files_path", "openFilesPath"]);
        if (path) return path;
      }
    }
  }
  return readMappedPath({
    metadata,
    containers: ["open_files_roots", "openFilesRoots", "open_files_paths", "openFilesPaths"],
    keys,
  });
}

function trustStatus(machine: MachineTopologyEntry | null): MachineWorkspaceTrustStatus {
  if (!machine) return "unknown";
  const explicit = metadataString(machine.metadata, ["trust_status", "trustStatus"]);
  if (explicit === "trusted" || explicit === "untrusted" || explicit === "unknown") return explicit;
  const trusted = metadataBoolean(machine.metadata, ["trusted", "syncTrusted", "sync_trusted"]);
  if (trusted === true) return "trusted";
  if (trusted === false) return "untrusted";
  if (machine.route_hints.some((hint) => hint.kind === "local")) return "trusted";
  if (machine.tags.includes("trusted")) return "trusted";
  return "unknown";
}

function authStatus(machine: MachineTopologyEntry | null): MachineWorkspaceAuthStatus {
  if (!machine) return "unknown";
  const explicit = metadataString(machine.metadata, ["auth_status", "authStatus"]);
  if (explicit === "authenticated" || explicit === "unauthenticated" || explicit === "unknown") return explicit;
  const authenticated = metadataBoolean(machine.metadata, ["authenticated", "sshAuthorized", "ssh_authorized"]);
  if (authenticated === true) return "authenticated";
  if (authenticated === false) return "unauthenticated";
  if (machine.route_hints.some((hint) => hint.kind === "local")) return "authenticated";
  return "unknown";
}

function primaryMachine(machine: MachineTopologyEntry | null, projectId: string, primaryMachineId?: string): boolean {
  if (!machine) return false;
  if (primaryMachineId) return machine.machine_id === primaryMachineId;
  if (metadataBoolean(machine.metadata, ["primary", "primary_machine", "primaryMachine"]) === true) return true;
  const primaryProjects = metadataStringArray(machine.metadata, ["primary_projects", "primaryProjects"]);
  if (primaryProjects.includes(projectId)) return true;
  return machine.tags.includes("primary");
}

function metadataKeysForDiagnostics(metadata: Record<string, unknown>): string[] {
  return publicMetadataKeys(metadata);
}

export function resolveMachineWorkspace(options: MachineWorkspaceOptions): MachineWorkspaceResolution {
  const now = options.now ?? new Date();
  const topology = options.topology ?? discoverMachineTopology({ ...options, limit: null, offset: 0 });
  const warnings = [...topology.warnings];
  const { machine, matchedBy } = findRouteMachine(topology, options.machineId);
  const generatedAt = now.toISOString();
  const repoName = options.repoName ?? options.projectId;
  const openFilesRepoName = options.openFilesRepoName ?? "open-files";

  if (!machine) {
    warnings.push(`machine_not_found:${options.machineId}`);
    const resolution: MachineWorkspaceResolution = {
      schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
      package: topology.package,
      ok: false,
      requested_machine_id: options.machineId,
      machine_id: null,
      generated_at: generatedAt,
      project: { project_id: options.projectId, repo_name: repoName, canonical: Boolean(options.projectId) },
      machine: { current: false, primary: false, trust_status: "unknown", auth_status: "unknown" },
      paths: {
        workspace_root: { path: null, source: "unresolved" },
        project_root: { path: null, source: "unresolved" },
        open_files_root: { path: null, source: "unresolved" },
      },
      diagnostics: [],
      repair_hints: [],
      evidence: {
        topology: true,
        matched_by: matchedBy,
        manifest_declared: null,
        metadata_keys: [],
      },
      cacheability: cacheability({
        ok: false,
        observedAt: now,
        now,
        ttlMs: options.resolverTtlMs,
        authority: "unresolved",
        confidence: "none",
        reasons: [`machine_not_found:${options.machineId}`],
      }),
      warnings,
    };
    const diagnostics = workspaceDiagnostics({
      machine,
      localMachineId: topology.local_machine_id,
      resolution,
      openFilesRepoName,
    });
    return {
      ...resolution,
      diagnostics: diagnostics.diagnostics,
      repair_hints: diagnostics.repairHints,
    };
  }

  const metadata = machine.metadata;
  const workspaceRootPath = options.workspaceRoot ?? machine.workspace_path;
  const workspaceRootSource: MachineWorkspacePathSource = options.workspaceRoot
    ? "argument"
    : machine.workspace_path
      ? "manifest"
      : "unresolved";

  const metadataProjectRoot = projectPathFromMetadata(metadata, options.projectId, repoName);
  const inferredProjectRoot = inferRepoRoot(workspaceRootPath, repoName);
  const projectRootPath = options.projectRoot ?? metadataProjectRoot ?? inferredProjectRoot;
  const projectRootSource: MachineWorkspacePathSource = options.projectRoot
    ? "argument"
    : metadataProjectRoot
      ? "manifest_metadata"
      : inferredProjectRoot
        ? "inferred"
        : "unresolved";

  const metadataOpenFilesRoot = openFilesPathFromMetadata(metadata, options.projectId, openFilesRepoName);
  const inferredOpenFilesRoot = inferRepoRoot(workspaceRootPath, openFilesRepoName);
  const openFilesRootPath = options.openFilesRoot ?? metadataOpenFilesRoot ?? inferredOpenFilesRoot;
  const openFilesRootSource: MachineWorkspacePathSource = options.openFilesRoot
    ? "argument"
    : metadataOpenFilesRoot
      ? "manifest_metadata"
      : inferredOpenFilesRoot
        ? "inferred"
        : "unresolved";

  if (projectRootSource === "inferred") warnings.push(`project_root_inferred:${options.projectId}`);
  if (openFilesRootSource === "inferred") warnings.push(`open_files_root_inferred:${options.projectId}`);
  if (!projectRootPath) warnings.push(`project_root_unresolved:${options.projectId}`);
  const workspacePaths = {
    workspace_root: { path: workspaceRootPath, source: workspaceRootSource },
    project_root: { path: projectRootPath, source: projectRootSource },
    open_files_root: { path: openFilesRootPath, source: openFilesRootSource },
  };
  const workspaceOk = Boolean(projectRootPath);

  const resolution: MachineWorkspaceResolution = {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: topology.package,
    ok: workspaceOk,
    requested_machine_id: options.machineId,
    machine_id: machine.machine_id,
    generated_at: generatedAt,
    project: {
      project_id: options.projectId,
      repo_name: repoName,
      canonical: Boolean(options.projectId && repoName),
    },
    machine: {
      current: machine.machine_id === topology.local_machine_id,
      primary: primaryMachine(machine, options.projectId, options.primaryMachineId),
      trust_status: trustStatus(machine),
      auth_status: authStatus(machine),
    },
    paths: workspacePaths,
    diagnostics: [],
    repair_hints: [],
    evidence: {
      topology: true,
      matched_by: matchedBy,
      manifest_declared: machine.manifest_declared,
      metadata_keys: metadataKeysForDiagnostics(metadata),
    },
    cacheability: cacheability({
      ok: workspaceOk,
      observedAt: now,
      now,
      ttlMs: options.resolverTtlMs,
      authority: workspaceAuthority(workspacePaths),
      confidence: workspaceOk ? "medium" : "none",
      reasons: projectRootPath ? [] : [`project_root_unresolved:${options.projectId}`],
    }),
    warnings,
  };
  const diagnostics = workspaceDiagnostics({
    machine,
    localMachineId: topology.local_machine_id,
    resolution,
    openFilesRepoName,
  });
  return {
    ...resolution,
    diagnostics: diagnostics.diagnostics,
    repair_hints: diagnostics.repairHints,
  };
}

export interface MachineResolverSnapshotRoute {
  ok: boolean;
  source: MachineRouteKind;
  route: MachineRouteKind;
  target: string | null;
  command_target: string | null;
  confidence: MachineRouteConfidence;
  local: boolean;
  cacheability: MachineResolverCacheability;
}

export interface MachineResolverSnapshotWorkspace {
  ok: boolean;
  project: MachineWorkspaceProject;
  machine: MachineWorkspaceResolution["machine"];
  paths: MachineWorkspaceResolution["paths"];
  diagnostics: MachineWorkspaceDiagnostic[];
  repair_hints: MachineWorkspaceRepairHint[];
  cacheability: MachineResolverCacheability;
}

export interface MachineResolverSnapshot {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  generated_at: string;
  requested_machine_id: string;
  machine_id: string | null;
  route: MachineResolverSnapshotRoute;
  workspace: MachineResolverSnapshotWorkspace | null;
  cacheability: MachineResolverCacheability;
  warnings: string[];
  provenance: {
    route: {
      schema_version: number;
      generated_at: string;
      evidence: {
        matched_by: MachineRouteResolution["evidence"]["matched_by"];
        manifest_declared: boolean | null;
        heartbeat_status: MachineTopologyEntry["heartbeat_status"] | null;
        tailscale_online: boolean | null;
        selected_hint_kind: MachineRouteKind | null;
      };
    };
    workspace: {
      schema_version: number;
      generated_at: string;
      metadata_keys: string[];
      matched_by: MachineRouteResolution["evidence"]["matched_by"];
      manifest_declared: boolean | null;
    } | null;
  };
}

export interface CreateMachineResolverSnapshotOptions {
  route: MachineRouteResolution;
  workspace?: MachineWorkspaceResolution | null;
  now?: Date;
  resolverTtlMs?: number | null;
}

export function createMachineResolverSnapshot(options: CreateMachineResolverSnapshotOptions): MachineResolverSnapshot {
  const now = options.now ?? new Date();
  const routeObservedAt = new Date(options.route.generated_at);
  const workspaceObservedAt = options.workspace ? new Date(options.workspace.generated_at) : null;
  const observedAt = new Date(Math.max(
    Number.isNaN(routeObservedAt.getTime()) ? 0 : routeObservedAt.getTime(),
    workspaceObservedAt && !Number.isNaN(workspaceObservedAt.getTime()) ? workspaceObservedAt.getTime() : 0,
  ));
  const cacheabilities = [options.route.cacheability, options.workspace?.cacheability].filter((entry): entry is MachineResolverCacheability => Boolean(entry));
  const authorities = cacheabilities.map((entry) => entry.source_authority);
  const warnings = [...new Set([
    ...options.route.warnings,
    ...(options.workspace?.warnings ?? []),
    ...cacheabilities.flatMap((entry) => entry.reasons),
  ])].sort();
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: options.route.package,
    generated_at: now.toISOString(),
    requested_machine_id: options.route.requested_machine_id,
    machine_id: options.route.machine_id ?? options.workspace?.machine_id ?? null,
    route: {
      ok: options.route.ok,
      source: options.route.source,
      route: options.route.route,
      target: options.route.target,
      command_target: options.route.command_target,
      confidence: options.route.confidence,
      local: options.route.local,
      cacheability: options.route.cacheability,
    },
    workspace: options.workspace ? {
      ok: options.workspace.ok,
      project: options.workspace.project,
      machine: options.workspace.machine,
      paths: options.workspace.paths,
      diagnostics: options.workspace.diagnostics,
      repair_hints: options.workspace.repair_hints,
      cacheability: options.workspace.cacheability,
    } : null,
    cacheability: mergeCacheability({
      observedAt: observedAt.getTime() > 0 ? observedAt : now,
      now,
      ttlMs: options.resolverTtlMs,
      authorities,
      cacheabilities,
    }),
    warnings,
    provenance: {
      route: {
        schema_version: options.route.schema_version,
        generated_at: options.route.generated_at,
        evidence: {
          matched_by: options.route.evidence.matched_by,
          manifest_declared: options.route.evidence.manifest_declared,
          heartbeat_status: options.route.evidence.heartbeat_status,
          tailscale_online: options.route.evidence.tailscale_online,
          selected_hint_kind: options.route.evidence.selected_hint?.kind ?? null,
        },
      },
      workspace: options.workspace ? {
        schema_version: options.workspace.schema_version,
        generated_at: options.workspace.generated_at,
        metadata_keys: options.workspace.evidence.metadata_keys,
        matched_by: options.workspace.evidence.matched_by,
        manifest_declared: options.workspace.evidence.manifest_declared,
      } : null,
    },
  };
}

export function getLocalMachineTopology(options: MachineTopologyOptions = {}): MachineTopologyEntry {
  const topology = discoverMachineTopology({ ...options, limit: null, offset: 0 });
  return topology.machines.find((machine) => machine.machine_id === topology.local_machine_id) ?? {
    machine_id: topology.local_machine_id,
    friendly_name: null,
    display_name: topology.local_machine_id,
    updated_at: null,
    hostname: hostname(),
    platform: normalizePlatform(),
    os: platform(),
    user: userInfo().username,
    workspace_path: null,
    manifest_declared: false,
    heartbeat_status: "unknown",
    last_heartbeat_at: null,
    agent: {
      pid: null,
      daemon_version: null,
      mode: null,
      private_metadata: false,
      platform: null,
      os_version: null,
      os_build: null,
      arch: null,
      uptime_seconds: null,
      tool_versions: null,
      tailscale: null,
      storage_sync_status: null,
      storage_sync_last_error: null,
      doctor_summary: null,
    },
    tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    ssh: { address: null, route: "local", command_target: "localhost" },
    route_hints: [{ kind: "local", target: "localhost", reachable: true }],
    tags: [`arch:${arch()}`],
    metadata: {},
  };
}
