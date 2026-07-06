import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { seedFixture, type Fixture } from "./helpers.js";
import { appendAudit, listAudit, verifyAuditChain } from "../src/db/audit.js";

let fx: Fixture;
beforeEach(async () => {
  fx = await seedFixture();
});
afterEach(() => fx.cleanup());

describe("audit — append-only, tamper-evident", () => {
  it("has audit rows and a valid hash chain after seeding", async () => {
    const rows = await listAudit(fx.db);
    expect(rows.length).toBeGreaterThan(0);
    expect((await verifyAuditChain(fx.db)).ok).toBe(true);
  });

  it("refuses UPDATE on audit rows (trigger RAISE ABORT)", async () => {
    await expect(fx.db.run("UPDATE audit_log SET detail = 'tampered' WHERE id = 1")).rejects.toThrow(/append-only/);
  });

  it("refuses DELETE on audit rows", async () => {
    await expect(fx.db.run("DELETE FROM audit_log WHERE id = 1")).rejects.toThrow(/append-only/);
  });

  it("detects a broken hash chain", async () => {
    // A forged INSERT (allowed) with a bogus hash breaks chain verification.
    await fx.db.run(
      "INSERT INTO audit_log (entity_id, actor_id, action, detail, prev_hash, row_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [null, "attacker", "forge", "x", "deadbeef", "not-a-real-hash", new Date().toISOString()],
    );
    const result = await verifyAuditChain(fx.db);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).not.toBeNull();
  });

  it("keeps appending with a valid chain", async () => {
    await appendAudit(fx.db, { entity_id: fx.usId, actor_id: "tester", action: "test.event", detail: "ok" });
    expect((await verifyAuditChain(fx.db)).ok).toBe(true);
  });
});
