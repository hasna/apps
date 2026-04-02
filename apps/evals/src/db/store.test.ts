import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { EvalRun } from "../types/index.js";

function makeRun(id: string, dataset = "test.jsonl"): EvalRun {
  return {
    id,
    createdAt: new Date().toISOString(),
    dataset,
    results: [],
    stats: { total: 5, passed: 4, failed: 1, unknown: 0, errors: 0, passRate: 0.8, totalDurationMs: 500, totalCostUsd: 0.01, totalTokens: 200 },
  };
}

beforeEach(() => { process.env["EVALS_DB_PATH"] = ":memory:"; });
afterEach(async () => {
  const { closeDatabase } = await import("./store.js");
  closeDatabase();
  delete process.env["EVALS_DB_PATH"];
});

describe("saveRun / getRun", () => {
  test("saves and retrieves a run", async () => {
    const { saveRun, getRun } = await import("./store.js");
    const run = makeRun("test-run-1");
    saveRun(run);
    const fetched = getRun("test-run-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe("test-run-1");
    expect(fetched!.stats.passRate).toBe(0.8);
  });

  test("partial ID matching works", async () => {
    const { saveRun, getRun } = await import("./store.js");
    saveRun(makeRun("abcdef1234567890"));
    const fetched = getRun("abcdef12");
    expect(fetched).not.toBeNull();
  });

  test("returns null for unknown run", async () => {
    const { getRun } = await import("./store.js");
    expect(getRun("nonexistent")).toBeNull();
  });
});

describe("listRuns", () => {
  test("lists runs in descending order", async () => {
    const { saveRun, listRuns } = await import("./store.js");
    saveRun(makeRun("run-a"));
    saveRun(makeRun("run-b"));
    const runs = listRuns(10);
    expect(runs.length).toBe(2);
  });

  test("filters by dataset", async () => {
    const { saveRun, listRuns } = await import("./store.js");
    saveRun(makeRun("run-1", "dataset-a.jsonl"));
    saveRun(makeRun("run-2", "dataset-b.jsonl"));
    const runs = listRuns(10, "dataset-a.jsonl");
    expect(runs.length).toBe(1);
    expect(runs[0]!.dataset).toBe("dataset-a.jsonl");
  });
});

describe("deleteRun", () => {
  test("deletes a saved run", async () => {
    const { saveRun, getRun, deleteRun } = await import("./store.js");
    saveRun(makeRun("del-run-1"));
    expect(getRun("del-run-1")).not.toBeNull();
    deleteRun("del-run-1");
    expect(getRun("del-run-1")).toBeNull();
  });

  test("deleting nonexistent run is a no-op", async () => {
    const { deleteRun, listRuns } = await import("./store.js");
    const before = listRuns(100).length;
    deleteRun("does-not-exist");
    expect(listRuns(100).length).toBe(before);
  });
});

describe("baselines", () => {
  test("set and get baseline", async () => {
    const { saveRun, setBaseline, getBaseline } = await import("./store.js");
    const run = makeRun("baseline-run-1");
    saveRun(run);
    setBaseline("main", "baseline-run-1");
    const baseline = getBaseline("main");
    expect(baseline).not.toBeNull();
    expect(baseline!.id).toBe("baseline-run-1");
  });

  test("overwrite baseline with same name", async () => {
    const { saveRun, setBaseline, getBaseline } = await import("./store.js");
    saveRun(makeRun("run-old"));
    saveRun(makeRun("run-new"));
    setBaseline("main", "run-old");
    setBaseline("main", "run-new");
    expect(getBaseline("main")!.id).toBe("run-new");
  });

  test("clearBaseline removes it", async () => {
    const { saveRun, setBaseline, getBaseline, clearBaseline } = await import("./store.js");
    saveRun(makeRun("run-x"));
    setBaseline("temp", "run-x");
    clearBaseline("temp");
    expect(getBaseline("temp")).toBeNull();
  });

  test("listBaselines returns all baselines", async () => {
    const { saveRun, setBaseline, listBaselines } = await import("./store.js");
    saveRun(makeRun("run-p"));
    saveRun(makeRun("run-q"));
    setBaseline("prod", "run-p");
    setBaseline("staging", "run-q");
    const baselines = listBaselines();
    expect(baselines.length).toBe(2);
  });
});
