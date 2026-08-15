import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEvidenceManifest,
  evaluateSafetyPolicy,
  openBenchStorage,
  redactEvidence,
  runFixtureAdapter,
  seedBenchmarks
} from "../src/index.js";

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_BENCH_HOME: home,
    HASNA_BENCH_DB_PATH: join(home, "bench.db")
  };
}

describe("@hasna/bench safety and evidence gates", () => {
  it("requires secretRef names and budget limits for risky benchmark plans", () => {
    const llmperf = seedBenchmarks.find((benchmark) => benchmark.id === "llmperf")!;
    const promptfoo = seedBenchmarks.find((benchmark) => benchmark.id === "promptfoo")!;
    const lmEval = seedBenchmarks.find((benchmark) => benchmark.id === "lm-evaluation-harness")!;
    const rawCredential = "sk-" + "proj-not-allowed";

    expect(evaluateSafetyPolicy({ benchmark: llmperf }).errors).toContain(
      "Benchmark llmperf requires secretRef names; raw credentials are not accepted"
    );
    expect(evaluateSafetyPolicy({ benchmark: llmperf }).errors).toContain(
      "Benchmark llmperf has high cost risk and requires limits.maxCostUsd"
    );
    expect(evaluateSafetyPolicy({
      benchmark: llmperf,
      secretRefs: ["OPENAI_API_KEY"],
      network: true,
      limits: { maxCostUsd: 1 }
    }).ok).toBe(true);
    expect(evaluateSafetyPolicy({
      benchmark: promptfoo,
      secretRefs: [rawCredential]
    }).errors.some((error) => error.includes("looks like a raw secret"))).toBe(true);
    expect(evaluateSafetyPolicy({
      benchmark: lmEval
    }).errors).toContain("Benchmark lm-evaluation-harness requires network=true");
  });

  it("redacts sensitive evidence fields and creates stable evidence manifests", () => {
    const rawCredential = "sk-" + "proj-example";
    const rawToken = "secret-" + "token:value";
    const redacted = redactEvidence({
      apiKey: rawCredential,
      nested: { token: rawToken, ok: "visible" }
    });
    const evidence = createEvidenceManifest({
      runId: "run_1",
      attemptId: "attempt_1",
      benchmarkId: "promptfoo",
      manifestVersion: "1.0.0",
      modelId: "model",
      provider: "provider",
      metrics: [{ metricId: "score", value: 1 }],
      safety: { ok: true, errors: [], warnings: [] }
    });

    expect(redacted).toEqual({ apiKey: "[REDACTED]", nested: { token: "[REDACTED]", ok: "visible" } });
    expect(evidence.schemaVersion).toBe("bench.evidence.v1");
    expect(evidence.metricHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.cleanup).toEqual({ required: false, status: "not-required" });
    expect(evidence.artifacts).toEqual([]);
  });

  it("persists redacted fixture result evidence and an evidence manifest", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-safety-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    const rawCredential = "sk-" + "proj-do-not-store";
    try {
      const result = await runFixtureAdapter(storage, {
        benchmarkId: "promptfoo",
        modelId: "fixture/model",
        provider: "fixture-provider",
        payload: {
          apiKey: rawCredential,
          metrics: [{ metricId: "score", value: 0.9 }]
        },
        secretRefs: ["OPENAI_API_KEY"],
        network: true
      });

      const segments = storage.db
        .prepare("SELECT event_type, segment_path FROM result_segments ORDER BY byte_offset")
        .all() as { event_type: string; segment_path: string }[];
      const raw = readFileSync(segments[0].segment_path, "utf8");
      expect(result.ok).toBe(true);
      expect(segments.map((segment) => segment.event_type)).toEqual(["fixture-result", "evidence-manifest"]);
      expect(raw).toContain("[REDACTED]");
      expect(raw).not.toContain(rawCredential);
      expect(raw).toContain("payloadHash");
      expect(raw).toContain("manifestHash");
      expect(raw).toContain("adapterCommandHash");
      expect(raw).toContain("OPENAI_API_KEY");
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects raw credential-shaped fixture run metadata before persistence", async () => {
    const home = mkdtempSync(join(tmpdir(), "bench-safety-"));
    const storage = await openBenchStorage(isolatedEnv(home));
    const rawCredential = "sk-" + "proj-do-not-store";
    try {
      await expect(runFixtureAdapter(storage, {
        benchmarkId: "promptfoo",
        modelId: rawCredential,
        provider: "fixture-provider",
        payload: { metrics: [{ metricId: "score", value: 0.9 }] },
        secretRefs: ["OPENAI_API_KEY"],
        network: true
      })).rejects.toThrow(/raw credential-shaped/);
    } finally {
      storage.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
