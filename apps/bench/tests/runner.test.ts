import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeMetricPayload, openBenchStorage, runFixtureAdapter } from "../src/index.js";

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_BENCH_HOME: home,
    HASNA_BENCH_DB_PATH: join(home, "bench.db")
  };
}

describe("@hasna/bench fixture runners", () => {
  it("normalizes object and array metric payloads", () => {
    expect(normalizeMetricPayload({ accuracy: 0.7 }, ["accuracy"])).toEqual([
      { metricId: "accuracy", value: 0.7, unit: undefined, direction: undefined }
    ]);
    expect(normalizeMetricPayload({ metrics: [{ id: "ttft", value: 1.2, unit: "seconds" }] }, ["ttft"])).toEqual([
      { metricId: "ttft", value: 1.2, unit: "seconds", direction: undefined }
    ]);
    expect(() => normalizeMetricPayload({ secret_metric: 1 }, ["accuracy"])).toThrow(/not declared/);
  });

  it("runs a fixture command, persists metrics, and records evidence", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-runner-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      const result = await runFixtureAdapter(storage, {
        benchmarkId: "promptfoo",
        modelId: "fixture/model",
        provider: "fixture-provider",
        payload: { metrics: [{ metricId: "score", value: 0.91 }, { metricId: "pass_rate", value: 0.8 }] },
        secretRefs: ["OPENAI_API_KEY"],
        network: true
      });

      expect(result.ok).toBe(true);
      expect(result.metrics.map((metric) => metric.metricId)).toEqual(["score", "pass_rate"]);
      expect((storage.db.prepare("SELECT COUNT(*) as count FROM metrics").get() as { count: number } | null)?.count).toBe(2);
      expect((storage.db.prepare("SELECT COUNT(*) as count FROM result_segments").get() as { count: number } | null)?.count).toBe(2);
      const segmentPath = (storage.db.prepare(
        "SELECT segment_path FROM result_segments WHERE event_type = 'evidence-manifest'"
      ).get() as { segment_path: string } | null)?.segment_path;
      expect(segmentPath).toBeTruthy();
      expect(readFileSync(segmentPath!, "utf8")).toContain("bench.evidence.v1");
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails closed for undeclared metrics and non-fixture benchmarks", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-runner-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    try {
      await expect(runFixtureAdapter(storage, {
        benchmarkId: "promptfoo",
        modelId: "fixture/model",
        provider: "fixture-provider",
        payload: { metrics: [{ metricId: "undeclared_metric", value: 1 }] },
        secretRefs: ["OPENAI_API_KEY"],
        network: true
      })).rejects.toThrow(/not declared/);
      await expect(runFixtureAdapter(storage, {
        benchmarkId: "swe-bench",
        modelId: "fixture/model",
        provider: "fixture-provider",
        payload: { metrics: [{ metricId: "resolved", value: 1 }] }
      })).rejects.toThrow(/not enabled|sandbox-required/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
