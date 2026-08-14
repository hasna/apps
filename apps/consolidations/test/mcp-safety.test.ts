import { afterEach, describe, expect, it } from "bun:test";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { handleMcpHttpRequest } from "../src/mcp/http.js";
import { OPS } from "../src/services/registry.js";
import { storageStatus } from "../src/services/storage-ops.js";

const WRITE_ACTIONS = new Set(["write", "run", "finalize", "admin"]);
const WRITE_SCOPES = new Set([
  "consolidations:write",
  "consolidations:run",
  "consolidations:finalize",
  "storage:admin",
]);

afterEach(() => {
  delete process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"];
  delete process.env["HASNA_CONSOLIDATIONS_MCP_AUTH"];
});

describe("MCP write safety", () => {
  it("every mutating op requires a write-class action + scope", () => {
    for (const op of OPS) {
      if (!op.mutating) continue;
      expect(WRITE_ACTIONS.has(op.action), `${op.op} action`).toBe(true);
      expect(WRITE_SCOPES.has(op.scope), `${op.op} scope`).toBe(true);
    }
  });

  it("every read op uses a read/export action (no silent writes)", () => {
    for (const op of OPS) {
      if (op.mutating) continue;
      expect(["read", "export"]).toContain(op.action);
    }
  });

  it("keeps destructive + storage-mutation tools out of the minimal profile", () => {
    for (const op of OPS) {
      const destructive = op.op.endsWith(".delete") || (op.op.startsWith("storage.") && op.mutating);
      if (destructive) expect(op.profiles, `${op.op}`).not.toContain("minimal");
    }
  });

  it("registers the four storage tools with elevated scope and namespaced names", () => {
    const names = OPS.filter((op) => op.scope === "storage:admin").map((op) => op.mcpTool).sort();
    expect(names).toEqual([
      "consolidations_storage_pull",
      "consolidations_storage_push",
      "consolidations_storage_status",
      "consolidations_storage_sync",
    ]);
  });
});

describe("MCP transport auth", () => {
  it("rejects unauthenticated /mcp requests with 401", async () => {
    const req = new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    const res = await handleMcpHttpRequest(req);
    expect(res.status).toBe(401);
  });
});

describe("storage_status redaction", () => {
  it("never emits the DSN or secret material", async () => {
    const dsn = "postgres://super:s3cr3t-VALUE@db.internal:5432/consolidations?sslmode=verify-full";
    process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"] = dsn;
    const store = new SqliteStore(":memory:");
    const status = await storageStatus(store);
    await store.close();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("s3cr3t-VALUE");
    expect(serialized).not.toContain("super");
    expect(serialized).not.toContain(dsn);
    expect(status.dsn_present).toBe(true);
    // remote_reachable must be probed, not hardcoded true (local => false).
    expect(status.remote_reachable).toBe(false);
    expect(Object.keys(status).sort()).toEqual(["dsn_present", "migrations_applied", "mode", "remote_reachable", "sqlite_path"]);
  });
});
