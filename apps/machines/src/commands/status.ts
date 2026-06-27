import { countRuns, getLocalMachineId, latestHeartbeatByMachine, listHeartbeats } from "../db.js";
import { machineDisplayName, normalizeFriendlyName, readManifest } from "../manifests.js";
import { getManifestPath, getDbPath, getNotificationsPath } from "../paths.js";
import { REDACTED_VALUE } from "../redaction.js";
import { DEFAULT_HEARTBEAT_ONLINE_TTL_MS } from "../topology.js";
import type { FleetStatus } from "../types.js";

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export interface FleetStatusOptions {
  privateMetadata?: boolean;
  now?: Date;
  heartbeatTtlMs?: number | null;
}

function heartbeatStatus(
  heartbeat: ReturnType<typeof listHeartbeats>[number] | undefined,
  now: Date,
  ttlMs: number | null,
): "online" | "offline" | "unknown" {
  if (!heartbeat) return "unknown";
  const status = heartbeat?.status === "online" || heartbeat?.status === "offline" ? heartbeat.status : undefined;
  if (!status) return "unknown";
  if (status !== "online" || ttlMs === null) return status;
  const freshnessAt = heartbeat.observed_at ?? heartbeat.updated_at;
  const observedAt = freshnessAt ? Date.parse(freshnessAt) : NaN;
  if (!Number.isFinite(observedAt)) return "unknown";
  return now.getTime() - observedAt > ttlMs ? "offline" : "online";
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function latestTimestamp(left: string | null | undefined, right: string | null | undefined): string | null {
  const leftMs = timestampMs(left);
  const rightMs = timestampMs(right);
  if (leftMs === null && rightMs === null) return null;
  if (leftMs === null) return right ?? null;
  if (rightMs === null) return left ?? null;
  return leftMs >= rightMs ? left ?? null : right ?? null;
}

export function getStatus(options: FleetStatusOptions = {}): FleetStatus {
  const privateMetadata = options.privateMetadata === true;
  const now = options.now ?? new Date();
  const heartbeatTtlMs = options.heartbeatTtlMs === undefined ? DEFAULT_HEARTBEAT_ONLINE_TTL_MS : options.heartbeatTtlMs;
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = latestHeartbeatByMachine(heartbeats);
  const manifestByMachine = new Map(manifest.machines.map((machine) => [machine.id, machine]));
  const machineIds = new Set([
    ...manifest.machines.map((machine) => machine.id),
    ...heartbeats.map((heartbeat) => heartbeat.machine_id),
  ]);
  const rows = [...machineIds].map((machineId) => {
    const declared = manifestByMachine.get(machineId);
    const heartbeat = heartbeatByMachine.get(machineId);
    const friendlyName = normalizeFriendlyName(declared?.friendlyName);
    const displayName = declared ? machineDisplayName(declared) : machineId;
    const updatedAt = latestTimestamp(declared?.updatedAt, heartbeat?.updated_at);
    return {
      machineId,
      friendlyName,
      displayName,
      updatedAt,
      declared,
      heartbeat,
    };
  }).sort((left, right) => {
    const leftMs = timestampMs(left.updatedAt);
    const rightMs = timestampMs(right.updatedAt);
    if (leftMs !== null || rightMs !== null) {
      if (leftMs === null) return 1;
      if (rightMs === null) return -1;
      if (leftMs !== rightMs) return rightMs - leftMs;
    }
    return left.machineId.localeCompare(right.machineId);
  });

  return {
    machineId: privateMetadata ? getLocalMachineId() : REDACTED_VALUE,
    manifestPath: privateMetadata ? getManifestPath() : REDACTED_VALUE,
    dbPath: privateMetadata ? getDbPath() : REDACTED_VALUE,
    notificationsPath: privateMetadata ? getNotificationsPath() : REDACTED_VALUE,
    manifestMachineCount: manifest.machines.length,
    heartbeatCount: heartbeats.length,
    machines: rows.map((row) => {
      const { machineId, friendlyName, displayName, updatedAt, declared, heartbeat } = row;
      return {
        machineId: privateMetadata ? machineId : REDACTED_VALUE,
        friendlyName,
        displayName: privateMetadata ? displayName : friendlyName ?? REDACTED_VALUE,
        platform: declared?.platform,
        manifestDeclared: Boolean(declared),
        heartbeatStatus: heartbeatStatus(heartbeat, now, heartbeatTtlMs),
        lastHeartbeatAt: heartbeat?.updated_at,
        updatedAt,
        daemonVersion: heartbeat?.daemon_version ?? null,
        agentMode: heartbeat?.agent_mode ?? null,
        storageSyncStatus: heartbeat?.storage_sync_status ?? null,
        doctorSummary: privateMetadata ? parseJsonObject(heartbeat?.doctor_summary_json) : null,
        privateMetadata: Boolean(heartbeat?.private_metadata),
      };
    }),
    recentSetupRuns: countRuns("setup_runs"),
    recentSyncRuns: countRuns("sync_runs"),
  };
}
