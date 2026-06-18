import { countRuns, getLocalMachineId, latestHeartbeatByMachine, listHeartbeats } from "../db.js";
import { readManifest } from "../manifests.js";
import { getManifestPath, getDbPath, getNotificationsPath } from "../paths.js";
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

export function getStatus(): FleetStatus {
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = latestHeartbeatByMachine(heartbeats);
  const machineIds = new Set([
    ...manifest.machines.map((machine) => machine.id),
    ...heartbeats.map((heartbeat) => heartbeat.machine_id),
  ]);

  return {
    machineId: getLocalMachineId(),
    manifestPath: getManifestPath(),
    dbPath: getDbPath(),
    notificationsPath: getNotificationsPath(),
    manifestMachineCount: manifest.machines.length,
    heartbeatCount: heartbeats.length,
    machines: [...machineIds].sort().map((machineId) => {
      const declared = manifest.machines.find((machine) => machine.id === machineId);
      const heartbeat = heartbeatByMachine.get(machineId);
      return {
        machineId,
        platform: declared?.platform,
        manifestDeclared: Boolean(declared),
        heartbeatStatus: (heartbeat?.status as "online" | "offline" | undefined) || "unknown",
        lastHeartbeatAt: heartbeat?.updated_at,
        daemonVersion: heartbeat?.daemon_version ?? null,
        agentMode: heartbeat?.agent_mode ?? null,
        storageSyncStatus: heartbeat?.storage_sync_status ?? null,
        doctorSummary: parseJsonObject(heartbeat?.doctor_summary_json),
        privateMetadata: Boolean(heartbeat?.private_metadata),
      };
    }),
    recentSetupRuns: countRuns("setup_runs"),
    recentSyncRuns: countRuns("sync_runs"),
  };
}
