import { countRuns, getLocalMachineId, latestHeartbeatByMachine, listHeartbeats } from "../db.js";
import { readManifest } from "../manifests.js";
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

export function getStatus(options: FleetStatusOptions = {}): FleetStatus {
  const privateMetadata = options.privateMetadata === true;
  const now = options.now ?? new Date();
  const heartbeatTtlMs = options.heartbeatTtlMs === undefined ? DEFAULT_HEARTBEAT_ONLINE_TTL_MS : options.heartbeatTtlMs;
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = latestHeartbeatByMachine(heartbeats);
  const machineIds = new Set([
    ...manifest.machines.map((machine) => machine.id),
    ...heartbeats.map((heartbeat) => heartbeat.machine_id),
  ]);

  return {
    machineId: privateMetadata ? getLocalMachineId() : REDACTED_VALUE,
    manifestPath: privateMetadata ? getManifestPath() : REDACTED_VALUE,
    dbPath: privateMetadata ? getDbPath() : REDACTED_VALUE,
    notificationsPath: privateMetadata ? getNotificationsPath() : REDACTED_VALUE,
    manifestMachineCount: manifest.machines.length,
    heartbeatCount: heartbeats.length,
    machines: [...machineIds].sort().map((machineId) => {
      const declared = manifest.machines.find((machine) => machine.id === machineId);
      const heartbeat = heartbeatByMachine.get(machineId);
      return {
        machineId: privateMetadata ? machineId : REDACTED_VALUE,
        platform: declared?.platform,
        manifestDeclared: Boolean(declared),
        heartbeatStatus: heartbeatStatus(heartbeat, now, heartbeatTtlMs),
        lastHeartbeatAt: heartbeat?.updated_at,
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
