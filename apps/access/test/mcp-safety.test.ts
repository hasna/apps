import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { formatError } from "../src/mcp/index.js";
import { McpWriteConfirmationRequiredError, stripMcpWriteConfirmation } from "../src/mcp/schemas.js";
import { shouldRegisterTool } from "../src/mcp/profile.js";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { registerIdentityTools } from "../src/mcp/tools/identities.js";
import { authorizeMcpRequest } from "../src/mcp/http.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../src/services/authorization.js";
import type { AuthorizationContext } from "../src/services/authorization-scopes.js";
import { createIdentity } from "../src/services/identities.js";
import { grantScope } from "../src/services/scopes.js";
import { issueToken } from "../src/services/tokens.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureTools(
  register: (server: unknown, ctx?: AuthorizationContext) => void,
  ctx?: AuthorizationContext,
): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    tool(name: string, _desc: string, _schema: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  register(fake, ctx);
  return handlers;
}

async function invoke(handler: Handler, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await handler(args);
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

let dbPath: string;
beforeEach(() => {
  dbPath = useTestDatabase("access-mcp-safety");
});
afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["ACCESS_PROFILE"];
  delete process.env["HASNA_ACCESS_MCP_AUTH"];
  delete process.env["HASNA_ACCESS_STORAGE_MODE"];
  delete process.env["HASNA_ACCESS_DATABASE_URL"];
  delete process.env["HASNA_ACCESS_API_KEY"];
  delete process.env["HASNA_ACCESS_API_CREDENTIALS"];
});

describe("MCP write safety", () => {
  it("requires confirm:true and strips MCP-only fields before writes", () => {
    expect(() => stripMcpWriteConfirmation({}, "create_identity")).toThrow(McpWriteConfirmationRequiredError);
    const sanitized = stripMcpWriteConfirmation(
      { confirm: true, confirmation_reason: "reviewed", idempotency_key: "k1", name: "x" },
      "create_identity",
    );
    expect(sanitized).toEqual({ name: "x" });
  });

  it("formats a missing confirmation as a structured envelope", () => {
    const payload = JSON.parse(formatError(new McpWriteConfirmationRequiredError("issue_token")));
    expect(payload.code).toBe("MCP_CONFIRMATION_REQUIRED");
    expect(payload.message).toContain("issue_token");
    expect(payload.suggestion).toContain("confirm: true");
  });

  it("a write tool refuses to mutate without confirm", async () => {
    const handlers = captureTools(registerIdentityTools as (s: unknown) => void);
    const result = await handlers.get("create_identity")!({ entity_id: "x", kind: "agent", name: "a" });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.code).toBe("MCP_CONFIRMATION_REQUIRED");
  });

  it("keeps destructive tools out of the minimal profile", () => {
    process.env["ACCESS_PROFILE"] = "minimal";
    expect(shouldRegisterTool("list_identities")).toBe(true);
    expect(shouldRegisterTool("create_identity")).toBe(true);
    expect(shouldRegisterTool("revoke_credential")).toBe(false);
    expect(shouldRegisterTool("suspend_identity")).toBe(false);
    expect(shouldRegisterTool("execute_revocation")).toBe(false);
  });

  it("/mcp rejects unauthenticated requests (auth on by default)", () => {
    const outcome = authorizeMcpRequest(new Request("http://127.0.0.1/mcp", { method: "POST" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(401);
  });

  it("storage_status leaks no DSN substring", async () => {
    const secret = "SUPERSECRETPW-8f2a";
    process.env["HASNA_ACCESS_STORAGE_MODE"] = "cloud";
    process.env["HASNA_ACCESS_DATABASE_URL"] = `postgres://u:${secret}@db.internal:5432/access?sslmode=verify-full`;
    const handlers = captureTools(registerStorageTools as (s: unknown) => void);
    const result = await handlers.get("access_storage_status")!({});
    const text = result.content[0]!.text;
    expect(text).not.toContain(secret);
    expect(text).not.toContain("postgres://");
    const parsed = JSON.parse(text);
    expect(parsed.dsn_present).toBe(true);
    expect(parsed.mode).toBe("cloud");
  });

  it("storage push/pull/sync are deny-by-default without elevation", async () => {
    const handlers = captureTools(registerStorageTools);
    for (const tool of ["access_storage_push", "access_storage_pull", "access_storage_sync"]) {
      const payload = await invoke(handlers.get(tool)!, { confirm: true });
      expect(payload.code).toBe("PERMISSION_DENIED");
    }
  });
});

describe("MCP per-caller authorization (§5.1a)", () => {
  it("derives a scoped context from a verified access-issued token", () => {
    const entityA = randomUUID();
    const identity = createIdentity({ entity_id: entityA, kind: "agent", name: "bot" }, SYSTEM_AUTHORIZATION_CONTEXT);
    grantScope({ identity_id: identity.id, scope: "access:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    const { token } = issueToken({ identity_id: identity.id, scopes: ["access:read"], entity_ids: [entityA] }, SYSTEM_AUTHORIZATION_CONTEXT);

    const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const outcome = authorizeMcpRequest(req);
    expect(outcome.ok).toBe(true);
    expect(outcome.context?.roles).toEqual([]);
    expect(outcome.context?.scopes).toEqual(["access:read"]);
    expect(outcome.context?.entity_ids).toEqual([entityA]);
  });

  it("a read-only, single-entity token is denied cross-entity reads AND un-scoped writes on the MCP surface", async () => {
    const entityA = randomUUID();
    const entityB = randomUUID();
    const identity = createIdentity({ entity_id: entityA, kind: "agent", name: "bot" }, SYSTEM_AUTHORIZATION_CONTEXT);
    grantScope({ identity_id: identity.id, scope: "access:read" }, SYSTEM_AUTHORIZATION_CONTEXT);
    const { token } = issueToken({ identity_id: identity.id, scopes: ["access:read"], entity_ids: [entityA] }, SYSTEM_AUTHORIZATION_CONTEXT);

    const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const ctx = authorizeMcpRequest(req).context;
    const handlers = captureTools(registerIdentityTools, ctx);

    // Same-entity read is allowed.
    const okRead = await invoke(handlers.get("list_identities")!, { entity_id: entityA });
    expect(Array.isArray(okRead)).toBe(true);

    // Cross-entity read is DENIED (knowing entity B's id grants nothing).
    const crossRead = await invoke(handlers.get("list_identities")!, { entity_id: entityB });
    expect(crossRead.code).toBe("PERMISSION_DENIED");

    // Un-scoped write (no access:write / identity:admin) is DENIED even on the home entity.
    const write = await invoke(handlers.get("create_identity")!, { confirm: true, entity_id: entityA, kind: "agent", name: "x" });
    expect(write.code).toBe("PERMISSION_DENIED");
  });

  it("the exfil surface is gated on the CALLER's storage:admin scope, not a process env flag", async () => {
    const entityA = randomUUID();

    // A caller WITHOUT storage:admin cannot push, even though no env flag is consulted.
    const lowCtx: AuthorizationContext = { actor_id: "low", roles: [], scopes: ["access:read"], entity_ids: [entityA] };
    const lowHandlers = captureTools(registerStorageTools, lowCtx);
    for (const tool of ["access_storage_push", "access_storage_pull", "access_storage_sync"]) {
      const payload = await invoke(lowHandlers.get(tool)!, { confirm: true });
      expect(payload.code).toBe("PERMISSION_DENIED");
    }

    // A caller carrying storage:admin is allowed.
    const adminCtx: AuthorizationContext = { actor_id: "admin", roles: [], scopes: ["storage:admin"], entity_ids: [entityA] };
    const adminHandlers = captureTools(registerStorageTools, adminCtx);
    const pushed = await invoke(adminHandlers.get("access_storage_push")!, { confirm: true });
    expect(pushed.ok).toBe(true);
    expect(pushed.direction).toBe("push");
  });

  it("an entity-scoped owner serve credential authorizes writes on the MCP surface", async () => {
    const entityA = randomUUID();
    // A properly entity-scoped `owner` credential — NOT a SYSTEM/bypass god-mode key.
    // The owner role widens the ACTION dimension; the explicit entity_ids grant the
    // ENTITY reach. Both are required under strict deny-by-default scoping (§1c).
    process.env["HASNA_ACCESS_API_CREDENTIALS"] = JSON.stringify([
      { id: "owner-a", token: "owner-a-token", type: "api_key", roles: ["owner"], entity_ids: [entityA] },
    ]);
    try {
      const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: "Bearer owner-a-token" } });
      const outcome = authorizeMcpRequest(req);
      expect(outcome.ok).toBe(true);
      expect(outcome.context?.roles).toContain("owner");
      // A network-presented credential is NEVER granted SYSTEM bypass.
      expect(outcome.context?.bypass).toBeUndefined();
      const handlers = captureTools(registerIdentityTools, outcome.context);
      const created = await invoke(handlers.get("create_identity")!, { confirm: true, entity_id: entityA, kind: "agent", name: "svc" });
      expect(created.code).toBeUndefined();
      expect(created.entity_id).toBe(entityA);
    } finally {
      delete process.env["HASNA_ACCESS_API_CREDENTIALS"];
    }
  });

  it("the static legacy API key is owner-role but NOT SYSTEM bypass: no entity reach without an explicit scope", async () => {
    process.env["HASNA_ACCESS_API_KEY"] = "test-legacy-owner-key";
    try {
      const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: "Bearer test-legacy-owner-key" } });
      const outcome = authorizeMcpRequest(req);
      expect(outcome.ok).toBe(true);
      expect(outcome.context?.roles).toContain("owner");
      // The key is owner (full ACTION set) but carries NO bypass and NO entity set,
      // so the deny-by-default entity gate blocks any entity-scoped write — a
      // network credential can never escalate to the entity-unrestricted SYSTEM context.
      expect(outcome.context?.bypass).toBeUndefined();
      const handlers = captureTools(registerIdentityTools, outcome.context);
      const denied = await invoke(handlers.get("create_identity")!, { confirm: true, entity_id: randomUUID(), kind: "agent", name: "svc" });
      expect(denied.code).toBe("PERMISSION_DENIED");
    } finally {
      delete process.env["HASNA_ACCESS_API_KEY"];
    }
  });
});
