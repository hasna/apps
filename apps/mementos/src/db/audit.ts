/**
 * Immutable audit-log queries.
 *
 * The audit table is append-only. Hosted clients use versioned, strictly
 * validated /v1 receipts; local/server callers use the same page contract over
 * SQLite or PostgreSQL. No client path may fall through to local storage.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PgAdapter, type DbAdapter } from "../storage.js";
import { getDatabase, now } from "./database.js";
import { isApiMode, apiJson, toQuery } from "./api-mode.js";
import { MementosApiProtocolError } from "./api-response-contract.js";
import {
  AUDIT_CURSOR_VERSION,
  AUDIT_DEFAULT_LIMIT,
  AUDIT_EXPORT_CONTRACT,
  AUDIT_OPERATIONS,
  AUDIT_STATS_CONTRACT,
  AUDIT_TRAIL_CONTRACT,
  AuditContractError,
  auditOperation,
  canonicalAuditTimestamp,
  validateAuditEntry,
  validateAuditPage,
  validateAuditStats,
  type AuditCursorPayload,
  type AuditEntry,
  type AuditFilters,
  type AuditOperation,
  type AuditPage,
  type AuditPageContract,
  type AuditStats,
} from "../audit-contract.js";

export type { AuditEntry, AuditFilters, AuditOperation, AuditPage, AuditStats } from "../audit-contract.js";
export { AUDIT_EXPORT_CONTRACT, AUDIT_OPERATIONS, AUDIT_STATS_CONTRACT, AUDIT_TRAIL_CONTRACT } from "../audit-contract.js";

export interface AuditPageOptions {
  limit?: number;
  cursor?: string;
}

export interface AuditExportOptions extends AuditPageOptions {
  since?: string;
  until?: string;
  operation?: AuditOperation | string;
  agent_id?: string;
}

type AuditDatabase = DbAdapter & { query(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] } };
type QueryBinding = string | number | Date | null;

const DEFAULT_TRAIL_LIMIT = AUDIT_DEFAULT_LIMIT;
const DEFAULT_EXPORT_LIMIT = AUDIT_DEFAULT_LIMIT;
const MAX_AUDIT_LIMIT = 1000;
const MAX_CURSOR_BYTES = 4096;
const PROCESS_CURSOR_SECRET = randomBytes(32).toString("base64url");
const CURSOR_MAC_DOMAIN = "mementos.audit.cursor.v1\0";

function protocol(operation: string, error: unknown): never {
  if (error instanceof MementosApiProtocolError) throw error;
  const detail = error instanceof Error ? error.message : String(error);
  throw new MementosApiProtocolError(operation, detail);
}

function safeLimit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_AUDIT_LIMIT) {
    throw new AuditContractError(`limit must be an integer between 1 and ${MAX_AUDIT_LIMIT}`);
  }
  return resolved;
}

function printableIdentifier(value: string | undefined, label: string, maximum = 512): string | null {
  if (value === undefined) return null;
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AuditContractError(`${label} must be a non-empty printable string of at most ${maximum} characters`);
  }
  return value;
}

export function normalizeAuditFilters(input: {
  memory_id?: string;
  since?: string;
  until?: string;
  operation?: string;
  agent_id?: string;
}): AuditFilters {
  const filters: AuditFilters = {
    memory_id: printableIdentifier(input.memory_id, "memory_id"),
    since: input.since === undefined ? null : canonicalAuditTimestamp(input.since, "since"),
    until: input.until === undefined ? null : canonicalAuditTimestamp(input.until, "until"),
    operation: input.operation === undefined ? null : auditOperation(input.operation),
    agent_id: printableIdentifier(input.agent_id, "agent_id"),
  };
  if (filters.since && filters.until && filters.since > filters.until) {
    throw new AuditContractError("since must not be after until");
  }
  return filters;
}

function filterFingerprint(filters: AuditFilters): string {
  return createHash("sha256").update(JSON.stringify(filters), "utf8").digest("hex");
}

function auditCursorSecret(): string {
  // Bearer API keys are deliberately excluded: callers know those values and
  // could otherwise forge a cursor. Hosted replicas share a server-only
  // signing secret; local servers fall back to one process-private key.
  return (
    process.env["MEMENTOS_AUDIT_CURSOR_SECRET"]?.trim() ||
    process.env["API_KEY_SIGNING_SECRET"]?.trim() ||
    process.env["HASNA_MEMENTOS_API_SIGNING_KEY"]?.trim() ||
    process.env["HASNA_API_SIGNING_KEY"]?.trim() ||
    PROCESS_CURSOR_SECRET
  );
}

function cursorMac(payload: AuditCursorPayload, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(CURSOR_MAC_DOMAIN, "utf8")
    .update(JSON.stringify(payload), "utf8")
    .digest();
}

function encodeAuditCursor(payload: AuditCursorPayload, secret: string): string {
  const mac = cursorMac(payload, secret).toString("base64url");
  return Buffer.from(JSON.stringify({ ...payload, mac }), "utf8").toString("base64url");
}

function decodeAuditCursor(
  cursor: string,
  contract: AuditPageContract,
  filters: AuditFilters,
  secret: string,
): AuditCursorPayload {
  if (!cursor || Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new AuditContractError("cursor is not a valid bounded audit cursor");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new AuditContractError("cursor is not valid base64url JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AuditContractError("cursor payload must be an object");
  const object = raw as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const expectedKeys = [
    "after_created_at", "after_id", "consumed", "contract", "filter_fingerprint", "mac",
    "snapshot_created_at", "snapshot_id", "snapshot_total", "v",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new AuditContractError("cursor payload fields are invalid");
  const timestamp = (value: unknown, label: string): string | null => value === null ? null : canonicalAuditTimestamp(value, label);
  const identifier = (value: unknown, label: string): string | null => {
    if (value === null) return null;
    if (typeof value !== "string") throw new AuditContractError(`${label} must be a string or null`);
    return printableIdentifier(value, label);
  };
  const payload: AuditCursorPayload = {
    v: object.v === AUDIT_CURSOR_VERSION ? AUDIT_CURSOR_VERSION : (() => { throw new AuditContractError("unsupported cursor version"); })(),
    contract: object.contract === AUDIT_TRAIL_CONTRACT || object.contract === AUDIT_EXPORT_CONTRACT
      ? object.contract
      : (() => { throw new AuditContractError("cursor contract is invalid"); })(),
    snapshot_created_at: timestamp(object.snapshot_created_at, "cursor.snapshot_created_at"),
    snapshot_id: identifier(object.snapshot_id, "cursor.snapshot_id"),
    after_created_at: timestamp(object.after_created_at, "cursor.after_created_at"),
    after_id: identifier(object.after_id, "cursor.after_id"),
    snapshot_total: Number.isSafeInteger(object.snapshot_total) && (object.snapshot_total as number) >= 0
      ? object.snapshot_total as number
      : (() => { throw new AuditContractError("cursor.snapshot_total must be a non-negative safe integer"); })(),
    consumed: Number.isSafeInteger(object.consumed) && (object.consumed as number) >= 0
      ? object.consumed as number
      : (() => { throw new AuditContractError("cursor.consumed must be a non-negative safe integer"); })(),
    filter_fingerprint: typeof object.filter_fingerprint === "string" ? object.filter_fingerprint : "",
  };
  const encodedMac = object.mac;
  if (typeof encodedMac !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encodedMac)) {
    throw new AuditContractError("cursor authentication code is invalid");
  }
  const providedMac = Buffer.from(encodedMac, "base64url");
  const expectedMac = cursorMac(payload, secret);
  if (
    providedMac.length !== expectedMac.length ||
    !timingSafeEqual(providedMac, expectedMac) ||
    payload.contract !== contract ||
    payload.filter_fingerprint !== filterFingerprint(filters)
  ) {
    throw new AuditContractError("cursor authentication or query binding failed");
  }
  if (!payload.snapshot_created_at || !payload.snapshot_id || !payload.after_created_at || !payload.after_id) {
    throw new AuditContractError("continuation cursor is missing its snapshot or ordering boundary");
  }
  if (
    payload.after_created_at > payload.snapshot_created_at ||
    (payload.after_created_at === payload.snapshot_created_at && payload.after_id > payload.snapshot_id)
  ) {
    throw new AuditContractError("cursor continuation lies outside its snapshot boundary");
  }
  return payload;
}

function dbTimestamp(value: string, db: AuditDatabase): QueryBinding {
  if (db instanceof PgAdapter) return new Date(value);
  const withoutZone = value.slice(0, -1).replace("T", " ");
  return withoutZone.endsWith(".000") ? withoutZone.slice(0, -4) : withoutZone;
}

function normalizedDbEntry(row: Record<string, unknown>): AuditEntry {
  let changes = row.changes;
  if (typeof changes === "string") {
    try { changes = JSON.parse(changes || "{}"); }
    catch { throw new AuditContractError("audit database row changes is not valid JSON"); }
  }
  return validateAuditEntry({
    id: row.id,
    memory_id: row.memory_id,
    memory_key: row.memory_key ?? null,
    operation: row.operation,
    agent_id: row.agent_id ?? null,
    old_value_hash: row.old_value_hash ?? null,
    new_value_hash: row.new_value_hash ?? null,
    changes: changes ?? {},
    created_at: canonicalAuditTimestamp(row.created_at, "audit database row created_at"),
  }, "audit database row");
}

function buildFilterSql(filters: AuditFilters, db: AuditDatabase): { conditions: string[]; params: QueryBinding[] } {
  const conditions: string[] = [];
  const params: QueryBinding[] = [];
  if (filters.memory_id) { conditions.push("memory_id = ?"); params.push(filters.memory_id); }
  if (filters.since) { conditions.push("created_at >= ?"); params.push(dbTimestamp(filters.since, db)); }
  if (filters.until) { conditions.push("created_at <= ?"); params.push(dbTimestamp(filters.until, db)); }
  if (filters.operation) { conditions.push("operation = ?"); params.push(filters.operation); }
  if (filters.agent_id) { conditions.push("agent_id = ?"); params.push(filters.agent_id); }
  return { conditions, params };
}

function auditSortExpression(db: AuditDatabase): string {
  return db instanceof PgAdapter ? "date_trunc('milliseconds', created_at)" : "created_at";
}

function boundarySql(
  payload: Pick<AuditCursorPayload, "snapshot_created_at" | "snapshot_id" | "after_created_at" | "after_id">,
  db: AuditDatabase,
): { conditions: string[]; params: QueryBinding[] } {
  const conditions: string[] = [];
  const params: QueryBinding[] = [];
  const createdAt = auditSortExpression(db);
  if (payload.snapshot_created_at && payload.snapshot_id) {
    const value = dbTimestamp(payload.snapshot_created_at, db);
    conditions.push(`(${createdAt} < ? OR (${createdAt} = ? AND id <= ?))`);
    params.push(value, value, payload.snapshot_id);
  }
  if (payload.after_created_at && payload.after_id) {
    const value = dbTimestamp(payload.after_created_at, db);
    conditions.push(`(${createdAt} < ? OR (${createdAt} = ? AND id < ?))`);
    params.push(value, value, payload.after_id);
  }
  return { conditions, params };
}

function whereClause(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function numberFromDb(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new AuditContractError(`${label} is not a non-negative safe integer`);
  return number;
}

function readAuditPage(
  contract: AuditPageContract,
  filters: AuditFilters,
  options: AuditPageOptions,
  db: AuditDatabase,
): AuditPage {
  const limit = safeLimit(options.limit, contract === AUDIT_TRAIL_CONTRACT ? DEFAULT_TRAIL_LIMIT : DEFAULT_EXPORT_LIMIT);
  const requestedCursor = options.cursor ?? null;
  const secret = auditCursorSecret();
  const continuation = requestedCursor ? decodeAuditCursor(requestedCursor, contract, filters, secret) : null;

  return db.transaction(() => {
    const base = buildFilterSql(filters, db);
    let snapshotCreatedAt = continuation?.snapshot_created_at ?? null;
    let snapshotId = continuation?.snapshot_id ?? null;
    if (!continuation) {
      const createdAt = auditSortExpression(db);
      const snapshotRow = db.query(
        `SELECT ${createdAt} AS created_at, id FROM memory_audit_log ${whereClause(base.conditions)} ORDER BY ${createdAt} DESC, id DESC LIMIT 1`,
      ).get(...base.params) as Record<string, unknown> | null;
      if (snapshotRow) {
        snapshotCreatedAt = canonicalAuditTimestamp(snapshotRow.created_at, "audit snapshot created_at");
        snapshotId = printableIdentifier(String(snapshotRow.id ?? ""), "audit snapshot id");
      }
    }

    const snapshotBoundary = boundarySql({
      snapshot_created_at: snapshotCreatedAt,
      snapshot_id: snapshotId,
      after_created_at: null,
      after_id: null,
    }, db);
    const countConditions = [...base.conditions, ...snapshotBoundary.conditions];
    const countParams = [...base.params, ...snapshotBoundary.params];
    const totalRow = db.query(
      `SELECT COUNT(*) AS count FROM memory_audit_log ${whereClause(countConditions)}`,
    ).get(...countParams) as Record<string, unknown> | null;
    const total = numberFromDb(totalRow?.count ?? 0, "audit total");
    if (continuation && continuation.snapshot_total !== total) {
      throw new AuditContractError("audit snapshot changed while following the cursor; restart from the first page");
    }

    const pageBoundary = boundarySql({
      snapshot_created_at: snapshotCreatedAt,
      snapshot_id: snapshotId,
      after_created_at: continuation?.after_created_at ?? null,
      after_id: continuation?.after_id ?? null,
    }, db);
    const pageConditions = [...base.conditions, ...pageBoundary.conditions];
    const pageParams = [...base.params, ...pageBoundary.params];
    const rawRows = db.query(
      `SELECT id, memory_id, memory_key, operation, agent_id, old_value_hash, new_value_hash, changes, created_at
       FROM memory_audit_log ${whereClause(pageConditions)}
       ORDER BY ${auditSortExpression(db)} DESC, id DESC LIMIT ?`,
    ).all(...pageParams, limit + 1) as Record<string, unknown>[];
    const hasExtra = rawRows.length > limit;
    const rows = hasExtra ? rawRows.slice(0, limit) : rawRows;
    const entries = rows.map(normalizedDbEntry);
    const consumedBefore = continuation?.consumed ?? 0;
    const consumed = consumedBefore + entries.length;
    if (consumed > total || hasExtra !== (consumed < total)) {
      throw new AuditContractError("audit page changed inside its database snapshot");
    }
    const hasMore = consumed < total;
    const last = entries.at(-1);
    const nextCursor = hasMore && last && snapshotCreatedAt && snapshotId
      ? encodeAuditCursor({
          v: AUDIT_CURSOR_VERSION,
          contract,
          snapshot_created_at: snapshotCreatedAt,
          snapshot_id: snapshotId,
          after_created_at: last.created_at,
          after_id: last.id,
          snapshot_total: total,
          consumed,
          filter_fingerprint: filterFingerprint(filters),
        }, secret)
      : null;
    const page: AuditPage = {
      contract,
      entries,
      count: entries.length,
      total,
      limit,
      cursor: requestedCursor,
      next_cursor: nextCursor,
      consumed,
      has_more: hasMore,
      complete: requestedCursor === null && !hasMore,
      snapshot_at: snapshotCreatedAt ?? now(),
      filters,
      sort: { field: "created_at", direction: "desc", tie_breaker: "id" },
    };
    return validateAuditPage(page, { contract, cursor: requestedCursor, filters, limit });
  });
}

function hostedAuditPage(
  contract: AuditPageContract,
  path: string,
  filters: AuditFilters,
  options: AuditPageOptions,
): AuditPage {
  const limit = safeLimit(options.limit, contract === AUDIT_TRAIL_CONTRACT ? DEFAULT_TRAIL_LIMIT : DEFAULT_EXPORT_LIMIT);
  const cursor = options.cursor ?? null;
  const operation = `GET ${path.split("?")[0]}`;
  const { data } = apiJson<unknown>("GET", path);
  try {
    return validateAuditPage(data, { contract, cursor, filters, limit });
  } catch (error) {
    return protocol(operation, error);
  }
}

export function getMemoryAuditTrailPage(
  memoryId: string,
  options: AuditPageOptions = {},
  db?: AuditDatabase,
): AuditPage {
  const filters = normalizeAuditFilters({ memory_id: memoryId });
  const limit = safeLimit(options.limit, DEFAULT_TRAIL_LIMIT);
  if (!db && isApiMode()) {
    const query = toQuery({ limit, cursor: options.cursor });
    return hostedAuditPage(
      AUDIT_TRAIL_CONTRACT,
      `/memories/${encodeURIComponent(filters.memory_id!)}/audit-trail${query}`,
      filters,
      { limit, cursor: options.cursor },
    );
  }
  return readAuditPage(AUDIT_TRAIL_CONTRACT, filters, { limit, cursor: options.cursor }, (db ?? getDatabase()) as AuditDatabase);
}

export function exportAuditLogPage(
  options: AuditExportOptions = {},
  db?: AuditDatabase,
): AuditPage {
  const filters = normalizeAuditFilters(options);
  const limit = safeLimit(options.limit, DEFAULT_EXPORT_LIMIT);
  if (!db && isApiMode()) {
    const query = toQuery({
      since: filters.since ?? undefined,
      until: filters.until ?? undefined,
      operation: filters.operation ?? undefined,
      agent_id: filters.agent_id ?? undefined,
      limit,
      cursor: options.cursor,
    });
    return hostedAuditPage(AUDIT_EXPORT_CONTRACT, `/audit/export${query}`, filters, { limit, cursor: options.cursor });
  }
  return readAuditPage(AUDIT_EXPORT_CONTRACT, filters, { limit, cursor: options.cursor }, (db ?? getDatabase()) as AuditDatabase);
}

/** Backward-compatible first-page helper. Prefer getMemoryAuditTrailPage. */
export function getMemoryAuditTrail(memoryId: string, limit: number = DEFAULT_TRAIL_LIMIT, db?: AuditDatabase): AuditEntry[] {
  return getMemoryAuditTrailPage(memoryId, { limit }, db).entries;
}

/** Backward-compatible first-page helper. Prefer exportAuditLogPage. */
export function exportAuditLog(options: AuditExportOptions = {}, db?: AuditDatabase): AuditEntry[] {
  return exportAuditLogPage(options, db).entries;
}

function auditStatsFromDb(db: AuditDatabase): AuditStats {
  const snapshotAt = now();
  const recentSince = new Date(new Date(snapshotAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const snapshotParam = dbTimestamp(snapshotAt, db);
  const recentParam = dbTimestamp(recentSince, db);
  const row = db.query(
    `SELECT
       COUNT(*) AS total_entries,
       SUM(CASE WHEN operation = 'create' THEN 1 ELSE 0 END) AS create_count,
       SUM(CASE WHEN operation = 'update' THEN 1 ELSE 0 END) AS update_count,
       SUM(CASE WHEN operation = 'delete' THEN 1 ELSE 0 END) AS delete_count,
       SUM(CASE WHEN operation = 'archive' THEN 1 ELSE 0 END) AS archive_count,
       SUM(CASE WHEN operation = 'restore' THEN 1 ELSE 0 END) AS restore_count,
       SUM(CASE WHEN operation = 'read' THEN 1 ELSE 0 END) AS read_count,
       SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) AS recent_24h
     FROM memory_audit_log
     WHERE created_at <= ?`,
  ).get(recentParam, snapshotParam, snapshotParam) as Record<string, unknown> | null;
  const byOperation = Object.fromEntries(AUDIT_OPERATIONS.map((operation) => [
    operation,
    numberFromDb(row?.[`${operation}_count`] ?? 0, `audit ${operation} count`),
  ])) as Record<AuditOperation, number>;
  return validateAuditStats({
    contract: AUDIT_STATS_CONTRACT,
    total_entries: numberFromDb(row?.total_entries ?? 0, "audit total_entries"),
    by_operation: byOperation,
    recent_24h: numberFromDb(row?.recent_24h ?? 0, "audit recent_24h"),
    snapshot_at: snapshotAt,
  });
}

export function getAuditStats(db?: AuditDatabase): AuditStats {
  if (!db && isApiMode()) {
    const operation = "GET /audit/stats";
    const { data } = apiJson<unknown>("GET", "/audit/stats");
    try { return validateAuditStats(data); }
    catch (error) { return protocol(operation, error); }
  }
  return auditStatsFromDb((db ?? getDatabase()) as AuditDatabase);
}
