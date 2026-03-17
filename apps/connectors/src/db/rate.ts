/**
 * Agent-aware rate budget splitting for connector operations.
 *
 * When multiple agents share a connector, the connector's rate limit is split
 * evenly among active agents (last heartbeat < 30min). Each agent gets:
 *   budget = Math.floor(connectorRateLimit / activeAgentCount)
 *
 * Rate usage is tracked per-agent-per-connector in the DB:
 *   connector_rate_usage(agent_id, connector, window_start, call_count)
 *
 * The window resets every WINDOW_SECONDS (default: 60s = per-minute rate).
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "./database.js";

/** How long an agent is considered active (ms) — matches agent heartbeat window */
const AGENT_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

/** Default rate window in seconds */
const WINDOW_SECONDS = 60;

export interface RateBudget {
  connector: string;
  agent_id: string;
  limit: number;        // Total connector rate limit (calls/window)
  active_agents: number; // How many agents are active on this connector
  budget: number;       // This agent's share: floor(limit / active_agents)
  used: number;         // Calls used in current window
  remaining: number;    // budget - used
  window_start: string; // ISO timestamp of current window start
  window_resets_in_ms: number; // ms until window resets
}

export interface RateExceededError {
  exceeded: true;
  connector: string;
  agent_id: string;
  budget: number;
  used: number;
  active_agents: number;
  window_resets_in_ms: number;
  message: string;
}

export function isRateExceeded(result: RateBudget | RateExceededError): result is RateExceededError {
  return (result as RateExceededError).exceeded === true;
}

/**
 * Ensure the rate_usage table exists (idempotent).
 */
export function ensureRateTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_rate_usage (
      agent_id TEXT NOT NULL,
      connector TEXT NOT NULL,
      window_start TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, connector, window_start)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rate_usage_window ON connector_rate_usage(connector, window_start)`);
}

/**
 * Count active agents in the DB (heartbeat within 30min).
 * If no agents registered, returns 1 (solo mode, full budget).
 */
function countActiveAgents(db: Database): number {
  const cutoff = new Date(Date.now() - AGENT_ACTIVE_WINDOW_MS).toISOString();
  const row = db.query("SELECT COUNT(*) as count FROM agents WHERE last_seen_at > ?").get(cutoff) as { count: number } | null;
  return Math.max(1, row?.count ?? 1);
}

/**
 * Get the current window start (truncated to WINDOW_SECONDS).
 */
function currentWindowStart(): string {
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs).toISOString();
}

/**
 * Check and optionally consume one rate budget unit for an agent+connector.
 *
 * @param agentId - Agent ID (from agents table)
 * @param connector - Connector name (e.g. "stripe")
 * @param connectorLimit - The connector's documented rate limit (calls/min)
 * @param consume - If true, increment the call counter. If false, just peek.
 * @param db - Optional DB instance (defaults to singleton)
 */
export function checkRateBudget(
  agentId: string,
  connector: string,
  connectorLimit: number,
  consume = true,
  db?: Database
): RateBudget | RateExceededError {
  const d = db ?? getDatabase();
  ensureRateTable(d);

  const activeAgents = countActiveAgents(d);
  const budget = Math.max(1, Math.floor(connectorLimit / activeAgents));
  const windowStart = currentWindowStart();
  const windowMs = WINDOW_SECONDS * 1000;
  const windowEnd = new Date(Math.floor(Date.now() / windowMs) * windowMs + windowMs);
  const windowResetsIn = windowEnd.getTime() - Date.now();

  // Get current usage
  const row = d.query(
    "SELECT call_count FROM connector_rate_usage WHERE agent_id = ? AND connector = ? AND window_start = ?"
  ).get(agentId, connector, windowStart) as { call_count: number } | null;

  const used = row?.call_count ?? 0;

  if (used >= budget) {
    return {
      exceeded: true,
      connector,
      agent_id: agentId,
      budget,
      used,
      active_agents: activeAgents,
      window_resets_in_ms: windowResetsIn,
      message: `Rate budget exceeded for "${connector}" (${used}/${budget} calls used, ${activeAgents} active agent${activeAgents === 1 ? "" : "s"} sharing limit of ${connectorLimit}/min). Resets in ${Math.ceil(windowResetsIn / 1000)}s.`,
    };
  }

  if (consume) {
    d.run(
      `INSERT INTO connector_rate_usage (agent_id, connector, window_start, call_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(agent_id, connector, window_start) DO UPDATE SET call_count = call_count + 1`,
      [agentId, connector, windowStart]
    );
  }

  return {
    connector,
    agent_id: agentId,
    limit: connectorLimit,
    active_agents: activeAgents,
    budget,
    used: consume ? used + 1 : used,
    remaining: consume ? budget - used - 1 : budget - used,
    window_start: windowStart,
    window_resets_in_ms: windowResetsIn,
  };
}

/**
 * Get rate budget status without consuming a unit.
 */
export function getRateBudget(
  agentId: string,
  connector: string,
  connectorLimit: number,
  db?: Database
): RateBudget | RateExceededError {
  return checkRateBudget(agentId, connector, connectorLimit, false, db);
}

/**
 * Clean up old rate windows (older than 2 windows).
 */
export function cleanExpiredRateWindows(db?: Database): number {
  const d = db ?? getDatabase();
  ensureRateTable(d);
  const cutoff = new Date(Date.now() - WINDOW_SECONDS * 2 * 1000).toISOString();
  return d.run("DELETE FROM connector_rate_usage WHERE window_start < ?", [cutoff]).changes;
}
