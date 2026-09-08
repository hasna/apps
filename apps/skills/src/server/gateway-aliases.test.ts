import { expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { resolveStoreBackends, storeBackendNotices } from "./store-fixtures.js";
import { skillsApiRequestUrl } from "../lib/fleet-credentials.js";

const backends = await resolveStoreBackends();
for (const notice of storeBackendNotices()) console.log(`[gateway-aliases] ${notice}`);
for (const backend of backends) {
  test(`version aliases preserve real HTTP authentication, methods, body and tenant isolation (${backend.name})`, async () => {
    const fixture = await backend.create([
      { token: "fixture-org-a", principal: { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", email: "a@example.test", userId: "user_a", apiKeyId: "key_a" } },
      { token: "fixture-org-b", principal: { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", email: "b@example.test", userId: "user_b", apiKeyId: "key_b" } },
    ]);
    const handler = await createSkillsFetchHandler({ store: fixture.store, governanceStore: fixture.governanceStore, config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore } });
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    const call = async (path: string, token?: string, method = "GET", body?: unknown) => {
      const response = await fetch(new URL(path, server.url), { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error" });
      return { status: response.status, body: await response.json() };
    };
    try {
      for (const path of ["/health", "/v1/health"]) {
        expect(await call(path)).toMatchObject({ status: 200, body: { ok: true, service: "skills" } });
        expect(await call(path, undefined, "POST")).toMatchObject({ status: 404 });
      }
      for (const pair of [["/api/v1/pins", "/v1/pins"], ["/api/auth/whoami", "/v1/auth/whoami"]]) {
        for (const token of [undefined, "fixture-revoked", "fixture-org-a", "fixture-org-b"]) {
          const [legacy, versioned] = await Promise.all(pair.map(path => call(path, token)));
          expect(versioned).toEqual(legacy);
          expect(versioned.status).toBe(!token || token === "fixture-revoked" ? 401 : 200);
        }
      }
      expect(await call("/v1/pins/deploy-notes", "fixture-org-a", "PUT", { metadata: { marker: "org-a-private" } })).toMatchObject({ status: 200 });
      const a = await call("/api/v1/pins", "fixture-org-a");
      expect(a.body).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "deploy-notes", metadata: { marker: "org-a-private" } })]));
      expect(await call("/v1/pins", "fixture-org-a")).toEqual(a);
      expect(await call("/v1/pins", "fixture-org-b")).toEqual({ status: 200, body: [] });
      expect(await call("/v1/pins/deploy-notes", "fixture-org-b", "DELETE")).toEqual(await call("/api/v1/pins/deploy-notes", "fixture-org-b", "DELETE"));
      expect(await call("/v1/pins", "fixture-org-a")).toEqual(a);
      for (const [legacy, versioned] of [["/api/v1/unknown-resource", "/v1/unknown-resource"], ["/api/auth/whoami", "/v1/auth/whoami"]])
        expect(await call(versioned, "fixture-org-a", "POST", {})).toEqual(await call(legacy, "fixture-org-a", "POST", {}));
      const gatewayWhoami = new URL(skillsApiRequestUrl("https://api.hasna.com/skills", "/api/auth/whoami"));
      expect(await call(gatewayWhoami.pathname.slice("/skills".length), "fixture-org-a")).toEqual(await call("/api/auth/whoami", "fixture-org-a"));
      expect(await call("/v10/pins", "fixture-org-a")).toMatchObject({ status: 404 });
    } finally { server.stop(true); await fixture.close(); }
  });
}
