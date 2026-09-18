/**
 * Pure public contract for the immutable Mementos audit log.
 *
 * This module deliberately has no storage, credential, transport, filesystem,
 * or server dependencies so the SDK and hosted client can validate the exact
 * same versioned receipts without pulling SQLite into client bundles.
 */

export const AUDIT_TRAIL_CONTRACT = "mementos.audit.trail.v1" as const;
export const AUDIT_EXPORT_CONTRACT = "mementos.audit.export.v1" as const;
export const AUDIT_STATS_CONTRACT = "mementos.audit.stats.v1" as const;
export const AUDIT_CURSOR_VERSION = 1 as const;

export const AUDIT_OPERATIONS = [
  "create",
  "update",
  "delete",
  "archive",
  "restore",
  "read",
] as const;

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];
export type AuditPageContract = typeof AUDIT_TRAIL_CONTRACT | typeof AUDIT_EXPORT_CONTRACT;

export interface AuditEntry {
  id: string;
  memory_id: string;
  memory_key: string | null;
  operation: AuditOperation;
  agent_id: string | null;
  /** md5 hex digest of the value before the operation, or null when unavailable. */
  old_value_hash: string | null;
  /** md5 hex digest of the value after the operation, or null when unavailable. */
  new_value_hash: string | null;
  changes: Record<string, unknown>;
  created_at: string;
}

export interface AuditFilters {
  memory_id: string | null;
  since: string | null;
  until: string | null;
  operation: AuditOperation | null;
  agent_id: string | null;
}

export interface AuditPage {
  contract: AuditPageContract;
  entries: AuditEntry[];
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  consumed: number;
  has_more: boolean;
  complete: boolean;
  snapshot_at: string;
  filters: AuditFilters;
  sort: {
    field: "created_at";
    direction: "desc";
    tie_breaker: "id";
  };
}

export interface AuditStats {
  contract: typeof AUDIT_STATS_CONTRACT;
  total_entries: number;
  by_operation: Record<AuditOperation, number>;
  recent_24h: number;
  snapshot_at: string;
}

export interface AuditCursorPayload {
  v: typeof AUDIT_CURSOR_VERSION;
  snapshot_created_at: string | null;
  snapshot_id: string | null;
  after_created_at: string | null;
  after_id: string | null;
  snapshot_total: number;
  consumed: number;
  filter_fingerprint: string;
}

export class AuditContractError extends Error {
  readonly code = "MEMENTOS_AUDIT_CONTRACT";
  constructor(message: string) {
    super(message);
    this.name = "AuditContractError";
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MD5_HEX = /^[0-9a-f]{32}$/;
const ENTRY_KEYS = new Set([
  "id", "memory_id", "memory_key", "operation", "agent_id",
  "old_value_hash", "new_value_hash", "changes", "created_at",
]);
const PAGE_KEYS = new Set([
  "contract", "entries", "count", "total", "limit", "cursor", "next_cursor",
  "consumed", "has_more", "complete", "snapshot_at", "filters", "sort",
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditContractError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new AuditContractError(`${label} has unexpected field '${unexpected[0]}'`);
}

function string(value: unknown, label: string, options: { nullable?: boolean; max?: number } = {}): string | null {
  if (options.nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > (options.max ?? 2048) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AuditContractError(`${label} must be a non-empty printable string of at most ${options.max ?? 2048} characters`);
  }
  return value;
}

function cursorString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuditContractError(`${label} must be a bounded base64url cursor or null`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AuditContractError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new AuditContractError(`${label} must be a boolean`);
  return value;
}

export function canonicalAuditTimestamp(value: unknown, label: string): string {
  if (value instanceof Date) value = value.toISOString();
  if (typeof value !== "string") throw new AuditContractError(`${label} must be a canonical UTC timestamp`);
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
    ? `${value.replace(" ", "T")}${value.includes(".") ? "" : ".000"}Z`
    : value;
  if (!ISO_UTC.test(candidate)) throw new AuditContractError(`${label} must use YYYY-MM-DDTHH:mm:ss.sssZ`);
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== candidate) {
    throw new AuditContractError(`${label} must be a real calendar timestamp`);
  }
  return candidate;
}

export function auditOperation(value: unknown, label = "operation"): AuditOperation {
  if (typeof value !== "string" || !(AUDIT_OPERATIONS as readonly string[]).includes(value)) {
    throw new AuditContractError(`${label} must be one of: ${AUDIT_OPERATIONS.join(", ")}`);
  }
  return value as AuditOperation;
}

function nullableHash(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !MD5_HEX.test(value)) {
    throw new AuditContractError(`${label} must be a lowercase md5 hex digest or null`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  return object(value, label);
}

export function validateAuditEntry(value: unknown, label = "audit entry"): AuditEntry {
  const row = object(value, label);
  exactKeys(row, ENTRY_KEYS, label);
  return {
    id: string(row.id, `${label}.id`, { max: 512 })!,
    memory_id: string(row.memory_id, `${label}.memory_id`, { max: 512 })!,
    memory_key: string(row.memory_key, `${label}.memory_key`, { nullable: true, max: 4096 }),
    operation: auditOperation(row.operation, `${label}.operation`),
    agent_id: string(row.agent_id, `${label}.agent_id`, { nullable: true, max: 512 }),
    old_value_hash: nullableHash(row.old_value_hash, `${label}.old_value_hash`),
    new_value_hash: nullableHash(row.new_value_hash, `${label}.new_value_hash`),
    changes: record(row.changes, `${label}.changes`),
    created_at: canonicalAuditTimestamp(row.created_at, `${label}.created_at`),
  };
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : canonicalAuditTimestamp(value, label);
}

function validateFilters(value: unknown): AuditFilters {
  const filters = object(value, "audit page filters");
  const expected = new Set(["memory_id", "since", "until", "operation", "agent_id"]);
  exactKeys(filters, expected, "audit page filters");
  const result: AuditFilters = {
    memory_id: string(filters.memory_id, "filters.memory_id", { nullable: true, max: 512 }),
    since: nullableTimestamp(filters.since, "filters.since"),
    until: nullableTimestamp(filters.until, "filters.until"),
    operation: filters.operation === null ? null : auditOperation(filters.operation, "filters.operation"),
    agent_id: string(filters.agent_id, "filters.agent_id", { nullable: true, max: 512 }),
  };
  if (result.since && result.until && result.since > result.until) {
    throw new AuditContractError("filters.since must not be after filters.until");
  }
  return result;
}

function compareEntryOrder(left: AuditEntry, right: AuditEntry): number {
  if (left.created_at !== right.created_at) return left.created_at > right.created_at ? -1 : 1;
  return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
}

export function validateAuditPage(
  value: unknown,
  expected: { contract: AuditPageContract; cursor: string | null; filters: AuditFilters },
): AuditPage {
  const page = object(value, "audit page");
  exactKeys(page, PAGE_KEYS, "audit page");
  if (page.contract !== expected.contract) throw new AuditContractError(`expected contract '${expected.contract}'`);
  const entries = Array.isArray(page.entries)
    ? page.entries.map((entry, index) => validateAuditEntry(entry, `entries[${index}]`))
    : (() => { throw new AuditContractError("entries must be an array"); })();
  const count = integer(page.count, "count");
  const total = integer(page.total, "total");
  const limit = integer(page.limit, "limit", 1);
  const consumed = integer(page.consumed, "consumed");
  const cursor = cursorString(page.cursor, "cursor");
  const nextCursor = cursorString(page.next_cursor, "next_cursor");
  const hasMore = boolean(page.has_more, "has_more");
  const complete = boolean(page.complete, "complete");
  const snapshotAt = canonicalAuditTimestamp(page.snapshot_at, "snapshot_at");
  const filters = validateFilters(page.filters);
  const sort = object(page.sort, "sort");
  exactKeys(sort, new Set(["field", "direction", "tie_breaker"]), "sort");
  if (sort.field !== "created_at" || sort.direction !== "desc" || sort.tie_breaker !== "id") {
    throw new AuditContractError("sort must be created_at desc with id tie-breaker");
  }
  if (cursor !== expected.cursor) throw new AuditContractError("cursor receipt does not match the request");
  if (JSON.stringify(filters) !== JSON.stringify(expected.filters)) throw new AuditContractError("filter receipt does not match the request");
  if (count !== entries.length || count > limit || total < count || consumed < count || consumed > total) {
    throw new AuditContractError("count/limit/consumed/total fields are inconsistent");
  }
  if (hasMore !== (consumed < total)) throw new AuditContractError("has_more does not match consumed/total");
  if (hasMore !== (nextCursor !== null)) throw new AuditContractError("next_cursor does not match has_more");
  const shouldBeComplete = cursor === null && !hasMore && consumed === total;
  if (complete !== shouldBeComplete) throw new AuditContractError("complete is not truthful for this page");
  if (cursor === null && consumed !== count) throw new AuditContractError("initial page consumed must equal count");
  for (let index = 1; index < entries.length; index++) {
    if (compareEntryOrder(entries[index - 1]!, entries[index]!) >= 0) {
      throw new AuditContractError("entries are not strictly ordered by created_at desc, id desc");
    }
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new AuditContractError(`duplicate audit entry id '${entry.id}'`);
    ids.add(entry.id);
    if (filters.memory_id && entry.memory_id !== filters.memory_id) throw new AuditContractError("entry violates memory_id filter");
    if (filters.operation && entry.operation !== filters.operation) throw new AuditContractError("entry violates operation filter");
    if (filters.agent_id && entry.agent_id !== filters.agent_id) throw new AuditContractError("entry violates agent_id filter");
    if (filters.since && entry.created_at < filters.since) throw new AuditContractError("entry violates since filter");
    if (filters.until && entry.created_at > filters.until) throw new AuditContractError("entry violates until filter");
    if (entry.created_at > snapshotAt) throw new AuditContractError("entry is newer than the snapshot boundary");
  }
  return {
    contract: expected.contract,
    entries,
    count,
    total,
    limit,
    cursor,
    next_cursor: nextCursor,
    consumed,
    has_more: hasMore,
    complete,
    snapshot_at: snapshotAt,
    filters,
    sort: { field: "created_at", direction: "desc", tie_breaker: "id" },
  };
}

export function validateAuditStats(value: unknown): AuditStats {
  const stats = object(value, "audit stats");
  exactKeys(stats, new Set(["contract", "total_entries", "by_operation", "recent_24h", "snapshot_at"]), "audit stats");
  if (stats.contract !== AUDIT_STATS_CONTRACT) throw new AuditContractError(`expected contract '${AUDIT_STATS_CONTRACT}'`);
  const total = integer(stats.total_entries, "total_entries");
  const recent = integer(stats.recent_24h, "recent_24h");
  const byOperationObject = object(stats.by_operation, "by_operation");
  exactKeys(byOperationObject, new Set(AUDIT_OPERATIONS), "by_operation");
  const byOperation = Object.fromEntries(
    AUDIT_OPERATIONS.map((operation) => [operation, integer(byOperationObject[operation], `by_operation.${operation}`)]),
  ) as Record<AuditOperation, number>;
  if (Object.values(byOperation).reduce((sum, count) => sum + count, 0) !== total) {
    throw new AuditContractError("by_operation counts do not sum to total_entries");
  }
  if (recent > total) throw new AuditContractError("recent_24h exceeds total_entries");
  return {
    contract: AUDIT_STATS_CONTRACT,
    total_entries: total,
    by_operation: byOperation,
    recent_24h: recent,
    snapshot_at: canonicalAuditTimestamp(stats.snapshot_at, "snapshot_at"),
  };
}
