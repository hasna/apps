import type { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { SqliteAdapter } from "@hasna/cloud";
import { ensureParentDir, getDbPath } from "./paths.js";

let adapter: SqliteAdapter | null = null;

function createTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_heartbeats (
      machine_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (machine_id, pid)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_runs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      actions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

export function getAdapter(path = getDbPath()): SqliteAdapter {
  if (path === ":memory:") {
    const memoryAdapter = new SqliteAdapter(path);
    createTables(memoryAdapter.raw);
    return memoryAdapter;
  }

  if (!adapter) {
    ensureParentDir(path);
    adapter = new SqliteAdapter(path);
    createTables(adapter.raw);
  }

  return adapter;
}

export function getDb(path = getDbPath()): Database {
  return getAdapter(path).raw;
}

export function upsertHeartbeat(machineId: string, pid = process.pid, status: "online" | "offline" = "online"): void {
  const db = getDb();
  db.query(
    `INSERT INTO agent_heartbeats (machine_id, pid, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(machine_id, pid) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(machineId, pid, status, new Date().toISOString());
}

export function getLocalMachineId(): string {
  return process.env["HASNA_MACHINES_MACHINE_ID"] || hostname();
}

export interface StoredHeartbeat {
  machine_id: string;
  pid: number;
  status: string;
  updated_at: string;
}

export function listHeartbeats(machineId?: string): StoredHeartbeat[] {
  const db = getDb();
  if (machineId) {
    return db
      .query(
        `SELECT machine_id, pid, status, updated_at
         FROM agent_heartbeats
         WHERE machine_id = ?
         ORDER BY updated_at DESC`
      )
      .all(machineId) as StoredHeartbeat[];
  }

  return db
    .query(
      `SELECT machine_id, pid, status, updated_at
       FROM agent_heartbeats
       ORDER BY updated_at DESC`
    )
    .all() as StoredHeartbeat[];
}

export function countRuns(table: "setup_runs" | "sync_runs"): number {
  const db = getDb();
  const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  return row.count;
}

export function setHeartbeatStatus(machineId: string, pid: number, status: "online" | "offline"): void {
  const db = getDb();
  db.query(
    `UPDATE agent_heartbeats
     SET status = ?, updated_at = ?
     WHERE machine_id = ? AND pid = ?`
  ).run(status, new Date().toISOString(), machineId, pid);
}

export function recordSetupRun(machineId: string, status: string, details: unknown): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO setup_runs (id, machine_id, status, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), machineId, status, JSON.stringify(details), now, now);
}

export function recordSyncRun(machineId: string, status: string, actions: unknown): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO sync_runs (id, machine_id, status, actions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), machineId, status, JSON.stringify(actions), now, now);
}
