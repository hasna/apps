import type { Database } from "bun:sqlite";
import { getDatabase, now, shortUuid } from "./database.js";

export function logUsage(connector: string, action: string, agentId?: string, db?: Database): void {
  const d = db ?? getDatabase();
  d.run("INSERT INTO connector_usage (id, connector, action, agent_id, timestamp) VALUES (?, ?, ?, ?, ?)",
    [shortUuid(), connector, action, agentId ?? null, now()]);
}

export interface UsageStats {
  connector: string;
  total: number;
  last7d: number;
  last24h: number;
}

export function getUsageStats(connector: string, db?: Database): UsageStats {
  const d = db ?? getDatabase();
  const total = (d.query("SELECT COUNT(*) as c FROM connector_usage WHERE connector = ?").get(connector) as { c: number }).c;
  const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last7d = (d.query("SELECT COUNT(*) as c FROM connector_usage WHERE connector = ? AND timestamp > ?").get(connector, d7) as { c: number }).c;
  const d1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const last24h = (d.query("SELECT COUNT(*) as c FROM connector_usage WHERE connector = ? AND timestamp > ?").get(connector, d1) as { c: number }).c;
  return { connector, total, last7d, last24h };
}

export interface TopConnector { connector: string; count: number; }

export function getTopConnectors(limit = 10, days = 7, db?: Database): TopConnector[] {
  const d = db ?? getDatabase();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return d.query(
    "SELECT connector, COUNT(*) as count FROM connector_usage WHERE timestamp > ? GROUP BY connector ORDER BY count DESC LIMIT ?"
  ).all(since, limit) as TopConnector[];
}

/** Get usage counts as a Map for search context */
export function getUsageMap(days = 7, db?: Database): Map<string, number> {
  const top = getTopConnectors(100, days, db);
  return new Map(top.map(t => [t.connector, t.count]));
}

export function cleanOldUsage(days = 30, db?: Database): number {
  const d = db ?? getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return d.run("DELETE FROM connector_usage WHERE timestamp < ?", [cutoff]).changes;
}
