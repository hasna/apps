// Audit-log routes.
//
// The audit log had no hosted route at all, so `memory_audit_trail` and
// `memory_audit_export` read a per-station SQLite table: on a hosted install
// they reported "no audit entries" for memories whose whole history lives in
// the cloud store — the most misleading possible answer from a compliance
// surface.
//
// NOTE the neighbouring `GET /api/memories/audit` is a DIFFERENT thing: the
// low-trust memory review list (memories-misc.ts). These are the immutable
// `memory_audit_log` reads. The table exists in both schemas
// (migrations.ts:649, pg-migrations.ts:444) and is append-only — every route
// here is a read.

import { getMemoryAuditTrail, exportAuditLog, getAuditStats } from "../../db/audit.js";
import { addRoute } from "../router.js";
import { json, errorResponse } from "../helpers.js";

function boundedLimit(raw: string | null, fallback: number, cap: number): number | Response {
  if (raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return errorResponse(`limit must be a positive integer (got ${raw})`, 400);
  }
  return Math.min(Math.floor(parsed), cap);
}

// GET /api/memories/:id/audit-trail — one memory's immutable history
addRoute("GET", "/api/memories/:id/audit-trail", (_req, url, params) => {
  const limit = boundedLimit(url.searchParams.get("limit"), 50, 1000);
  if (limit instanceof Response) return limit;
  const entries = getMemoryAuditTrail(params["id"]!, limit);
  return json({ entries, count: entries.length });
});

// GET /api/audit/export — the compliance export, filtered
addRoute("GET", "/api/audit/export", (_req, url) => {
  const limit = boundedLimit(url.searchParams.get("limit"), 1000, 10000);
  if (limit instanceof Response) return limit;
  const entries = exportAuditLog({
    since: url.searchParams.get("since") ?? undefined,
    until: url.searchParams.get("until") ?? undefined,
    operation: url.searchParams.get("operation") ?? undefined,
    agent_id: url.searchParams.get("agent_id") ?? undefined,
    limit,
  });
  return json({ entries, count: entries.length });
});

// GET /api/audit/stats — operation counts over the whole log
addRoute("GET", "/api/audit/stats", () => json(getAuditStats()));
