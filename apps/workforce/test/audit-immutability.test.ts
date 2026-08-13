import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { verifyLifecycleChain } from "../src/db/audit.js";
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
});
