import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { captureMcpHandlers, makeDb, parseMcp, seedFixture } from "./helpers/harness.js";
import { authenticateMcpRequest } from "../src/mcp/http.js";
import { shouldRegisterTool } from "../src/mcp/index.js";
import type { ApiPrincipal } from "../src/server/auth.js";
import { seedEntity } from "../src/services/entities.js";
import { createAsset } from "../src/services/assets.js";
import { systemContext } from "../src/services/runtime.js";

const ENV_KEYS = ["HASNA_HOLDINGS_STORAGE_MODE", "HASNA_HOLDINGS_DATABASE_URL", "HASNA_HOLDINGS_PROFILE", "HASNA_HOLDINGS_API_CREDENTIALS", "HASNA_HOLDINGS_MCP_AUTH"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  delete process.env["HASNA_HOLDINGS_PROFILE"];
});

describe("mcp safety", () => {
  it("holdings_storage_status never leaks the DSN value", async () => {
    const secretDsn = "postgres://holdings:sup3rs3cr3t@rds.example.com:5432/holdings?sslmode=verify-full";
    process.env["HASNA_HOLDINGS_STORAGE_MODE"] = "cloud";
    process.env["HASNA_HOLDINGS_DATABASE_URL"] = secretDsn;
    const db = makeDb(); // scrubs the DSN from env after connecting
    const handlers = captureMcpHandlers(db);
    const result = await handlers.get("holdings_storage_status")!({});
    const text = result.content[0]!.text;
    expect(text).not.toContain(secretDsn);
    expect(text).not.toContain("sup3rs3cr3t");
    const payload = parseMcp<Record<string, unknown>>(result);
    expect(Object.keys(payload).sort()).toEqual(["dsn_present", "migrations_applied", "mode", "remote_reachable", "sqlite_path"]);
  });

  it("holdings_storage_status reports remote_reachable honestly (null in the local build, never a hardcoded false)", async () => {
    delete process.env["HASNA_HOLDINGS_STORAGE_MODE"];
    delete process.env["HASNA_HOLDINGS_DATABASE_URL"];
    const db = makeDb();
    const handlers = captureMcpHandlers(db);
    const result = await handlers.get("holdings_storage_status")!({});
    const payload = parseMcp<{ mode: string; remote_reachable: boolean | null }>(result);
    expect(payload.mode).toBe("local");
    // Local build has no remote to reach: report unknown/not-applicable, not a fixed boolean.
    expect(payload.remote_reachable).toBeNull();
  });

  it("rejects unauthenticated /mcp requests", () => {
    delete process.env["HASNA_HOLDINGS_API_CREDENTIALS"];
    delete process.env["HASNA_HOLDINGS_MCP_AUTH"];
    const req = new Request("http://127.0.0.1:8893/mcp", { method: "POST" });
    expect(authenticateMcpRequest(req)).toBeNull();

    process.env["HASNA_HOLDINGS_API_CREDENTIALS"] = JSON.stringify([{ id: "c", token: "tok", roles: ["owner"] }]);
    const authed = new Request("http://127.0.0.1:8893/mcp", { method: "POST", headers: { Authorization: "Bearer tok" } });
    expect(authenticateMcpRequest(authed)?.credential_id).toBe("c");
  });

  it("keeps destructive tools out of the minimal profile", () => {
    process.env["HASNA_HOLDINGS_PROFILE"] = "minimal";
    expect(shouldRegisterTool("list_assets")).toBe(true);
    expect(shouldRegisterTool("delete_asset")).toBe(false);
    expect(shouldRegisterTool("update_asset")).toBe(false);
    expect(shouldRegisterTool("delete_registration")).toBe(false);
    // Standard + storage tools are always registered regardless of profile.
    expect(shouldRegisterTool("holdings_storage_status")).toBe(true);
    expect(shouldRegisterTool("register_agent")).toBe(true);

    process.env["HASNA_HOLDINGS_PROFILE"] = "full";
    expect(shouldRegisterTool("delete_asset")).toBe(true);
    expect(shouldRegisterTool("update_registration")).toBe(true);
  });

  it("mutating tools require the write scope (deny-by-default)", async () => {
    const { db, entityId } = seedFixture();
    const readonly: ApiPrincipal = {
      actor_id: "ro",
      credential_id: "ro",
      credential_type: "api_key",
      roles: ["viewer"],
      scopes: ["holdings:read"],
    };
    const handlers = captureMcpHandlers(db, readonly);
    const result = await handlers.get("create_asset")!({ entity_id: entityId, kind: "patent", name: "Blocked" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("PERMISSION_DENIED");
  });

  it("enforces cross-entity tenant isolation on the MCP surface with a real scoped principal", async () => {
    // Two-entity fixture, mirroring the /v1 cross-entity test in auth.test.ts but
    // driven through the MCP handlers with a scoped (entity_ids) credential rather
    // than the owner LOCAL_DEV_PRINCIPAL bypass.
    const db = makeDb();
    const sys = systemContext(db);
    const a = seedEntity(sys, { name: "Entity A" });
    const b = seedEntity(sys, { name: "Entity B" });
    const assetA = createAsset(sys, { entity_id: a.entity_id, kind: "trademark", name: "A-Mark" });
    const assetB = createAsset(sys, { entity_id: b.entity_id, kind: "trademark", name: "B-Mark" });

    const scoped: ApiPrincipal = {
      actor_id: "mgr-a",
      credential_id: "mgr-a",
      credential_type: "api_key",
      roles: ["holdings_manager"],
      scopes: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew"],
      entity_ids: [a.entity_id],
    };
    const handlers = captureMcpHandlers(db, scoped);

    // Own-entity read succeeds.
    const own = await handlers.get("get_asset")!({ id: assetA.id });
    expect(own.isError).toBeUndefined();
    expect(parseMcp<{ id: string }>(own).id).toBe(assetA.id);

    // Cross-entity read is denied (not merely empty).
    const cross = await handlers.get("get_asset")!({ id: assetB.id });
    expect(cross.isError).toBe(true);
    expect(cross.content[0]!.text).toContain("PERMISSION_DENIED");

    // list_assets returns only the principal's entity rows.
    const list = await handlers.get("list_assets")!({});
    const rows = parseMcp<Array<{ id: string }>>(list);
    expect(rows.map((r) => r.id)).toEqual([assetA.id]);
  });

  it("storage push/pull/sync are gated behind storage:admin", async () => {
    const { db, entityId } = seedFixture();
    void entityId;
    const nonAdmin: ApiPrincipal = {
      actor_id: "w",
      credential_id: "w",
      credential_type: "api_key",
      roles: ["holdings_manager"],
      scopes: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew"],
    };
    const handlers = captureMcpHandlers(db, nonAdmin);
    for (const tool of ["holdings_storage_push", "holdings_storage_pull", "holdings_storage_sync"]) {
      const result = await handlers.get(tool)!({});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("storage:admin");
    }
  });
});
