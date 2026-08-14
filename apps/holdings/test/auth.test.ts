import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createApp, authRequiredFor, rateLimitKey, trustProxy } from "../src/server/app.js";
import type { Context } from "hono";
import type { AppEnv } from "../src/server/hono-env.js";
import { authenticateBearer } from "../src/server/auth.js";
import { makeDb } from "./helpers/harness.js";
import { seedEntity } from "../src/services/entities.js";
import { createAsset } from "../src/services/assets.js";
import { systemContext } from "../src/services/runtime.js";
import type { Database } from "bun:sqlite";

const CRED_ENV = "HASNA_HOLDINGS_API_CREDENTIALS";

function setup(): { db: Database; entA: string; entB: string; assetA: string; assetB: string } {
  const db = makeDb();
  const ctx = systemContext(db);
  const a = seedEntity(ctx, { name: "Entity A" });
  const b = seedEntity(ctx, { name: "Entity B" });
  const assetA = createAsset(ctx, { entity_id: a.entity_id, kind: "trademark", name: "A-Mark" });
  const assetB = createAsset(ctx, { entity_id: b.entity_id, kind: "trademark", name: "B-Mark" });
  return { db, entA: a.entity_id, entB: b.entity_id, assetA: assetA.id, assetB: assetB.id };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[CRED_ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[CRED_ENV];
  else process.env[CRED_ENV] = saved;
});

describe("bearer auth + entity scoping", () => {
  it("authenticates a valid token and rejects a wrong one (timing-safe compare)", () => {
    process.env[CRED_ENV] = JSON.stringify([{ id: "c1", token: "secret-token-1", roles: ["owner"] }]);
    expect(authenticateBearer("secret-token-1")?.credential_id).toBe("c1");
    expect(authenticateBearer("secret-token-2")).toBeNull();
    expect(authenticateBearer("")).toBeNull();
  });

  it("requires auth on any non-loopback bind or cloud mode (fail-closed policy)", () => {
    expect(authRequiredFor("127.0.0.1", "local")).toBe(false);
    expect(authRequiredFor("0.0.0.0", "local")).toBe(true);
    expect(authRequiredFor("127.0.0.1", "cloud")).toBe(true);
  });

  it("denies unauthenticated /v1 when credentials are configured", async () => {
    const { db } = setup();
    process.env[CRED_ENV] = JSON.stringify([{ id: "c1", token: "tok-owner", roles: ["owner"] }]);
    const app = createApp({ db, bindHost: "127.0.0.1", mode: "local" });
    const res = await app.request("/v1/entities");
    expect(res.status).toBe(401);
  });

  it("enforces scope: a viewer cannot create assets", async () => {
    const { db, entA } = setup();
    process.env[CRED_ENV] = JSON.stringify([{ id: "viewer", token: "tok-viewer", roles: ["viewer"], entity_ids: [entA] }]);
    const app = createApp({ db, bindHost: "127.0.0.1", mode: "local" });
    const read = await app.request("/v1/assets", { headers: { Authorization: "Bearer tok-viewer" } });
    expect(read.status).toBe(200);
    const write = await app.request("/v1/assets", {
      method: "POST",
      headers: { Authorization: "Bearer tok-viewer", "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entA, kind: "patent", name: "X" }),
    });
    expect(write.status).toBe(403);
    expect((await write.json()).code).toBe("PERMISSION_DENIED");
  });

  it("scopes reads to the principal's entities (cross-entity read denied)", async () => {
    const { db, entA, assetA, assetB } = setup();
    process.env[CRED_ENV] = JSON.stringify([{ id: "mgr", token: "tok-a", roles: ["holdings_manager"], entity_ids: [entA] }]);
    const app = createApp({ db, bindHost: "127.0.0.1", mode: "local" });

    const own = await app.request(`/v1/assets/${assetA}`, { headers: { Authorization: "Bearer tok-a" } });
    expect(own.status).toBe(200);

    const other = await app.request(`/v1/assets/${assetB}`, { headers: { Authorization: "Bearer tok-a" } });
    expect(other.status).toBe(403);

    const list = await app.request("/v1/assets", { headers: { Authorization: "Bearer tok-a" } });
    const rows = (await list.json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([assetA]);
  });

  it("rate limiter ignores client-controlled x-forwarded-for by default (no XFF-spoof bypass)", () => {
    delete process.env["HASNA_HOLDINGS_TRUST_PROXY"];
    delete process.env["HOLDINGS_TRUST_PROXY"];
    expect(trustProxy()).toBe(false);
    const ctx = (headers: Record<string, string>) =>
      ({ req: { header: (n: string) => headers[n.toLowerCase()] } }) as unknown as Context<AppEnv>;
    // A hostile client rotating XFF cannot mint distinct buckets: both collapse
    // to the same non-forgeable key (no socket peer in the in-process test client).
    const k1 = rateLimitKey(ctx({ "x-forwarded-for": "1.2.3.4" }));
    const k2 = rateLimitKey(ctx({ "x-forwarded-for": "9.9.9.9" }));
    expect(k1).toBe(k2);
    expect(k1).not.toContain("1.2.3.4");
  });

  it("rate limiter trusts x-forwarded-for only when the deployment opts in (behind a known proxy)", () => {
    process.env["HASNA_HOLDINGS_TRUST_PROXY"] = "true";
    try {
      expect(trustProxy()).toBe(true);
      const ctx = { req: { header: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? "1.2.3.4, 10.0.0.1" : undefined) } } as unknown as Context<AppEnv>;
      expect(rateLimitKey(ctx)).toBe("xff:1.2.3.4");
    } finally {
      delete process.env["HASNA_HOLDINGS_TRUST_PROXY"];
    }
  });

  it("honors expiry and revocation", () => {
    process.env[CRED_ENV] = JSON.stringify([
      { id: "exp", token: "tok-exp", roles: ["owner"], expires_at: "2000-01-01T00:00:00Z" },
      { id: "rev", token: "tok-rev", roles: ["owner"], revoked: true },
    ]);
    expect(authenticateBearer("tok-exp")).toBeNull();
    expect(authenticateBearer("tok-rev")).toBeNull();
  });
});
