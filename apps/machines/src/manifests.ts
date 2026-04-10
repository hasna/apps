import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform, userInfo } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";
import { getManifestPath, ensureParentDir } from "./paths.js";
import type { FleetManifest, MachineManifest } from "./types.js";

const packageSchema = z.object({
  name: z.string(),
  manager: z.enum(["bun", "brew", "apt", "custom"]).optional(),
  version: z.string().optional(),
});

const appSchema = z.object({
  name: z.string(),
  manager: z.enum(["brew", "cask", "apt", "winget", "custom"]).optional(),
  packageName: z.string().optional(),
});

const fileSchema = z.object({
  source: z.string(),
  target: z.string(),
  mode: z.enum(["copy", "symlink"]).optional(),
});

export const machineSchema = z.object({
  id: z.string(),
  hostname: z.string().optional(),
  sshAddress: z.string().optional(),
  tailscaleName: z.string().optional(),
  platform: z.enum(["linux", "macos", "windows"]),
  connection: z.enum(["local", "ssh", "tailscale"]).optional(),
  workspacePath: z.string(),
  bunPath: z.string().optional(),
  tags: z.array(z.string()).optional(),
  packages: z.array(packageSchema).optional(),
  apps: z.array(appSchema).optional(),
  files: z.array(fileSchema).optional(),
});

export const fleetSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().optional(),
  machines: z.array(machineSchema),
});

function detectWorkspacePath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return `${home}/Workspace`;
  }
  return `${home}/workspace`;
}

function normalizePlatform(): MachineManifest["platform"] {
  if (platform() === "darwin") return "macos";
  if (platform() === "win32") return "windows";
  return "linux";
}

function normalizeMachines(machines: MachineManifest[]): MachineManifest[] {
  return [...machines].sort((left, right) => left.id.localeCompare(right.id));
}

export function getDefaultManifest(): FleetManifest {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    machines: [],
  };
}

export function readManifest(path = getManifestPath()): FleetManifest {
  if (!existsSync(path)) {
    return getDefaultManifest();
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return fleetSchema.parse(raw);
}

export function validateManifest(path = getManifestPath()): FleetManifest {
  return readManifest(path);
}

export function writeManifest(manifest: FleetManifest, path = getManifestPath()): string {
  ensureParentDir(path);
  const payload: FleetManifest = {
    ...manifest,
    version: 1,
    generatedAt: new Date().toISOString(),
    machines: normalizeMachines(manifest.machines),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

export function getManifestMachine(machineId: string, path = getManifestPath()): MachineManifest | null {
  return readManifest(path).machines.find((machine) => machine.id === machineId) || null;
}

export function detectCurrentMachineManifest(): MachineManifest {
  const machineId = process.env["HASNA_MACHINES_MACHINE_ID"] || hostname();
  const user = userInfo().username;
  const bunDir = dirname(process.execPath);
  return {
    id: machineId,
    hostname: hostname(),
    sshAddress: `${user}@${machineId}`,
    tailscaleName: machineId,
    platform: normalizePlatform(),
    connection: "local",
    workspacePath: detectWorkspacePath(),
    bunPath: bunDir,
    tags: [`arch:${arch()}`],
    packages: [],
    files: [],
  };
}
