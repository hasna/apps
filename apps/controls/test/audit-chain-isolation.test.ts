// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy } from "../src/services/policies.js";
import { listAuditEvents, recordAuditEvent, verifyAuditIntegrity } from "../src/db/audit.js";

describe("audit: per-entity chains are isolated", () => {
  it("interleaved events for two entities each form a clean, independent chain", () => {
    const db = memoryDb();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    recordAuditEvent(db, { entity_id: a, actor_id: "a1", action: "policy.create", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: b, actor_id: "b1", action: "policy.create", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: a, actor_id: "a2", action: "policy.update", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: b, actor_id: "b2", action: "policy.delete", resource_type: "policy", detail: {} });

    const chainA = verifyAuditIntegrity(db, a);
    expect(chainA.valid).toBe(true);
    expect(chainA.event_count).toBe(2);
    const chainB = verifyAuditIntegrity(db, b);
    expect(chainB.valid).toBe(true);
    expect(chainB.event_count).toBe(2);

    const eventsA = listAuditEvents(db, a);
    const eventsB = listAuditEvents(db, b);
    expect(eventsA[0]!.prev_hash).toBe("");
    expect(eventsA[1]!.prev_hash).toBe(eventsA[0]!.row_hash);
    expect(eventsB[0]!.prev_hash).toBe("");
    expect(eventsB[1]!.prev_hash).toBe(eventsB[0]!.row_hash);
    // The chains are independent: A's head is not B's head.
    expect(chainA.head_hash).not.toBe(chainB.head_hash);
  });

  it("tampering inside entity A's chain does not invalidate entity B's chain", () => {
    const db = memoryDb();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    recordAuditEvent(db, { entity_id: a, actor_id: "a1", action: "policy.create", resource_type: "policy", amount: 100, currency: "USD", detail: {} });
    recordAuditEvent(db, { entity_id: a, actor_id: "a2", action: "policy.update", resource_type: "policy", amount: 200, currency: "USD", detail: {} });
    recordAuditEvent(db, { entity_id: b, actor_id: "b1", action: "policy.create", resource_type: "policy", amount: 300, currency: "USD", detail: {} });

    // Corrupt A's second row (drop the append-only trigger, then mutate).
    db.run("DROP TRIGGER controls_audit_no_update");
    db.run("UPDATE controls_audit SET amount = 999 WHERE entity_id = ?", [a]);

    const chainA = verifyAuditIntegrity(db, a);
    expect(chainA.valid).toBe(false);
    expect(chainA.issues.some((i) => i.code === "hash_mismatch")).toBe(true);
    const chainB = verifyAuditIntegrity(db, b);
    expect(chainB.valid).toBe(true);
  });

  it("detects a broken chain link when a middle prev_hash is rewritten", () => {
    const db = memoryDb();
    const e = crypto.randomUUID();
    recordAuditEvent(db, { entity_id: e, actor_id: "a1", action: "policy.create", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: e, actor_id: "a2", action: "policy.update", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: e, actor_id: "a3", action: "policy.delete", resource_type: "policy", detail: {} });

    db.run("DROP TRIGGER controls_audit_no_update");
    db.run("UPDATE controls_audit SET prev_hash = 'deadbeef' WHERE action = 'policy.update'");

    const result = verifyAuditIntegrity(db, e);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "previous_hash_mismatch")).toBe(true);
  });
});

describe("audit: global events chain separately from entity chains", () => {
  it("a global event's genesis does not disturb an entity chain", () => {
    const db = memoryDb();
    const e = crypto.randomUUID();
    recordAuditEvent(db, { entity_id: null, actor_id: "g1", action: "policy.create", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: e, actor_id: "a1", action: "policy.create", resource_type: "policy", detail: {} });
    recordAuditEvent(db, { entity_id: null, actor_id: "g2", action: "policy.update", resource_type: "policy", detail: {} });

    const chain = verifyAuditIntegrity(db, e);
    expect(chain.valid).toBe(true);
    expect(chain.event_count).toBe(1);
    const events = listAuditEvents(db, e);
    expect(events[0]!.prev_hash).toBe("");
  });

  it("an entity chain that never writes an audit event verifies as an empty valid chain", () => {
    const db = memoryDb();
    const e = crypto.randomUUID();
    const result = verifyAuditIntegrity(db, e);
    expect(result.valid).toBe(true);
    expect(result.event_count).toBe(0);
  });

  it("service-level money operations chain into the entity audit trail", () => {
    const db = memoryDb();
    const e = crypto.randomUUID();
    createPolicy(db, { entity_id: e, window: "day", amount_limit: 1000, currency: "USD" }, SYS);
    const result = verifyAuditIntegrity(db, e);
    expect(result.valid).toBe(true);
    const events = listAuditEvents(db, e);
    expect(events.map((ev) => ev.action)).toContain("policy.create");
  });
});
