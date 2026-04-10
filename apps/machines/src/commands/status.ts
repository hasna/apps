import { countRuns, getLocalMachineId, listHeartbeats } from "../db.js";
import { readManifest } from "../manifests.js";
import { getManifestPath, getDbPath, getNotificationsPath } from "../paths.js";
import type { FleetStatus } from "../types.js";

export function getStatus(): FleetStatus {
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = new Map(heartbeats.map((heartbeat) => [heartbeat.machine_id, heartbeat]));
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
      };
    }),
    recentSetupRuns: countRuns("setup_runs"),
    recentSyncRuns: countRuns("sync_runs"),
  };
}
