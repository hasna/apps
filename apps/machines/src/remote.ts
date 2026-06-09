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
    if (String((error as Error).message ?? error).includes("Machine not found in manifest")) {
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
