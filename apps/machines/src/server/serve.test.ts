import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createHandler } from "./serve.js";
import type { MachineRegistry } from "./registry.js";

const SIGNING_SECRET = "test-signing-secret-please-do-not-use-in-prod";

function verifier() {
  return verifyApiKey({ app: "machines", signingSecret: SIGNING_SECRET, isRevoked: () => false });
}

function keyFor(scopes: string[]): string {
  return mintApiKey({ app: "machines", scopes, signingSecret: SIGNING_SECRET }).token;
}

/** Minimal in-memory registry stub with the surface createHandler touches. */
function stubRegistry() {
  const machines = new Map<string, Record<string, unknown>>();
  const reg = {
    async list() {
      return [...machines.values()];
    },
    async get(id: string) {
      return machines.get(id) ?? null;
    },
    async upsert(input: { id: string }) {
      const rec = { ...input, status: "unknown", labels: {}, metadata: {}, createdAt: "", updatedAt: "" };
      machines.set(input.id, rec);
      return rec;
    },
    async update(id: string, patch: Record<string, unknown>) {
      const existing = machines.get(id);
      if (!existing) return null;
      const merged = { ...existing, ...patch };
      machines.set(id, merged);
      return merged;
    },
    async remove(id: string) {
      return machines.delete(id);
    },
    async listHeartbeats() {
      return [];
    },
  };
  return reg as unknown as MachineRegistry;
}

function handler(reg = stubRegistry()) {
  return createHandler({
    registry: () => reg,
    verifier: verifier(),
    ensureAuthSchema: async () => {},
  });
}

describe("machines-serve handler", () => {
  test("GET /health is unauthenticated and returns status/version/mode", async () => {
    const res = await handler()(new Request("http://x/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect("mode" in body).toBe(true);
  });

  test("GET /version returns version payload without auth", async () => {
    const res = await handler()(new Request("http://x/version"));
    expect(res.status).toBe(200);
  });

  test("GET /openapi.json exposes the versioned paths", async () => {
    const res = await handler()(new Request("http://x/openapi.json"));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths["/v1/machines"]).toBeDefined();
    expect(doc.paths["/v1/machines/{id}"]).toBeDefined();
  });

  test("unauthenticated /v1 request is rejected with 401", async () => {
    const res = await handler()(new Request("http://x/v1/machines"));
    expect(res.status).toBe(401);
  });

  test("a bad token is rejected with 401", async () => {
    const res = await handler()(new Request("http://x/v1/machines", { headers: { "x-api-key": "hasna_machines_garbage" } }));
    expect(res.status).toBe(401);
  });

  test("read-scoped key can list but not write (403 on write)", async () => {
    const h = handler();
    const readKey = keyFor(["machines:read"]);
    const list = await h(new Request("http://x/v1/machines", { headers: { "x-api-key": readKey } }));
    expect(list.status).toBe(200);

    const write = await h(
      new Request("http://x/v1/machines", {
        method: "POST",
        headers: { "x-api-key": readKey, "content-type": "application/json" },
        body: JSON.stringify({ id: "m1" }),
      }),
    );
    expect(write.status).toBe(403);
  });

  test("write-scoped key completes a full CRUD roundtrip", async () => {
    const h = handler();
    const key = keyFor(["machines:read", "machines:write"]);
    const auth = { "x-api-key": key, "content-type": "application/json" };

    const created = await h(new Request("http://x/v1/machines", { method: "POST", headers: auth, body: JSON.stringify({ id: "spark01" }) }));
    expect(created.status).toBe(200);

    const got = await h(new Request("http://x/v1/machines/spark01", { headers: auth }));
    expect(got.status).toBe(200);

    const patched = await h(new Request("http://x/v1/machines/spark01", { method: "PATCH", headers: auth, body: JSON.stringify({ status: "online" }) }));
    expect(patched.status).toBe(200);

    const deleted = await h(new Request("http://x/v1/machines/spark01", { method: "DELETE", headers: auth }));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).deleted).toBe(true);

    const missing = await h(new Request("http://x/v1/machines/spark01", { headers: auth }));
    expect(missing.status).toBe(404);
  });

  test("Bearer scheme is accepted", async () => {
    const key = keyFor(["machines:read"]);
    const res = await handler()(new Request("http://x/v1/heartbeats", { headers: { authorization: `Bearer ${key}` } }));
    expect(res.status).toBe(200);
  });
});
