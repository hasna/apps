import type { Database } from "bun:sqlite";
import type { Machine } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { hostname, type } from "node:os";

export function currentHostname(): string {
  return hostname();
}

export function currentOs(): string {
  return type();
}

export function registerMachine(
  hostnameStr?: string,
  os?: string,
  db?: Database
): Machine {
  const d = db || getDatabase();
  const h = hostnameStr ?? currentHostname();
  const o = os ?? currentOs();
  const existing = d
    .query<Machine, [string]>("SELECT * FROM machines WHERE hostname = ?")
    .get(h);
  if (existing) return existing;
  const id = uuid();
  const ts = now();
  d.run(
    "INSERT INTO machines (id, hostname, os, last_applied_at, created_at) VALUES (?, ?, ?, NULL, ?)",
    [id, h, o, ts]
  );
  return d.query<Machine, [string]>("SELECT * FROM machines WHERE id = ?").get(id)!;
}

export function updateMachineApplied(hostnameStr?: string, db?: Database): void {
  const d = db || getDatabase();
  const h = hostnameStr ?? currentHostname();
  d.run("UPDATE machines SET last_applied_at = ? WHERE hostname = ?", [now(), h]);
}

export function listMachines(db?: Database): Machine[] {
  const d = db || getDatabase();
  return d
    .query<Machine, []>("SELECT * FROM machines ORDER BY last_applied_at DESC NULLS LAST")
    .all();
}
