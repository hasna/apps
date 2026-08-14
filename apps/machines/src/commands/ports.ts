import { spawnSync } from "node:child_process";
import { getLocalMachineId } from "../db.js";
import { buildSshCommand } from "./ssh.js";

export interface ListeningPort {
  protocol: string;
  host: string;
  port: number;
  process?: string;
}

export interface PortsResult {
  machineId: string;
  listeners: ListeningPort[];
}

function parseSsOutput(output: string): ListeningPort[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const protocol = parts[0] === "tcp" || parts[0] === "udp" ? parts[0] : "tcp";
      const local = parts.find((part) => /:\d+$/.test(part)) || "";
      const process = parts.find((part) => part.startsWith("users:")) || parts.slice(5).join(" ") || undefined;
      const separatorIndex = local.lastIndexOf(":");
      return {
        protocol,
        host: separatorIndex >= 0 ? local.slice(0, separatorIndex) : local,
        port: Number.parseInt(separatorIndex >= 0 ? local.slice(separatorIndex + 1) : "0", 10),
        process,
      };
    })
    .filter((entry) => Number.isFinite(entry.port) && entry.port > 0);
}

function parseLsofOutput(output: string): ListeningPort[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const process = parts[0];
      const protocol = parts[7] || "tcp";
      const endpoint = parts[8] || "";
      const normalized = endpoint.replace(/\(LISTEN\)$/, "");
      const separatorIndex = normalized.lastIndexOf(":");
      return {
        protocol,
        host: separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized,
        port: Number.parseInt(separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : "0", 10),
        process,
      };
    })
    .filter((entry) => Number.isFinite(entry.port) && entry.port > 0);
}

export function parsePortOutput(output: string, format: "ss" | "lsof"): ListeningPort[] {
  return format === "ss" ? parseSsOutput(output) : parseLsofOutput(output);
}

export function listPorts(machineId?: string): PortsResult {
  const targetMachineId = machineId || getLocalMachineId();
  const isLocal = targetMachineId === getLocalMachineId();
  const localCommand = "if command -v ss >/dev/null 2>&1; then ss -ltnpH; else lsof -nP -iTCP -sTCP:LISTEN; fi";
  const command = isLocal ? localCommand : buildSshCommand(targetMachineId, localCommand);
  const result = spawnSync("bash", ["-lc", command], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Failed to list ports for ${targetMachineId}`);
  }

  const format = result.stdout.includes("LISTEN") && result.stdout.includes("TCP") ? "lsof" : "ss";
  return {
    machineId: targetMachineId,
    listeners: parsePortOutput(result.stdout, format),
  };
}
