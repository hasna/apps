process.env["MEMENTOS_DB_PATH"] = ":memory:";
// Isolate HOME and the station identity (W0 rule, 2026-09-11): nothing in this
// suite may resolve the operator's real station credential or write into
// ~/.hasna/mementos. The store is in-memory, so a stray write would be a bug
// this makes visible rather than silent.
process.env["HOME"] = mkdtempSync(join(tmpdir(), "mementos-route-test-home-"));
process.env["HASNA_STATION"] = "no-such-station";

// Server side of the ACL and ratings port, through the real router against a
// real store. Client half: src/db/port-to-api-acl-ratings.test.ts.
//
// The ACL check route matters more than a plain CRUD read: `checkPermission`
// treats "this agent has no rules" as FULL ACCESS. That default is only safe
// when the decision is taken where the whole rule set lives, so the decision
// itself is an endpoint rather than something a client re-derives.

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { matchRoute } from "./router.js";
import { buildOpenApiDocument } from "./openapi.js";
import "./routes/acl.js";
import "./routes/ratings.js";

beforeEach(() => {
  resetDatabase();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const match = matchRoute(method, path.split("?")[0]!);
  expect(match).not.toBeNull();
  const request = new Request(`http://mementos.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  const response = await match!.handler(request, new URL(request.url), match!.params);
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("ACL routes", () => {
  test("POST /api/acl sets a rule and upserts by agent + pattern", async () => {
    const first = await call("POST", "/api/acl", {
      agent_id: "agent-1",
      key_pattern: "architecture-*",
      permission: "read",
    });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ agent_id: "agent-1", key_pattern: "architecture-*", permission: "read" });

    await call("POST", "/api/acl", {
      agent_id: "agent-1",
      key_pattern: "architecture-*",
      permission: "admin",
    });
    const list = await call("GET", "/api/acl?agent_id=agent-1");
    expect(list.data["count"]).toBe(1);
    expect((list.data["acls"] as Record<string, unknown>[])[0]!["permission"]).toBe("admin");
  });

  test("POST /api/acl validates its inputs instead of writing a broken rule", async () => {
    expect((await call("POST", "/api/acl", { key_pattern: "a", permission: "read" })).status).toBe(400);
    expect((await call("POST", "/api/acl", { agent_id: "a", permission: "read" })).status).toBe(400);
    expect(
      (await call("POST", "/api/acl", { agent_id: "a", key_pattern: "b", permission: "superuser" })).status,
    ).toBe(400);
    expect((await call("GET", "/api/acl?agent_id=a")).data["count"]).toBe(0);
  });

  test("GET /api/acl requires agent_id rather than listing everyone's rules", async () => {
    expect((await call("GET", "/api/acl")).status).toBe(400);
  });

  test("GET /api/acl/check answers the authorization decision, including the glob and the deny-by-default", async () => {
    // No rules at all for this agent -> full access (documented default).
    expect((await call("GET", "/api/acl/check?agent_id=agent-2&key=anything")).data["allowed"]).toBe(true);

    await call("POST", "/api/acl", {
      agent_id: "agent-1",
      key_pattern: "architecture-*",
      permission: "read",
    });
    // Matching pattern, sufficient permission.
    expect(
      (await call("GET", "/api/acl/check?agent_id=agent-1&key=architecture-db&permission=read")).data["allowed"],
    ).toBe(true);
    // Matching pattern, INSUFFICIENT permission (read rule, write asked).
    expect(
      (await call("GET", "/api/acl/check?agent_id=agent-1&key=architecture-db&permission=write")).data["allowed"],
    ).toBe(false);
    // Agent has rules but none match -> deny.
    expect(
      (await call("GET", "/api/acl/check?agent_id=agent-1&key=secrets-prod&permission=read")).data["allowed"],
    ).toBe(false);
    // Bad inputs are refused, never answered with a default.
    expect((await call("GET", "/api/acl/check?key=k")).status).toBe(400);
    expect((await call("GET", "/api/acl/check?agent_id=a")).status).toBe(400);
    expect((await call("GET", "/api/acl/check?agent_id=a&key=k&permission=admin")).status).toBe(400);
  });

  test("DELETE /api/acl/:id removes a rule and 404s on an unknown one", async () => {
    const created = await call("POST", "/api/acl", {
      agent_id: "agent-1",
      key_pattern: "a-*",
      permission: "read",
    });
    const id = (await call("GET", "/api/acl?agent_id=agent-1")).data["acls"] as Record<string, unknown>[];
    expect(created.status).toBe(201);
    const deleted = await call("DELETE", `/api/acl/${id[0]!["id"]}`);
    expect(deleted.status).toBe(200);
    expect((await call("GET", "/api/acl?agent_id=agent-1")).data["count"]).toBe(0);
    expect((await call("DELETE", "/api/acl/no-such-acl")).status).toBe(404);
  });
});

describe("rating routes", () => {
  test("POST /api/memories/:id/ratings records feedback and returns the live summary", async () => {
    const memory = createMemory({ key: "rated", value: "v", category: "fact" });

    const up = await call("POST", `/api/memories/${memory.id}/ratings`, { useful: true, agent_id: "agent-1" });
    expect(up.status).toBe(201);
    expect((up.data["rating"] as Record<string, unknown>)["useful"]).toBe(true);
    expect((up.data["summary"] as Record<string, unknown>)["total"]).toBe(1);

    const down = await call("POST", `/api/memories/${memory.id}/ratings`, { useful: false, context: "stale" });
    const summary = down.data["summary"] as Record<string, unknown>;
    expect(summary["total"]).toBe(2);
    expect(summary["useful_count"]).toBe(1);
    expect(summary["not_useful_count"]).toBe(1);
    expect(summary["usefulness_ratio"]).toBe(0.5);
  });

  test("POST /api/memories/:id/ratings refuses a missing or non-boolean `useful`", async () => {
    const memory = createMemory({ key: "rated2", value: "v", category: "fact" });
    expect((await call("POST", `/api/memories/${memory.id}/ratings`, {})).status).toBe(400);
    expect((await call("POST", `/api/memories/${memory.id}/ratings`, { useful: "yes" })).status).toBe(400);
    expect((await call("GET", `/api/memories/${memory.id}/ratings`)).data["count"]).toBe(0);
  });

  test("GET /api/memories/:id/ratings lists the ratings with the summary; unrated is zeroed, not absent", async () => {
    const memory = createMemory({ key: "rated3", value: "v", category: "fact" });
    const empty = await call("GET", `/api/memories/${memory.id}/ratings`);
    expect(empty.status).toBe(200);
    expect(empty.data["ratings"]).toEqual([]);
    expect(empty.data["summary"]).toMatchObject({
      memory_id: memory.id,
      total: 0,
      useful_count: 0,
      not_useful_count: 0,
      usefulness_ratio: 0,
    });

    await call("POST", `/api/memories/${memory.id}/ratings`, { useful: true });
    const one = await call("GET", `/api/memories/${memory.id}/ratings`);
    expect(one.data["count"]).toBe(1);
  });

  test("both families appear in the generated OpenAPI document", () => {
    const doc = buildOpenApiDocument("test") as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/acl",
        "/v1/acl/check",
        "/v1/acl/{id}",
        "/v1/memories/{id}/ratings",
      ]),
    );
  });
});
