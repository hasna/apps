import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  MACHINE_LIST_ORDER,
  discoverMachineTopology,
  findMachineTopologyEntry,
  getMachinesConsumerCapabilities,
  type MachineTopology,
  type MachineListPagination,
  type MachineTopologyEntry,
  type MachinesContractPackage,
} from "./topology.js";
import { isSensitiveKey } from "./redaction.js";
import { getPackageVersion } from "./version.js";

export const NOTE_MACHINE_CONTEXT_KIND = "note_machine_context";
export const MACHINE_TRASH_POLICIES_KIND = "machine_trash_policies";

export type NoteMachineRole = "origin" | "source" | "target" | "sync_target" | "trash_owner";
export type NoteActorType = "human" | "agent" | "system" | "unknown";
export type NoteMachineContextSource = "notes" | "agent" | "sync" | "import" | "machines" | "unknown" | "open-notes" | "open-machines";
/** Legacy stored values accepted on read until records are migrated. */
export const LEGACY_NOTE_CONTEXT_SOURCES = ["notes", "machines"] as const;
export type LegacyNoteContextSource = (typeof LEGACY_NOTE_CONTEXT_SOURCES)[number];
/** Retired open-* alias values accepted on read until records are migrated (open- prefix retired, PR #320). */
export type LegacyNoteMachineContextSourceAlias = "open-notes" | "open-machines";
/** Actor source accepted at read boundaries: canonical values plus retired open-* aliases. */
export type NoteMachineContextSourceInput = NoteMachineContextSource | LegacyNoteMachineContextSourceAlias;
const LEGACY_NOTE_CONTEXT_SOURCE_ALIASES: Record<LegacyNoteMachineContextSourceAlias, NoteMachineContextSource> = {
  "open-notes": "notes",
  "open-machines": "machines",
};
export type MachineTrashPolicySource = "manifest_metadata" | "default";

export interface NoteMachineReference {
  machine_id: string;
  friendly_name: string | null;
  display_name: string;
  updated_at: string | null;
  role: NoteMachineRole;
  known: boolean;
  manifest_declared: boolean;
}

export interface NoteSyncTarget {
  machine_id: string;
  machine: NoteMachineReference;
}

export interface NoteActorContext {
  actor_type: NoteActorType;
  actor_id: string | null;
  actor_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  source: NoteMachineContextSource;
  display_name: string;
}

/** Actor input at a read boundary; source accepts retired open-* aliases, normalized to canonical on read. */
export type NoteActorContextInput = Partial<Omit<NoteActorContext, "source">> & { source?: NoteMachineContextSourceInput };

export interface NoteMachineContextOptions {
  originMachineId?: string | null;
  sourceMachineId?: string | null;
  targetMachineId?: string | null;
  syncTargetMachineIds?: string[];
  actor?: NoteActorContextInput;
  topology?: MachineTopology;
  now?: Date;
  includeTailscale?: boolean;
}

export interface NoteMachineContext {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: ReturnType<typeof getMachinesConsumerCapabilities>;
  generated_at: string;
  origin_machine_id: string | null;
  source_machine_id: string | null;
  target_machine_id: string | null;
  origin_machine: NoteMachineReference | null;
  source_machine: NoteMachineReference | null;
  target_machine: NoteMachineReference | null;
  sync_target_machine_ids: string[];
  sync_targets: NoteSyncTarget[];
  actor: NoteActorContext;
  warnings: string[];
}

export interface MachineTrashPolicy {
  machine_id: string;
  friendly_name: string | null;
  display_name: string;
  updated_at: string | null;
  enabled: boolean | null;
  retention_days: number | null;
  delete_after_days: number | null;
  trash_path: string | null;
  source: MachineTrashPolicySource;
  metadata_keys: string[];
}

export interface MachineTrashPoliciesOptions {
  machineId?: string | null;
  topology?: MachineTopology;
  now?: Date;
  includeTailscale?: boolean;
  limit?: number | null;
  offset?: number;
}

export interface MachineTrashPolicies {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: ReturnType<typeof getMachinesConsumerCapabilities>;
  generated_at: string;
  pagination: MachineListPagination;
  policies: MachineTrashPolicy[];
  warnings: string[];
}

const NOTE_ACTOR_TYPES = new Set<NoteActorType>(["human", "agent", "system", "unknown"]);
const NOTE_CONTEXT_SOURCES = new Set<NoteMachineContextSource | LegacyNoteContextSource>([...LEGACY_NOTE_CONTEXT_SOURCES, "notes", "agent", "sync", "import", "machines", "unknown"]);

function packageInfo(): MachinesContractPackage {
  return {
    name: MACHINES_PACKAGE_NAME,
    version: getPackageVersion(),
  };
}

function topologyForNotes(options: NoteMachineContextOptions | MachineTrashPoliciesOptions): MachineTopology {
  return options.topology ?? discoverMachineTopology({
    includeTailscale: options.includeTailscale === true,
    limit: "limit" in options ? options.limit : undefined,
    offset: "offset" in options ? options.offset : 0,
    now: options.now,
  });
}

function requestedContextMachineIds(options: NoteMachineContextOptions): string[] {
  return dedupeMachineIds([
    options.originMachineId,
    options.sourceMachineId,
    options.targetMachineId,
    ...(options.syncTargetMachineIds ?? []),
  ]);
}

function isPaginatedTopology(topology: MachineTopology): boolean {
  return topology.pagination.limit !== null
    && (topology.pagination.offset > 0 || topology.pagination.count < topology.pagination.total || topology.pagination.hasMore);
}

function topologyHasMachineIds(topology: MachineTopology, machineIds: string[]): boolean {
  if (machineIds.length === 0) return true;
  return machineIds.every((machineId) => findMachineTopologyEntry(topology, machineId) !== null);
}

function mergeTopologyForMachineLookup(primary: MachineTopology, fallback: MachineTopology, warning: string): MachineTopology {
  const machinesById = new Map(fallback.machines.map((machine) => [machine.machine_id, machine]));
  for (const machine of primary.machines) machinesById.set(machine.machine_id, machine);
  return {
    ...fallback,
    machines: [...machinesById.values()],
    warnings: [...new Set([...fallback.warnings, ...primary.warnings, warning])],
  };
}

function unpaginatedDiscoveredTopology(options: NoteMachineContextOptions | MachineTrashPoliciesOptions): MachineTopology {
  return discoverMachineTopology({
    includeTailscale: options.includeTailscale === true,
    limit: null,
    offset: 0,
    now: options.now,
  });
}

function topologyForNoteContext(options: NoteMachineContextOptions): MachineTopology {
  if (!options.topology) return unpaginatedDiscoveredTopology(options);
  const requestedMachineIds = requestedContextMachineIds(options);
  if (!isPaginatedTopology(options.topology) || topologyHasMachineIds(options.topology, requestedMachineIds)) {
    return options.topology;
  }
  return mergeTopologyForMachineLookup(
    options.topology,
    unpaginatedDiscoveredTopology(options),
    "paginated_topology_expanded_for_note_context",
  );
}

function normalizeMachineId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeMachineIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = normalizeMachineId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function findMachine(topology: MachineTopology, machineId: string): MachineTopologyEntry | null {
  return findMachineTopologyEntry(topology, machineId);
}

export function machineReferenceForNote(
  machineId: string | null | undefined,
  role: NoteMachineRole,
  topology: MachineTopology,
): NoteMachineReference | null {
  const id = normalizeMachineId(machineId);
  if (!id) return null;
  const machine = findMachine(topology, id);
  if (!machine) {
    return {
      machine_id: id,
      friendly_name: null,
      display_name: id,
      updated_at: null,
      role,
      known: false,
      manifest_declared: false,
    };
  }
  return {
    machine_id: machine.machine_id,
    friendly_name: machine.friendly_name,
    display_name: machine.display_name,
    updated_at: machine.updated_at,
    role,
    known: true,
    manifest_declared: machine.manifest_declared,
  };
}

function normalizeActorType(actor: NoteActorContextInput | undefined): NoteActorType {
  if (actor?.actor_type && NOTE_ACTOR_TYPES.has(actor.actor_type)) return actor.actor_type;
  if (actor?.actor_type) return "unknown";
  return actor?.agent_id || actor?.agent_name ? "agent" : "unknown";
}

function normalizeContextSource(source: NoteMachineContextSourceInput | undefined, actorType: NoteActorType): NoteMachineContextSource {
  const canonical = source === "open-notes" || source === "open-machines" ? LEGACY_NOTE_CONTEXT_SOURCE_ALIASES[source] : source;
  if (canonical && NOTE_CONTEXT_SOURCES.has(canonical)) return canonical;
  if (source) return "unknown";
  return actorType === "agent" ? "agent" : "unknown";
}

function normalizeActor(actor: NoteActorContextInput | undefined): NoteActorContext {
  const actorType = normalizeActorType(actor);
  const source = normalizeContextSource(actor?.source, actorType);
  const actorId = actor?.actor_id?.trim() || actor?.agent_id?.trim() || null;
  const actorName = actor?.actor_name?.trim() || actor?.agent_name?.trim() || null;
  const agentId = actorType === "agent" ? actor?.agent_id?.trim() || actorId : actor?.agent_id?.trim() || null;
  const agentName = actorType === "agent" ? actor?.agent_name?.trim() || actorName : actor?.agent_name?.trim() || null;
  return {
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    agent_id: agentId,
    agent_name: agentName,
    source,
    display_name: actorName || actorId || source,
  };
}

export function resolveNoteMachineContext(options: NoteMachineContextOptions = {}): NoteMachineContext {
  const topology = topologyForNoteContext(options);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const originMachineId = normalizeMachineId(options.originMachineId);
  const sourceMachineId = normalizeMachineId(options.sourceMachineId) ?? originMachineId;
  const targetMachineId = normalizeMachineId(options.targetMachineId);
  const syncTargetMachineIds = dedupeMachineIds([
    ...(options.syncTargetMachineIds ?? []),
    targetMachineId,
  ]);
  const originMachine = machineReferenceForNote(originMachineId, "origin", topology);
  const sourceMachine = machineReferenceForNote(sourceMachineId, "source", topology);
  const targetMachine = machineReferenceForNote(targetMachineId, "target", topology);
  const syncTargets = syncTargetMachineIds
    .map((machineId) => {
      const machine = machineReferenceForNote(machineId, "sync_target", topology);
      return machine ? { machine_id: machine.machine_id, machine } : null;
    })
    .filter((target): target is NoteSyncTarget => target !== null);
  const warnings = [...topology.warnings];
  for (const ref of [originMachine, sourceMachine, targetMachine, ...syncTargets.map((target) => target.machine)]) {
    if (ref && !ref.known) warnings.push(`unknown_machine:${ref.role}:${ref.machine_id}`);
  }
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt,
    origin_machine_id: originMachine?.machine_id ?? null,
    source_machine_id: sourceMachine?.machine_id ?? null,
    target_machine_id: targetMachine?.machine_id ?? null,
    origin_machine: originMachine,
    source_machine: sourceMachine,
    target_machine: targetMachine,
    sync_target_machine_ids: syncTargets.map((target) => target.machine_id),
    sync_targets: syncTargets,
    actor: normalizeActor(options.actor),
    warnings,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function trashMetadata(machine: MachineTopologyEntry): { record: Record<string, unknown> | null; keys: string[] } {
  const metadata = machine.metadata;
  for (const key of ["notes_trash", "notesTrash", "note_trash", "noteTrash", "trash"]) {
    const record = recordValue(metadata[key]);
    if (record) return { record, keys: Object.keys(record).filter((entryKey) => !isSensitiveKey(entryKey)).sort() };
  }
  return { record: null, keys: [] };
}

function optionalBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key];
  }
  return null;
}

function optionalInteger(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function optionalString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function trashPolicyForMachine(machine: MachineTopologyEntry): MachineTrashPolicy {
  const trash = trashMetadata(machine);
  const record = trash.record;
  return {
    machine_id: machine.machine_id,
    friendly_name: machine.friendly_name,
    display_name: machine.display_name,
    updated_at: machine.updated_at,
    enabled: record ? optionalBoolean(record, "enabled") : null,
    retention_days: record ? optionalInteger(record, "retention_days", "retentionDays") : null,
    delete_after_days: record ? optionalInteger(record, "delete_after_days", "deleteAfterDays") : null,
    trash_path: record ? optionalString(record, "trash_path", "trashPath", "path") : null,
    source: record ? "manifest_metadata" : "default",
    metadata_keys: trash.keys,
  };
}

export function listMachineTrashPolicies(options: MachineTrashPoliciesOptions = {}): MachineTrashPolicies {
  const machineId = normalizeMachineId(options.machineId);
  const initialTopology = machineId && !options.topology ? unpaginatedDiscoveredTopology(options) : topologyForNotes(options);
  const topology = machineId && options.topology && isPaginatedTopology(options.topology) && !topologyHasMachineIds(options.topology, [machineId])
    ? mergeTopologyForMachineLookup(options.topology, unpaginatedDiscoveredTopology(options), "paginated_topology_expanded_for_trash_policy")
    : initialTopology;
  const machines = machineId
    ? (() => {
      const machine = findMachineTopologyEntry(topology, machineId);
      return machine ? [machine] : [];
    })()
    : topology.machines;
  const pagination: MachineListPagination = machineId
    ? {
        limit: 1,
        offset: 0,
        total: machines.length,
        count: machines.length,
        hasMore: false,
        nextOffset: null,
        has_more: false,
        next_offset: null,
        order: MACHINE_LIST_ORDER,
      }
    : topology.pagination;
  const warnings = [...topology.warnings];
  if (machineId && machines.length === 0) warnings.push(`unknown_machine:trash_owner:${machineId}`);
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: (options.now ?? new Date()).toISOString(),
    pagination,
    policies: machines.map(trashPolicyForMachine),
    warnings,
  };
}
