import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { appendAudit, verifyAuditChain, AUDIT_GENESIS_HASH } from "../src/db/audit.js";
import type { Database } from "bun:sqlite";

let db: Database;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => closeDatabase());

describe("append-only audit (§4.7)", () => {
  it("hash-chains appended rows and verifies the chain", () => {
    appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "x", resource: "r", resource_id: "1" });
    appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "y", resource: "r", resource_id: "2" });
    const v = verifyAuditChain(db);
    expect(v.valid).toBe(true);
    expect(v.count).toBe(2);
  });

  it("forbids UPDATE on an audit row (RAISE(ABORT) trigger)", () => {
    const row = appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "x", resource: "r", resource_id: "1" });
    expect(() => db.run("UPDATE audit_log SET detail = 'tampered' WHERE id = ?", [row.id])).toThrow(/append-only/);
  });

  it("forbids DELETE on an audit row (RAISE(ABORT) trigger)", () => {
    const row = appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "x", resource: "r", resource_id: "1" });
    expect(() => db.run("DELETE FROM audit_log WHERE id = ?", [row.id])).toThrow(/append-only/);
  });

  it("detects a tampered/forged chain link", () => {
    appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "x", resource: "r", resource_id: "1" });
    // Forge a row with a bad prev_hash (INSERT is allowed; the chain breaks).
    db.run(
      `INSERT INTO audit_log (id, entity_id, actor_id, action, resource, resource_id, detail, prev_hash, row_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["forged", TEST_ENTITY_A, "attacker", "grant", "audit_log", null, "injected", AUDIT_GENESIS_HASH, "deadbeef", new Date().toISOString()],
    );
    const v = verifyAuditChain(db);
    expect(v.valid).toBe(false);
    expect(v.broken_at).toBe("forged");
  });
});
