process.env["MEMENTOS_DB_PATH"] = ":memory:";
process.env["HOME"] = mkdtempSync(join(tmpdir(), "mementos-machine-route-home-"));
process.env["HASNA_STATION"] = "mementos-machine-route-test";

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, resetDatabase } from "../db/database.js";
import {
  MACHINE_LIST_CONTRACT,
  MACHINE_MUTATION_CONTRACT,
  MACHINE_REGISTRATION_CONTRACT,
} from "../db/machines.js";
import { buildOpenApiDocument } from "./openapi.js";
import { matchRoute } from "./router.js";
import "./routes/machines.js";

beforeEach(() => resetDatabase());

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const match = matchRoute(method, path.split("?")[0]!);
  expect(match).not.toBeNull();
  const request = new Request(`http://mementos.test${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  const response = await match!.handler(request, new URL(request.url), match!.params);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

function machine(response: { data: Record<string, unknown> }): Record<string, unknown> {
  return response.data["machine"] as Record<string, unknown>;
}

describe("hosted machine registry routes", () => {
  test("registration is idempotent by normalized hostname and preserves the stable id/name", async () => {
    const first = await call("POST", "/api/machines", { name: "Apple One", hostname: "APPLE01.local", platform: "Darwin" });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({
      contract: MACHINE_REGISTRATION_CONTRACT,
      created: true,
      identity: { idempotency_key: "normalized_hostname" },
    });
    expect(machine(first)).toMatchObject({ name: "Apple One", hostname: "apple01.local", platform: "darwin", is_primary: false });

    const again = await call("POST", "/api/machines", { name: "takeover-name", hostname: " APPLE01.LOCAL. ", platform: "linux" });
    expect(again.status).toBe(200);
    expect(again.data["created"]).toBe(false);
    expect(machine(again)["id"]).toBe(machine(first)["id"]);
    expect(machine(again)["name"]).toBe("Apple One");
    expect(machine(again)["platform"]).toBe("linux");

    const list = await call("GET", "/api/machines");
    expect(list.data).toMatchObject({ contract: MACHINE_LIST_CONTRACT, count: 1, complete: true });
  });

  test("registration refuses malformed identity and name conflicts", async () => {
    expect((await call("POST", "/api/machines", { platform: "darwin" })).status).toBe(400);
    expect((await call("POST", "/api/machines", { hostname: "apple01" })).status).toBe(400);
    expect((await call("POST", "/api/machines", { hostname: "bad host", platform: "linux" })).status).toBe(400);
    expect((await call("POST", "/api/machines", { hostname: "alpha", platform: "linux", name: 1 })).status).toBe(400);

    await call("POST", "/api/machines", { hostname: "alpha", platform: "linux", name: "shared" });
    const clash = await call("POST", "/api/machines", { hostname: "beta", platform: "linux", name: "shared" });
    expect(clash.status).toBe(409);
    expect(clash.data["details"]).toMatchObject({ code: "MACHINE_NAME_CONFLICT" });
  });

  test("stable-id reads and mutations refuse display-name addressing", async () => {
    const created = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux", name: "display" });
    const id = String(machine(created)["id"]);

    const byId = await call("GET", `/api/machines/${id}`);
    expect(byId.status).toBe(200);
    expect(byId.data["contract"]).toBe(MACHINE_MUTATION_CONTRACT);
    expect(machine(byId)["id"]).toBe(id);
    expect((await call("GET", "/api/machines/display")).status).toBe(404);
    expect((await call("PATCH", "/api/machines/display", { name: "nope" })).status).toBe(404);

    const renamed = await call("PATCH", `/api/machines/${id}`, { name: "renamed" });
    expect(machine(renamed)["name"]).toBe("renamed");
    expect(machine(renamed)["id"]).toBe(id);
  });

  test("the database enforces unique hostnames independently of application code", () => {
    const db = getDatabase();
    db.run("INSERT INTO machines (id, name, hostname, platform) VALUES (?, ?, ?, ?)", "one", "one", "same-host", "linux");
    expect(() => db.run("INSERT INTO machines (id, name, hostname, platform) VALUES (?, ?, ?, ?)", "two", "two", "same-host", "linux")).toThrow();
  });

  test("primary transitions remain singular and primary deletion is refused", async () => {
    const first = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    const second = await call("POST", "/api/machines", { hostname: "beta", platform: "linux" });
    const firstId = String(machine(first)["id"]);
    const secondId = String(machine(second)["id"]);

    expect(machine(await call("POST", `/api/machines/${firstId}/primary`))["is_primary"]).toBe(true);
    expect(machine(await call("POST", `/api/machines/${secondId}/primary`))["is_primary"]).toBe(true);
    const rows = (await call("GET", "/api/machines")).data["machines"] as Record<string, unknown>[];
    expect(rows.filter((row) => row["is_primary"]).map((row) => row["id"])).toEqual([secondId]);
    expect((await call("DELETE", `/api/machines/${secondId}`)).status).toBe(409);

    const deleted = await call("DELETE", `/api/machines/${firstId}`);
    expect(deleted.data).toEqual({ contract: MACHINE_MUTATION_CONTRACT, deleted: true, id: firstId });
  });

  test("touch returns the exact stable machine and refreshes last_seen_at", async () => {
    const created = await call("POST", "/api/machines", { hostname: "alpha", platform: "linux" });
    const id = String(machine(created)["id"]);
    const before = String(machine(created)["last_seen_at"]);
    const touched = await call("POST", `/api/machines/${id}/touch`);
    expect(touched.status).toBe(200);
    expect(touched.data).toMatchObject({ contract: "mementos.machine-touch.v1", touched: true, id });
    expect(touched.data["touched_at"]).toBe(machine(touched)["last_seen_at"]);
    expect(machine(touched)["id"]).toBe(id);
    expect(String(machine(touched)["last_seen_at"]) >= before).toBe(true);
    expect((await call("POST", "/api/machines/missing/touch")).status).toBe(404);
  });

  test("OpenAPI describes stable identity, strict receipts, and registration inputs", () => {
    const doc = buildOpenApiDocument("test") as {
      paths: Record<string, Record<string, any>>;
      components: { schemas: Record<string, any> };
    };
    expect(doc.paths["/v1/machines"]?.post?.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/MementosMachineRegistrationInput",
    });
    expect(doc.paths["/v1/machines"]?.post?.responses?.["201"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/MementosMachineRegistration",
    });
    expect(doc.paths["/v1/machines/{id}"]?.patch?.operationId).toBe("renameMachine");
    expect(doc.paths["/v1/machines/{id}"]?.patch?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/MementosMachineMutation",
    });
    expect(doc.paths["/v1/machines/{id}/touch"]?.post?.operationId).toBe("touchMachine");
    expect(doc.paths["/v1/machines/{id}/touch"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/MementosMachineTouchReceipt",
    });
    expect([
      doc.paths["/v1/machines"]?.get?.operationId,
      doc.paths["/v1/machines"]?.post?.operationId,
      doc.paths["/v1/machines/{id}"]?.get?.operationId,
      doc.paths["/v1/machines/{id}"]?.patch?.operationId,
      doc.paths["/v1/machines/{id}/primary"]?.post?.operationId,
      doc.paths["/v1/machines/{id}/touch"]?.post?.operationId,
      doc.paths["/v1/machines/{id}"]?.delete?.operationId,
    ]).toEqual([
      "listMachines",
      "registerMachine",
      "getMachine",
      "renameMachine",
      "setPrimaryMachine",
      "touchMachine",
      "deleteMachine",
    ]);
    expect(doc.components.schemas["MementosMachine"]?.properties?.hostname?.description).toContain("not an authorization boundary");
  });
});
