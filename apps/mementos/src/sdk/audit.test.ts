import { describe, expect, test } from "bun:test";
import {
  MEMENTOS_AUDIT_EXPORT_CONTRACT,
  MEMENTOS_AUDIT_STATS_CONTRACT,
  MEMENTOS_AUDIT_TRAIL_CONTRACT,
  MementosClient,
} from "./index.js";

const entry = {
  id: "audit-1",
  memory_id: "memory-1",
  memory_key: "key",
  operation: "create",
  agent_id: null,
  old_value_hash: null,
  new_value_hash: "d41d8cd98f00b204e9800998ecf8427e",
  changes: {},
  created_at: "2026-09-18T07:00:00.000Z",
};

function page(contract: string, filters: Record<string, unknown>) {
  return {
    contract,
    entries: [entry],
    count: 1,
    total: 1,
    limit: 1,
    cursor: null,
    next_cursor: null,
    consumed: 1,
    has_more: false,
    complete: true,
    snapshot_at: "2026-09-18T07:00:01.000Z",
    filters,
    sort: { field: "created_at", direction: "desc", tie_breaker: "id" },
  };
}

function clientWith(responses: unknown[], calls: string[] = []): MementosClient {
  return new MementosClient({
    baseUrl: "https://api.hasna.com/mementos",
    apiKey: "test-only-key",
    fetch: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(responses.shift());
    }) as typeof fetch,
  });
}

describe("MementosClient immutable audit API", () => {
  test("uses one /v1 and validates trail/export/stats contracts", async () => {
    const calls: string[] = [];
    const trailFilters = { memory_id: "memory-1", since: null, until: null, operation: null, agent_id: null };
    const exportFilters = { memory_id: null, since: null, until: null, operation: "create", agent_id: null };
    const client = clientWith([
      page(MEMENTOS_AUDIT_TRAIL_CONTRACT, trailFilters),
      page(MEMENTOS_AUDIT_EXPORT_CONTRACT, exportFilters),
      {
        contract: MEMENTOS_AUDIT_STATS_CONTRACT,
        total_entries: 1,
        by_operation: { create: 1, update: 0, delete: 0, archive: 0, restore: 0, read: 0 },
        recent_24h: 1,
        snapshot_at: "2026-09-18T07:00:01.000Z",
      },
    ], calls);

    expect((await client.getMemoryAuditTrail("memory-1", { limit: 1 })).entries[0]?.id).toBe("audit-1");
    expect((await client.exportAuditLog({ operation: "create", limit: 1 })).complete).toBe(true);
    expect((await client.getAuditStats()).total_entries).toBe(1);
    expect(calls).toEqual([
      "https://api.hasna.com/mementos/v1/memories/memory-1/audit-trail?limit=1",
      "https://api.hasna.com/mementos/v1/audit/export?operation=create&limit=1",
      "https://api.hasna.com/mementos/v1/audit/stats",
    ]);
    expect(calls.every((url) => !url.includes("/v1/v1/"))).toBe(true);
  });

  test.each([
    {},
    page("wrong", { memory_id: "memory-1", since: null, until: null, operation: null, agent_id: null }),
    { ...page(MEMENTOS_AUDIT_TRAIL_CONTRACT, { memory_id: "memory-1", since: null, until: null, operation: null, agent_id: null }), count: 0 },
    { ...page(MEMENTOS_AUDIT_TRAIL_CONTRACT, { memory_id: "other", since: null, until: null, operation: null, agent_id: null }) },
    { ...page(MEMENTOS_AUDIT_TRAIL_CONTRACT, { memory_id: "memory-1", since: null, until: null, operation: null, agent_id: null }), entries: [{ ...entry, operation: "bad" }] },
  ])("refuses malformed trail success %#", async (response) => {
    await expect(clientWith([response]).getMemoryAuditTrail("memory-1", { limit: 1 })).rejects.toThrow("malformed 2xx response");
  });

  test("refuses success-shaped empty stats and invalid client inputs before dispatch", async () => {
    await expect(clientWith([{}]).getAuditStats()).rejects.toThrow("malformed 2xx response");
    const calls: string[] = [];
    const client = clientWith([], calls);
    await expect(client.exportAuditLog({ operation: "create", limit: 1.5 })).rejects.toThrow("malformed 2xx response");
    await expect(client.exportAuditLog({ since: "2026-09-18" })).rejects.toThrow("malformed 2xx response");
    await expect(client.exportAuditLog({ cursor: "not valid!" })).rejects.toThrow("malformed 2xx response");
    expect(calls).toEqual([]);
  });
});
