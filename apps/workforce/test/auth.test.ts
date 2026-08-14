import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildApp } from "../src/server/app.js";
import { authenticateApiRequest, configuredApiCredentials } from "../src/server/auth.js";
import { memberService } from "../src/services/index.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../src/services/authorization.js";
import { cleanupTestDatabase, testEntity, useTestDatabase } from "./helpers/database.js";

let dbPath: string;
let entityA: string;
let entityB: string;
let memberA: string;
let memberB: string;

function setCredentials(creds: unknown): void {
  process.env["HASNA_WORKFORCE_API_CREDENTIALS"] = JSON.stringify(creds);
}

beforeEach(() => {
  dbPath = useTestDatabase("auth");
  entityA = testEntity();
  entityB = testEntity();
  memberA = memberService.createMember({ kind: "human", name: "A", home_entity_id: entityA }, SYSTEM_AUTHORIZATION_CONTEXT).id;
  memberB = memberService.createMember({ kind: "human", name: "B", home_entity_id: entityB }, SYSTEM_AUTHORIZATION_CONTEXT).id;
});

afterEach(() => {
  delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
  cleanupTestDatabase(dbPath);
});

function req(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  return buildApp().request(path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

describe("serve auth", () => {
  it("rejects requests with no bearer token (deny-by-default)", async () => {
    setCredentials([{ id: "c1", token: "secret-a", roles: ["hr_manager"], org_ids: [entityA] }]);
    const res = await req("/v1/members");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("rejects an invalid token", async () => {
    setCredentials([{ id: "c1", token: "secret-a", roles: ["hr_manager"], org_ids: [entityA] }]);
    const res = await req("/v1/members", { token: "wrong-token" });
    expect(res.status).toBe(401);
  });

  it("enforces scope: an auditor (read+export) cannot write", async () => {
    setCredentials([{ id: "c1", token: "aud", roles: ["auditor"], org_ids: [entityA] }]);
    const read = await req(`/v1/members/${memberA}`, { token: "aud" });
    expect(read.status).toBe(200);
    const write = await req("/v1/members", { method: "POST", token: "aud", body: { kind: "human", name: "New", home_entity_id: entityA } });
    expect(write.status).toBe(403);
    expect((await write.json()).code).toBe("PERMISSION_DENIED");
  });

  it("enforces entity scoping: cross-entity read denied", async () => {
    setCredentials([{ id: "c1", token: "hrA", roles: ["hr_manager"], org_ids: [entityA] }]);
    const own = await req(`/v1/members/${memberA}`, { token: "hrA" });
    expect(own.status).toBe(200);
    const cross = await req(`/v1/members/${memberB}`, { token: "hrA" });
    expect(cross.status).toBe(403);
  });

  it("filters list results to the principal's entity set", async () => {
    setCredentials([{ id: "c1", token: "hrA", roles: ["hr_manager"], org_ids: [entityA] }]);
    const res = await req("/v1/members", { token: "hrA" });
    const rows = (await res.json()) as Array<{ home_entity_id: string }>;
    expect(rows.every((r) => r.home_entity_id === entityA)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("honors expiry and revocation", async () => {
    setCredentials([
      { id: "exp", token: "expired", roles: ["owner"], expires_at: "2000-01-01T00:00:00Z" },
      { id: "rev", token: "revoked", roles: ["owner"], revoked: true },
    ]);
    expect(authenticateApiRequest(new Request("http://x/", { headers: { Authorization: "Bearer expired" } }))).toBeNull();
    expect(authenticateApiRequest(new Request("http://x/", { headers: { Authorization: "Bearer revoked" } }))).toBeNull();
  });

  it("denies by default when a non-bypass principal has no entity scope", async () => {
    setCredentials([{ id: "c1", token: "noent", roles: ["hr_manager"] }]);
    const res = await req(`/v1/members/${memberA}`, { token: "noent" });
    expect(res.status).toBe(403);
  });

  it("parses only well-formed credentials", () => {
    setCredentials([{ id: "ok", token: "t" }, { id: "no-secret" }]);
    expect(configuredApiCredentials()).toHaveLength(1);
  });

  it("keeps system endpoints unauthenticated", async () => {
    setCredentials([{ id: "c1", token: "t", roles: ["owner"] }]);
    expect((await req("/health")).status).toBe(200);
    expect((await req("/version")).status).toBe(200);
  });
});
