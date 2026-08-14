import { getLocalMachineId, upsertHeartbeatSnapshot, type HeartbeatSnapshot } from "../db.js";
import { readManifest } from "../manifests.js";
import { redactErrorMessage } from "../redaction.js";
import { runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { MachineManifest } from "../types.js";
import {
  assertSdkMutationApproved,
  MUTATION_APPROVAL_FLAG_ENV,
  type SdkMutationApprovalOptions,
} from "./mutation-approval.js";

export interface HeartbeatCollectOptions extends SdkMutationApprovalOptions {
  machines?: string[];
  timeoutMs?: number;
  doctorSummary?: boolean;
}

export interface HeartbeatCollectResult {
  machineId: string;
  status: "imported" | "failed";
  source: "local" | "lan" | "tailscale" | "ssh" | null;
  updatedAt: string | null;
  daemonVersion: string | null;
  storageSyncStatus: string | null;
  error: string | null;
}

export const HEARTBEAT_COLLECT_MUTATION_OPERATION = "machines_heartbeat_collect";
export const HEARTBEAT_COLLECTOR_LOOP_NAME = "machine-openmachines-heartbeat-collector";
export const DEFAULT_HEARTBEAT_COLLECTOR_TIMEOUT_MS = 90_000;

export interface HeartbeatCollectorCommandOptions {
  machines?: string[];
  timeoutMs?: number;
  machinesCommand?: string;
}

export interface HeartbeatCollectorCommandPlan {
  kind: "heartbeat_collector_command";
  loopName: string;
  command: string;
  machines: string[];
  timeoutMs: number;
  trustedLocalMutationEnv: string;
  warnings: string[];
}

export function heartbeatCollectMutationArgs(options: Pick<HeartbeatCollectOptions, "machines" | "timeoutMs" | "doctorSummary"> = {}): Record<string, unknown> {
  return {
    machines: options.machines?.map((machine) => machine.trim()).filter(Boolean) ?? [],
    timeout_ms: options.timeoutMs ?? null,
    doctor_summary: options.doctorSummary !== false,
  };
}

export function heartbeatCollectResourceId(options: Pick<HeartbeatCollectOptions, "machines"> = {}): string {
  const machines = options.machines?.map((machine) => machine.trim()).filter(Boolean) ?? [];
  return `heartbeat:collect:${machines.length > 0 ? machines.join(",") : "all"}`;
}

function defaultMachineIds(): string[] {
  const ids = new Set<string>([getLocalMachineId()]);
  for (const machine of readManifest().machines) ids.add(machine.id);
  return [...ids].sort();
}

function uniqueSortedMachineIds(machineIds: string[]): string[] {
  return [...new Set(machineIds.map((machine) => machine.trim()).filter(Boolean))].sort();
}

function defaultHeartbeatCollectorMachineIds(): string[] {
  return uniqueSortedMachineIds([getLocalMachineId()]);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildHeartbeatCollectorCommand(options: HeartbeatCollectorCommandOptions = {}): HeartbeatCollectorCommandPlan {
  const explicitMachineIds = options.machines ? uniqueSortedMachineIds(options.machines) : [];
  const machines = explicitMachineIds.length > 0 ? explicitMachineIds : defaultHeartbeatCollectorMachineIds();
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_COLLECTOR_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("heartbeat collector timeoutMs must be a positive finite number");
  }
  const machinesCommand = options.machinesCommand?.trim() || "machines";
  // Do not bake in --fail-on-error: `collect` always exits non-zero on any
  // failed import, so the flag is a deprecated no-op retained only for
  // backwards compatibility. Emitting it here would propagate a deprecated flag
  // into the trusted, blessed OpenLoops automation command.
  const collectArgs = [
    "heartbeat",
    "collect",
    ...machines.flatMap((machine) => ["--machine", machine]),
    "--timeout-ms",
    String(Math.floor(timeoutMs)),
    "--json",
  ];
  const collectCommand = [machinesCommand, ...collectArgs].map(shellArg).join(" ");
  const warnings: string[] = [];
  if (explicitMachineIds.length === 0) warnings.push("heartbeat_collector_defaulted_to_local_machine_only");
  if (machines.length > 2) warnings.push("heartbeat_collector_many_machines_may_exceed_freshness_ttl");

  return {
    kind: "heartbeat_collector_command",
    loopName: HEARTBEAT_COLLECTOR_LOOP_NAME,
    command: `${MUTATION_APPROVAL_FLAG_ENV}=1 ${collectCommand}`,
    machines,
    timeoutMs: Math.floor(timeoutMs),
    trustedLocalMutationEnv: `${MUTATION_APPROVAL_FLAG_ENV}=1`,
    warnings,
  };
}

function metadataStrings(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

function expectedIdentities(machineId: string, manifest?: MachineManifest): Set<string> {
  const identities = new Set<string>([machineId]);
  for (const value of metadataStrings(manifest?.metadata, "heartbeatAliases")) {
    if (!value) continue;
    identities.add(value.replace(/\.$/, ""));
  }
  return identities;
}

function canonicalCollectionMachineId(
  requestedMachineId: string,
  manifestById: Map<string, MachineManifest>,
  localMachineId: string,
): string | null {
  const requested = requestedMachineId.trim();
  if (!requested) return null;
  if (requested === "local" || requested === "localhost" || requested === localMachineId) return localMachineId;
  if (manifestById.has(requested)) return requested;
  return null;
}

function heartbeatCommand(machineId: string, doctorSummary: boolean): string {
  const doctorArgs = doctorSummary
    ? `if machines-agent --help 2>&1 | grep -q -- '--doctor-summary'; then doctor='--doctor-summary'; else doctor=''; fi`
    : "doctor=''";
  return [
    `PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"`,
    "unset HASNA_MACHINES_MACHINE_ID MACHINES_MACHINE_ID HASNA_MACHINES_PRIVATE_METADATA MACHINES_PRIVATE_METADATA",
    "export PATH",
    "if ! command -v machines-agent >/dev/null 2>&1; then printf 'machines-agent not found\\n' >&2; exit 127; fi",
    doctorArgs,
    'machines-agent --once $doctor --json',
  ].join("; ");
}

function lastJsonLine(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.startsWith("{") && line.endsWith("}")) return line;
  }
  return null;
}

function parseHeartbeatSnapshot(
  machineId: string,
  stdout: string,
  expectedIds: Set<string>,
  observedAt = new Date().toISOString(),
): HeartbeatSnapshot {
  const line = lastJsonLine(stdout);
  if (!line) throw new Error("machines-agent did not emit a JSON heartbeat");
  const parsed = JSON.parse(line) as Partial<HeartbeatSnapshot> & {
    machineId?: string;
    updatedAt?: string;
    daemonVersion?: string | null;
    agentMode?: string | null;
    osVersion?: string | null;
    osBuild?: string | null;
    uptimeSeconds?: number | null;
    toolVersions?: Record<string, unknown> | null;
    storageSyncStatus?: string | null;
    storageSyncLastError?: string | null;
    doctorSummary?: Record<string, unknown> | null;
    privateMetadata?: boolean;
  };

  if (!parsed.machineId || !expectedIds.has(parsed.machineId)) {
    throw new Error(`heartbeat machine mismatch: expected ${machineId}, got ${parsed.machineId ?? "unknown"}`);
  }
  if (parsed.status !== "online" && parsed.status !== "offline") {
    throw new Error(`invalid heartbeat status for ${machineId}: ${String(parsed.status)}`);
  }
  const pid = parsed.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid)) throw new Error(`invalid heartbeat pid for ${machineId}`);
  if (!parsed.updatedAt || Number.isNaN(Date.parse(parsed.updatedAt))) {
    throw new Error(`invalid heartbeat timestamp for ${machineId}`);
  }
  if (parsed.privateMetadata === true) {
    throw new Error(`private heartbeat metadata refused for ${machineId}`);
  }

  return {
    machineId,
    pid,
    status: parsed.status,
    updatedAt: observedAt,
    daemonVersion: parsed.daemonVersion ?? null,
    agentMode: parsed.agentMode ?? null,
    platform: parsed.platform ?? null,
    osVersion: parsed.osVersion ?? null,
    osBuild: parsed.osBuild ?? null,
    arch: parsed.arch ?? null,
    uptimeSeconds: parsed.uptimeSeconds ?? null,
    toolVersions: parsed.toolVersions ?? null,
    tailscale: parsed.tailscale ?? null,
    storageSyncStatus: parsed.storageSyncStatus ?? null,
    storageSyncLastError: parsed.storageSyncLastError ?? null,
    doctorSummary: parsed.doctorSummary ?? null,
    privateMetadata: false,
    observedAt,
  };
}

function failureError(message: string): string {
  const redacted = redactErrorMessage(message).trim();
  return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
}

export function collectHeartbeats(
  options: HeartbeatCollectOptions = {},
  runner: MachineCommandRunner = runMachineCommand,
): HeartbeatCollectResult[] {
  assertSdkMutationApproved({
    operation: HEARTBEAT_COLLECT_MUTATION_OPERATION,
    resourceId: heartbeatCollectResourceId(options),
    args: heartbeatCollectMutationArgs(options),
  }, options);

  const manifest = readManifest();
  const manifestById = new Map(manifest.machines.map((machine) => [machine.id, machine]));
  const localMachineId = getLocalMachineId();
  const requestedMachineIds = options.machines && options.machines.length > 0 ? options.machines : defaultMachineIds();
  return requestedMachineIds.map((requestedMachineId) => {
    const machineId = canonicalCollectionMachineId(requestedMachineId, manifestById, localMachineId);
    if (!machineId) {
      return {
        machineId: requestedMachineId,
        status: "failed",
        source: null,
        updatedAt: null,
        daemonVersion: null,
        storageSyncStatus: null,
        error: "heartbeat collection requires a canonical manifest machine id",
      };
    }

    let result: ReturnType<MachineCommandRunner>;
    try {
      result = runner(machineId, heartbeatCommand(machineId, options.doctorSummary !== false), {
        timeoutMs: options.timeoutMs ?? 45_000,
        killGraceMs: 2_000,
      });
    } catch (error) {
      return {
        machineId,
        status: "failed",
        source: null,
        updatedAt: null,
        daemonVersion: null,
        storageSyncStatus: null,
        error: failureError(error instanceof Error ? error.message : String(error)),
      };
    }
    if (result.exitCode !== 0) {
      return {
        machineId,
        status: "failed",
        source: result.source,
        updatedAt: null,
        daemonVersion: null,
        storageSyncStatus: null,
        error: failureError(result.stderr || result.stdout || `command exited ${result.exitCode}`),
      };
    }

    try {
      const heartbeat = parseHeartbeatSnapshot(machineId, result.stdout, expectedIdentities(machineId, manifestById.get(machineId)));
      upsertHeartbeatSnapshot(heartbeat);
      return {
        machineId,
        status: "imported",
        source: result.source,
        updatedAt: heartbeat.updatedAt,
        daemonVersion: heartbeat.daemonVersion ?? null,
        storageSyncStatus: heartbeat.storageSyncStatus ?? null,
        error: null,
      };
    } catch (error) {
      return {
        machineId,
        status: "failed",
        source: result.source,
        updatedAt: null,
        daemonVersion: null,
        storageSyncStatus: null,
        error: failureError(error instanceof Error ? error.message : String(error)),
      };
    }
  });
}
