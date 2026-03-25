import { getDatabase, now, type Database } from "./database.js";

export function promoteConnector(name: string, db?: Database): void {
  const d = db ?? getDatabase();
  d.run("INSERT OR REPLACE INTO connector_promotions (connector, promoted_at) VALUES (?, ?)", [name, now()]);
}

export function demoteConnector(name: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM connector_promotions WHERE connector = ?", [name]).changes > 0;
}

export function getPromotedConnectors(db?: Database): string[] {
  const d = db ?? getDatabase();
  return (d.query("SELECT connector FROM connector_promotions ORDER BY promoted_at DESC").all() as { connector: string }[]).map(r => r.connector);
}

export function isPromoted(name: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  const row = d.query("SELECT 1 FROM connector_promotions WHERE connector = ?").get(name);
  return !!row;
}
