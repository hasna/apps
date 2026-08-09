import { redactErrorMessage } from "../redaction.js";
import { resolveMachineRoute, type MachineRouteOptions } from "../topology.js";

export const UNSAFE_SSH_TARGET_ERROR = "Unsafe SSH target";

export interface ResolvedSshTarget {
  machineId: string;
  target: string;
  route: "lan" | "tailscale" | "local" | "ssh";
  confidence: "exact" | "high" | "medium" | "low" | "none";
  warnings: string[];
}

export interface SshCommandPlan extends ResolvedSshTarget {
  command: "ssh";
  args: string[];
  shellCommand: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function unsafeSshTargetError(target: string): Error {
  const redacted = redactErrorMessage(target.trim() || target);
  if (redacted.includes("[redacted]") || redacted !== target.trim()) {
    return new Error(UNSAFE_SSH_TARGET_ERROR);
  }
  return new Error(`${UNSAFE_SSH_TARGET_ERROR}: ${redacted}`);
}

export function validateSshTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith("-") || /[\s"'`$\\;&|<>()[\]{}]/.test(trimmed)) {
    throw unsafeSshTargetError(target);
  }
  if (!/^(?:[A-Za-z0-9._%+-]+@)?[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw unsafeSshTargetError(target);
  }
  return trimmed;
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
    target: validateSshTarget(resolved.command_target ?? resolved.target),
    route: resolved.route,
    confidence: resolved.confidence,
    warnings: resolved.warnings,
  };
}

export function buildSshCommand(machineId: string, remoteCommand?: string, options: MachineRouteOptions = {}): string {
  return buildSshCommandPlan(machineId, remoteCommand, options).shellCommand;
}

export function buildSshCommandArgs(machineId: string, remoteCommand?: string, options: MachineRouteOptions = {}): string[] {
  return buildSshCommandPlan(machineId, remoteCommand, options).args;
}

export function buildSshCommandPlan(machineId: string, remoteCommand?: string, options: MachineRouteOptions = {}): SshCommandPlan {
  const resolved = resolveSshTarget(machineId, options);
  const args = remoteCommand ? [resolved.target, remoteCommand] : [resolved.target];
  const shellCommand = `ssh ${args.map(shellQuote).join(" ")}`;
  return {
    ...resolved,
    command: "ssh",
    args,
    shellCommand,
  };
}
