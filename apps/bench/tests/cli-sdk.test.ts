import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createBenchSDK } from "../src/index.js";

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_BENCH_HOME: home,
    HASNA_BENCH_DB_PATH: join(home, "bench.db")
  };
}

function runBench(args: string[], env: NodeJS.ProcessEnv): unknown {
  const result = spawnSync("bun", ["run", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`bench ${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
  }

  return JSON.parse(result.stdout);
}

function runBenchFailure(args: string[], env: NodeJS.ProcessEnv): unknown {
  const result = spawnSync("bun", ["run", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8"
  });

  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toBe("");
  return JSON.parse(result.stdout);
}

function runBenchRaw(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

describe("@hasna/bench CLI and SDK core", () => {
  it("exits successfully for standard help and version flags", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const env = isolatedEnv(home);
    try {
      const help = runBenchRaw(["--help"], env);
      const version = runBenchRaw(["--version"], env);

      expect(help.status).toBe(0);
      expect(help.stdout).toContain("Usage:");
      expect(help.stderr).toBe("");
      expect(version.status).toBe(0);
      expect(version.stdout.trim()).toBe("0.0.1");
      expect(version.stderr).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("plans, records, lists, shows, compares, and reports through the SDK", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-sdk-"));
    try {
      const sdk = createBenchSDK({ env: isolatedEnv(home) });

      const plan = sdk.plan({
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model",
        provider: "example-provider"
      });
      expect(plan.ok).toBe(true);
      expect(plan.benchmark.id).toBe("lm-evaluation-harness");
      expect(plan.command).toContain("lm_eval");

      const left = await sdk.recordRun({
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model-a",
        provider: "example-provider",
        metrics: [{ metricId: "accuracy", value: 0.72, direction: "higher-is-better" }]
      });
      const right = await sdk.recordRun({
        benchmarkId: "lm-evaluation-harness",
        modelId: "example/model-b",
        provider: "example-provider",
        metrics: [{ metricId: "accuracy", value: 0.82, direction: "higher-is-better" }]
      });

      expect((await sdk.listResults()).map((result) => result.runId)).toEqual([right.run.id, left.run.id]);
      expect((await sdk.showResult(left.run.id)).metrics[0].value).toBe(0.72);
      expect((await sdk.compareResults(left.run.id, right.run.id, "accuracy")).metrics[0]).toMatchObject({
        metricId: "accuracy",
        leftValue: 0.72,
        rightValue: 0.82
      });
      expect((await sdk.report()).runCount).toBe(2);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("runs core CLI commands against an isolated store", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const env = isolatedEnv(home);
    try {
      const suite = runBench(["suites", "show", "lm-evaluation-harness", "--json"], env) as { id: string };
      const plan = runBench([
        "plan",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--json"
      ], env) as { ok: boolean; command: string[] };
      const left = runBench([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model-a",
        "--provider",
        "example-provider",
        "--input",
        "examples/result-record.json",
        "--json"
      ], env) as { run: { id: string } };
      const right = runBench([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model-b",
        "--provider",
        "example-provider",
        "--metric",
        "accuracy=0.82",
        "--json"
      ], env) as { run: { id: string } };
      const results = runBench(["results", "list", "--json"], env) as Array<{ runId: string }>;
      const detail = runBench(["results", "show", left.run.id, "--json"], env) as { metrics: Array<{ metricId: string }> };
      const comparison = runBench([
        "compare",
        left.run.id,
        right.run.id,
        "--metric",
        "accuracy",
        "--json"
      ], env) as { metrics: Array<{ delta: number }> };
      const report = runBench(["report", "--json"], env) as { runCount: number; metricCount: number };
      const fixture = runBench([
        "runs",
        "fixture",
        "promptfoo",
        "--model",
        "example/model-c",
        "--provider",
        "example-provider",
        "--metric",
        "score=0.93",
        "--secret-ref",
        "OPENAI_API_KEY",
        "--network",
        "--json"
      ], env) as { ok: boolean; metrics: Array<{ metricId: string }> };

      expect(suite.id).toBe("lm-evaluation-harness");
      expect(plan.ok).toBe(true);
      expect(plan.command).toContain("lm_eval");
      expect(results).toHaveLength(2);
      expect(detail.metrics.map((metric) => metric.metricId)).toContain("accuracy");
      expect(comparison.metrics[0].delta).toBeCloseTo(0.1);
      expect(report.runCount).toBe(2);
      expect(report.metricCount).toBe(3);
      expect(fixture.ok).toBe(true);
      expect(fixture.metrics[0].metricId).toBe("score");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("emits canonical contract JSON additively without changing unflagged output", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-contract-cli-"));
    const fixtureInput = join(home, "promptfoo-fixture.json");
    const env = isolatedEnv(home);
    try {
      writeFileSync(fixtureInput, JSON.stringify({
        metrics: [{ metricId: "score", value: 0.9 }]
      }));
      const plan = runBench([
        "plan",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--json"
      ], env) as { ok: boolean; contracts?: unknown };
      const planContract = runBench([
        "plan",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--json",
        "--contract"
      ], env) as {
        ok: boolean;
        legacy: { ok: boolean; command: string[] };
        contracts: { validationPlan: { schema: string }; mappingNotes: string[] };
      };
      const recorded = runBench([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--input",
        "examples/result-record.json",
        "--json",
        "--contract"
      ], env) as {
        ok: boolean;
        legacy: { run: { id: string } };
        contracts: {
          workRun: { schema: string; status: string };
          costEstimates: Array<{ schema: string; amountMicros: number }>;
          evidenceRefs: Array<{ schema: string; uri: string }>;
          proofBundle: { schema: string; verdict: string };
        };
      };
      const shown = runBench([
        "results",
        "show",
        recorded.legacy.run.id,
        "--json",
        "--contract"
      ], env) as {
        legacy: { runId: string };
        contracts: { workRun: { schema: string }; evidenceRefs: Array<{ uri: string }> };
      };
      const fixture = runBench([
        "runs",
        "fixture",
        "promptfoo",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--input",
        fixtureInput,
        "--secret-ref",
        "OPENAI_API_KEY",
        "--network",
        "--json",
        "--contract"
      ], env) as {
        contracts: {
          costEstimates: Array<unknown>;
          proofBundle: { verdict: string; checks: Array<{ checkId: string; status: string }> };
        };
      };

      expect(plan.ok).toBe(true);
      expect(plan.contracts).toBeUndefined();
      expect(planContract.ok).toBe(true);
      expect(planContract.legacy.command).toContain("lm_eval");
      expect(planContract.contracts.validationPlan.schema).toBe("hasna.validation_plan.v1");
      expect(planContract.contracts.mappingNotes[0]).toContain("bench.manifest.v1");
      expect(recorded.contracts.workRun.schema).toBe("hasna.work_run.v1");
      expect(recorded.contracts.workRun.status).toBe("succeeded");
      expect(recorded.contracts.costEstimates[0]).toMatchObject({
        schema: "hasna.cost_estimate.v1",
        amountMicros: 12000
      });
      expect(recorded.contracts.evidenceRefs[0]?.schema).toBe("hasna.evidence_ref.v1");
      expect(recorded.contracts.proofBundle).toMatchObject({
        schema: "hasna.proof_bundle.v1",
        verdict: "inconclusive"
      });
      expect(shown.legacy.runId).toBe(recorded.legacy.run.id);
      expect(shown.contracts.workRun.schema).toBe("hasna.work_run.v1");
      expect(shown.contracts.evidenceRefs[0]?.uri).not.toContain("/tmp");
      expect(fixture.contracts.costEstimates).toEqual([]);
      expect(fixture.contracts.proofBundle.verdict).toBe("passed");
      expect(fixture.contracts.proofBundle.checks.map((check) => check.checkId)).toEqual([
        "safety-gate",
        "redaction",
        "cleanup"
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("emits JSON errors for JSON-mode command failures", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const env = isolatedEnv(home);
    try {
      const unknownSuite = runBenchFailure(["suites", "show", "missing-suite", "--json"], env) as {
        ok: boolean;
        error: string;
      };
      const invalidManifest = runBenchFailure(["manifest", "validate", "examples/benchmark.invalid.json", "--json"], env) as {
        ok: boolean;
        error: string;
      };

      expect(unknownSuite.ok).toBe(false);
      expect(unknownSuite.error).toContain("Unknown benchmark suite");
      expect(invalidManifest.ok).toBe(false);
      expect(invalidManifest.error.length).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects invalid provider usage values from CLI fixtures", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const fixture = join(home, "bad-usage.json");
    const env = isolatedEnv(home);
    try {
      writeFileSync(fixture, JSON.stringify({
        metrics: [{ metricId: "accuracy", value: 0.5 }],
        usage: { inputTokens: "bad", costUsd: "not-cost", latencyMs: "fast" }
      }));

      const result = runBenchFailure([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--input",
        fixture,
        "--json"
      ], env) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toContain("usage.inputTokens");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("redacts manual record payloads and rejects unsafe metadata through the CLI", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const fixture = join(home, "secret-payload.json");
    const env = isolatedEnv(home);
    const rawCredential = "sk-" + "proj-cli-payload";
    try {
      writeFileSync(fixture, JSON.stringify({
        metrics: [{ metricId: "accuracy", value: 0.5 }],
        payload: { nested: { credential: rawCredential } }
      }));

      const result = runBench([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--input",
        fixture,
        "--json"
      ], env) as { segment: { segmentPath: string } };
      const rawSegment = readFileSync(result.segment.segmentPath, "utf8");
      expect(rawSegment).toContain("[REDACTED]");
      expect(rawSegment).not.toContain(rawCredential);

      const unsafeModel = runBenchFailure([
        "runs",
        "fixture",
        "promptfoo",
        "--model",
        rawCredential,
        "--provider",
        "example-provider",
        "--metric",
        "score=0.93",
        "--secret-ref",
        "OPENAI_API_KEY",
        "--network",
        "--json"
      ], env) as { ok: boolean; error: string };
      expect(unsafeModel.ok).toBe(false);
      expect(unsafeModel.error).toContain("raw credential-shaped");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails closed for network-required fixtures without network acknowledgement", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const env = isolatedEnv(home);
    try {
      const result = runBenchFailure([
        "runs",
        "fixture",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--metric",
        "accuracy=0.93",
        "--json"
      ], env) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toContain("requires network=true");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects undeclared manual metrics", () => {
    const home = mkdtempSync(join(tmpdir(), "bench-cli-"));
    const env = isolatedEnv(home);
    try {
      const result = runBenchFailure([
        "runs",
        "record",
        "lm-evaluation-harness",
        "--model",
        "example/model",
        "--provider",
        "example-provider",
        "--metric",
        "undeclared_metric=1",
        "--json"
      ], env) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not declared");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
