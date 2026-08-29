/**
 * Regression tests for the live pre-distribution verification gate
 * (O15-04800): a fleet API key that the live service refuses (revoked,
 * expired, unknown, insufficient scope) must NEVER be propagated to fleet
 * targets by distribute-cloud-keys.ts.
 *
 * Measured incident: the telephony fleet key was revoked on 2026-07-30
 * (leaked via env|grep, incident 607515) and rotated to a new kid, but
 * station01's ~/.hasna/fleet-env/telephony.env still held the revoked key, so
 * every /v1 business route answered 401 "API key has been revoked" and the
 * telephony live-gate business route + client use were blocked. The
 * distributor had no verification step, so a revoked key in ANY source (AWS
 * SM, a stale local vault capture) was pushed to fleet machines silently.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveProbePath,
  verifyKeyLive,
  verifyResolvedKeys,
  type AppSpec,
  type LiveVerifyResult,
} from "./distribute-cloud-keys";

function spec(app: string): AppSpec {
  const UP = app.toUpperCase();
  return {
    app,
    apiUrlEnv: `HASNA_${UP}_API_URL`,
    apiKeyEnv: `HASNA_${UP}_API_KEY`,
    apiUrl: `https://${app}.example`,
    apiKeySecretPath: `hasna/oss/${app}/api-key`,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Fake fetch keyed by (url, hasAuthorizationHeader). The telephony incident
 * shape is the "revoked" row: with a key the server answers 401 "API key has
 * been revoked."; without a key it answers 401 missing_token.
 */
function fakeFetch(
  routes: Record<
    string,
    {
      openapi?: { paths: Record<string, { get?: unknown }> };
      noKeyStatus: number;
      withKeyStatus: number;
      withKeyBody?: unknown;
    }
  >,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headerKeys = init?.headers ? Object.keys(init.headers as Record<string, string>) : [];
    const hasAuth = headerKeys.some((k) => k.toLowerCase() === "authorization");
    for (const [prefix, r] of Object.entries(routes)) {
      if (!url.startsWith(prefix)) continue;
      if (url.endsWith("/openapi.json")) {
        if (!r.openapi) return jsonResponse(404, { error: "not_found" });
        return jsonResponse(200, r.openapi);
      }
      return jsonResponse(hasAuth ? r.withKeyStatus : r.noKeyStatus, r.withKeyBody);
    }
    return jsonResponse(404, { error: "not_found" });
  }) as typeof fetch;
}

const TELEPHONY_OPENAPI = {
  openapi: "3.0.0",
  paths: {
    "/v1/agents": { get: { operationId: "listAgents" } },
    "/v1/contacts": { get: { operationId: "listContacts" } },
    "/v1/numbers": { get: { operationId: "listNumbers" } },
  },
};

describe("deriveProbePath", () => {
  test("picks the first /v1 path with a GET operation", () => {
    expect(deriveProbePath(TELEPHONY_OPENAPI)).toBe("/v1/agents");
  });

  test("returns null when no /v1 GET path exists", () => {
    expect(deriveProbePath({ openapi: "3.0.0", paths: { "/v2/things": { post: {} } } })).toBeNull();
  });
});

describe("verifyKeyLive", () => {
  test("REJECTS a revoked key (the O15-04800 regression): 401 with key, 401 without", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: TELEPHONY_OPENAPI,
        noKeyStatus: 401,
        withKeyStatus: 401,
        withKeyBody: { error: "unauthorized", message: "API key has been revoked." },
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_revoked-token", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("auth_refused");
    expect(r.status).toBe(401);
    expect(r.detail).toContain("revoked");
  });

  test("ACCEPTS an active key: 200 with key, 401 without (auth enforced)", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: TELEPHONY_OPENAPI,
        noKeyStatus: 401,
        withKeyStatus: 200,
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  test("ACCEPTS a valid key on an unknown route: 404 with key proves auth passed", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: TELEPHONY_OPENAPI,
        noKeyStatus: 401,
        withKeyStatus: 404,
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(true);
  });

  test("REJECTS when the probe route is NOT behind auth (no-key probe did not 401/403)", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: TELEPHONY_OPENAPI,
        noKeyStatus: 404, // route answers before auth -> cannot discriminate
        withKeyStatus: 404,
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("probe_not_authenticated");
  });

  test("REJECTS when the service is unhealthy (5xx)", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: TELEPHONY_OPENAPI,
        noKeyStatus: 503,
        withKeyStatus: 503,
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("service_unhealthy");
  });

  test("REJECTS on network failure (fetch throws)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("network");
  });

  test("REJECTS when the OpenAPI document cannot be fetched", async () => {
    const fetchImpl = fakeFetch({
      "https://telephony.example": {
        openapi: undefined, // openapi.json 404s
        noKeyStatus: 401,
        withKeyStatus: 200,
      },
    });
    const r = await verifyKeyLive(spec("telephony"), "hasna_telephony_active-token", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("openapi_unavailable");
  });
});

describe("verifyResolvedKeys", () => {
  const fakeVerify =
    (results: Record<string, LiveVerifyResult>) =>
    async (s: AppSpec): Promise<LiveVerifyResult> =>
      results[s.app];

  test("drops every app whose key the live service refuses; keeps accepted apps", async () => {
    const keys = new Map([
      ["telephony", "hasna_telephony_revoked-token"],
      ["todos", "hasna_todos_active-token"],
    ]);
    const { keys: kept, rejected } = await verifyResolvedKeys(
      [spec("telephony"), spec("todos")],
      keys,
      fakeVerify({
        telephony: {
          app: "telephony",
          ok: false,
          status: 401,
          reason: "auth_refused",
          detail: "API key has been revoked.",
        },
        todos: { app: "todos", ok: true, status: 200, reason: null, detail: null },
      }),
    );
    expect(rejected.map((r) => r.app)).toEqual(["telephony"]);
    expect([...kept.keys()]).toEqual(["todos"]);
    expect(kept.get("todos")).toBe("hasna_todos_active-token");
  });

  test("keeps everything when every key verifies", async () => {
    const keys = new Map([["telephony", "hasna_telephony_active-token"]]);
    const { keys: kept, rejected } = await verifyResolvedKeys(
      [spec("telephony")],
      keys,
      fakeVerify({
        telephony: { app: "telephony", ok: true, status: 200, reason: null, detail: null },
      }),
    );
    expect(rejected).toHaveLength(0);
    expect(kept.has("telephony")).toBe(true);
  });
});
