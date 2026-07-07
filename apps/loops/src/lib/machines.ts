import { createRequire } from "node:module";
import type {
  MachineRouteResolution,
  MachineTopology,
  MachineTopologyEntry,
} from "@hasna/machines/consumer";
import type { LoopMachinePlacement, LoopMachineRef } from "../types.js";

type MachinesConsumer = typeof import("@hasna/machines/consumer");

let consumerModule: MachinesConsumer | undefined;

/**
 * `@hasna/machines` is an optional dependency: loops without machine
 * assignment must keep working when it is not installed. Loading is deferred
 * to first machine-routing use so module import never fails. The package's
 * exports map only declares the `import` condition, so resolve with Bun's
 * import resolver and require the resolved file synchronously.
 */
function machinesConsumer(): MachinesConsumer {
  if (!consumerModule) {
    try {
      const resolved = Bun.resolveSync("@hasna/machines/consumer", import.meta.dir);
      consumerModule = createRequire(import.meta.url)(resolved) as MachinesConsumer;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `@hasna/machines is not available; install the optional dependency to use machine-assigned loops: ${detail}`,
      );
    }
  }
  return consumerModule;
}

export interface MachineCommandPlan {
  command: string;
  args: string[];
  source: string;
}

export interface OpenMachineSummary {
  id: string;
  hostname?: string;
  platform?: string;
  user?: string;
  workspacePath?: string;
  route?: string;
  local: boolean;
  heartbeatStatus?: string;
  tailscaleOnline?: boolean | null;
  tags: string[];
}

export interface RunnerMachineIdentity {
  id: string;
  machineId?: string;
  hostname?: string;
  labels?: Record<string, string>;
  capabilities?: Record<string, unknown>;
}

function compact(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function compactStringList(values: readonly string[] | undefined): string[] | undefined {
  const result = Array.from(new Set((values ?? []).map((value) => compact(value)).filter((value): value is string => Boolean(value))));
  return result.length ? result : undefined;
}

function compactStringRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    const normalizedKey = compact(key);
    const normalizedValue = compact(entry);
    if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;
  }
  return Object.keys(result).length ? result : undefined;
}

function compactCapabilityRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    const normalizedKey = compact(key);
    if (normalizedKey && entry !== undefined) result[normalizedKey] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}

function identityCandidates(runner: RunnerMachineIdentity): Set<string> {
  return new Set([runner.id, runner.machineId, runner.hostname].map((value) => compact(value)).filter((value): value is string => Boolean(value)));
}

function capabilityMatches(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual === undefined) return false;
  if (typeof actual === "object" || typeof expected === "object") {
    try {
      return JSON.stringify(actual) === JSON.stringify(expected);
    } catch {
      return false;
    }
  }
  return String(actual) === String(expected);
}

export function normalizeLoopMachinePlacement(placement: LoopMachinePlacement | undefined): LoopMachinePlacement | undefined {
  if (!placement) return undefined;
  if (!["single", "fanout"].includes(placement.mode)) throw new Error("machine placement mode must be single or fanout");
  const selector = {
    ids: compactStringList(placement.selector.ids),
    labels: compactStringRecord(placement.selector.labels),
    capabilities: compactCapabilityRecord(placement.selector.capabilities),
  };
  if (!selector.ids && !selector.labels && !selector.capabilities) {
    throw new Error("machine placement selector requires ids, labels, or capabilities");
  }
  if (placement.mode === "fanout" && !selector.ids?.length) {
    throw new Error("fanout machine placement requires explicit machine ids");
  }
  return {
    mode: placement.mode,
    selector,
  };
}

export function runnerMatchesLoopMachine(
  machine: LoopMachineRef | undefined,
  placement: LoopMachinePlacement | undefined,
  runner: RunnerMachineIdentity,
): boolean {
  const candidates = identityCandidates(runner);
  if (machine) {
    const machineMatches = candidates.has(machine.id) || (machine.requestedId ? candidates.has(machine.requestedId) : false);
    if (!machineMatches) return false;
  }
  if (!placement) return true;
  const normalized = normalizeLoopMachinePlacement(placement);
  if (!normalized) return true;
  const { selector } = normalized;
  if (selector.ids?.length && !selector.ids.some((id) => candidates.has(id))) return false;
  for (const [key, value] of Object.entries(selector.labels ?? {})) {
    if (runner.labels?.[key] !== value) return false;
  }
  for (const [key, value] of Object.entries(selector.capabilities ?? {})) {
    if (!capabilityMatches(runner.capabilities?.[key], value)) return false;
  }
  return true;
}

export function runnerFanoutKey(placement: LoopMachinePlacement | undefined, runner: RunnerMachineIdentity): string {
  if (placement?.mode !== "fanout") return "single";
  const candidates = identityCandidates(runner);
  const matchedId = placement.selector.ids?.find((id) => candidates.has(id));
  return matchedId ?? compact(runner.machineId) ?? compact(runner.hostname) ?? runner.id;
}

export function expectedFanoutKeys(placement: LoopMachinePlacement | undefined): string[] | undefined {
  if (placement?.mode !== "fanout") return undefined;
  return normalizeLoopMachinePlacement(placement)?.selector.ids;
}

function entryToSummary(entry: MachineTopologyEntry, topology: MachineTopology): OpenMachineSummary {
  return {
    id: entry.machine_id,
    hostname: compact(entry.hostname),
    platform: compact(entry.platform),
    user: compact(entry.user),
    workspacePath: compact(entry.workspace_path),
    route: entry.ssh.route,
    local: entry.machine_id === topology.local_machine_id || entry.ssh.route === "local",
    heartbeatStatus: entry.heartbeat_status,
    tailscaleOnline: entry.tailscale.online,
    tags: entry.tags,
  };
}

function machineFromRoute(route: MachineRouteResolution, topology: MachineTopology): LoopMachineRef {
  if (!route.ok || !route.machine_id) {
    throw new Error(`OpenMachines route not found for machine: ${route.requested_machine_id}`);
  }
  const entry = topology.machines.find((machine) => machine.machine_id === route.machine_id);
  return {
    id: route.machine_id,
    requestedId: route.requested_machine_id !== route.machine_id ? route.requested_machine_id : undefined,
    route: route.route,
    local: route.local,
    confidence: route.confidence,
    workspacePath: compact(entry?.workspace_path),
    resolvedAt: route.generated_at,
    packageVersion: route.package.version,
    warnings: route.warnings.length ? route.warnings : undefined,
  };
}

export function listOpenMachines(): OpenMachineSummary[] {
  const topology = machinesConsumer().discoverMachineTopology();
  return topology.machines.map((entry) => entryToSummary(entry, topology));
}

export function resolveLoopMachine(machineId: string): LoopMachineRef {
  const consumer = machinesConsumer();
  const topology = consumer.discoverMachineTopology();
  const route = consumer.resolveMachineRoute(machineId, { topology });
  return machineFromRoute(route, topology);
}

export function resolveMachineCommand(machineId: string, command: string): MachineCommandPlan {
  return machinesConsumer().resolveMachineCommand(machineId, command);
}

export function refreshLoopMachine(machine: LoopMachineRef): LoopMachineRef {
  return resolveLoopMachine(machine.id);
}
