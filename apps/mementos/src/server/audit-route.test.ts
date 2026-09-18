process.env["MEMENTOS_DB_PATH"] = ":memory:";
process.env["HOME"] = "/tmp/mementos-audit-route-home";

import { beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_EXPORT_CONTRACT, AUDIT_STATS_CONTRACT, AUDIT_TRAIL_CONTRACT } from "../audit-contract.js";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createMemory, updateMemory } from "../db/memories.js";
import { buildOpenApiDocument } from "./openapi.js";
import { matchRoute } from "./router.js";
import "./routes/audit.js";
import "./routes/memories.js";

beforeEach(() => resetDatabase());

async function call(path: string): Promise<{ status: number; data: Record<string, any> }> {
  const match = matchRoute("GET", path.split("?")[0]!);
  expect(match).not.toBeNull();
  const request = new Request(`http://mementos.test${path}`);
  const response = await match!.handler(request, new URL(request.url), match!.params);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

function seed(): string {
  const memory = createMemory({ key: "audited-key", value: "v1", category: "fact" });
  updateMemory(memory.id, { value: "v2", version: memory.version });
  return memory.id;
}

describe("hosted immutable audit routes", () => {
  test("trail is versioned, strictly ordered, and does not shadow low-trust audit", async () => {
    const id = seed();
    const response = await call(`/api/memories/${id}/audit-trail?limit=10`);
    expect(response.status).toBe(200);
    expect(response.data.contract).toBe(AUDIT_TRAIL_CONTRACT);
    expect(response.data.count).toBeGreaterThanOrEqual(2);
    expect(response.data.total).toBe(response.data.count);
    expect(response.data).toMatchObject({ complete: true, has_more: false });
    expect(response.data.entries.every((row: any) => row.memory_id === id)).toBe(true);
    expect(response.data.sort).toEqual({ field: "created_at", direction: "desc", tie_breaker: "id" });
    expect(matchRoute("GET", "/api/memories/audit")?.params).toEqual({});
  });

  test("cursor pages use stable created_at plus id order and a fixed snapshot", async () => {
    const db = getDatabase();
    for (const id of ["audit-c", "audit-b", "audit-a"]) {
      db.run(
        `INSERT INTO memory_audit_log
         (id, memory_id, memory_key, operation, agent_id, old_value_hash, new_value_hash, changes, created_at)
         VALUES (?, 'memory-page', 'page', 'read', NULL, NULL, NULL, '{}', '2026-09-18 07:00:00')`,
        id,
      );
    }
    const first = await call("/api/memories/memory-page/audit-trail?limit=1");
    expect(first.data.entries[0].id).toBe("audit-c");
    expect(first.data).toMatchObject({ total: 3, consumed: 1, has_more: true, complete: false });
    const cursor = encodeURIComponent(first.data.next_cursor);

    // Appended after the page snapshot: it must not move or enlarge the traversal.
    db.run(
      `INSERT INTO memory_audit_log
       (id, memory_id, memory_key, operation, agent_id, old_value_hash, new_value_hash, changes, created_at)
       VALUES ('audit-new', 'memory-page', 'page', 'read', NULL, NULL, NULL, '{}', '2026-09-18 08:00:00')`,
    );
    const second = await call(`/api/memories/memory-page/audit-trail?limit=1&cursor=${cursor}`);
    expect(second.data.entries[0].id).toBe("audit-b");
    expect(second.data).toMatchObject({ total: 3, consumed: 2, has_more: true, complete: false });
    const third = await call(`/api/memories/memory-page/audit-trail?limit=1&cursor=${encodeURIComponent(second.data.next_cursor)}`);
    expect(third.data.entries[0].id).toBe("audit-a");
    expect(third.data).toMatchObject({ total: 3, consumed: 3, has_more: false, complete: false, next_cursor: null });
  });

  test("cursor refuses same-timestamp append drift instead of silently changing the snapshot", async () => {
    const db = getDatabase();
    for (const id of ["stable-c", "stable-b", "stable-a"]) {
      db.run(
        `INSERT INTO memory_audit_log
         (id, memory_id, memory_key, operation, agent_id, old_value_hash, new_value_hash, changes, created_at)
         VALUES (?, 'memory-drift', 'page', 'read', NULL, NULL, NULL, '{}', '2026-09-18 07:00:00')`,
        id,
      );
    }
    const first = await call("/api/memories/memory-drift/audit-trail?limit=1");
    db.run(
      `INSERT INTO memory_audit_log
       (id, memory_id, memory_key, operation, agent_id, old_value_hash, new_value_hash, changes, created_at)
       VALUES ('stable-0', 'memory-drift', 'page', 'read', NULL, NULL, NULL, '{}', '2026-09-18 07:00:00')`,
    );
    const continued = await call(`/api/memories/memory-drift/audit-trail?limit=1&cursor=${encodeURIComponent(first.data.next_cursor)}`);
    expect(continued.status).toBe(400);
    expect(continued.data.error).toContain("snapshot changed");
  });

  test("export validates operation, canonical times, integer limits, cursors, and unknown parameters", async () => {
    seed();
    expect((await call("/api/audit/export?operation=update&limit=1")).data.entries[0].operation).toBe("update");
    for (const query of [
      "operation=nope",
      "limit=1.5",
      "limit=0",
      "since=2026-09-18",
      "since=2026-09-19T00:00:00.000Z&until=2026-09-18T00:00:00.000Z",
      "cursor=not_valid!",
      "limt=1",
      "limit=1&limit=2",
    ]) {
      const response = await call(`/api/audit/export?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.data.details.code).toBe("MEMENTOS_AUDIT_CONTRACT");
    }
  });

  test("stats are one versioned snapshot whose operation counts sum to total", async () => {
    seed();
    const response = await call("/api/audit/stats");
    expect(response.status).toBe(200);
    expect(response.data.contract).toBe(AUDIT_STATS_CONTRACT);
    expect(Object.values(response.data.by_operation).reduce((a: number, b: any) => a + Number(b), 0)).toBe(response.data.total_entries);
    expect(response.data.recent_24h).toBeLessThanOrEqual(response.data.total_entries);
    expect((await call("/api/audit/stats?extra=1")).status).toBe(400);
  });

  test("OpenAPI exposes typed audit operations and schemas", () => {
    const doc = buildOpenApiDocument("test") as any;
    expect(doc.paths["/v1/memories/{id}/audit-trail"].get.operationId).toBe("getMemoryAuditTrail");
    expect(doc.paths["/v1/audit/export"].get.operationId).toBe("exportAuditLog");
    expect(doc.paths["/v1/audit/stats"].get.operationId).toBe("getAuditStats");
    expect(doc.paths["/v1/audit/export"].get.responses["200"].content["application/json"].schema)
      .toEqual({ $ref: "#/components/schemas/MementosAuditExportPage" });
    expect(doc.components.schemas.MementosAuditEntry.additionalProperties).toBe(false);
  });

  test("empty filters return a truthful empty contract rather than guessed defaults", async () => {
    const response = await call("/api/memories/missing/audit-trail");
    expect(response.data).toMatchObject({ contract: AUDIT_TRAIL_CONTRACT, entries: [], count: 0, total: 0, consumed: 0, has_more: false, complete: true });
    expect(response.data.filters.memory_id).toBe("missing");
    const exported = await call("/api/audit/export?operation=restore");
    expect(exported.data.contract).toBe(AUDIT_EXPORT_CONTRACT);
    expect(exported.data.entries).toEqual([]);
  });
});
