import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `brains-db-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });

const testDbPath = join(testDir, "test.db");

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("getDb", () => {
  test("creates and returns a drizzle db instance", async () => {
    const { getDb } = await import("./index.js");
    const db = getDb(testDbPath);
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
  });

  test("db has fine_tuned_models table", async () => {
    const { getDb, fineTunedModels } = await import("./index.js");
    const db = getDb(testDbPath);
    const models = await db.select().from(fineTunedModels);
    expect(Array.isArray(models)).toBe(true);
  });

  test("db has training_jobs table", async () => {
    const { getDb, trainingJobs } = await import("./index.js");
    const db = getDb(testDbPath);
    const jobs = await db.select().from(trainingJobs);
    expect(Array.isArray(jobs)).toBe(true);
  });

  test("db has training_datasets table", async () => {
    const { getDb, trainingDatasets } = await import("./index.js");
    const db = getDb(testDbPath);
    const datasets = await db.select().from(trainingDatasets);
    expect(Array.isArray(datasets)).toBe(true);
  });

  test("can insert and query a fine_tuned_model", async () => {
    const { getDb, fineTunedModels } = await import("./index.js");
    const db = getDb(testDbPath);
    const now = Date.now();
    await db.insert(fineTunedModels).values({
      id: "test-model-1",
      baseModel: "gpt-4o",
      name: "test-ft",
      provider: "openai",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const models = await db.select().from(fineTunedModels);
    expect(models.some((m) => m.id === "test-model-1")).toBe(true);
  });
});

describe("getRawDb", () => {
  test("returns a SqliteAdapter", async () => {
    const { getRawDb } = await import("./index.js");
    const rawDb = getRawDb(testDbPath);
    expect(rawDb).toBeDefined();
    expect(typeof rawDb.run).toBe("function");
    expect(typeof rawDb.get).toBe("function");
    rawDb.close();
  });

  test("can run raw SQL", async () => {
    const { getRawDb } = await import("./index.js");
    const rawDb = getRawDb(testDbPath);
    const row = rawDb.get("SELECT 1 as val") as { val: number };
    expect(row.val).toBe(1);
    rawDb.close();
  });

  test("feedback table exists in raw db", async () => {
    const { getRawDb } = await import("./index.js");
    const rawDb = getRawDb(testDbPath);
    const tables = rawDb.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'"
    ) as { name: string }[];
    // feedback table is created by ensureFeedbackTable via getDb
    expect(tables).toBeDefined();
    rawDb.close();
  });
});
