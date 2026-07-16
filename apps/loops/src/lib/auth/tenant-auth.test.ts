import { describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import type { QueryResultRow } from "pg";
import type { TypedQueryClient } from "../../generated/storage-kit/query.js";
import { routePolicy } from "./route-policy.js";
import { TenantApiAuthenticator } from "./tenant-auth.js";

const secret = "tenant-auth-test-secret-at-least-32-bytes";
const now = Date.UTC(2026, 0, 1);

function clientFor(token: ReturnType<typeof mintApiKey>, overrides: Record<string, unknown> = {}, auditFails = false) {
  const audits: readonly unknown[][] = [];
  const effects: string[] = [];
  const row = {
    kid: token.kid,
    app: "loops",
    agent: "principal-a",
    scopes: token.claims.scopes,
    token_hash: token.tokenHash,
    issued_at: new Date(token.claims.iat * 1000),
    expires_at: token.claims.exp === null ? null : new Date(token.claims.exp * 1000),
    revoked_at: null,
    disabled_at: null,
    tenant_id: "tenant-a",
    tenant_status: "active",
    principal_id: "principal-a",
    principal_status: "active",
    membership_status: "active",
    token_kind: "api_key",
    roles: ["admin"],
    ...overrides,
  };
  const mutableAudits: unknown[][] = [];
  const client: TypedQueryClient = {
    query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
    many: async <T extends QueryResultRow>() => [] as T[],
    one: async <T extends QueryResultRow>() => row as unknown as T,
    get: async <T extends QueryResultRow>(_sql: string, params?: readonly unknown[]) =>
      params?.[1] === token.tokenHash ? row as unknown as T : null,
    execute: async (_sql: string, params?: readonly unknown[]) => {
      if (auditFails) throw new Error("audit down");
      mutableAudits.push([...(params ?? [])]);
      effects.push("audit");
    },
  };
  return { client, audits: mutableAudits as unknown[][], effects };
}

function headers(token?: string): Headers {
  return new Headers(token ? { authorization: `Bearer ${token}` } : {});
}

const readPolicy = routePolicy("GET", "/v1/loops")!;

describe("tenant API authentication", () => {
  test("rejects signing keys shorter than the token minting minimum", () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client } = clientFor(token);
    expect(() => new TenantApiAuthenticator(client, "too-short")).toThrow("at least 16 bytes");
    expect(() => new TenantApiAuthenticator(client, "1234567890abcdef")).not.toThrow();
  });

  test("binds exact token hash, principal, tenant, role, and scopes", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, kid: "kid-a", nowMs: now });
    const { client, audits } = clientFor(token);
    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(token.token),
      { method: "GET", path: "/v1/loops", policy: readPolicy },
    );

    expect(decision).toMatchObject({
      ok: true,
      principal: { tenantId: "tenant-a", principalId: "principal-a", kid: "kid-a" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.[5]).toBe("allow");
  });

  test("rejects a separately signed token that reuses an active kid with altered claims", async () => {
    const persisted = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, kid: "shared-kid", nowMs: now });
    const altered = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:*"], signingSecret: secret, kid: "shared-kid", nowMs: now });
    const { client, audits } = clientFor(persisted);

    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(altered.token),
      { method: "GET", path: "/v1/loops", policy: readPolicy },
    );

    expect(decision).toMatchObject({ ok: false, status: 401, reason: "unbound_key" });
    expect(audits[0]?.[5]).toBe("deny");
  });

  test("durably audits missing credentials without a tenant", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client, audits } = clientFor(token);
    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(),
      { method: "GET", path: "/v1/loops/password=hostile-audit-secret", policy: readPolicy },
    );

    expect(decision).toMatchObject({ ok: false, status: 401, reason: "missing_token" });
    expect(audits[0]?.[1]).toBeNull();
    expect(audits[0]?.[5]).toBe("deny");
    const metadata = JSON.parse(String(audits[0]?.[7]));
    expect(metadata).toMatchObject({ route: "loops.list" });
    expect(JSON.stringify(metadata)).not.toContain("hostile-audit-secret");
    expect(JSON.stringify(metadata)).not.toContain("password=");
  });

  test("emits one secret-safe api_auth event after a durable 401 denial audit", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client, audits, effects } = clientFor(token);
    const logged: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => {
      effects.push("warn");
      logged.push(values.map(String).join(" "));
    };
    try {
      const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
        headers(),
        { method: "GET", path: "/v1/loops", policy: readPolicy },
      );

      expect(decision).toMatchObject({ ok: false, status: 401, reason: "missing_token" });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.[5]).toBe("deny");
      expect(logged).toEqual([
        JSON.stringify({ evt: "api_auth", outcome: "deny", reason: "missing_token", status: 401 }),
      ]);
      expect(effects).toEqual(["audit", "warn"]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("emits one exact api_auth event for a real 403 without credential or identity material", async () => {
    const credentialMarker = "credential-marker-secret-at-least-32-bytes";
    const tenantMarker = "tenant-leak-marker";
    const principalMarker = "principal-leak-marker";
    const kidMarker = "kid-leak-marker";
    const token = mintApiKey({
      app: "loops",
      agent: principalMarker,
      scopes: ["loops:read"],
      signingSecret: credentialMarker,
      kid: kidMarker,
      nowMs: now,
    });
    const { client, audits, effects } = clientFor(token, {
      agent: principalMarker,
      principal_id: principalMarker,
      tenant_id: tenantMarker,
      roles: ["worker"],
    });
    const logged: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => {
      effects.push("warn");
      logged.push(values.map(String).join(" "));
    };
    try {
      const decision = await new TenantApiAuthenticator(client, credentialMarker, () => now).authenticate(
        headers(token.token),
        { method: "GET", path: "/v1/loops", policy: readPolicy },
      );

      expect(decision).toMatchObject({ ok: false, status: 403, reason: "insufficient_role" });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.[5]).toBe("deny");
      expect(logged).toEqual([
        JSON.stringify({ evt: "api_auth", outcome: "deny", reason: "insufficient_role", status: 403 }),
      ]);
      expect(effects).toEqual(["audit", "warn"]);

      const serialized = logged[0] ?? "";
      const event = JSON.parse(serialized) as Record<string, unknown>;
      expect(Object.keys(event)).toEqual(["evt", "outcome", "reason", "status"]);
      expect(serialized).not.toContain(token.token);
      expect(serialized).not.toContain(token.tokenHash);
      expect(serialized.toLowerCase()).not.toContain("authorization");
      expect(serialized.toLowerCase()).not.toContain("bearer");
      expect(serialized).not.toContain(credentialMarker);
      expect(serialized).not.toContain(tenantMarker);
      expect(serialized).not.toContain(principalMarker);
      expect(serialized).not.toContain(kidMarker);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("does not emit an api_auth denial event for an allowed request", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client, audits, effects } = clientFor(token);
    const logged: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
        headers(token.token),
        { method: "GET", path: "/v1/loops", policy: readPolicy },
      );

      expect(decision).toMatchObject({ ok: true, status: 200 });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.[5]).toBe("allow");
      expect(effects).toEqual(["audit"]);
      expect(logged).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("does not emit an api_auth denial event when the denial audit fails", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client, audits, effects } = clientFor(token, {}, true);
    const logged: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
        headers(),
        { method: "GET", path: "/v1/loops", policy: readPolicy },
      );

      expect(decision).toMatchObject({ ok: false, status: 503, reason: "audit_unavailable" });
      expect(audits).toEqual([]);
      expect(effects).toEqual([]);
      expect(logged).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test.each([
    ["revoked", { revoked_at: new Date(now) }, 401, "revoked"],
    ["disabled", { disabled_at: new Date(now) }, 401, "disabled"],
    ["tenant suspended", { tenant_status: "suspended" }, 403, "tenant_suspended"],
    ["principal suspended", { principal_status: "suspended" }, 403, "principal_suspended"],
    ["membership suspended", { membership_status: "suspended" }, 403, "membership_suspended"],
    ["wrong role", { roles: ["worker"] }, 403, "insufficient_role"],
    ["wrong token kind", { token_kind: "machine", roles: ["worker"] }, 403, "wrong_token_kind"],
  ])("rejects %s", async (_label, overrides, status, reason) => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client } = clientFor(token, overrides);
    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(token.token),
      { method: "GET", path: "/v1/loops", policy: readPolicy },
    );
    expect(decision).toMatchObject({ ok: false, status, reason });
  });

  test("fails closed when an allow decision cannot be persisted to audit", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client } = clientFor(token, {}, true);
    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(token.token),
      { method: "GET", path: "/v1/loops", policy: readPolicy },
    );
    expect(decision).toMatchObject({ ok: false, status: 503, reason: "audit_unavailable" });
  });

  test("rejects a persisted principal binding that differs from the signed identity", async () => {
    const token = mintApiKey({ app: "loops", agent: "principal-a", scopes: ["loops:read"], signingSecret: secret, nowMs: now });
    const { client } = clientFor(token, { principal_id: "principal-b" });
    const decision = await new TenantApiAuthenticator(client, secret, () => now).authenticate(
      headers(token.token),
      { method: "GET", path: "/v1/loops", policy: readPolicy },
    );
    expect(decision).toMatchObject({ ok: false, status: 401, reason: "key_record_mismatch" });
  });
});
