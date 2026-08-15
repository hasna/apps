import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callBenchTool, createBenchSDK, listBenchTools } from "../src/index.js";

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_BENCH_HOME: home,
    HASNA_BENCH_DB_PATH: join(home, "bench.db")
  };
}

describe("@hasna/bench MCP tools", () => {
  it("lists the expected tool contracts", () => {
    expect(listBenchTools().map((tool) => tool.name)).toEqual([
      "bench_suites_list",
      "bench_suites_show",
      "bench_manifest_validate",
      "bench_plan",
      "bench_results_list",
      "bench_results_show",
      "bench_compare",
      "bench_report",
      "bench_doctor"
    ]);
    const manifestTool = listBenchTools().find((tool) => tool.name === "bench_manifest_validate");
    expect(manifestTool?.inputSchema).toMatchObject({
      required: ["manifest"]
    });
    expect(Object.keys(manifestTool?.inputSchema.properties ?? {})).not.toContain("path");
  });

  it("calls MCP tools through the SDK without executing external benchmarks", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-mcp-"));
    const sdk = createBenchSDK({ env: isolatedEnv(home) });
    try {
      const suites = await callBenchTool(sdk, "bench_suites_list", {}) as { suites: Array<{ id: string }> };
      const suite = await callBenchTool(sdk, "bench_suites_show", { id: "lm-evaluation-harness" }) as {
        suite: { id: string };
      };
      const manifest = await callBenchTool(sdk, "bench_manifest_validate", {
        manifest: {
          schemaVersion: "bench.manifest.v1",
          id: "mcp-fixture",
          manifestVersion: "1.0.0",
          name: "MCP Fixture",
          category: "custom",
          sources: [{ type: "website", url: "https://example.com/mcp", verifiedAt: "2026-06-29" }],
          license: { name: "Unknown", status: "unknown", requiresAttribution: false },
          runner: { kind: "custom", capabilities: ["dry-run"], supportsDryRun: true },
          metrics: [{ id: "score", name: "Score", direction: "higher-is-better" }],
          adapter: { status: "candidate" },
          safety: { class: "offline-safe", allowsNetwork: false, requiresSandbox: false, requiresSecrets: false, costRisk: "none" }
        }
      }) as { ok: boolean; manifest: { id: string } };
      const plan = await callBenchTool(sdk, "bench_plan", {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      }) as { ok: boolean; command: string[] };
      const first = await sdk.recordRun({
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/a",
        provider: "example",
        metrics: [{ metricId: "accuracy", value: 0.7 }]
      });
      const second = await sdk.recordRun({
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/b",
        provider: "example",
        metrics: [{ metricId: "accuracy", value: 0.9 }]
      });
      const results = await callBenchTool(sdk, "bench_results_list", {}) as { results: Array<{ runId: string }> };
      const detail = await callBenchTool(sdk, "bench_results_show", { runId: first.run.id }) as {
        result: { metrics: Array<{ metricId: string }> };
      };
      const comparison = await callBenchTool(sdk, "bench_compare", {
        leftRunId: first.run.id,
        rightRunId: second.run.id,
        metricId: "accuracy"
      }) as { metrics: Array<{ delta: number }> };
      const report = await callBenchTool(sdk, "bench_report", {}) as { runCount: number };
      const doctor = await callBenchTool(sdk, "bench_doctor", {}) as { ok: boolean };

      expect(suites.suites.length).toBe(13);
      expect(suite.suite.id).toBe("lm-evaluation-harness");
      expect(manifest.ok).toBe(true);
      expect(manifest.manifest.id).toBe("mcp-fixture");
      expect(plan.ok).toBe(true);
      expect(plan.command).toContain("lm_eval");
      expect(results.results).toHaveLength(2);
      expect(detail.result.metrics[0].metricId).toBe("accuracy");
      expect(comparison.metrics[0].delta).toBeCloseTo(0.2);
      expect(report.runCount).toBe(2);
      expect(doctor.ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects invalid MCP tool arguments with zod validation", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-mcp-"));
    const sdk = createBenchSDK({ env: isolatedEnv(home) });
    try {
      const missingPlanArg = await callBenchTool(sdk, "bench_plan", {
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model"
      }) as { ok: boolean; error: string };
      const pathMode = await callBenchTool(sdk, "bench_manifest_validate", {
        path: "examples/benchmark.valid.json"
      }) as { ok: boolean; error: string };
      const unknownSuite = await callBenchTool(sdk, "bench_suites_show", { id: "missing-suite" }) as {
        ok: boolean;
        error: string;
      };

      expect(missingPlanArg.ok).toBe(false);
      expect(missingPlanArg.error.length).toBeGreaterThan(0);
      expect(pathMode.ok).toBe(false);
      expect(pathMode.error.length).toBeGreaterThan(0);
      expect(unknownSuite.ok).toBe(false);
      expect(unknownSuite.error).toContain("Unknown benchmark suite");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
