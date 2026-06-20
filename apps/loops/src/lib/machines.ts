import {
  discoverMachineTopology,
  resolveMachineRoute,
  type MachineRouteResolution,
  type MachineTopology,
  type MachineTopologyEntry,
} from "@hasna/machines/consumer";
import type { LoopMachineRef } from "../types.js";

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

function compact(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
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
  const topology = discoverMachineTopology();
  return topology.machines.map((entry) => entryToSummary(entry, topology));
}

export function resolveLoopMachine(machineId: string): LoopMachineRef {
  const topology = discoverMachineTopology();
  const route = resolveMachineRoute(machineId, { topology });
  return machineFromRoute(route, topology);
}

export function refreshLoopMachine(machine: LoopMachineRef): LoopMachineRef {
  return resolveLoopMachine(machine.id);
}
