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

export const EXACT_BUN_REGISTRY_SECRET_REFS = [
  "hasna/npm/live/publish-token",
  "hasnaxyz/npm/live/publish-token",
] as const;

export const EXACT_BUN_REGISTRY_EXCLUSIONS = [
  "@hasnaxyz/infinity",
  "@hasnaxyz/factory",
  "@hasna/secrets",
  "@hasna/events",
] as const;

export const EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE = 604800;
export const EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES = 1_048_576;
export const LEGACY_BUN_REGISTRY_SOURCE_SHA256 = "4aad0a5c76e89c9532cb308d65ab0693465bf97519fb47d4ea6d4106c4e2ddf6";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EXACT_SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const REGISTRY_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

const exactBunRegistrySchema = z.object({
  schema: z.literal("machines.exact_bun_registry.v1"),
  order: z.number().int().positive(),
  mode: z.literal("live-global"),
  source: z.object({
    provider: z.enum(["files", "task-attachment"]),
    ref: z.string().trim().min(1).max(512),
    sha256: z.string().regex(SHA256_PATTERN, "source.sha256 must be a lowercase SHA-256 digest"),
    sizeBytes: z.number().int().positive().max(EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES),
  }).strict(),
  archiveSha256: z.string().regex(SHA256_PATTERN, "archiveSha256 must be a lowercase SHA-256 digest"),
  registryIntegrity: z.string().regex(REGISTRY_INTEGRITY_PATTERN, "registryIntegrity must be an npm sha512 integrity"),
  secretRefs: z.tuple([
    z.literal(EXACT_BUN_REGISTRY_SECRET_REFS[0]),
    z.literal(EXACT_BUN_REGISTRY_SECRET_REFS[1]),
  ]),
  quarantine: z.object({
    minimumReleaseAge: z.literal(EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE),
    exactExclusions: z.tuple([
      z.literal(EXACT_BUN_REGISTRY_EXCLUSIONS[0]),
      z.literal(EXACT_BUN_REGISTRY_EXCLUSIONS[1]),
      z.literal(EXACT_BUN_REGISTRY_EXCLUSIONS[2]),
      z.literal(EXACT_BUN_REGISTRY_EXCLUSIONS[3]),
    ]),
  }).strict(),
  probe: z.object({
    sdkImport: z.string().trim().min(1).max(256),
    cli: z.object({
      bin: z.string().trim().min(1).max(128),
      args: z.tuple([z.literal("--help")]),
    }).strict(),
  }).strict(),
  rollback: z.literal("byte-preimage"),
}).strict().superRefine((delivery, context) => {
  if (delivery.source.sha256 === LEGACY_BUN_REGISTRY_SOURCE_SHA256) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "sha256"],
      message: "the legacy isolated installer source is not compatible with live-global exact delivery",
    });
  }
});

const packageSchema = z.object({
  name: z.string(),
  manager: z.enum(["bun", "brew", "apt", "custom"]).optional(),
  version: z.string().optional(),
  appId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "appId must be a lowercase slug (hasna.app.v1 AppId)").optional(),
  bin: z.string().min(1).optional(),
  verify: z.boolean().optional(),
  mcpHealthUrl: z.string().min(1).optional(),
  exactBunRegistry: exactBunRegistrySchema.optional(),
}).strict().superRefine((pkg, context) => {
  if (!pkg.exactBunRegistry) return;
  if (pkg.manager !== "bun") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manager"], message: "exactBunRegistry requires manager bun" });
  }
  if (!pkg.version || !EXACT_SEMVER_PATTERN.test(pkg.version)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["version"], message: "exactBunRegistry requires one exact semantic version" });
  }
  if (pkg.name.includes("@", 1) || /[~^*<>|\s]/.test(pkg.name)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "package name must not contain a version, range, tag, or protocol" });
  }
  if (!pkg.bin || pkg.bin !== pkg.exactBunRegistry.probe.cli.bin) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bin"], message: "package bin must exactly match exactBunRegistry.probe.cli.bin" });
  }
  if (pkg.exactBunRegistry.probe.sdkImport !== pkg.name) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["exactBunRegistry", "probe", "sdkImport"], message: "probe.sdkImport must exactly match package name" });
  }
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
  installCommand: z.string().refine((value) => value.trim().length > 0, "installCommand must not be blank").optional(),
  probeCommand: z.string().refine((value) => value.trim().length > 0, "probeCommand must not be blank").optional(),
  expectedVersion: z.string().refine((value) => value.trim().length > 0, "expectedVersion must not be blank").optional(),
}).superRefine((app, context) => {
  const hasExactCustomContract =
    app.installCommand !== undefined
    || app.probeCommand !== undefined
    || app.expectedVersion !== undefined;
  if (!hasExactCustomContract) return;

  if (app.manager !== "custom") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "installCommand, probeCommand, and expectedVersion are only valid when manager is custom",
    });
    return;
  }
  if (!app.installCommand) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["installCommand"],
      message: "installCommand is required when a custom probe contract is declared",
    });
  }
  if (!app.probeCommand) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["probeCommand"],
      message: "probeCommand is required when a custom install contract is declared",
    });
  }
});

const fileSchema = z.object({
  source: z.string(),
  target: z.string(),
  mode: z.enum(["copy", "symlink"]).optional(),
});

export const machineSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string().trim().min(1)).optional(),
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
}).strict().superRefine((machine, context) => {
  const deliveries = (machine.packages ?? []).filter((pkg) => pkg.exactBunRegistry);
  if (deliveries.length === 0) return;
  if (machine.platform !== "linux" && machine.platform !== "macos") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["platform"], message: "exact Bun registry delivery supports linux and macos targets only" });
  }
  if (!machine.bunPath || !machine.bunPath.startsWith("/") || !machine.bunPath.endsWith("/bin/bun")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bunPath"], message: "exact Bun registry delivery requires an absolute Bun path ending in /bin/bun" });
  }
  const seenNames = new Set<string>();
  const seenOrders = new Set<number>();
  for (const [index, pkg] of deliveries.entries()) {
    if (seenNames.has(pkg.name)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["packages", index, "name"], message: `duplicate exact package ${pkg.name}` });
    }
    seenNames.add(pkg.name);
    const order = pkg.exactBunRegistry!.order;
    if (seenOrders.has(order)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["packages", index, "exactBunRegistry", "order"], message: `duplicate exact package order ${order}` });
    }
    seenOrders.add(order);
  }
});

export const fleetSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().optional(),
  packages: z.array(packageSchema).optional(),
  freeze: z.array(freezeEntrySchema).optional(),
  machines: z.array(machineSchema),
}).strict().superRefine((fleet, context) => {
  const fleetExactPackage = (fleet.packages ?? []).find((pkg) => pkg.exactBunRegistry);
  if (fleetExactPackage) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["packages"],
      message: "exactBunRegistry is target-only and must not appear in fleet-wide packages",
    });
  }
  const seenMachines = new Set<string>();
  const seenIdentities = new Map<string, { machineIndex: number; kind: "id" | "alias" }>();
  fleet.machines.forEach((machine, index) => {
    if (seenMachines.has(machine.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["machines", index, "id"], message: `duplicate machine id ${machine.id}` });
    }
    seenMachines.add(machine.id);
    const identities: Array<{ value: string; kind: "id" | "alias"; aliasIndex?: number }> = [
      { value: machine.id, kind: "id" },
      ...(machine.aliases ?? []).map((value, aliasIndex) => ({ value, kind: "alias" as const, aliasIndex })),
    ];
    for (const identity of identities) {
      const key = identity.value.trim().toLowerCase();
      const previous = seenIdentities.get(key);
      if (previous) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["machines", index, identity.kind === "id" ? "id" : "aliases", ...(identity.aliasIndex === undefined ? [] : [identity.aliasIndex])],
          message: `duplicate machine identity ${identity.value}`,
        });
      } else {
        seenIdentities.set(key, { machineIndex: index, kind: identity.kind });
      }
    }
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Move the pre-metadata heartbeat alias field into the current metadata
 * namespace while loading a manifest. Keep the schema strict for every other
 * unknown field, and leave malformed legacy values untouched so validation
 * still rejects them.
 */
function migrateLegacyManifest(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.machines)) return raw;

  let migrated = false;
  const machines = raw.machines.map((machine): unknown => {
    if (!isRecord(machine) || !Object.prototype.hasOwnProperty.call(machine, "heartbeatAliases")) {
      return machine;
    }

    const aliases = machine.heartbeatAliases;
    if (!isStringArray(aliases)) return machine;

    const metadata = machine.metadata;
    if (metadata !== undefined && !isRecord(metadata)) return machine;

    const nextMetadata: Record<string, unknown> = { ...(metadata ?? {}) };
    const currentAliases = nextMetadata.heartbeatAliases;
    if (currentAliases !== undefined && !isStringArray(currentAliases)) return machine;

    nextMetadata.heartbeatAliases = [...new Set([...(currentAliases ?? []), ...aliases])];
    const nextMachine = { ...machine };
    delete nextMachine.heartbeatAliases;
    nextMachine.metadata = nextMetadata;
    migrated = true;
    return nextMachine;
  });

  return migrated ? { ...raw, machines } : raw;
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
  return fleetSchema.parse(migrateLegacyManifest(raw));
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
            manifest: fleetSchema.parse(migrateLegacyManifest(manifest)),
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
  return findManifestMachine(readManifest(path), machineId);
}

/** Resolve canonical ids first, then the legacy aliases retained by a re-keyed machine. */
export function findManifestMachine(manifest: FleetManifest, machineId: string): MachineManifest | null {
  const direct = manifest.machines.find((machine) => machine.id === machineId);
  if (direct) return direct;
  const requested = machineId.trim().toLowerCase();
  return manifest.machines.find((machine) => (machine.aliases ?? []).some((alias) => alias.trim().toLowerCase() === requested)) ?? null;
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
