import { createRequire } from "node:module";
import type {
  MachineRouteResolution,
  MachineTopology,
  MachineTopologyEntry,
} from "@hasna/machines/consumer";
import type { LoopMachineRef } from "../types.js";

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
  const consumer = machinesConsumer();
  const route = consumer.resolveMachineRoute(machineId);
  if (!route.ok || !route.machine_id) {
    // Fail closed through the canonical route. The machines package's own
    // resolveMachineCommand degrades an unresolvable id to `ssh <machine-id>`,
    // which for canonical machine names (e.g. the apple03 -> station03 alias)
    // fails DNS instead of reporting the route problem. Every preflight and
    // execution path funnels through this wrapper, so the route is the only
    // resolution the loop ever performs.
    throw new Error(`OpenMachines route not found for machine: ${machineId}`);
  }
  if (route.local) {
    return { command: "bash", args: ["-c", command], source: "local" };
  }
  const target = route.command_target ?? route.target;
  if (!target) {
    throw new Error(`OpenMachines route not found for machine: ${machineId}`);
  }
  return { command: "ssh", args: [target, command], source: route.route };
}

export function refreshLoopMachine(machine: LoopMachineRef): LoopMachineRef {
  return resolveLoopMachine(machine.id);
}
