import { getDb } from "./db.js";
import { REDACTED_VALUE, isSensitiveKey, redactErrorMessage, redactSensitiveValue } from "./redaction.js";
import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  type MachineTopology,
  type MachineTopologyEntry,
  type MachinesContractPackage,
} from "./topology.js";
import { getPackageVersion } from "./version.js";

export const MACHINE_DETAILS_KIND = "machine_details";

export type MachineDetailsStatusState = "online" | "offline" | "unknown";
export type MachineDetailsMetadataValue = string | number | boolean | string[];

export interface MachineDetailsStatus {
  state: MachineDetailsStatusState;
  label: "Online" | "Offline" | "Unknown";
  online: boolean | null;
  last_seen_at?: string;
  last_heartbeat_at?: string;
}

export interface MachineDetailsTimestamps {
  updated_at?: string;
  last_seen_at?: string;
  last_heartbeat_at?: string;
  last_tailscale_seen_at?: string;
  recent_sync_at?: string;
  recent_sync_status?: string;
  storage_sync_status?: string;
}

export interface MachineDetailsSource {
  authority: "open-machines";
  metadata_source: "manifest_metadata" | "heartbeat" | "topology" | "fallback";
  manifest_declared: boolean;
  heartbeat_present: boolean;
  topology_entry: boolean;
  local: boolean;
}

export interface MachineDetails {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: ReturnType<typeof getMachinesConsumerCapabilities>;
  generated_at: string;
  machine_id: string;
  slug: string;
  friendly_name?: string;
  friendlyName?: string;
  display_name: string;
  displayName: string;
  known: boolean;
  status: MachineDetailsStatus;
  platform?: string;
  machine_type?: string;
  role?: string;
  roles?: string[];
  machine_capabilities?: string[];
  tags?: string[];
  updated_at?: string;
  last_seen_at?: string;
  timestamps: MachineDetailsTimestamps;
  source: MachineDetailsSource;
  display_metadata?: Record<string, MachineDetailsMetadataValue>;
  warnings: string[];
}

export interface MachineDetailsOptions {
  topology?: MachineTopology;
  now?: Date;
  includeTailscale?: boolean;
}

interface SyncRunSummary {
  status: string;
  updated_at: string;
}

function packageInfo(): MachinesContractPackage {
  return {
    name: MACHINES_PACKAGE_NAME,
    version: getPackageVersion(),
  };
}

function normalizeMachineId(value: string | null | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : "local";
}

function isPaginatedTopology(topology: MachineTopology): boolean {
  return topology.pagination.limit !== null
    && (topology.pagination.offset > 0 || topology.pagination.count < topology.pagination.total || topology.pagination.hasMore);
}

function topologyHasMachineId(topology: MachineTopology, machineId: string): boolean {
  return topology.machines.some((machine) => machine.machine_id === machineId);
}

function fullTopology(options: MachineDetailsOptions): MachineTopology {
  return discoverMachineTopology({
    includeTailscale: options.includeTailscale === true,
    limit: null,
    offset: 0,
    now: options.now,
  });
}

function topologyForDetails(machineId: string, options: MachineDetailsOptions): MachineTopology {
  if (!options.topology) return fullTopology(options);
  if (!isPaginatedTopology(options.topology) || topologyHasMachineId(options.topology, machineId)) return options.topology;
  const fallback = fullTopology(options);
  const machinesById = new Map(fallback.machines.map((machine) => [machine.machine_id, machine]));
  for (const machine of options.topology.machines) machinesById.set(machine.machine_id, machine);
  return {
    ...fallback,
    machines: [...machinesById.values()],
    warnings: [...new Set([...fallback.warnings, ...options.topology.warnings, "paginated_topology_expanded_for_machine_details"])],
  };
}

function findMachine(topology: MachineTopology, machineId: string): MachineTopologyEntry | null {
  if (machineId === "local" || machineId === "localhost") {
    return topology.machines.find((machine) => machine.machine_id === topology.local_machine_id) ?? null;
  }
  return topology.machines.find((machine) => machine.machine_id === machineId) ?? null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function latestIso(values: Array<string | null | undefined>): string | undefined {
  const latest = values
    .map((value) => ({ value, ms: parseDateMs(value) }))
    .filter((entry): entry is { value: string; ms: number } => entry.value !== null && entry.value !== undefined && entry.ms !== null)
    .sort((left, right) => right.ms - left.ms)[0];
  return latest?.value;
}

function statusStateForMachine(machine: MachineTopologyEntry | null): MachineDetailsStatusState {
  const heartbeatStatus = machine?.heartbeat_status;
  if (heartbeatStatus === "online" || heartbeatStatus === "offline") return heartbeatStatus;
  if (machine?.tailscale.online === true) return "online";
  if (machine?.tailscale.online === false) return "offline";
  return "unknown";
}

function statusForMachine(machine: MachineTopologyEntry | null): MachineDetailsStatus {
  const state = statusStateForMachine(machine);
  const label = state === "online" ? "Online" : state === "offline" ? "Offline" : "Unknown";
  const lastSeen = latestIso([machine?.last_heartbeat_at, machine?.tailscale.last_seen]);
  return {
    state,
    label,
    online: state === "unknown" ? null : state === "online",
    ...(lastSeen ? { last_seen_at: lastSeen } : {}),
    ...(machine?.last_heartbeat_at ? { last_heartbeat_at: machine.last_heartbeat_at } : {}),
  };
}

function latestSyncRun(machineId: string): SyncRunSummary | null {
  try {
    return getDb()
      .query(
        `SELECT status, updated_at
         FROM sync_runs
         WHERE machine_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(machineId) as SyncRunSummary | null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key)
      .filter((key) => !isSensitiveKey(key))
      .sort();
  }
  return [];
}

function firstMetadataString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (isSensitiveKey(key)) continue;
    const value = stringValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function firstMetadataArray(metadata: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (isSensitiveKey(key)) continue;
    const value = stringArrayValue(metadata[key]);
    if (value.length > 0) return value;
  }
  return [];
}

function safeMetadataString(key: string, value: unknown): string | undefined {
  const redacted = redactSensitiveValue(value, key);
  if (typeof redacted !== "string") return undefined;
  const cleaned = redactErrorMessage(redacted).trim();
  if (!cleaned || cleaned.includes(REDACTED_VALUE) || cleaned.includes("<redacted>")) return undefined;
  return cleaned;
}

function safeMetadataValue(key: string, value: unknown): MachineDetailsMetadataValue | undefined {
  const stringValue = safeMetadataString(key, value);
  if (stringValue) return stringValue;
  const redacted = redactSensitiveValue(value, key);
  if (typeof redacted === "number" && Number.isFinite(redacted)) return redacted;
  if (typeof redacted === "boolean") return redacted;
  if (Array.isArray(redacted)) {
    const values = redacted
      .map((entry) => safeMetadataString(key, entry))
      .filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function displayMetadata(machine: MachineTopologyEntry): Record<string, MachineDetailsMetadataValue> | undefined {
  const metadata = machine.metadata;
  const allowedKeys = [
    "machine_type",
    "machineType",
    "type",
    "role",
    "roles",
    "capabilities",
    "capability_flags",
    "environment",
    "env",
    "region",
    "location",
    "team",
    "owner",
    "profile",
  ];
  const safe: Record<string, MachineDetailsMetadataValue> = {};
  for (const key of allowedKeys) {
    if (isSensitiveKey(key) || !(key in metadata)) continue;
    const value = safeMetadataValue(key, metadata[key]);
    if (value !== undefined) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function timestampsForMachine(machine: MachineTopologyEntry | null, syncRun: SyncRunSummary | null): MachineDetailsTimestamps {
  const lastSeen = latestIso([machine?.last_heartbeat_at, machine?.tailscale.last_seen]);
  return {
    ...(machine?.updated_at ? { updated_at: machine.updated_at } : {}),
    ...(lastSeen ? { last_seen_at: lastSeen } : {}),
    ...(machine?.last_heartbeat_at ? { last_heartbeat_at: machine.last_heartbeat_at } : {}),
    ...(machine?.tailscale.last_seen ? { last_tailscale_seen_at: machine.tailscale.last_seen } : {}),
    ...(syncRun?.updated_at ? { recent_sync_at: syncRun.updated_at } : {}),
    ...(syncRun?.status ? { recent_sync_status: syncRun.status } : {}),
    ...(machine?.agent.storage_sync_status ? { storage_sync_status: machine.agent.storage_sync_status } : {}),
  };
}

function sourceForMachine(topology: MachineTopology, machine: MachineTopologyEntry | null): MachineDetailsSource {
  if (!machine) {
    return {
      authority: "open-machines",
      metadata_source: "fallback",
      manifest_declared: false,
      heartbeat_present: false,
      topology_entry: false,
      local: false,
    };
  }
  const heartbeatPresent = machine.heartbeat_status !== "unknown" || Boolean(machine.last_heartbeat_at);
  return {
    authority: "open-machines",
    metadata_source: machine.manifest_declared ? "manifest_metadata" : heartbeatPresent ? "heartbeat" : "topology",
    manifest_declared: machine.manifest_declared,
    heartbeat_present: heartbeatPresent,
    topology_entry: true,
    local: machine.machine_id === topology.local_machine_id,
  };
}

function detailsWarnings(topology: MachineTopology, machine: MachineTopologyEntry | null, requestedMachineId: string): string[] {
  const warnings = [...topology.warnings];
  if (!machine) warnings.push(`unknown_machine:details:${requestedMachineId}`);
  return warnings;
}

export function getMachineDetails(machineId: string, options: MachineDetailsOptions = {}): MachineDetails {
  const requestedMachineId = normalizeMachineId(machineId);
  const topology = topologyForDetails(requestedMachineId, options);
  const machine = findMachine(topology, requestedMachineId);
  const resolvedMachineId = machine?.machine_id ?? requestedMachineId;
  const syncRun = latestSyncRun(resolvedMachineId);
  const friendlyName = machine?.friendly_name ?? undefined;
  const displayName = machine?.display_name ?? resolvedMachineId;
  const status = statusForMachine(machine);
  const timestamps = timestampsForMachine(machine, syncRun);
  const metadata = machine?.metadata ?? {};
  const roles = machine ? firstMetadataArray(metadata, ["roles", "machine_roles", "machineRoles"]) : [];
  const capabilities = machine ? firstMetadataArray(metadata, ["capabilities", "capability_flags", "capabilityFlags"]) : [];
  const machineType = machine ? firstMetadataString(metadata, ["machine_type", "machineType", "type"]) : undefined;
  const role = machine ? firstMetadataString(metadata, ["role", "machine_role", "machineRole"]) : undefined;
  const safeDisplayMetadata = machine ? displayMetadata(machine) : undefined;
  const details: MachineDetails = {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: (options.now ?? new Date()).toISOString(),
    machine_id: resolvedMachineId,
    slug: resolvedMachineId,
    ...(friendlyName ? { friendly_name: friendlyName, friendlyName } : {}),
    display_name: displayName,
    displayName,
    known: Boolean(machine),
    status,
    ...(machine?.platform ? { platform: String(machine.platform) } : {}),
    ...(machineType ? { machine_type: machineType } : {}),
    ...(role ? { role } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(capabilities.length > 0 ? { machine_capabilities: capabilities } : {}),
    ...(machine?.tags.length ? { tags: machine.tags } : {}),
    ...(timestamps.updated_at ? { updated_at: timestamps.updated_at } : {}),
    ...(timestamps.last_seen_at ? { last_seen_at: timestamps.last_seen_at } : {}),
    timestamps,
    source: sourceForMachine(topology, machine),
    ...(safeDisplayMetadata ? { display_metadata: safeDisplayMetadata } : {}),
    warnings: detailsWarnings(topology, machine, requestedMachineId),
  };
  return details;
}
