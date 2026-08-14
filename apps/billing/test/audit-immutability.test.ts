import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { appendAudit, verifyAuditChain, computeRowHash, AUDIT_GENESIS_HASH } from "../src/db/audit.js";
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

  it("verifies under a same-millisecond append whose UUID sorts smaller (regression)", () => {
    const a = appendAudit(db, { entity_id: TEST_ENTITY_A, actor_id: "a", action: "x", resource: "r", resource_id: "1" });
    // Byte-exact same-ms append: identical created_at, UUID guaranteed smaller
    // than A's, chained onto A via the normal hash computation. (created_at, id)
    // would order this row BEFORE A; append order must govern the chain.
    const bId = "00000000-0000-4000-8000-000000000000";
    const bHash = computeRowHash({
      entity_id: TEST_ENTITY_A,
      actor_id: "a",
      action: "y",
      resource: "r",
      resource_id: "2",
      detail: null,
      created_at: a.created_at,
      prev_hash: a.row_hash,
    });
    db.run(
      `INSERT INTO audit_log (id, entity_id, actor_id, action, resource, resource_id, detail, prev_hash, row_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bId, TEST_ENTITY_A, "a", "y", "r", "2", null, a.row_hash, bHash, a.created_at],
    );
    const v = verifyAuditChain(db);
    expect(v.valid).toBe(true);
    expect(v.count).toBe(2);
  });
});
