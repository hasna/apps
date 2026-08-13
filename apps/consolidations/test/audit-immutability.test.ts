import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { verifyAuditChain } from "../src/db/audit.js";
import { openStore } from "../src/db/database.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

let dbPath: string;

beforeEach(() => {
  dbPath = useTempDb();
});
afterEach(() => cleanupTempDb(dbPath));

async function seedTwoEvents(): Promise<void> {
  const store = await openStore();
  await store.appendAudit({ event: "run.created", actor_id: "a", entity_id: null, detail: "one", created_at: "2026-01-01T00:00:00.000Z" });
  await store.appendAudit({ event: "run.computed", actor_id: "a", entity_id: null, detail: "two", created_at: "2026-01-01T00:00:01.000Z" });
  await store.close();
}

describe("append-only audit", () => {
  it("hash-chains events and verifies clean", async () => {
    await seedTwoEvents();
    const store = await openStore();
    const events = await store.listAudit();
    await store.close();
    expect(events).toHaveLength(2);
    expect(verifyAuditChain(events).ok).toBe(true);
  });

  it("rejects UPDATE and DELETE on the audit table (triggers)", async () => {
    await seedTwoEvents();
    const raw = new Database(dbPath);
    expect(() => raw.run("UPDATE audit_log SET detail = 'tampered' WHERE id = 1")).toThrow(/append-only/);
    expect(() => raw.run("DELETE FROM audit_log WHERE id = 1")).toThrow(/append-only/);
    raw.close();
  });

  it("detects a tampered chain", async () => {
    await seedTwoEvents();
    const store = await openStore();
    const events = await store.listAudit();
    await store.close();
    events[0]!.detail = "hacked";
    const result = verifyAuditChain(events);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});
