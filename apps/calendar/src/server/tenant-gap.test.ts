import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleV1Request } from "./v1.js";

// Former exposure characterization now pins verified tenant propagation.
// Actual SQL isolation is tested against PostgreSQL in tenant-boundary.pg.test.ts.
test("the router resolves only the authenticated tenant, ignoring request tenant overrides", async () => {
  const signingSecret = "calendar-synthetic-tenant-audit";
  const key = mintApiKey({ app: "calendar", scopes: ["calendar:*"], signingSecret, tid: "tenant-a" });
  const verifier = verifyApiKey({ app: "calendar", signingSecret, requireTenant: true, keyStatus: async () => "active" });
  const tenants: string[] = [];
  for (const method of ["GET", "DELETE"]) {
    const request = new Request("https://calendar.example.test/v1/orgs/org-b?tenant_id=tenant-b", {
      method, headers: { "x-api-key": key.token, "x-tenant-id": "tenant-b" },
    });
    const response = await handleV1Request(request, new URL(request.url), {
      getCloudVerifier: () => verifier,
      getCloudStore: async (tid) => { tenants.push(tid); return null; },
    });
    expect(response?.status).toBe(403);
  }
  expect(tenants).toEqual(["tenant-a", "tenant-a"]);
});

test("tenant lookup failure is closed and sanitized", async () => {
  const request = new Request("https://calendar.example.test/v1/orgs");
  const response = await handleV1Request(request, new URL(request.url), {
    getCloudVerifier: () => ({ authenticate: async () => ({ ok: true, principal: { tid: "tenant-a" } }) }) as never,
    getCloudStore: async () => { throw new Error("private database details"); },
  });
  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({ error: "service unavailable" });
});
