import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { REGISTRY, opInProfile } from "../src/services/registry.js";
import { localOwnerPrincipal, type ApiPrincipal } from "../src/server/auth.js";
import { startHttpServer } from "../src/mcp/http.js";
import { HASNA_INC } from "../src/adapters/index.js";
import { cleanupTestDatabase, seededDb, useTestDatabase } from "./helpers/database.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools(register: (server: unknown) => void): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    tool(name: string, _d: string, _s: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  register(fake);
  return handlers;
}

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-mcp-safety");
  seededDb();
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_FLEET_DATABASE_URL"];
  delete process.env["HASNA_FLEET_API_CREDENTIALS"];
});

describe("MCP write safety", () => {
  it("every mutating registry op requires a write scope", () => {
    for (const op of REGISTRY) {
      if (!op.mutates) continue;
      expect(op.scopes, `${op.mcpTool} must require fleet:write`).toContain("fleet:write");
    }
  });

  it("keeps destructive (delete) tools out of the minimal profile", () => {
    const deletes = REGISTRY.filter((o) => o.op.endsWith(".delete"));
    expect(deletes.length).toBeGreaterThan(0);
    for (const op of deletes) {
      expect(opInProfile(op, "minimal"), `${op.mcpTool} must be absent from minimal`).toBe(false);
    }
  });

  it("denies a mutating domain tool for a caller without the write scope", async () => {
    const viewer: ApiPrincipal = { actor_id: "v", credential_id: "v", credential_type: "api_key", roles: ["viewer"], scopes: ["fleet:read"] };
    const handlers = captureTools((s) => registerDomainTools(s as never, viewer, "full"));
    const create = handlers.get("fleet_slo_create")!;
    const result = await create({ entity_id: HASNA_INC, target_type: "agent", target_ref: "x", name: "n", objective: "error_rate", target_value: 1 });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("PERMISSION_DENIED");
  });

  it("gates storage push/pull/sync behind storage:admin", async () => {
    const editor: ApiPrincipal = { actor_id: "e", credential_id: "e", credential_type: "api_key", roles: ["editor"], scopes: ["fleet:read", "fleet:write"] };
    const handlers = captureTools((s) => registerStorageTools(s as never, editor));
    const push = handlers.get("fleet_storage_push")!;
    const result = await push({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("storage:admin");
  });

  it("excludes the audit table from storage sync even for an admin", async () => {
    const handlers = captureTools((s) => registerStorageTools(s as never, localOwnerPrincipal()));
    const sync = handlers.get("fleet_storage_sync")!;
    const result = await sync({ tables: ["slos", "fleet_audit"] });
    const payload = JSON.parse(result.content[0]!.text) as { tables: string[]; rejected_requested_audit_tables: string[] };
    expect(payload.tables).not.toContain("fleet_audit");
    expect(payload.rejected_requested_audit_tables).toContain("fleet_audit");
  });

  it("storage_status leaks no DSN substring", async () => {
    process.env["HASNA_FLEET_DATABASE_URL"] = "postgres://fleet:supersecretpassword@db.internal:5432/fleet?sslmode=verify-full";
    const handlers = captureTools((s) => registerStorageTools(s as never, localOwnerPrincipal()));
    const status = handlers.get("fleet_storage_status")!;
    const result = await status({});
    const text = result.content[0]!.text;
    expect(text).not.toContain("supersecretpassword");
    expect(text).not.toContain("postgres://");
    const payload = JSON.parse(text) as { dsn_present: boolean };
    expect(payload.dsn_present).toBe(true);
  });

  it("rejects unauthenticated /mcp HTTP requests (401)", async () => {
    process.env["HASNA_FLEET_API_CREDENTIALS"] = JSON.stringify([{ id: "o", token: "owner-token-xxxxxxxxxxxxxxxx", roles: ["owner"] }]);
    const server = await startHttpServer(0, { hostname: "127.0.0.1" });
    const port = server.port;
    try {
      const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(unauth.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });
});
