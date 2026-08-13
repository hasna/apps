import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDatabase } from "../src/db/database.js";
import { listAudit, recordAudit, verifyAuditChain } from "../src/db/audit.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-audit");
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
});

describe("append-only tamper-evident audit", () => {
  it("hash-chains inserted rows and verifies clean", () => {
    const db = getDatabase();
    const a = recordAudit(db, { actor_id: "u1", action: "create", resource: "slo", entity_id: "e1" });
    const b = recordAudit(db, { actor_id: "u1", action: "update", resource: "slo", entity_id: "e1" });
    expect(b.prev_hash).toBe(a.row_hash);
    expect(listAudit(db).length).toBe(2);
    expect(verifyAuditChain(db)).toEqual({ valid: true, checked: 2 });
  });

  it("forbids UPDATE on audit rows", () => {
    const db = getDatabase();
    recordAudit(db, { actor_id: "u1", action: "create", resource: "slo" });
    expect(() => db.run("UPDATE fleet_audit SET actor_id = 'attacker' WHERE seq = 1")).toThrow(/append-only/);
  });

  it("forbids DELETE on audit rows", () => {
    const db = getDatabase();
    recordAudit(db, { actor_id: "u1", action: "create", resource: "slo" });
    expect(() => db.run("DELETE FROM fleet_audit WHERE seq = 1")).toThrow(/append-only/);
  });

  it("detects a tampered chain (forged row_hash)", () => {
    const db = getDatabase();
    recordAudit(db, { actor_id: "u1", action: "create", resource: "slo" });
    // A forged insert with a bogus hash breaks the chain and is detected.
    db.run(
      "INSERT INTO fleet_audit (id, at, actor_id, action, resource, entity_id, detail, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["forged", new Date().toISOString(), "attacker", "tamper", "slo", null, "{}", "deadbeef", "deadbeef"],
    );
    const result = verifyAuditChain(db);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });
});
