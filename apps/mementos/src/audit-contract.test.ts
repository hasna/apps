import { describe, expect, test } from "bun:test";
import {
  AUDIT_EXPORT_CONTRACT,
  AUDIT_STATS_CONTRACT,
  validateAuditPage,
  validateAuditStats,
  type AuditFilters,
} from "./audit-contract.js";

const filters: AuditFilters = { memory_id: null, since: null, until: null, operation: null, agent_id: null };
const entry = {
  id: "entry-2",
  memory_id: "memory-1",
  memory_key: "key",
  operation: "update",
  agent_id: null,
  old_value_hash: null,
  new_value_hash: null,
  changes: { version_from: 1, version_to: 2 },
  created_at: "2026-09-18T07:00:00.000Z",
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    contract: AUDIT_EXPORT_CONTRACT,
    entries: [entry],
    count: 1,
    total: 1,
    limit: 10,
    cursor: null,
    next_cursor: null,
    consumed: 1,
    has_more: false,
    complete: true,
    snapshot_at: "2026-09-18T07:00:01.000Z",
    filters,
    sort: { field: "created_at", direction: "desc", tie_breaker: "id" },
    ...overrides,
  };
}

describe("audit response contracts", () => {
  test("accepts a complete initial page and fixed operation stats", () => {
    expect(validateAuditPage(page(), { contract: AUDIT_EXPORT_CONTRACT, cursor: null, filters }).complete).toBe(true);
    expect(validateAuditStats({
      contract: AUDIT_STATS_CONTRACT,
      total_entries: 1,
      by_operation: { create: 0, update: 1, delete: 0, archive: 0, restore: 0, read: 0 },
      recent_24h: 1,
      snapshot_at: "2026-09-18T07:00:01.000Z",
    }).total_entries).toBe(1);
  });

  test.each([
    page({ contract: "wrong" }),
    page({ entries: [], count: 1 }),
    page({ total: 2, has_more: false, next_cursor: null, complete: true }),
    page({ total: 2, has_more: true, next_cursor: null, complete: false }),
    page({ total: 2, consumed: 1, has_more: true, next_cursor: "not valid!", complete: false }),
    page({ cursor: "cursor", complete: true }),
    page({ entries: [{ ...entry, created_at: "not-a-time" }] }),
    page({ entries: [{ ...entry, old_value_hash: "fabricated" }] }),
    page({ entries: [{ ...entry, operation: "unknown" }] }),
    page({ unexpected: true }),
  ])("refuses malformed or success-shaped page %#", (value) => {
    expect(() => validateAuditPage(value, { contract: AUDIT_EXPORT_CONTRACT, cursor: value.cursor as string | null, filters })).toThrow();
  });

  test("requires strict descending created_at plus id ordering", () => {
    const older = { ...entry, id: "entry-1", created_at: "2026-09-18T06:00:00.000Z" };
    expect(() => validateAuditPage(page({ entries: [older, entry], count: 2, total: 2, consumed: 2 }), {
      contract: AUDIT_EXPORT_CONTRACT,
      cursor: null,
      filters,
    })).toThrow("strictly ordered");
  });
});
