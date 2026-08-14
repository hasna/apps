import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { verifyLifecycleChain, appendLifecycleEvent, computeRowHash } from "../src/db/audit.js";
import { getDatabase } from "../src/db/database.js";
import { memberService, lifecycleService } from "../src/services/index.js";
import { cleanupTestDatabase, testEntity, useTestDatabase } from "./helpers/database.js";

let dbPath: string;
let entity: string;

beforeEach(() => {
  dbPath = useTestDatabase("audit");
  entity = testEntity();
});
afterEach(() => cleanupTestDatabase(dbPath));

function seed(): string {
  const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity, role: "Junior" });
  lifecycleService.recordRoleChange({ member_id: m.id, to_role: "Senior" });
  return m.id;
}

describe("append-only, tamper-evident lifecycle audit", () => {
  it("blocks UPDATE on audit rows via trigger", () => {
    seed();
    const db = getDatabase();
    expect(() => db.run("UPDATE lifecycle_events SET reason = 'tampered'")).toThrow(/append-only/i);
  });

  it("blocks DELETE on audit rows via trigger", () => {
    seed();
    const db = getDatabase();
    expect(() => db.run("DELETE FROM lifecycle_events")).toThrow(/append-only/i);
  });

  it("verifies an intact chain", () => {
    seed();
    expect(verifyLifecycleChain(getDatabase()).valid).toBe(true);
  });

  it("detects a tampered row once triggers are bypassed", () => {
    seed();
    const db = getDatabase();
    // Simulate an attacker with raw DB access removing the guard triggers.
    db.run("DROP TRIGGER IF EXISTS lifecycle_events_no_update");
    db.run("UPDATE lifecycle_events SET reason = 'tampered'");
    const result = verifyLifecycleChain(db);
    expect(result.valid).toBe(false);
    expect(result.broken_at).toBeDefined();
  });

  it("verifies under a same-millisecond append whose UUID sorts smaller (regression)", () => {
    const db = getDatabase();
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity, role: "Junior" });
    const a = appendLifecycleEvent(db, {
      member_id: m.id,
      event_type: "role_change",
      effective_date: "2026-01-01",
      to_role: "Senior",
    });
    // Byte-exact same-ms append: identical recorded_at, UUID guaranteed smaller
    // than A's, chained onto A via the normal hash computation. (recorded_at, id)
    // would order this row BEFORE A; append order must govern the chain.
    const bId = "00000000-0000-4000-8000-000000000000";
    const bHash = computeRowHash(a.row_hash, {
      id: bId,
      member_id: m.id,
      event_type: "role_change",
      effective_date: "2026-01-01",
      from_role: null,
      to_role: null,
      reason: null,
      recorded_at: a.recorded_at,
    });
    db.run(
      `INSERT INTO lifecycle_events (id, member_id, event_type, effective_date, from_role, to_role, reason, recorded_at, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bId, m.id, "role_change", "2026-01-01", null, null, null, a.recorded_at, a.row_hash, bHash],
    );
    const v = verifyLifecycleChain(db);
    expect(v.valid).toBe(true);
    // hire (from createMember) + role_change + the same-ms adversarial append.
    expect(v.checked).toBe(3);
  });
});
