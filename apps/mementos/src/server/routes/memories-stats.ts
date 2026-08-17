import { getDatabase } from "../../db/database.js";
import {
  getMemoryStats,
  getMemoryActivity,
  getMemoryReport,
  getStaleMemoriesPage,
  getMemoryHealth,
} from "../../db/analytics.js";
import { listMemoryHistoryPage, countMemoryHistory } from "../../db/memories.js";
import type { MemoryScope } from "../../types/index.js";
import { addRoute } from "../router.js";
import { json, getSearchParams } from "../helpers.js";

// GET /api/memories/stats — statistics
addRoute("GET", "/api/memories/stats", () => {
  return json(getMemoryStats(getDatabase()));
});

// GET /api/metrics — comprehensive memory health metrics
addRoute("GET", "/api/metrics", () => {
  const db = getDatabase();

  const total = (db.query("SELECT COUNT(*) as c FROM memories WHERE status = 'active'").get() as { c: number }).c;

  const byScope = db.query("SELECT scope, COUNT(*) as c FROM memories WHERE status = 'active' GROUP BY scope").all() as { scope: string; c: number }[];
  const byCategory = db.query("SELECT category, COUNT(*) as c FROM memories WHERE status = 'active' GROUP BY category").all() as { category: string; c: number }[];

  // Growth rate (last 7 days vs prior 7 days)
  const last7 = (db.query("SELECT COUNT(*) as c FROM memories WHERE created_at >= datetime('now', '-7 days')").get() as { c: number }).c;
  const prior7 = (db.query("SELECT COUNT(*) as c FROM memories WHERE created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')").get() as { c: number }).c;
  const growthRate = prior7 > 0 ? ((last7 - prior7) / prior7 * 100) : 0;

  // Stale percentage (not accessed in 30 days)
  const staleCount = (db.query("SELECT COUNT(*) as c FROM memories WHERE status = 'active' AND pinned = 0 AND (accessed_at IS NULL OR accessed_at < datetime('now', '-30 days'))").get() as { c: number }).c;
  const stalePercentage = total > 0 ? (staleCount / total * 100) : 0;

  // Top accessed memories
  const topAccessed = db.query("SELECT id, key, access_count, importance FROM memories WHERE status = 'active' ORDER BY access_count DESC LIMIT 10").all() as { id: string; key: string; access_count: number; importance: number }[];

  return json({
    total_memories: total,
    by_scope: Object.fromEntries(byScope.map(r => [r.scope, r.c])),
    by_category: Object.fromEntries(byCategory.map(r => [r.category, r.c])),
    growth_rate_7d: Math.round(growthRate * 10) / 10,
    new_last_7d: last7,
    stale_percentage: Math.round(stalePercentage * 10) / 10,
    stale_count: staleCount,
    top_accessed: topAccessed,
  });
});

// GET /api/activity — daily memory activity over N days
addRoute("GET", "/api/activity", (_req: Request, url: URL) => {
  const q = getSearchParams(url);
  return json(getMemoryActivity({
    days: q["days"] ? parseInt(q["days"], 10) : undefined,
    scope: q["scope"] as MemoryScope | undefined,
    agent_id: q["agent_id"],
    project_id: q["project_id"],
  }, getDatabase()));
});

// GET /api/memories/stale — memories not accessed recently
// Bounded page contract (BUG 2796806b): the previous silent hard cap of 100
// rows made `count` mirror the page length with no signal. A page now carries
// the TRUE total plus has_more / next_cursor; single responses are capped at
// 1000 so no proxy can truncate a huge body mid-JSON.
addRoute("GET", "/api/memories/stale", (_req: Request, url: URL) => {
  const q = getSearchParams(url);
  const days = q["days"] ? parseInt(q["days"], 10) : undefined;
  const parsedLimit = Number(q["limit"]);
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 1000)
      : 20;
  const parsedOffset = Number(q["offset"]);
  const offset =
    Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const page = getStaleMemoriesPage({
    days,
    project_id: q["project_id"],
    agent_id: q["agent_id"],
    limit,
    offset,
  }, getDatabase());
  return json({
    memories: page.rows,
    count: page.rows.length,
    total: page.total,
    days: Math.min(days || 30, 365),
    limit,
    has_more: page.has_more,
    next_cursor: page.next_cursor,
  });
});

// GET /api/memories/history — memories by most recently accessed
// Same bounded page contract as the list and stale surfaces.
addRoute("GET", "/api/memories/history", (_req: Request, url: URL) => {
  const q = getSearchParams(url);
  const parsedLimit = Number(q["limit"]);
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 20;
  const parsedOffset = Number(q["offset"]);
  const offset =
    Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const page = listMemoryHistoryPage({ limit, offset }, getDatabase());
  const total = countMemoryHistory(getDatabase());
  return json({
    memories: page.rows,
    count: page.rows.length,
    total,
    limit,
    has_more: page.has_more,
    next_cursor: page.next_cursor,
  });
});

// GET /api/memories/health — stale / forgotten / possibly-superseded report
addRoute("GET", "/api/memories/health", (_req: Request, url: URL) => {
  const q = getSearchParams(url);
  return json(getMemoryHealth({
    stale_days: q["stale_days"] ? parseInt(q["stale_days"], 10) : undefined,
    forgotten_days: q["forgotten_days"] ? parseInt(q["forgotten_days"], 10) : undefined,
    project_id: q["project_id"],
    agent_id: q["agent_id"],
    limit: q["limit"] ? parseInt(q["limit"], 10) : undefined,
  }, getDatabase()));
});

// GET /api/report — rich activity summary
addRoute("GET", "/api/report", (_req: Request, url: URL) => {
  const q = getSearchParams(url);
  return json(getMemoryReport({
    days: q["days"] ? parseInt(q["days"], 10) : undefined,
    project_id: q["project_id"],
    agent_id: q["agent_id"],
  }, getDatabase()));
});
