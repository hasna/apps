import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { getLocalMachineId } from "./db.js";
import { buildSshCommand, resolveSshTarget } from "./commands/ssh.js";

export interface MachineCommandResult {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type MachineCommandRunner = (machineId: string, command: string) => MachineCommandResult;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function machineIsLocal(machineId: string, localMachineId: string): boolean {
  return machineId === "local"
    || machineId === "localhost"
    || machineId === localMachineId
    || machineId === hostname();
}

export function resolveMachineCommand(machineId: string, command: string, localMachineId = getLocalMachineId()): { source: MachineCommandResult["source"]; shellCommand: string } {
  if (machineIsLocal(machineId, localMachineId)) {
    return { source: "local", shellCommand: command };
  }

  try {
    return {
      source: resolveSshTarget(machineId).route,
      shellCommand: buildSshCommand(machineId, command),
    };
  } catch (error) {
    const message = String((error as Error).message ?? error);
    if (message.includes("Machine route not found") || message.includes("Machine not found in manifest")) {
      return { source: "ssh", shellCommand: `ssh ${shellQuote(machineId)} ${shellQuote(command)}` };
    }
    throw error;
  }
}

export function runMachineCommand(machineId: string, command: string): MachineCommandResult {
  const resolved = resolveMachineCommand(machineId, command);
  const result = spawnSync("bash", ["-c", resolved.shellCommand], {
    encoding: "utf8",
    env: process.env,
  });

  return {
    machineId,
    source: resolved.source,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

export function describeMachineCommandFailure(operation: string, result: MachineCommandResult): string {
  const detail = (result.stderr || result.stdout || "").trim();
  const suffix = detail ? `: ${detail}` : "";
  return `${operation} failed on ${result.machineId} via ${result.source} (exit ${result.exitCode})${suffix}`;
}

export function requireMachineCommandSuccess(operation: string, result: MachineCommandResult): MachineCommandResult {
  if (result.exitCode !== 0) {
    throw new Error(describeMachineCommandFailure(operation, result));
  }
  return result;
}
