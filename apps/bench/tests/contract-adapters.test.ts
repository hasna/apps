import { describe, expect, it } from "bun:test";
import { SCHEMA_IDS } from "@hasna/contracts";
import {
  benchmarkManifestToValidationPlan,
  createEvidenceManifest,
  evidenceManifestToEvidenceRefs,
  evidenceManifestToProofBundle,
  providerUsageToCostEstimate,
  resultDetailToContractBundle,
  resultSegmentToEvidenceRef,
  seedBenchmarks,
  storedRunToWorkRun
} from "../src/index.js";
import type { ResultSegmentRecord, StoredRun } from "../src/index.js";

const createdAt = "2026-07-07T10:00:00.000Z";
const finishedAt = "2026-07-07T10:01:00.000Z";

function segment(overrides: Partial<ResultSegmentRecord> = {}): ResultSegmentRecord {
  return {
    id: "segment_contracts",
    runId: "run_contracts",
    attemptId: "attempt_contracts",
    eventType: "manual-record",
    segmentPath: "/tmp/not-exposed/results.jsonl",
    byteOffset: 0,
    byteLength: 128,
    recordSha256: "a".repeat(64),
    createdAt,
    ...overrides
  };
}

function storedRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: "run_contracts",
    benchmarkId: "lm-evaluation-harness",
    manifestVersion: "1.0.0",
    modelId: "example/model",
    provider: "example-provider",
    status: "completed",
    createdAt,
    ...overrides
  };
}

describe("@hasna/bench contract adapters", () => {
  it("maps provider usage into hasna.cost_estimate.v1", () => {
    const estimate = providerUsageToCostEstimate({
      runId: "run_contracts",
      attemptId: "attempt_contracts",
      provider: "openai",
      modelId: "gpt-example",
      inputTokens: 12,
      outputTokens: 8,
      costUsd: 0.001234,
      latencyMs: 250,
      createdAt
    });

    expect(estimate.schema).toBe(SCHEMA_IDS.costEstimate);
    expect(estimate.amountMicros).toBe(1234);
    expect(estimate.totalTokens).toBe(20);
    expect(estimate.resourceRefs[0]).toMatchObject({ kind: "run", id: "run_contracts" });
  });

  it("maps result segments and stored runs into evidence_ref and work_run contracts", () => {
    const evidence = resultSegmentToEvidenceRef(segment());
    const workRun = storedRunToWorkRun({
      run: storedRun(),
      finishedAt,
      evidenceRefs: [evidence],
      proofBundleRefs: [{
        kind: "proof_bundle",
        id: "proof_run_contracts",
        externalId: "proof_run_contracts",
        sourcePackage: "@hasna/bench"
      }]
    });

    expect(evidence.schema).toBe(SCHEMA_IDS.evidenceRef);
    expect(evidence.uri).toBe("artifact://bench/runs/run_contracts/segments/segment_contracts");
    expect(workRun.schema).toBe(SCHEMA_IDS.workRun);
    expect(workRun.status).toBe("succeeded");
    expect(workRun.evidenceRefs[0]?.id).toBe(evidence.id);
  });

  it("maps legacy evidence manifests into evidence refs and proof bundles", () => {
    const legacyEvidence = createEvidenceManifest({
      runId: "run_contracts",
      attemptId: "attempt_contracts",
      benchmarkId: "promptfoo",
      manifestVersion: "1.0.0",
      modelId: "example/model",
      provider: "example-provider",
      metrics: [{ metricId: "score", value: 1 }],
      payload: { score: 1 },
      safety: { ok: true, errors: [], warnings: [] },
      redaction: { applied: true, findings: ["fixture inspected"] }
    });
    const evidenceRefs = evidenceManifestToEvidenceRefs(legacyEvidence);
    const proofBundle = evidenceManifestToProofBundle(legacyEvidence, evidenceRefs);

    expect(evidenceRefs.map((ref) => ref.schema)).toContain(SCHEMA_IDS.evidenceRef);
    expect(proofBundle.schema).toBe(SCHEMA_IDS.proofBundle);
    expect(proofBundle.verdict).toBe("passed");
    expect(proofBundle.checks.every((check) => check.status === "succeeded")).toBe(true);
  });

  it("maps benchmark manifests into validation plans with documented lossy checks", () => {
    const benchmark = seedBenchmarks.find((entry) => entry.id === "lm-evaluation-harness")!;
    const plan = benchmarkManifestToValidationPlan(benchmark, {
      command: ["lm_eval", "--model", "example/model"],
      warnings: ["Real execution may use network access."]
    });

    expect(plan.schema).toBe(SCHEMA_IDS.validationPlan);
    expect(plan.subject).toMatchObject({ kind: "eval", id: "lm-evaluation-harness" });
    expect(plan.checks.map((check) => check.id)).toEqual([
      "manifest-valid",
      "source-provenance",
      "license-policy",
      "adapter-metadata",
      "safety-policy",
      "metric-projection",
      "artifact-evidence",
      "dry-run-command",
      "plan-warnings"
    ]);
  });

  it("creates a complete contract bundle from stored result details", () => {
    const bundle = resultDetailToContractBundle({
      runId: "run_contracts",
      benchmarkId: "lm-evaluation-harness",
      manifestVersion: "1.0.0",
      modelId: "example/model",
      provider: "example-provider",
      status: "completed",
      createdAt,
      updatedAt: finishedAt,
      attempts: [{
        id: "attempt_contracts",
        attemptIndex: 1,
        status: "completed",
        startedAt: createdAt,
        completedAt: finishedAt
      }],
      segments: [segment()],
      artifacts: [],
      providerUsage: [{
        id: "usage_contracts",
        attemptId: "attempt_contracts",
        provider: "example-provider",
        modelId: "example/model",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.001,
        latencyMs: 100,
        metadata: {},
        createdAt
      }]
    });

    expect(bundle.workRun.schema).toBe(SCHEMA_IDS.workRun);
    expect(bundle.costEstimates[0]?.schema).toBe(SCHEMA_IDS.costEstimate);
    expect(bundle.evidenceRefs[0]?.schema).toBe(SCHEMA_IDS.evidenceRef);
    expect(bundle.proofBundle.schema).toBe(SCHEMA_IDS.proofBundle);
  });

  it("omits cost_estimate when provider usage has no cost amount", () => {
    const bundle = resultDetailToContractBundle({
      runId: "run_contracts",
      benchmarkId: "promptfoo",
      manifestVersion: "1.0.0",
      modelId: "example/model",
      provider: "example-provider",
      status: "completed",
      createdAt,
      updatedAt: finishedAt,
      attempts: [{
        id: "attempt_contracts",
        attemptIndex: 1,
        status: "completed",
        startedAt: createdAt,
        completedAt: finishedAt
      }],
      segments: [segment()],
      artifacts: [],
      providerUsage: [{
        id: "usage_no_cost",
        attemptId: "attempt_contracts",
        provider: "example-provider",
        modelId: "example/model",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 100,
        metadata: {},
        createdAt
      }]
    });

    expect(bundle.costEstimates).toEqual([]);
    expect(bundle.proofBundle.verdict).toBe("inconclusive");
  });
});
