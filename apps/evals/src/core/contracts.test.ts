import { describe, expect, test } from "bun:test";
import type { EvalCase, EvalRun } from "../types/index.js";
import {
  EVALS_CONTRACT_METADATA_KEY,
  createProofBundle,
  createValidationPlan,
  validateProofBundle,
  validateValidationPlan,
} from "./contracts.js";
import type {
  EvalProofBundleMetadata,
  EvalValidationPlanMetadata,
} from "./contracts.js";

const cases: EvalCase[] = [{
  id: "answer-4",
  input: "What is 2+2?",
  expected: "The answer is 4",
  assertions: [{ type: "contains", value: "4", label: "contains answer" }],
  judge: {
    rubric: "Must correctly answer 4",
    model: "judge-model",
    provider: "anthropic",
    apiKey: "must-not-leak",
  },
}];

function passingRun(): EvalRun {
  return {
    id: "run-1",
    createdAt: "2026-07-29T12:00:01.000Z",
    dataset: "datasets/math.jsonl",
    results: [{
      caseId: "answer-4",
      verdict: "PASS",
      output: "4",
      assertionResults: [{
        type: "contains",
        passed: true,
        reason: "Output contains 4",
        label: "contains answer",
      }],
      judgeResult: {
        verdict: "PASS",
        reasoning: "The response is correct",
        durationMs: 20,
        inputTokens: 12,
        outputTokens: 4,
        costUsd: 0.001,
      },
      durationMs: 25,
    }],
    stats: {
      total: 1,
      passed: 1,
      failed: 0,
      unknown: 0,
      errors: 0,
      passRate: 1,
      totalDurationMs: 25,
      totalCostUsd: 0.001,
      totalTokens: 16,
    },
  };
}

describe("validation plan contract", () => {
  test("records required assertions and non-secret judge metadata", () => {
    const plan = createValidationPlan(cases, {
      id: "plan-1",
      createdAt: "2026-07-29T12:00:00.000Z",
      dataset: "datasets/math.jsonl",
      objective: "Validate arithmetic answers",
      artifactRefs: [{
        id: "dataset-snapshot",
        kind: "artifact",
        uri: "artifact://evals/datasets/math",
      }],
    });

    expect(plan.schema).toBe("hasna.validation_plan.v1");
    expect(plan.checks).toEqual([{
      id: "answer-4",
      kind: "eval",
      required: true,
      expected: "The answer is 4",
      resourceRefs: [],
    }]);
    expect(validateValidationPlan(plan).success).toBe(true);

    const metadata = plan.metadata?.[EVALS_CONTRACT_METADATA_KEY] as EvalValidationPlanMetadata;
    expect(metadata.requiredChecks[0]?.deterministicAssertions).toEqual(cases[0]?.assertions);
    expect(metadata.requiredChecks[0]?.llmJudge).toEqual({
      rubric: "Must correctly answer 4",
      model: "judge-model",
      provider: "anthropic",
    });
    expect(metadata.artifactRefs[0]?.id).toBe("dataset-snapshot");
    expect(JSON.stringify(plan)).not.toContain("must-not-leak");
  });

  test("rejects invalid plan values through @hasna/contracts", () => {
    expect(validateValidationPlan({
      schema: "hasna.validation_plan.v1",
      checks: [],
    }).success).toBe(false);
  });
});

describe("proof bundle contract", () => {
  test("records executed checks, verdicts, judge metadata, risks, and freshness", () => {
    const plan = createValidationPlan(cases, {
      id: "plan-1",
      createdAt: "2026-07-29T12:00:00.000Z",
      dataset: "datasets/math.jsonl",
      objective: "Validate arithmetic answers",
    });
    const proof = createProofBundle(passingRun(), plan, {
      id: "proof-1",
      createdAt: "2026-07-29T12:00:02.000Z",
      verifier: { kind: "agent", id: "codex", provider: "openai" },
      artifactRefs: [{
        id: "run-log",
        kind: "log",
        uri: "artifact://evals/runs/run-1/log",
      }],
      residualRisks: ["Only the configured cases were evaluated"],
      freshness: "fresh",
    });

    expect(proof.schema).toBe("hasna.proof_bundle.v1");
    expect(proof.status).toBe("succeeded");
    expect(proof.verdict).toBe("passed");
    expect(proof.checks[0]?.checkId).toBe("answer-4");
    expect(proof.checks[0]?.status).toBe("succeeded");
    expect(proof.verifier?.id).toBe("codex");
    expect(proof.freshness).toBe("fresh");
    expect(proof.residualRisks).toEqual(["Only the configured cases were evaluated"]);
    expect(proof.evidenceRefs[0]?.id).toBe("run-log");
    expect(validateProofBundle(proof).success).toBe(true);

    const metadata = proof.metadata?.[EVALS_CONTRACT_METADATA_KEY] as EvalProofBundleMetadata;
    expect(metadata.caseVerdicts).toEqual([{ checkId: "answer-4", verdict: "PASS" }]);
    expect(metadata.deterministicAssertions[0]?.results[0]?.passed).toBe(true);
    expect(metadata.llmJudges[0]).toEqual({
      checkId: "answer-4",
      config: {
        rubric: "Must correctly answer 4",
        model: "judge-model",
        provider: "anthropic",
      },
      verdict: "PASS",
      durationMs: 20,
      inputTokens: 12,
      outputTokens: 4,
      costUsd: 0.001,
    });
    expect(metadata.artifactRefs[0]?.id).toBe("run-log");
    expect(JSON.stringify(proof)).not.toContain("must-not-leak");
    expect(JSON.stringify(proof)).not.toContain("The response is correct");
  });

  test("uses an inconclusive verdict for unknown eval results", () => {
    const plan = createValidationPlan(cases, {
      dataset: "datasets/math.jsonl",
      objective: "Validate arithmetic answers",
    });
    const run = passingRun();
    run.results[0]!.verdict = "UNKNOWN";
    run.results[0]!.judgeResult = undefined;
    run.stats.passed = 0;
    run.stats.unknown = 1;

    const proof = createProofBundle(run, plan, {
      verifier: { kind: "agent", id: "codex" },
    });

    expect(proof.status).toBe("unknown");
    expect(proof.verdict).toBe("inconclusive");
    expect(proof.checks[0]?.status).toBe("unknown");
    expect(validateProofBundle(proof).success).toBe(true);
  });

  test("does not pass when a required plan check was not executed", () => {
    const plan = createValidationPlan([
      ...cases,
      { id: "required-but-missing", input: "Say hello" },
    ], {
      dataset: "datasets/math.jsonl",
      objective: "Validate all required cases",
    });

    const proof = createProofBundle(passingRun(), plan, {
      verifier: { kind: "agent", id: "codex" },
    });

    expect(proof.verdict).toBe("inconclusive");
    expect(proof.checks[1]).toMatchObject({
      checkId: "required-but-missing",
      status: "skipped",
    });
    expect(proof.residualRisks).toContain("Required check required-but-missing was not executed");
    expect(validateProofBundle(proof).success).toBe(true);
  });
});
