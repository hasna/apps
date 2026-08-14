import type { Database } from "bun:sqlite";
import type { ConfigSnapshot } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createSnapshot(
  configId: string,
  content: string,
  version: number,
  db?: Database
): ConfigSnapshot {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  d.run(
    "INSERT INTO config_snapshots (id, config_id, content, version, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, configId, content, version, ts]
  );
  return { id, config_id: configId, content, version, created_at: ts };
}

export function listSnapshots(configId: string, db?: Database): ConfigSnapshot[] {
  const d = db || getDatabase();
  return d
    .query<ConfigSnapshot, [string]>(
      "SELECT * FROM config_snapshots WHERE config_id = ? ORDER BY version DESC"
    )
    .all(configId);
}

export function getSnapshot(id: string, db?: Database): ConfigSnapshot | null {
  const d = db || getDatabase();
  return d
    .query<ConfigSnapshot, [string]>(
      "SELECT * FROM config_snapshots WHERE id = ?"
    )
    .get(id);
}

export function getSnapshotByVersion(
  configId: string,
  version: number,
  db?: Database
): ConfigSnapshot | null {
  const d = db || getDatabase();
  return d
    .query<ConfigSnapshot, [string, number]>(
      "SELECT * FROM config_snapshots WHERE config_id = ? AND version = ?"
    )
    .get(configId, version);
}

export function pruneSnapshots(
  configId: string,
  keep = 10,
  db?: Database
): number {
  const d = db || getDatabase();
  const result = d.run(
    `DELETE FROM config_snapshots WHERE config_id = ? AND id NOT IN (
      SELECT id FROM config_snapshots WHERE config_id = ? ORDER BY version DESC LIMIT ?
    )`,
    [configId, configId, keep]
  );
  return result.changes;
}
