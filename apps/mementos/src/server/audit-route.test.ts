process.env["MEMENTOS_DB_PATH"] = ":memory:";
// Isolate HOME and the station identity (W0 rule, 2026-09-11): nothing in this
// suite may resolve the operator's real station credential or write into
// ~/.hasna/mementos. The store is in-memory, so a stray write would be a bug
// this makes visible rather than silent.
process.env["HOME"] = mkdtempSync(join(tmpdir(), "mementos-route-test-home-"));
process.env["HASNA_STATION"] = "no-such-station";

// Server side of the audit-log port: the new /api/audit family and
// /api/memories/:id/audit-trail, exercised through the real router against a
// real store. The client half is src/db/port-to-api-audit.test.ts.
//
// The audit rows here are produced by real memory writes, not hand-inserted:
// the append-only log is populated by the same triggers/writes the product
// uses, so a route that read the wrong table or the wrong column would fail.

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDatabase } from "../db/database.js";
import { createMemory, updateMemory } from "../db/memories.js";
import { matchRoute } from "./router.js";
import { buildOpenApiDocument } from "./openapi.js";
import "./routes/audit.js";
import "./routes/memories.js";

beforeEach(() => {
  resetDatabase();
});

async function call(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const match = matchRoute("GET", path.split("?")[0]!);
  expect(match).not.toBeNull();
  const request = new Request(`http://mementos.test${path}`);
  const response = await match!.handler(request, new URL(request.url), match!.params);
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function seed(): string {
  const memory = createMemory({ key: "audited-key", value: "v1", category: "fact" });
  updateMemory(memory.id, { value: "v2", version: memory.version });
  return memory.id;
}

describe("audit log routes", () => {
  test("GET /api/memories/:id/audit-trail returns that memory's entries, newest first", async () => {
    const id = seed();
    const res = await call(`/api/memories/${id}/audit-trail`);
    expect(res.status).toBe(200);
    const entries = res.data["entries"] as Record<string, unknown>[];
    expect(entries.length).toBeGreaterThan(0);
    expect(res.data["count"]).toBe(entries.length);
    for (const e of entries) expect(e["memory_id"]).toBe(id);
    expect(entries.map((e) => e["operation"])).toContain("update");
  });

  test("audit-trail honours limit and refuses a non-positive one instead of guessing", async () => {
    const id = seed();
    const limited = await call(`/api/memories/${id}/audit-trail?limit=1`);
    expect((limited.data["entries"] as unknown[]).length).toBe(1);

    const bad = await call(`/api/memories/${id}/audit-trail?limit=0`);
    expect(bad.status).toBe(400);
    const alsoBad = await call(`/api/memories/${id}/audit-trail?limit=abc`);
    expect(alsoBad.status).toBe(400);
  });

  test("an unknown memory id is an empty trail, not an error (the log is append-only)", async () => {
    seed();
    const res = await call("/api/memories/no-such-memory/audit-trail");
    expect(res.status).toBe(200);
    expect(res.data["entries"]).toEqual([]);
    expect(res.data["count"]).toBe(0);
  });

  test("GET /api/audit/export exports the log and filters by operation", async () => {
    seed();
    const all = await call("/api/audit/export");
    expect(all.status).toBe(200);
    const total = (all.data["entries"] as unknown[]).length;
    expect(total).toBeGreaterThan(0);

    const updates = await call("/api/audit/export?operation=update");
    const ops = (updates.data["entries"] as Record<string, unknown>[]).map((e) => e["operation"]);
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops)).toEqual(new Set(["update"]));

    const none = await call("/api/audit/export?operation=delete");
    expect(none.data["entries"]).toEqual([]);
  });

  test("GET /api/audit/export filters by a time window", async () => {
    seed();
    const future = await call("/api/audit/export?since=2099-01-01T00:00:00.000Z");
    expect(future.data["entries"]).toEqual([]);
    const past = await call("/api/audit/export?since=2000-01-01T00:00:00.000Z");
    expect((past.data["entries"] as unknown[]).length).toBeGreaterThan(0);
  });

  test("GET /api/audit/stats counts the whole log by operation", async () => {
    seed();
    const res = await call("/api/audit/stats");
    expect(res.status).toBe(200);
    const byOperation = res.data["by_operation"] as Record<string, number>;
    expect(res.data["total_entries"]).toBeGreaterThan(0);
    expect(Object.values(byOperation).reduce((a, b) => a + b, 0)).toBe(res.data["total_entries"]);
    expect(res.data["recent_24h"]).toBe(res.data["total_entries"]);
  });

  test("the audit family appears in the generated OpenAPI document", () => {
    const doc = buildOpenApiDocument("test") as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/memories/{id}/audit-trail",
        "/v1/audit/export",
        "/v1/audit/stats",
      ]),
    );
  });

  test("the new trail route does not shadow GET /api/memories/audit (the low-trust list)", () => {
    // matchRoute exposes {handler, params}; the params are the tell. The
    // literal low-trust route binds nothing, the trail route binds :id.
    const lowTrust = matchRoute("GET", "/api/memories/audit");
    expect(lowTrust).not.toBeNull();
    expect(lowTrust!.params).toEqual({});

    const trail = matchRoute("GET", "/api/memories/abc/audit-trail");
    expect(trail).not.toBeNull();
    expect(trail!.params).toEqual({ id: "abc" });
  });
});
