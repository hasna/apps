import { randomBytes } from "crypto";
import { getDb } from "./database.js";
import type { UsageEvent, UsageEventType, UsageSummary } from "../types/index.js";

// ─── Credit costs ─────────────────────────────────────────────────────────────

const CREDIT_COSTS: Record<UsageEventType, number> = {
  crawl_page: 1,
  map_url: 1,
  search_result: 1,
  ai_extraction: 4,
  screenshot: 1,
};

// ─── Row type ─────────────────────────────────────────────────────────────────

interface UsageEventRow {
  id: string;
  api_key_id: string | null;
  event_type: string;
  credits: number;
  crawl_id: string | null;
  page_id: string | null;
  metadata: string;
  created_at: string;
}

function rowToEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    eventType: row.event_type as UsageEventType,
    credits: row.credits,
    crawlId: row.crawl_id,
    pageId: row.page_id,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function recordUsage(input: {
  eventType: UsageEventType;
  credits?: number;
  apiKeyId?: string;
  crawlId?: string;
  pageId?: string;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  const id = randomBytes(16).toString("hex");
  const credits = input.credits ?? CREDIT_COSTS[input.eventType];
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO usage_events (id, api_key_id, event_type, credits, crawl_id, page_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.apiKeyId ?? null,
    input.eventType,
    credits,
    input.crawlId ?? null,
    input.pageId ?? null,
    JSON.stringify(input.metadata ?? {}),
    now
  );
}

interface TotalRow {
  total: number;
}

interface TypeRow {
  event_type: string;
  count: number;
  credits: number;
}

export function getUsageSummary(options?: {
  apiKeyId?: string;
  since?: Date;
}): UsageSummary {
  const db = getDb();

  const sinceDate = options?.since ?? new Date(0);
  const fromIso = sinceDate.toISOString();

  let totalRow: TotalRow | null;
  let typeRows: TypeRow[];

  if (options?.apiKeyId) {
    totalRow = db
      .prepare<TotalRow, [string, string]>(
        "SELECT COALESCE(SUM(credits), 0) as total FROM usage_events WHERE api_key_id = ? AND created_at >= ?"
      )
      .get(options.apiKeyId, fromIso);

    typeRows = db
      .prepare<TypeRow, [string, string]>(
        `SELECT event_type, COUNT(*) as count, COALESCE(SUM(credits), 0) as credits
         FROM usage_events WHERE api_key_id = ? AND created_at >= ?
         GROUP BY event_type`
      )
      .all(options.apiKeyId, fromIso);
  } else {
    totalRow = db
      .prepare<TotalRow, [string]>(
        "SELECT COALESCE(SUM(credits), 0) as total FROM usage_events WHERE created_at >= ?"
      )
      .get(fromIso);

    typeRows = db
      .prepare<TypeRow, [string]>(
        `SELECT event_type, COUNT(*) as count, COALESCE(SUM(credits), 0) as credits
         FROM usage_events WHERE created_at >= ?
         GROUP BY event_type`
      )
      .all(fromIso);
  }

  const byType: Record<string, { count: number; credits: number }> = {};
  for (const row of typeRows) {
    byType[row.event_type] = { count: row.count, credits: row.credits };
  }

  return {
    totalCredits: totalRow?.total ?? 0,
    byType,
    period: {
      from: fromIso,
      to: new Date().toISOString(),
    },
  };
}

export function getRecentEvents(options?: {
  apiKeyId?: string;
  limit?: number;
}): UsageEvent[] {
  const db = getDb();
  const limit = options?.limit ?? 50;

  if (options?.apiKeyId) {
    return db
      .prepare<UsageEventRow, [string, number]>(
        "SELECT * FROM usage_events WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(options.apiKeyId, limit)
      .map(rowToEvent);
  }

  return db
    .prepare<UsageEventRow, [number]>(
      "SELECT * FROM usage_events ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit)
    .map(rowToEvent);
}
