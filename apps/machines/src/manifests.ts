import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform, userInfo } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";
import { getManifestPath, ensureParentDir } from "./paths.js";
import { redactIdentifier, redactPath, redactPrivateRef } from "./redaction.js";
import type { FleetManifest, MachineManifest, ManifestLoadInfo, ManifestSourceRef } from "./types.js";

export const PRIVATE_MANIFEST_REF_ENV = "HASNA_MACHINES_PRIVATE_MANIFEST_REF";
export const PRIVATE_MANIFEST_BACKEND_ENV = "HASNA_MACHINES_PRIVATE_MANIFEST_BACKEND";

export interface ManifestSourceAdapter {
  id: string;
  readManifest(input: { source: ManifestSourceRef; rawRef: string }): FleetManifest | null | undefined;
}

export interface ReadManifestWithSourceOptions {
  path?: string;
  env?: NodeJS.ProcessEnv;
  privateRef?: string;
  privateBackend?: string;
  adapter?: ManifestSourceAdapter | null;
}

const packageSchema = z.object({
  name: z.string(),
  manager: z.enum(["bun", "brew", "apt", "custom"]).optional(),
  version: z.string().optional(),
  appId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "appId must be a lowercase slug (hasna.app.v1 AppId)").optional(),
  bin: z.string().min(1).optional(),
  verify: z.boolean().optional(),
  mcpHealthUrl: z.string().min(1).optional(),
});

const freezeEntrySchema = z.object({
  name: z.string().min(1),
  reason: z.string().optional(),
  frozenAt: z.string().optional(),
  until: z.string().optional(),
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
  friendlyName: z.string().optional(),
  updatedAt: z.string().optional(),
  hostname: z.string().optional(),
  sshAddress: z.string().optional(),
  tailscaleName: z.string().optional(),
  platform: z.enum(["linux", "macos", "windows"]),
  connection: z.enum(["local", "ssh", "tailscale"]).optional(),
  workspacePath: z.string(),
  bunPath: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  packages: z.array(packageSchema).optional(),
  apps: z.array(appSchema).optional(),
  files: z.array(fileSchema).optional(),
});

export const fleetSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().optional(),
  packages: z.array(packageSchema).optional(),
  freeze: z.array(freezeEntrySchema).optional(),
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

export function normalizeFriendlyName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function machineDisplayName(machine: Pick<MachineManifest, "id" | "friendlyName">): string {
  return normalizeFriendlyName(machine.friendlyName) ?? machine.id;
}

function inferPrivateBackend(rawRef: string, explicitBackend?: string): string | null {
  if (explicitBackend?.trim()) return explicitBackend.trim();
  const scheme = rawRef.trim().match(/^([a-z][a-z0-9+.-]*)(?::\/\/|:)/i);
  return scheme?.[1] ?? null;
}

function fileSourceRef(path: string): ManifestSourceRef {
  return {
    kind: "file",
    ref: redactPath(path),
    backend: "file",
    private: false,
    publicSafe: true,
  };
}

function privateSourceRef(rawRef: string, backend?: string): ManifestSourceRef {
  return {
    kind: "private-ref",
    ref: redactPrivateRef(rawRef),
    backend: inferPrivateBackend(rawRef, backend),
    private: true,
    publicSafe: true,
  };
}

function privateRefFromOptions(options: ReadManifestWithSourceOptions): string | null {
  const env = options.env ?? process.env;
  return options.privateRef?.trim()
    || env[PRIVATE_MANIFEST_REF_ENV]?.trim()
    || env["MACHINES_PRIVATE_MANIFEST_REF"]?.trim()
    || null;
}

export function getManifestSourceRef(options: ReadManifestWithSourceOptions = {}): ManifestSourceRef {
  const rawPrivateRef = privateRefFromOptions(options);
  if (rawPrivateRef) {
    const env = options.env ?? process.env;
    return privateSourceRef(rawPrivateRef, options.privateBackend ?? env[PRIVATE_MANIFEST_BACKEND_ENV]);
  }
  return fileSourceRef(options.path ?? getManifestPath());
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

export function readManifestWithSource(options: ReadManifestWithSourceOptions = {}): { manifest: FleetManifest; info: ManifestLoadInfo } {
  const path = options.path ?? getManifestPath();
  const source = getManifestSourceRef(options);
  const warnings: string[] = [];

  if (source.kind === "private-ref") {
    const rawRef = privateRefFromOptions(options);
    if (rawRef && options.adapter) {
      try {
        const manifest = options.adapter.readManifest({ source, rawRef });
        if (manifest) {
          return {
            manifest: fleetSchema.parse(manifest),
            info: {
              source,
              loadedFrom: "private-ref",
              warnings,
            },
          };
        }
        warnings.push(`private_manifest_adapter_empty:${redactIdentifier(options.adapter.id)}`);
      } catch (error) {
        warnings.push(`private_manifest_adapter_failed:${redactIdentifier(options.adapter.id)}`);
      }
    } else {
      warnings.push("private_manifest_ref_without_adapter");
    }

    const fallbackSource = fileSourceRef(path);
    const manifest = readManifest(path);
    return {
      manifest,
      info: {
        source,
        loadedFrom: existsSync(path) ? "fallback" : "default",
        fallbackSource,
        warnings,
      },
    };
  }

  return {
    manifest: readManifest(path),
    info: {
      source,
      loadedFrom: existsSync(path) ? "file" : "default",
      warnings,
    },
  };
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
  fleetSchema.parse(payload);
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
    updatedAt: new Date().toISOString(),
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
