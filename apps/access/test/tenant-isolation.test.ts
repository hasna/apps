import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildApp } from "../src/server/app.js";
import { authorizeMcpRequest } from "../src/mcp/http.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../src/services/authorization.js";
import { principalToContext } from "../src/server/auth.js";
import { createIdentity } from "../src/services/identities.js";
import { registerCredential } from "../src/services/credentials.js";
import { grantScope } from "../src/services/scopes.js";
import { requestElevation } from "../src/services/elevations.js";
import { scheduleReview } from "../src/services/reviews.js";
import { issueToken } from "../src/services/tokens.js";
import { executeRevocation } from "../src/services/revocations.js";
import { registerIdentityTools } from "../src/mcp/tools/identities.js";
import { registerCredentialTools } from "../src/mcp/tools/credentials.js";
import { registerScopeTools } from "../src/mcp/tools/scopes.js";
import { registerElevationTools } from "../src/mcp/tools/elevations.js";
import { registerReviewTools } from "../src/mcp/tools/reviews.js";
import { registerRevocationTools } from "../src/mcp/tools/revocations.js";
import { registerTokenTools } from "../src/mcp/tools/tokens.js";
import { registerAuditTools } from "../src/mcp/tools/audit.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

/**
 * PROVING TEST for the cross-entity data-disclosure fix.
 *
 * A viewer scoped to entity A (via an access-issued MCP bearer token AND via a
 * scoped /v1 serve credential) must NOT be able to enumerate entity B's rows by
 * calling any list op with no entity_id filter. Before the fix, only
 * list_identities post-filtered by the caller's allowed entity set; the other
 * six list services returned every entity's rows. This test drives EVERY list op
 * on BOTH surfaces and asserts no foreign entity_id ever appears.
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
type Register = (server: unknown, ctx?: AuthorizationContext) => void;

function captureTools(registrars: Register[], ctx?: AuthorizationContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    tool(name: string, _desc: string, _schema: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  for (const register of registrars) register(fake, ctx);
  return handlers;
}

async function invoke(handler: Handler, args: Record<string, unknown>): Promise<unknown> {
  const result = await handler(args);
  return JSON.parse(result.content[0]!.text) as unknown;
}

interface Seeded {
  entityA: string;
  entityB: string;
}

/** Seed a full set of rows in BOTH entity A and entity B using the system context. */
function seedBothEntities(): Seeded {
  const entityA = randomUUID();
  const entityB = randomUUID();
  for (const entity of [entityA, entityB]) {
    const identity = createIdentity({ entity_id: entity, kind: "agent", name: `bot-${entity.slice(0, 8)}` }, SYSTEM_AUTHORIZATION_CONTEXT);
    const cred = registerCredential(
      { identity_id: identity.id, name: "cred", kind: "api_key", secret_ref: `hasna/agents/${entity}/token` },
      SYSTEM_AUTHORIZATION_CONTEXT,
    );
    grantScope({ identity_id: identity.id, scope: "wallets:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    grantScope({ identity_id: identity.id, scope: "access:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    requestElevation({ identity_id: identity.id, scope: "wallets:write", reason: "seed" }, SYSTEM_AUTHORIZATION_CONTEXT);
    scheduleReview({ entity_id: entity, name: "quarterly" }, SYSTEM_AUTHORIZATION_CONTEXT);
    issueToken({ identity_id: identity.id, scopes: ["access:read"], entity_ids: [entity] }, SYSTEM_AUTHORIZATION_CONTEXT);
    // A revocation row (targets the credential) so listRevocations has data per entity.
    executeRevocation(
      { identity_id: identity.id, target_type: "credential", target_id: cred.id, reason: "seed" },
      SYSTEM_AUTHORIZATION_CONTEXT,
    );
  }
  return { entityA, entityB };
}

/** Extract entity_ids from a list-op response, tolerating the shape of each resource. */
function entityIdsOf(rows: unknown): string[] {
  expect(Array.isArray(rows)).toBe(true);
  return (rows as Array<Record<string, unknown>>).map((r) => String(r.entity_id));
}

let dbPath: string;
beforeEach(() => {
  dbPath = useTestDatabase("access-tenant-isolation");
});
afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_ACCESS_API_CREDENTIALS"];
  delete process.env["HASNA_ACCESS_API_KEY"];
});

const LIST_TOOLS = [
  "list_identities",
  "list_credentials",
  "list_scopes",
  "list_elevations",
  "list_reviews",
  "list_tokens",
  "list_revocations",
  "list_audit",
] as const;

describe("tenant isolation — MCP surface (access-issued bearer token)", () => {
  it("a viewer scoped to entity A sees ZERO entity-B rows across every list op (no entity_id filter)", async () => {
    const { entityA, entityB } = seedBothEntities();

    // Issue a real access token scoped to entity A, read-only.
    const viewer = createIdentity({ entity_id: entityA, kind: "agent", name: "viewer" }, SYSTEM_AUTHORIZATION_CONTEXT);
    grantScope({ identity_id: viewer.id, scope: "access:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    const { token } = issueToken({ identity_id: viewer.id, scopes: ["access:read"], entity_ids: [entityA] }, SYSTEM_AUTHORIZATION_CONTEXT);

    const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const outcome = authorizeMcpRequest(req);
    expect(outcome.ok).toBe(true);
    const ctx = outcome.context;
    expect(ctx?.entity_ids).toEqual([entityA]);

    const handlers = captureTools(
      [
        registerIdentityTools as Register,
        registerCredentialTools as Register,
        registerScopeTools as Register,
        registerElevationTools as Register,
        registerReviewTools as Register,
        registerTokenTools as Register,
        registerRevocationTools as Register,
        registerAuditTools as Register,
      ],
      ctx,
    );

    for (const tool of LIST_TOOLS) {
      const rows = await invoke(handlers.get(tool)!, {});
      const ids = entityIdsOf(rows);
      expect(ids, `${tool} leaked a foreign entity`).not.toContain(entityB);
      // And it still returns the caller's own rows (isolation, not a blanket denial).
      expect(ids.every((id) => id === entityA), `${tool} returned a non-A entity`).toBe(true);
      expect(ids.length, `${tool} returned no rows for the caller's own entity`).toBeGreaterThan(0);
    }
  });

  it("cross-entity read with an explicit foreign entity_id is denied (defense already present, kept green)", async () => {
    const { entityA, entityB } = seedBothEntities();
    const viewer = createIdentity({ entity_id: entityA, kind: "agent", name: "viewer" }, SYSTEM_AUTHORIZATION_CONTEXT);
    grantScope({ identity_id: viewer.id, scope: "access:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    const { token } = issueToken({ identity_id: viewer.id, scopes: ["access:read"], entity_ids: [entityA] }, SYSTEM_AUTHORIZATION_CONTEXT);
    const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const ctx = authorizeMcpRequest(req).context;
    const handlers = captureTools([registerCredentialTools as Register], ctx);
    const denied = (await invoke(handlers.get("list_credentials")!, { entity_id: entityB })) as Record<string, unknown>;
    expect(denied.code).toBe("PERMISSION_DENIED");
  });
});

describe("tenant isolation — /v1 surface (scoped serve credential)", () => {
  function scopedCredentialEnv(entityId: string): void {
    process.env["HASNA_ACCESS_API_CREDENTIALS"] = JSON.stringify([
      {
        id: "viewer-a",
        token: "viewer-a-token",
        type: "api_key",
        roles: ["auditor"],
        scopes: ["access:read"],
        entity_ids: [entityId],
      },
    ]);
  }

  const V1_PATHS: Record<string, string> = {
    identities: "/v1/identities",
    credentials: "/v1/credentials",
    scopes: "/v1/scopes",
    elevations: "/v1/elevations",
    reviews: "/v1/reviews",
    tokens: "/v1/tokens",
    revocations: "/v1/revocations",
    audit: "/v1/audit",
  };

  it("a serve credential scoped to entity A sees ZERO entity-B rows across every list route (no entity_id query)", async () => {
    const { entityA, entityB } = seedBothEntities();
    scopedCredentialEnv(entityA);
    const app = buildApp();

    for (const [name, path] of Object.entries(V1_PATHS)) {
      const res = await app.request(path, { headers: { Authorization: "Bearer viewer-a-token" } });
      expect(res.status, `${name} unexpected status`).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const ids = rows.map((r) => String(r.entity_id));
      expect(ids, `${name} leaked a foreign entity`).not.toContain(entityB);
      expect(ids.every((id) => id === entityA), `${name} returned a non-A entity`).toBe(true);
      expect(ids.length, `${name} returned no rows for the caller's own entity`).toBeGreaterThan(0);
    }
  });
});

describe("principalToContext threads scopes (defense-in-depth)", () => {
  it("carries the principal's scopes into the service-layer context", () => {
    const ctx = principalToContext({
      actor_id: "svc",
      credential_id: "c1",
      credential_type: "api_key",
      roles: [],
      scopes: ["access:read", "token:issue"],
      entity_ids: ["e1"],
    });
    expect(ctx.scopes).toEqual(["access:read", "token:issue"]);
    expect(ctx.entity_ids).toEqual(["e1"]);
  });
});
