import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase, type ContactsDatabase } from "../db/database.js";
import {
  createAudience,
  getAudience,
  listSuppressions,
  suppressAddress,
} from "../db/audiences.js";
import { syncSuppressions, type SuppressionSyncAdapter } from "./mailery-sync.js";

let tmpDir: string;
let db: ContactsDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

function mockAdapter(fail: string[] = []): { adapter: SuppressionSyncAdapter; pushed: string[] } {
  const pushed: string[] = [];
  const adapter: SuppressionSyncAdapter = {
    name: "mock-mailery",
    suppress(email: string) {
      if (fail.includes(email)) throw new Error(`refused: ${email}`);
      pushed.push(email);
    },
  };
  return { adapter, pushed };
}

describe("syncSuppressions", () => {
  it("pushes unsynced email suppressions through the adapter and stamps synced_at", async () => {
    suppressAddress({ channel: "email", address: "a@example.com", reason: "unsubscribe" }, db);
    suppressAddress({ channel: "email", address: "b@example.com" }, db);
    suppressAddress({ channel: "telegram", address: "@ignored" }, db);
    const { adapter, pushed } = mockAdapter();

    const result = await syncSuppressions({ adapter, db });

    expect(result.adapter).toBe("mock-mailery");
    expect(result.pending).toBe(2);
    expect(result.pushed).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(pushed.sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(listSuppressions({ channel: "email", unsyncedOnly: true }, db)).toHaveLength(0);
    // telegram suppression is not pushed to a mail system
    expect(listSuppressions({ channel: "telegram", unsyncedOnly: true }, db)).toHaveLength(1);
  });

  it("stamps suppression_synced_at on audiences after a clean sync", async () => {
    const audience = createAudience({
      audience_id: "seg", name: "S", predicates: [{ kind: "tag", value: "x" }],
    }, db);
    expect(audience.suppression_synced_at).toBeNull();
    suppressAddress({ channel: "email", address: "a@example.com" }, db);

    const result = await syncSuppressions({ adapter: mockAdapter().adapter, db });
    expect(result.synced_at).toBeTruthy();
    expect(getAudience(audience.id, db).suppression_synced_at).toBe(result.synced_at);
  });

  it("keeps failed pushes unsynced and reports them", async () => {
    suppressAddress({ channel: "email", address: "ok@example.com" }, db);
    suppressAddress({ channel: "email", address: "bad@example.com" }, db);
    const { adapter, pushed } = mockAdapter(["bad@example.com"]);

    const result = await syncSuppressions({ adapter, db });

    expect(result.pushed).toBe(1);
    expect(result.failed).toEqual([{ address: "bad@example.com", error: "refused: bad@example.com" }]);
    expect(pushed).toEqual(["ok@example.com"]);
    const unsynced = listSuppressions({ channel: "email", unsyncedOnly: true }, db);
    expect(unsynced.map((s) => s.address)).toEqual(["bad@example.com"]);
  });

  it("does not stamp audiences when any push fails", async () => {
    const audience = createAudience({
      audience_id: "seg", name: "S", predicates: [{ kind: "tag", value: "x" }],
    }, db);
    suppressAddress({ channel: "email", address: "bad@example.com" }, db);

    await syncSuppressions({ adapter: mockAdapter(["bad@example.com"]).adapter, db });
    expect(getAudience(audience.id, db).suppression_synced_at).toBeNull();
  });

  it("dry run reports pending without pushing", async () => {
    suppressAddress({ channel: "email", address: "a@example.com" }, db);
    const { adapter, pushed } = mockAdapter();

    const result = await syncSuppressions({ adapter, dryRun: true, db });

    expect(result.dry_run).toBe(true);
    expect(result.pending).toBe(1);
    expect(result.pushed).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(listSuppressions({ channel: "email", unsyncedOnly: true }, db)).toHaveLength(1);
  });

  it("dry run does not require the optional mailery adapter", async () => {
    suppressAddress({ channel: "email", address: "preview@example.com" }, db);

    const result = await syncSuppressions({ dryRun: true, db });

    expect(result).toMatchObject({
      adapter: "mailery",
      dry_run: true,
      pending: 1,
      pushed: 0,
      failed: [],
      synced_at: null,
    });
  });

  it("no-op sync still stamps audiences (nothing pending)", async () => {
    const audience = createAudience({
      audience_id: "seg", name: "S", predicates: [{ kind: "tag", value: "x" }],
    }, db);

    const result = await syncSuppressions({ adapter: mockAdapter().adapter, db });
    expect(result.pending).toBe(0);
    expect(result.pushed).toBe(0);
    expect(result.synced_at).toBeTruthy();
    expect(getAudience(audience.id, db).suppression_synced_at).toBe(result.synced_at);
  });
});
