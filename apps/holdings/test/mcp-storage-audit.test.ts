// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 4): the
// AUTHORIZED arm of the storage MCP tools had no tests at origin/main —
// mcp-safety.test.ts only covers the unauthorized arm. These tests pin:
// storage:admin authorization succeeding for push/pull/sync, AUDIT_TABLES
// filtered out of the returned table list (and out of the audit payload), the
// local-build result {ok:false} with "authorized and audited but not executed",
// exactly one audit row per call recording action storage.<verb> with the
// filtered table list and the caller's actor_id, the empty-table arm, the
// unauthorized arm recording ZERO audit rows, and the pagination contract:
// mcpListOptionsSchema parses limit/cursor bounds, and per Sol the REAL list
// tools are verified — today they do not apply limit/cursor (the parsed schema
// is not wired to any list tool), and the two-sided probe below pins that gap
// exactly so a future wiring change is visible.
import { describe, expect, it } from "bun:test";
import { captureMcpHandlers, makeDb, parseMcp } from "./helpers/harness.js";
import { AUDIT_TABLES, SYNC_TABLES } from "../src/db/schema.js";
import { DEFAULT_MCP_LIMIT, MAX_MCP_LIMIT, mcpListOptionsSchema } from "../src/mcp/compact.js";
import { SCHEMAS } from "../src/mcp/tools/domain.js";
import type { ApiPrincipal } from "../src/server/auth.js";
import { seedEntity } from "../src/services/entities.js";
import { systemContext } from "../src/services/runtime.js";

const storageAdmin: ApiPrincipal = {
  actor_id: "storage-bot",
  credential_id: "storage-bot",
  credential_type: "api_key",
  roles: ["viewer"],
  scopes: ["storage:admin"],
};

const nonAdmin: ApiPrincipal = {
  actor_id: "plain-viewer",
  credential_id: "plain-viewer",
  credential_type: "api_key",
  roles: ["viewer"],
  scopes: ["holdings:read"],
};

function auditCount(db: ReturnType<typeof makeDb>): number {
  return db.query<{ id: number }, []>("SELECT COUNT(*) AS id FROM audit_events").get()!.id;
}

function lastAuditRow(db: ReturnType<typeof makeDb>) {
  return db
    .query<{ event_id: string; action: string; resource: string; actor_id: string; payload: string }, []>(
      "SELECT event_id, action, resource, actor_id, payload FROM audit_events ORDER BY id DESC LIMIT 1",
    )
    .get()!;
}

describe("storage push/pull/sync — authorized arm", () => {
  it("authorizes storage:admin and returns the honest local-build result for every verb", async () => {
    for (const verb of ["push", "pull", "sync"] as const) {
      const db = makeDb();
      const handlers = captureMcpHandlers(db, storageAdmin);
      const result = await handlers.get(`holdings_storage_${verb}`)!({});
      expect(result.isError, `${verb} must not error`).toBeUndefined();

      const payload = parseMcp<{ ok: boolean; action: string; tables: string[]; excluded: string[]; note: string }>(result);
      expect(payload.ok).toBe(false); // local build: authorized + audited but NOT executed
      expect(payload.action).toBe(verb);
      expect(payload.tables).toEqual([...SYNC_TABLES]); // default table set
      expect(payload.excluded).toEqual([...AUDIT_TABLES]);
      expect(payload.note).toContain("authorized and audited but not executed");
    }
  });

  it("records exactly ONE audit row per call with action storage.<verb>, the filtered tables and the actor", async () => {
    const db = makeDb();
    const handlers = captureMcpHandlers(db, storageAdmin);
    const before = auditCount(db);
    await handlers.get("holdings_storage_push")!({ tables: ["assets", "audit_events"] });
    const after = auditCount(db);
    expect(after).toBe(before + 1);

    const row = lastAuditRow(db);
    expect(row.action).toBe("storage.push");
    expect(row.resource).toBe("storage");
    expect(row.actor_id).toBe("storage-bot");
    const payload = JSON.parse(row.payload) as { tables: string[] };
    // The audit payload carries the FILTERED list: audit_events is excluded.
    expect(payload.tables).toEqual(["assets"]);
  });

  it("an explicit table allowlist narrows the transfer set and the audit record", async () => {
    const db = makeDb();
    const handlers = captureMcpHandlers(db, storageAdmin);
    const result = await handlers.get("holdings_storage_pull")!({ tables: ["entities"] });
    const payload = parseMcp<{ tables: string[] }>(result);
    expect(payload.tables).toEqual(["entities"]);
    const row = lastAuditRow(db);
    expect(row.action).toBe("storage.pull");
    expect(JSON.parse(row.payload) as { tables: string[] }).toEqual({ tables: ["entities"] });
  });

  it("the empty-table arm: an allowlist consisting only of audit tables yields an empty transfer set", async () => {
    const db = makeDb();
    const handlers = captureMcpHandlers(db, storageAdmin);
    const before = auditCount(db);
    const result = await handlers.get("holdings_storage_sync")!({ tables: ["audit_events"] });
    const payload = parseMcp<{ ok: boolean; tables: string[]; excluded: string[] }>(result);
    expect(payload.ok).toBe(false);
    expect(payload.tables).toEqual([]);
    expect(payload.excluded).toEqual([...AUDIT_TABLES]);
    expect(auditCount(db)).toBe(before + 1); // still authorized + audited
  });
});

describe("storage push/pull/sync — unauthorized arm records no audit", () => {
  it("denies a non-admin principal with PERMISSION_DENIED and writes ZERO audit rows", async () => {
    const db = makeDb();
    const handlers = captureMcpHandlers(db, nonAdmin);
    const before = auditCount(db);
    for (const tool of ["holdings_storage_push", "holdings_storage_pull", "holdings_storage_sync"]) {
      const result = await handlers.get(tool)!({});
      expect(result.isError).toBe(true);
      const envelope = parseMcp<{ code: string; message: string }>(result);
      expect(envelope.code).toBe("PERMISSION_DENIED");
      expect(envelope.message).toContain("storage:admin");
    }
    // An unauthorized attempt must not be recorded as an authorized audit event.
    expect(auditCount(db)).toBe(before);
  });
});

describe("pagination contract — schema bounds and real list-tool behavior", () => {
  it("mcpListOptionsSchema accepts the inclusive 1..100 limit range and defaults, rejects 0 and >100", () => {
    expect(DEFAULT_MCP_LIMIT).toBe(25);
    expect(MAX_MCP_LIMIT).toBe(100);
    for (const limit of [1, 25, 100, undefined]) {
      expect(mcpListOptionsSchema.limit.safeParse(limit).success, `limit=${String(limit)}`).toBe(true);
    }
    for (const limit of [0, -1, 101, 1000, 1.5, Number.NaN]) {
      expect(mcpListOptionsSchema.limit.safeParse(limit).success, `limit=${limit}`).toBe(false);
    }
  });

  it("mcpListOptionsSchema accepts zero-based cursors and rejects negatives", () => {
    expect(mcpListOptionsSchema.cursor.safeParse(0).success).toBe(true);
    expect(mcpListOptionsSchema.cursor.safeParse(25).success).toBe(true);
    expect(mcpListOptionsSchema.cursor.safeParse(undefined).success).toBe(true);
    expect(mcpListOptionsSchema.cursor.safeParse(-1).success).toBe(false);
    expect(mcpListOptionsSchema.cursor.safeParse(1.5).success).toBe(false);
  });

  it("REAL list tools today do not apply limit/cursor — the parsed schema is not wired to any list tool", async () => {
    // Sol: verify a real list tool actually applies limit and cursor rather than
    // merely parsing them. The verified current state (origin/main): the schema
    // parses (positive arm below) but no list tool exposes or honors it — a
    // {limit:1} call returns every row (negative arm), so a caller cannot page.
    const db = makeDb();
    const sys = systemContext(db);
    seedEntity(sys, { name: "Entity 1" });
    seedEntity(sys, { name: "Entity 2" });
    seedEntity(sys, { name: "Entity 3" });

    // The tool's declared schema has no pagination keys.
    expect("limit" in SCHEMAS["list_assets"]!).toBe(false);
    expect("cursor" in SCHEMAS["list_assets"]!).toBe(false);
    expect("limit" in SCHEMAS["list_entities"]!).toBe(false);

    // Positive arm: the parsed schema accepts the same input shape a caller would send.
    expect(mcpListOptionsSchema.limit.safeParse(1).success).toBe(true);

    // Negative arm (the gap): the real handler ignores limit entirely and returns all rows.
    const handlers = captureMcpHandlers(db);
    const withLimit = await handlers.get("list_entities")!({ limit: 1 });
    const withoutLimit = await handlers.get("list_entities")!({});
    expect(parseMcp<Array<{ name: string }>>(withLimit).map((e) => e.name).sort()).toEqual(["Entity 1", "Entity 2", "Entity 3"]);
    expect(parseMcp<Array<{ name: string }>>(withoutLimit).map((e) => e.name).sort()).toEqual(["Entity 1", "Entity 2", "Entity 3"]);
  });
});
