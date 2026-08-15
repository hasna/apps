import { describe, expect, it } from "bun:test";
import { buildAdapterPlan, createBenchSDK, listAdapters, seedBenchmarks } from "../src/index.js";

describe("@hasna/bench adapter registry", () => {
  it("has one adapter for every seed benchmark", () => {
    const adapterIds = listAdapters().map((adapter) => adapter.benchmarkId);
    expect(adapterIds).toEqual(seedBenchmarks.map((benchmark) => benchmark.id));
  });

  it("declares install, run, parse, safety, and dry-run command metadata for each adapter", () => {
    for (const benchmark of seedBenchmarks) {
      const adapter = buildAdapterPlan({
        benchmarkId: benchmark.id,
        modelId: "example/model",
        provider: "example-provider",
        outputDir: `runs/${benchmark.id}`
      });

      expect(adapter.executionModes).toContain("dry-run");
      expect(adapter.run.supportsDryRun).toBe(true);
      expect(adapter.run.requiresNetwork).toBe(benchmark.runner.requiresNetwork);
      expect(adapter.run.requiresSandbox).toBe(benchmark.runner.requiresSandbox);
      expect(adapter.install.type.length).toBeGreaterThan(0);
      expect(adapter.parse.expectedOutputs).toEqual(benchmark.runner.expectedArtifacts);
      expect(adapter.parse.metrics).toEqual(benchmark.metrics.map((metric) => metric.id));
      expect(adapter.safety).toEqual(benchmark.safety);
      expect(adapter.plan.command.length).toBeGreaterThan(0);
      expect(adapter.plan.expectedOutputs.length).toBeGreaterThan(0);
    }
  });

  it("uses adapter plans through the SDK plan command", () => {
    const sdk = createBenchSDK();
    const promptfoo = sdk.plan({
      benchmarkId: "promptfoo",
      modelId: "example/model",
      provider: "example-provider"
    });
    const sweBench = sdk.plan({
      benchmarkId: "swe-bench",
      modelId: "example/model",
      provider: "example-provider"
    });

    expect(promptfoo.adapter.id).toBe("promptfoo:default");
    expect(promptfoo.command).toContain("promptfoo");
    expect(promptfoo.commandPlan.expectedOutputs).toContain("results.json");
    expect(sweBench.requiresSandbox).toBe(true);
    expect(sweBench.warnings).toContain("Real execution requires an isolated sandbox.");

    const llmperf = sdk.plan({
      benchmarkId: "llmperf",
      modelId: "example/model",
      provider: "example-provider"
    });
    expect(llmperf.warnings).toContain("Real execution may use network access.");
    expect(llmperf.warnings).toContain("Real execution has high cost risk and requires an explicit budget.");
  });
});
