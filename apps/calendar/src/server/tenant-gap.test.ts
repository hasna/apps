import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { CalendarPgStore } from "./pg-store.js";
import { handleV1Request } from "./v1.js";

/** Adversarial characterization of a KNOWN UNFIXED authorization gap.
 * These assertions reproduce exposure; they are NOT a tenant-isolation gate.
 * Product decisions are required before changing global org/agent semantics.
 */
test("KNOWN TENANCY GAP: tenant-A credential reaches tenant-B list/detail/delete queries", async () => {
  const signingSecret = "calendar-synthetic-tenant-audit";
  const key = mintApiKey({ app: "calendar", scopes: ["calendar:read", "calendar:write"], signingSecret, tid: "tenant-a" });
  const verifier = verifyApiKey({ app: "calendar", signingSecret, keyStatus: async () => "active" });
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const store = new CalendarPgStore({ query: async (sql: string, params: readonly unknown[] = []) => {
    queries.push({ sql, params });
    return { rows: sql.startsWith("DELETE") ? [{ id: "org-b" }] : [{ id: "org-b", name: "Other tenant", slug: "org-b", metadata: {} }] };
  }, close: async () => {} } as never);
  const decision = await verifier.authenticate({ "x-api-key": key.token });
  expect(decision.ok).toBe(true);
  if (decision.ok) expect(decision.principal.tid).toBe("tenant-a");
  for (const [method, path] of [["GET", "/v1/orgs"], ["GET", "/v1/orgs/org-b"], ["DELETE", "/v1/orgs/org-b"]]) {
    const request = new Request("https://calendar.example.test" + path, { method, headers: { "x-api-key": key.token } });
    const response = await handleV1Request(request, new URL(request.url), { getCloudVerifier: () => verifier, getCloudStore: () => store });
    // Evidence of current unsafe behavior, not the desired acceptance result.
    expect(response?.status).toBe(200);
  }
  expect(queries).toHaveLength(3);
  expect(queries[0]!.sql).toBe("SELECT * FROM orgs ORDER BY name");
  expect(queries[1]!.params).toEqual(["org-b"]);
  expect(queries[2]!.params).toEqual(["org-b"]);
  expect(queries.every(q => !q.params.includes("tenant-a"))).toBe(true);
});

test("KNOWN TENANCY GAP: service verifier accepts an untenanted key", async () => {
  const signingSecret = "calendar-synthetic-untenanted-audit";
  const key = mintApiKey({ app: "calendar", scopes: ["calendar:read"], signingSecret });
  const verifier = verifyApiKey({ app: "calendar", signingSecret, keyStatus: async () => "active" });
  const decision = await verifier.authenticate({ "x-api-key": key.token }, { requiredScopes: ["calendar:read"] });
  expect(decision.ok).toBe(true);
  if (decision.ok) expect(decision.principal.tid).toBeNull();
});
