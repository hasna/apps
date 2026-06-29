import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBenchSDK, parseBenchmarkManifest, seedBenchmarks } from "../src/index.js";

describe("@hasna/bench scaffold", () => {
  it("ships a seed benchmark registry", () => {
    const ids = seedBenchmarks.map((entry) => entry.id);
    expect(ids).toEqual([
      "lm-evaluation-harness",
      "inspect-ai",
      "helm",
      "opencompass",
      "lighteval",
      "swe-bench",
      "evalplus",
      "livecodebench",
      "bfcl",
      "ragas",
      "promptfoo",
      "xstest",
      "llmperf"
    ]);
  });

  it("validates benchmark manifests", () => {
    const parsed = parseBenchmarkManifest(seedBenchmarks[0]);
    expect(parsed.id).toBe(seedBenchmarks[0].id);
    expect(parsed.schemaVersion).toBe("bench.manifest.v1");
    expect(parsed.sources[0].verifiedAt).toBe("2026-06-29");
  });

  it("rejects malformed benchmark manifest objects", () => {
    expect(() => parseBenchmarkManifest({ id: "" })).toThrow();
  });

  it("validates and rejects benchmark manifest fixtures", () => {
    const valid = JSON.parse(readFileSync(join(process.cwd(), "examples", "benchmark.valid.json"), "utf8"));
    const invalid = JSON.parse(readFileSync(join(process.cwd(), "examples", "benchmark.invalid.json"), "utf8"));

    expect(parseBenchmarkManifest(valid).id).toBe("example-fixture");
    expect(() => parseBenchmarkManifest(invalid)).toThrow();
  });

  it("rejects contradictory runner and safety metadata", () => {
    const manifest = structuredClone(seedBenchmarks[0]);
    manifest.safety = {
      class: "offline-safe",
      allowsNetwork: false,
      requiresSandbox: false,
      requiresSecrets: false,
      costRisk: "none"
    };

    expect(() => parseBenchmarkManifest(manifest)).toThrow(/Networked runners cannot be classified as offline-safe/);
  });

  it("rejects impossible source verification dates", () => {
    const manifest = structuredClone(seedBenchmarks[0]);
    manifest.sources[0].verifiedAt = "2026-99-99";

    expect(() => parseBenchmarkManifest(manifest)).toThrow(/real calendar date/);
  });

  it("records non-main upstream branches when needed", () => {
    const evalplus = seedBenchmarks.find((benchmark) => benchmark.id === "evalplus");
    expect(evalplus?.sources[0].repository).toBe("evalplus/evalplus");
    expect(evalplus?.sources[0].branch).toBe("master");
  });

  it("records license, safety, runner, and adapter metadata for each seed benchmark", () => {
    for (const benchmark of seedBenchmarks) {
      expect(benchmark.manifestVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(benchmark.sources.length).toBeGreaterThan(0);
      expect(benchmark.license.name.length).toBeGreaterThan(0);
      expect(benchmark.runner.capabilities.length).toBeGreaterThan(0);
      expect(benchmark.metrics.length).toBeGreaterThan(0);
      expect(benchmark.adapter.status).toBe("planned");
      expect(benchmark.safety.class.length).toBeGreaterThan(0);
    }
  });

  it("initializes isolated local storage", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-test-"));
    try {
      const sdk = createBenchSDK({
        env: { ...process.env, HASNA_BENCH_HOME: home, HASNA_BENCH_DB_PATH: join(home, "bench.db") }
      });
      const result = await sdk.doctor();
      expect(result.ok).toBe(true);
      expect(result.home).toBe(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
