import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDatabase } from "../src/db/database.js";
import { appendAuditEvent, verifyAuditChain } from "../src/db/audit.js";
import { AUDIT_TABLE } from "../src/db/schema.js";
import { createIdentity } from "../src/services/identities.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";
import { randomUUID } from "node:crypto";

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("access-audit");
});
afterEach(() => cleanupTestDatabase(dbPath));

describe("append-only tamper-evident audit", () => {
  it("appends a valid hash chain", () => {
    const db = getDatabase();
    createIdentity({ entity_id: randomUUID(), kind: "agent", name: "a" });
    appendAuditEvent(db, { event_type: "test.event", actor: "tester", payload: { n: 1 } });
    const result = verifyAuditChain(db);
    expect(result.valid).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(2);
  });

  it("blocks UPDATE on audit rows", () => {
    const db = getDatabase();
    appendAuditEvent(db, { event_type: "test.event", actor: "tester", payload: { n: 1 } });
    expect(() => db.run(`UPDATE ${AUDIT_TABLE} SET payload = '{"n":2}' WHERE id = 1`)).toThrow();
  });

  it("blocks DELETE on audit rows", () => {
    const db = getDatabase();
    appendAuditEvent(db, { event_type: "test.event", actor: "tester", payload: { n: 1 } });
    expect(() => db.run(`DELETE FROM ${AUDIT_TABLE} WHERE id = 1`)).toThrow();
  });

  it("detects a tampered chain", () => {
    const db = getDatabase();
    appendAuditEvent(db, { event_type: "test.a", actor: "tester", payload: { n: 1 } });
    appendAuditEvent(db, { event_type: "test.b", actor: "tester", payload: { n: 2 } });
    expect(verifyAuditChain(db).valid).toBe(true);
    // Bypass the append-only triggers to simulate an attacker with raw DB access.
    db.run(`DROP TRIGGER ${AUDIT_TABLE}_no_update`);
    db.run(`UPDATE ${AUDIT_TABLE} SET payload = '{"n":999}' WHERE id = 1`);
    const result = verifyAuditChain(db);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});
