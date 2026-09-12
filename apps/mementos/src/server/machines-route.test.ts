process.env["MEMENTOS_DB_PATH"] = ":memory:";
// Isolate HOME and the station identity (W0 rule, 2026-09-11): nothing in this
// suite may resolve the operator's real station credential or write into
// ~/.hasna/mementos. The store is in-memory, so a stray write would be a bug
// this makes visible rather than silent.
process.env["HOME"] = mkdtempSync(join(tmpdir(), "mementos-route-test-home-"));
process.env["HASNA_STATION"] = "no-such-station";

// Server side of the machines port: the new /api/machines family, exercised
// through the real router against a real store. The matching client test is
// src/db/port-to-api-machines.test.ts.
//
// The registration route is the interesting one: the calling machine's
// identity (hostname, platform) CANNOT be observed server-side — inside the
// container `hostname()` is the task id — so the route takes them from the
// body and refuses a request that omits them rather than registering the
// server as the user's machine.

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDatabase } from "../db/database.js";
import { matchRoute } from "./router.js";
import { buildOpenApiDocument } from "./openapi.js";
import "./routes/machines.js";

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

describe("machines routes", () => {
  test("POST /api/machines registers the CALLING machine and is idempotent by hostname", async () => {
    const first = await call("POST", "/api/machines", {
      name: "apple01",
      hostname: "apple01",
      platform: "darwin",
    });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ name: "apple01", hostname: "apple01", platform: "darwin", is_primary: false });

    const again = await call("POST", "/api/machines", { hostname: "apple01", platform: "darwin" });
    expect(again.status).toBe(201);
    expect(again.data["id"]).toBe(first.data["id"]);

    const list = await call("GET", "/api/machines");
    expect(list.data["count"]).toBe(1);
  });

  test("POST /api/machines refuses a body without the caller's identity (400, nothing written)", async () => {
    const noHost = await call("POST", "/api/machines", { name: "apple01", platform: "darwin" });
    expect(noHost.status).toBe(400);
    expect(String(noHost.data["error"])).toContain("hostname is required");

    const noPlatform = await call("POST", "/api/machines", { hostname: "apple01" });
    expect(noPlatform.status).toBe(400);

    const list = await call("GET", "/api/machines");
    expect(list.data["count"]).toBe(0);
  });

  test("GET /api/machines/:id resolves by id or by name, 404 otherwise", async () => {
    const created = await call("POST", "/api/machines", { hostname: "linux01", platform: "linux" });
    const byId = await call("GET", `/api/machines/${created.data["id"]}`);
    expect(byId.status).toBe(200);
    const byName = await call("GET", "/api/machines/linux01");
    expect(byName.data["id"]).toBe(created.data["id"]);
    const missing = await call("GET", "/api/machines/nope");
    expect(missing.status).toBe(404);
  });

  test("PATCH /api/machines/:id renames; a taken name is a 409, not a silent no-op", async () => {
    const a = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    await call("POST", "/api/machines", { hostname: "beta", platform: "linux" });

    const renamed = await call("PATCH", `/api/machines/${a.data["id"]}`, { name: "gamma" });
    expect(renamed.status).toBe(200);
    expect(renamed.data["name"]).toBe("gamma");

    const clash = await call("PATCH", `/api/machines/${a.data["id"]}`, { name: "beta" });
    expect(clash.status).toBe(409);

    const blank = await call("PATCH", `/api/machines/${a.data["id"]}`, { name: "  " });
    expect(blank.status).toBe(400);
  });

  test("POST /api/machines/:id/primary moves the single primary flag", async () => {
    const a = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    const b = await call("POST", "/api/machines", { hostname: "beta", platform: "linux" });

    expect((await call("POST", `/api/machines/${a.data["id"]}/primary`)).data["is_primary"]).toBe(true);
    expect((await call("POST", `/api/machines/${b.data["id"]}/primary`)).data["is_primary"]).toBe(true);

    const list = (await call("GET", "/api/machines")).data["machines"] as Record<string, unknown>[];
    expect(list.filter((m) => m["is_primary"]).map((m) => m["id"])).toEqual([b.data["id"]]);
    // and the primary sorts first
    expect(list[0]!["id"]).toBe(b.data["id"]);
  });

  test("DELETE /api/machines/:id removes a machine and refuses the primary (409)", async () => {
    const a = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    const b = await call("POST", "/api/machines", { hostname: "beta", platform: "linux" });
    await call("POST", `/api/machines/${a.data["id"]}/primary`);

    const refused = await call("DELETE", `/api/machines/${a.data["id"]}`);
    expect(refused.status).toBe(409);
    expect(String(refused.data["error"])).toContain("Primary machine cannot be deleted");

    const deleted = await call("DELETE", `/api/machines/${b.data["id"]}`);
    expect(deleted.status).toBe(200);
    expect((await call("GET", "/api/machines")).data["count"]).toBe(1);
  });

  test("POST /api/machines/:id/touch refreshes last_seen_at", async () => {
    const a = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    const before = (await call("GET", `/api/machines/${a.data["id"]}`)).data["last_seen_at"];
    const touched = await call("POST", `/api/machines/${a.data["id"]}/touch`);
    expect(touched.status).toBe(200);
    expect(touched.data["touched"]).toBe(true);
    const after = (await call("GET", `/api/machines/${a.data["id"]}`)).data["last_seen_at"];
    expect(String(after) >= String(before)).toBe(true);
    expect((await call("POST", "/api/machines/nope/touch")).status).toBe(404);
  });

  test("the machines family appears in the generated OpenAPI document", () => {
    const doc = buildOpenApiDocument("test") as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/machines",
        "/v1/machines/{id}",
        "/v1/machines/{id}/primary",
        "/v1/machines/{id}/touch",
      ]),
    );
    expect(doc.paths["/v1/machines"]!["post"]).toBeDefined();
    expect(doc.paths["/v1/machines"]!["get"]).toBeDefined();
    expect(doc.paths["/v1/machines/{id}"]!["patch"]).toBeDefined();
    expect(doc.paths["/v1/machines/{id}"]!["delete"]).toBeDefined();
  });
});
