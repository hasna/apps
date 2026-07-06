import { describe, expect, it } from "bun:test";
import { makeDb } from "./helpers/harness.js";
import { appendAudit, listAudit, verifyAuditChain } from "../src/db/audit.js";

describe("append-only tamper-evident audit", () => {
  it("hash-chains rows and verifies the chain", () => {
    const db = makeDb();
    appendAudit(db, { action: "asset.create", resource: "asset", resource_id: "a1", actor_id: "u1" });
    appendAudit(db, { action: "asset.update", resource: "asset", resource_id: "a1", actor_id: "u1" });
    const rows = listAudit(db);
    expect(rows.length).toBe(2);
    expect(rows[0]!.prev_hash).toBe("GENESIS");
    expect(rows[1]!.prev_hash).toBe(rows[0]!.row_hash);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("forbids UPDATE on audit rows", () => {
    const db = makeDb();
    appendAudit(db, { action: "x", resource: "asset", actor_id: "u1" });
    expect(() => db.run("UPDATE audit_events SET action = 'tampered' WHERE id = 1")).toThrow(/append-only/);
  });

  it("forbids DELETE on audit rows", () => {
    const db = makeDb();
    appendAudit(db, { action: "x", resource: "asset", actor_id: "u1" });
    expect(() => db.run("DELETE FROM audit_events WHERE id = 1")).toThrow(/append-only/);
  });

  it("detects a tampered chain (row_hash mismatch)", () => {
    const db = makeDb();
    appendAudit(db, { action: "a", resource: "asset", actor_id: "u1" });
    appendAudit(db, { action: "b", resource: "asset", actor_id: "u1" });
    // Bypass the app triggers by rewriting row_hash via a raw statement that the
    // triggers still block — so simulate tamper by dropping triggers first.
    db.run("DROP TRIGGER audit_events_no_update");
    db.run("UPDATE audit_events SET action = 'tampered' WHERE id = 1");
    const result = verifyAuditChain(db);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBeDefined();
  });
});
