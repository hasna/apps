import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import { getMachineId } from "./machines.js";

export type StorageTombstoneObjectType =
  | "tasks"
  | "projects"
  | "project_machine_paths"
  | "plans"
  | "agents"
  | "task_lists"
  | "templates"
  | "audit_history";

export interface StorageTombstone {
  id: string;
  object_type: StorageTombstoneObjectType;
  object_id: string;
  deleted_at: string;
  updated_at: string;
  source_machine_id: string | null;
  payload: Record<string, unknown> | null;
  version: number | null;
}

export interface RecordStorageTombstoneInput {
  object_type: StorageTombstoneObjectType;
  object_id: string;
  deleted_at?: string;
  source_machine_id?: string | null;
  payload?: Record<string, unknown> | null;
  version?: number | null;
}

export function recordStorageTombstone(input: RecordStorageTombstoneInput, db?: Database): StorageTombstone {
  const d = getDatabase(db);
  const deletedAt = input.deleted_at ?? now();
  const machineId = input.source_machine_id ?? currentStorageMachineId(d);
  d.run(
    `INSERT INTO storage_tombstones (
       id, object_type, object_id, deleted_at, updated_at, source_machine_id, payload, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(object_type, object_id) DO UPDATE SET
       deleted_at = excluded.deleted_at,
       updated_at = excluded.updated_at,
       source_machine_id = excluded.source_machine_id,
       payload = excluded.payload,
       version = excluded.version
     WHERE storage_tombstones.updated_at IS NULL OR storage_tombstones.updated_at <= excluded.updated_at`,
    [
      uuid(),
      input.object_type,
      input.object_id,
      deletedAt,
      deletedAt,
      machineId,
      input.payload ? JSON.stringify(input.payload) : null,
      input.version ?? null,
    ],
  );
  return getStorageTombstone(input.object_type, input.object_id, d)!;
}

export function getStorageTombstone(
  objectType: StorageTombstoneObjectType,
  objectId: string,
  db?: Database,
): StorageTombstone | null {
  const d = getDatabase(db);
  const row = d
    .query("SELECT * FROM storage_tombstones WHERE object_type = ? AND object_id = ?")
    .get(objectType, objectId) as StorageTombstoneRow | null;
  return row ? rowToStorageTombstone(row) : null;
}

export function listStorageTombstones(db?: Database): StorageTombstone[] {
  const d = getDatabase(db);
  return (d
    .query("SELECT * FROM storage_tombstones ORDER BY updated_at ASC, object_type ASC, object_id ASC")
    .all() as StorageTombstoneRow[]).map(rowToStorageTombstone);
}

export function shouldApplyStorageTombstone(
  tombstone: Pick<StorageTombstone, "updated_at" | "deleted_at">,
  existingUpdatedAt?: string | null,
): boolean {
  const tombstoneClock = Date.parse(tombstone.updated_at || tombstone.deleted_at);
  if (!existingUpdatedAt) return true;
  const existingClock = Date.parse(existingUpdatedAt);
  if (Number.isNaN(tombstoneClock)) return true;
  if (Number.isNaN(existingClock)) return true;
  return tombstoneClock >= existingClock;
}

interface StorageTombstoneRow {
  id: string;
  object_type: StorageTombstoneObjectType;
  object_id: string;
  deleted_at: string;
  updated_at: string;
  source_machine_id: string | null;
  payload: string | null;
  version: number | null;
}

function rowToStorageTombstone(row: StorageTombstoneRow): StorageTombstone {
  return {
    ...row,
    payload: parsePayload(row.payload),
  };
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function currentStorageMachineId(db: Database): string | null {
  try {
    return getMachineId(db);
  } catch {
    return null;
  }
}
