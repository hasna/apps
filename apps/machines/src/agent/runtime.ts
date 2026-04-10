import { getLocalMachineId, listHeartbeats, upsertHeartbeat } from "../db.js";

export interface AgentRuntimeStatus {
  machineId: string;
  pid: number;
  status: "online" | "offline";
  updatedAt: string;
}

export function writeHeartbeat(status: "online" | "offline" = "online"): AgentRuntimeStatus {
  const machineId = getLocalMachineId();
  upsertHeartbeat(machineId, process.pid, status);
  return {
    machineId,
    pid: process.pid,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export function markOffline(): AgentRuntimeStatus {
  return writeHeartbeat("offline");
}

export function getAgentStatus(machineId = getLocalMachineId()): AgentRuntimeStatus[] {
  return listHeartbeats(machineId).map((heartbeat) => ({
    machineId: heartbeat.machine_id,
    pid: heartbeat.pid,
    status: heartbeat.status as "online" | "offline",
    updatedAt: heartbeat.updated_at,
  }));
}
