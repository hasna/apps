import { spawnSync } from "node:child_process";
import { getLocalMachineId } from "./db.js";
import { buildSshCommand, resolveSshTarget } from "./commands/ssh.js";

export interface MachineCommandResult {
  machineId: string;
  source: "local" | "lan" | "tailscale";
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runMachineCommand(machineId: string, command: string): MachineCommandResult {
  const localMachineId = getLocalMachineId();
  const isLocal = machineId === localMachineId;
  const route = isLocal ? "local" : resolveSshTarget(machineId).route;
  const shellCommand = isLocal ? command : buildSshCommand(machineId, command);
  const result = spawnSync("bash", ["-lc", shellCommand], {
    encoding: "utf8",
    env: process.env,
  });

  return {
    machineId,
    source: route,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}
