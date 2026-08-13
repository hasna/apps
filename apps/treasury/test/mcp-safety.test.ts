import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleMcpHttpRequest } from "../src/mcp/http.js";
import { localOwnerPrincipal } from "../src/mcp/index.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { seedFixture, clearCredentials, type Fixture } from "./helpers.js";
import type { ApiPrincipal } from "../src/server/auth.js";

let fx: Fixture;
afterEach(() => {
  fx?.cleanup();
  clearCredentials();
  delete process.env["HASNA_TREASURY_STORAGE_MODE"];
  delete process.env["HASNA_TREASURY_DATABASE_URL"];
});

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function capture(principal: ApiPrincipal, profile: "minimal" | "standard" | "full"): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = { tool(name: string, _d: string, _s: unknown, h: Handler) { handlers.set(name, h); } } as unknown as McpServer;
  registerDomainTools(fake, principal, profile);
  registerStorageTools(fake, principal);
  return handlers;
}

function parse(r: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

function principal(scopes: ApiPrincipal["scopes"], entity_ids?: string[]): ApiPrincipal {
  return { credential_id: "c", credential_type: "api_key", actor_id: "c", roles: ["treasurer"], scopes, ...(entity_ids ? { entity_ids } : {}) };
}

describe("mcp-safety", () => {
  it("rejects unauthenticated /mcp requests with 401", async () => {
    const res = await handleMcpHttpRequest(new Request("http://x/mcp", { method: "POST", body: "{}" }), "127.0.0.1");
    expect(res.status).toBe(401);
  });

  it("storage_status leaks no DSN/secret value", async () => {
    fx = await seedFixture();
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "cloud";
    process.env["HASNA_TREASURY_DATABASE_URL"] = "postgres://user:SUPERSECRETPW@db.example/treasury?sslmode=verify-full";
    const handlers = capture(principal(["treasury:read"], [fx.usId, fx.roId]), "full");
    const status = parse(await handlers.get("treasury_storage_status")!({}));
    const text = JSON.stringify(status);
    expect(text).not.toContain("SUPERSECRETPW");
    expect(text).not.toContain("postgres://");
    expect(status.dsn_present).toBe(true);
    expect(status).toHaveProperty("remote_reachable");
    expect(status).not.toHaveProperty("dsn");
  });

  it("omits destructive/advisory tools from the minimal profile", () => {
    fx = undefined as unknown as Fixture;
    const handlers = capture(principal(["treasury:read"], ["e"]), "minimal");
    expect(handlers.has("generate_sweeps")).toBe(false);
    expect(handlers.has("update_sweep_status")).toBe(false);
    expect(handlers.has("ingest_fixtures")).toBe(false);
    // primary create + core reads ARE present in minimal
    expect(handlers.has("record_balance")).toBe(true);
    expect(handlers.has("list_balances")).toBe(true);
  });

  it("local-owner principal (stdio / auth-off) has SYSTEM bypass, matching the CLI local owner", async () => {
    fx = await seedFixture();
    // The stdio fallback + HASNA_TREASURY_MCP_AUTH=off loopback dev path both use
    // localOwnerPrincipal(); it MUST have the same authority as the CLI's
    // localOwnerContext (bypass), or every entity-scoped op would fail closed.
    const handlers = capture(localOwnerPrincipal(), "full");
    const entities = JSON.parse((await handlers.get("list_entities")!({})).content[0]!.text) as unknown[];
    expect(Array.isArray(entities)).toBe(true);
    expect(entities.length).toBe(2); // bypass sees ALL entities, not deny-by-default []
    const one = parse(await handlers.get("get_entity")!({ entity_id: fx.usId }));
    expect(one.code).toBeUndefined();
    expect(one.entity_id).toBe(fx.usId);
  });

  it("threads the CALLER principal into per-op authorization (no SYSTEM bypass)", async () => {
    fx = await seedFixture();
    // Principal scoped to US only must be denied a cross-entity read on the MCP transport.
    const handlers = capture(principal(["treasury:read"], [fx.usId]), "full");
    const denied = parse(await handlers.get("get_entity")!({ entity_id: fx.roId }));
    expect(denied.code).toBe("PERMISSION_DENIED");
    const allowed = parse(await handlers.get("get_entity")!({ entity_id: fx.usId }));
    expect(allowed.entity_id).toBe(fx.usId);
  });

  it("gates storage push/pull/sync behind the storage:admin scope (deny by default)", async () => {
    fx = await seedFixture();
    const handlers = capture(principal(["treasury:read", "treasury:write"], [fx.usId, fx.roId]), "full");
    for (const tool of ["treasury_storage_push", "treasury_storage_pull", "treasury_storage_sync"]) {
      const res = parse(await handlers.get(tool)!({}));
      expect(res.code, tool).toBe("PERMISSION_DENIED");
    }
  });
});
