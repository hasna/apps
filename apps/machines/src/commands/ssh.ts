import { resolveMachineRoute, type MachineRouteOptions } from "../topology.js";

export interface ResolvedSshTarget {
  machineId: string;
  target: string;
  route: "lan" | "tailscale" | "local" | "ssh";
  confidence: "exact" | "high" | "medium" | "low" | "none";
  warnings: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function resolveSshTarget(machineId: string, options: MachineRouteOptions = {}): ResolvedSshTarget {
  const resolved = resolveMachineRoute(machineId, options);
  if (!resolved.ok || !resolved.target) {
    throw new Error(`Machine route not found: ${machineId}`);
  }
  if (resolved.route !== "local" && resolved.route !== "lan" && resolved.route !== "tailscale" && resolved.route !== "ssh") {
    throw new Error(`Machine route is not SSH-capable: ${machineId}`);
  }
  return {
    machineId: resolved.machine_id ?? machineId,
    target: resolved.command_target ?? resolved.target,
    route: resolved.route,
    confidence: resolved.confidence,
    warnings: resolved.warnings,
  };
}

export function buildSshCommand(machineId: string, remoteCommand?: string, options: MachineRouteOptions = {}): string {
  const resolved = resolveSshTarget(machineId, options);
  return remoteCommand ? `ssh ${resolved.target} ${shellQuote(remoteCommand)}` : `ssh ${resolved.target}`;
}
