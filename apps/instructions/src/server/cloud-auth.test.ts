import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { Hono } from "hono";
import {
  closeCloud,
  getApiKeyStore,
  getCloudVerifier,
  getHonoAuthMiddleware,
} from "./cloud.js";

const FIXTURE_SIGNING_MATERIAL = Buffer.alloc(32, 7);

describe("cloud profile API-key authentication", () => {
  const previousEnv = {
    databaseUrl: process.env["HASNA_INSTRUCTIONS_DATABASE_URL"],
    signingKey: process.env["HASNA_INSTRUCTIONS_API_SIGNING_KEY"],
  };

  beforeAll(async () => {
    await closeCloud();
    process.env["HASNA_INSTRUCTIONS_DATABASE_URL"] = "postgresql://127.0.0.1:1/instructions_auth_test";
    process.env["HASNA_INSTRUCTIONS_API_SIGNING_KEY"] = FIXTURE_SIGNING_MATERIAL.toString("hex");
  });

  afterAll(async () => {
    await closeCloud();
    if (previousEnv.databaseUrl === undefined) delete process.env["HASNA_INSTRUCTIONS_DATABASE_URL"];
    else process.env["HASNA_INSTRUCTIONS_DATABASE_URL"] = previousEnv.databaseUrl;
    if (previousEnv.signingKey === undefined) delete process.env["HASNA_INSTRUCTIONS_API_SIGNING_KEY"];
    else process.env["HASNA_INSTRUCTIONS_API_SIGNING_KEY"] = previousEnv.signingKey;
  });

  test("profile list and show permit a registered active key and reject missing, invalid, revoked, and unregistered keys", async () => {
    const active = mintApiKey({
      app: "instructions",
      scopes: ["instructions:read"],
      signingSecret: FIXTURE_SIGNING_MATERIAL.toString("hex"),
      kid: "active-test-key",
      nowMs: Date.UTC(2026, 0, 1),
      ttlSeconds: null,
    });
    const revoked = mintApiKey({
      app: "instructions",
      scopes: ["instructions:read"],
      signingSecret: FIXTURE_SIGNING_MATERIAL.toString("hex"),
      kid: "revoked-test-key",
      nowMs: Date.UTC(2026, 0, 1),
      ttlSeconds: null,
    });
    const unregistered = mintApiKey({
      app: "instructions",
      scopes: ["instructions:read"],
      signingSecret: FIXTURE_SIGNING_MATERIAL.toString("hex"),
      kid: "unregistered-test-key",
      nowMs: Date.UTC(2026, 0, 1),
      ttlSeconds: null,
    });

    const keyStore = getApiKeyStore();
    Object.defineProperty(keyStore, "keyStatus", {
      configurable: true,
      value: async (kid: string) => {
        if (kid === active.kid) return "active";
        if (kid === revoked.kid) return "revoked";
        return "unknown";
      },
    });

    const app = new Hono();
    app.use("/v1/*", getHonoAuthMiddleware(["instructions:read"]));
    app.get("/v1/profiles", (context) => context.json({ profiles: [] }));
    app.get("/v1/profiles/:id", (context) => context.json({ profile: { id: context.req.param("id") } }));

    const denied: Array<{ label: string; token?: string }> = [
      { label: "missing" },
      { label: "invalid", token: "not-an-api-key" },
      { label: "revoked", token: revoked.token },
      { label: "unregistered", token: unregistered.token },
    ];
    const verifier = getCloudVerifier();
    expect((await verifier.authenticate({ "x-api-key": active.token }, { requiredScopes: ["instructions:read"] })).ok).toBe(true);
    for (const candidate of denied) {
      const headers = candidate.token ? { "x-api-key": candidate.token } : {};
      expect(
        (await verifier.authenticate(headers, { requiredScopes: ["instructions:read"] })).status,
        `${candidate.label} key through getCloudVerifier`,
      ).toBe(401);
    }

    const paths = ["/v1/profiles", "/v1/profiles/profile-1"];
    for (const path of paths) {
      expect((await app.request(path, { headers: { "x-api-key": active.token } })).status).toBe(200);

      for (const candidate of denied) {
        const headers = candidate.token ? { "x-api-key": candidate.token } : undefined;
        expect((await app.request(path, { headers })).status, `${candidate.label} key at ${path}`).toBe(401);
      }
    }
  });
});
