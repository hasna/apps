import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildRecorder, clearCredentials, driveMcp, freshDb, principalFor, setCredentials, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { ALL_OPS, opsForProfile } from "../src/services/registry.js";
import { handleMcpHttpRequest } from "../src/mcp/http.js";
import { storageStatus } from "../src/services/storage.js";
import { getDatabase } from "../src/db/database.js";

beforeEach(() => {
  freshDb();
  clearCredentials();
});
afterEach(() => {
  closeDatabase();
  delete process.env["HASNA_BILLING_DATABASE_URL"];
});

describe("mcp write-safety", () => {
  it("every mutating op declares a write/run scope and no read-only op mutates", () => {
    for (const op of ALL_OPS) {
      if (op.mutates) {
        expect(op.scopes.some((s) => s !== "billing:read")).toBe(true);
        expect(["write", "run", "admin"]).toContain(op.action);
      } else {
        expect(op.action).toBe("read");
      }
    }
  });

  it("keeps destructive ops out of the minimal profile", () => {
    const minimal = opsForProfile("minimal").map((o) => o.op);
    expect(minimal).not.toContain("void_invoice");
    expect(minimal).not.toContain("cancel_subscription");
    // minimal still exposes core reads + a primary create per resource.
    expect(minimal).toContain("create_customer");
    expect(minimal).toContain("list_invoices");
  });
});

describe("storage tools gated by CALLER scope, not an env var (§4.6, failure class 4)", () => {
  it("denies storage_push for a credential lacking storage:admin", async () => {
    setCredentials([
      // billing_manager has read/write/run/export but NOT storage:admin.
      { id: "mgr", token: "tok-mgr", roles: ["billing_manager"], entity_ids: [TEST_ENTITY_A] },
    ]);
    try {
      const rec = buildRecorder(principalFor("tok-mgr"));
      const res = await driveMcp(rec, "billing_storage_push", {});
      expect(res.ok).toBe(false);
      expect((res.value as { code: string }).code).toBe("PERMISSION_DENIED");
    } finally {
      clearCredentials();
    }
  });

  it("permits storage:admin scope past the gate (then fails closed on unreachable cloud, not on scope)", async () => {
    setCredentials([{ id: "adm", token: "tok-adm", roles: ["admin"], entity_ids: [TEST_ENTITY_A] }]);
    try {
      const rec = buildRecorder(principalFor("tok-adm"));
      const res = await driveMcp(rec, "billing_storage_push", {});
      // Past the scope gate → fails closed because no cloud target is reachable.
      expect(res.ok).toBe(false);
      expect((res.value as { code: string }).code).not.toBe("PERMISSION_DENIED");
    } finally {
      clearCredentials();
    }
  });
});

describe("mcp transport auth (§5.1a)", () => {
  it("rejects unauthenticated /mcp requests with 401", async () => {
    const req = new Request("http://127.0.0.1:8891/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await handleMcpHttpRequest(req, { host: "0.0.0.0" });
    expect(res.status).toBe(401);
  });
});

describe("no secret leakage (§4.6)", () => {
  it("storage_status never emits the configured DATABASE_URL", async () => {
    const secret = "postgres://billing:SUP3RSECRET_pw@db.internal:5432/billing?sslmode=verify-full";
    process.env["HASNA_BILLING_DATABASE_URL"] = secret;
    const status = await storageStatus(getDatabase());
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("SUP3RSECRET_pw");
    expect(serialized).not.toContain(secret);
    expect(status.dsn_present).toBe(true);
    expect(status.remote_reachable).toBe(false);
  });

  it("the billing_storage_status MCP tool output contains no DSN substring", async () => {
    const secret = "postgres://billing:ANOTHERSECRET@db.internal:5432/billing?sslmode=verify-full";
    process.env["HASNA_BILLING_DATABASE_URL"] = secret;
    const rec = buildRecorder(undefined);
    const res = await driveMcp(rec, "billing_storage_status", {});
    expect(JSON.stringify(res.value)).not.toContain("ANOTHERSECRET");
  });
});
