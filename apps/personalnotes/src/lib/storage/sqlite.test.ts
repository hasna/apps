import { describe, expect, test } from "bun:test";
import { runStorageContractSuite } from "./storage-contract-suite.js";
import { SqliteAuthStorage } from "./sqlite.js";

describe("SqliteAuthStorage", () => {
  test("migrate is idempotent and dry-run reports pending before applying", async () => {
    const storage = new SqliteAuthStorage({ path: ":memory:" });
    const dry = await storage.migrate({ dryRun: true });
    expect(dry.pending).toContain("0001_init");
    expect(dry.applied.length).toBe(0);

    const first = await storage.migrate();
    expect(first.applied).toContain("0001_init");

    const second = await storage.migrate();
    expect(second.applied.length).toBe(0);
    expect(second.pending.length).toBe(0);
    await storage.close();
  });
});

runStorageContractSuite("SqliteAuthStorage", async () => {
  const storage = new SqliteAuthStorage({ path: ":memory:" });
  await storage.migrate();
  return storage;
});
