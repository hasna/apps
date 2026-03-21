/**
 * Eval scenario runner — hits AI endpoints and scores outputs using the judge engine.
 *
 * Eval scenarios store their config in scenario.metadata as EvalScenarioConfig.
 * Each test case runs against the endpoint and is scored by one or more rubrics.
 * Results are stored in the standard results table with per-case scores in metadata.
 */

import type { Scenario, Result } from "../types/index.js";
import { createResult, updateResult } from "../db/results.js";
import { judge } from "./judge.js";
import type { JudgeRubric, JudgeConfig, JudgeResult } from "./judge.js";
import { runPipeline } from "./pipeline-runner.js";
import type { PipelineConfig } from "./pipeline-runner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalTestCase {
  input: string;
  context?: string;
  rubrics: JudgeRubric[];
}

export interface EvalScenarioConfig {
  endpoint: string;              // e.g. "/api/chat"
  method?: string;               // default POST
  headers?: Record<string, string>;
  inputField?: string;           // JSON path to inject input, e.g. "messages[0].content"
  outputField?: string;          // JSON path to extract output, e.g. "choices[0].message.content"
  testCases: EvalTestCase[];
  judgeModel?: string;           // optional override for judge model
  judgeProvider?: string;
  baseUrl?: string;
}

export interface EvalCaseResult {
  input: string;
  output: string | null;
  rubricResults: Array<{ rubricType: string; pass: boolean; score: number; reason: string }>;
  passed: boolean;
  score: number;
  error?: string;
}

export interface EvalRunResult {
  passed: boolean;
  totalCases: number;
  passedCases: number;
  avgScore: number;
  caseResults: EvalCaseResult[];
  tokensUsed: number;
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: unknown, path: string): string | null {
  try {
    // Support simple dot notation and array indexing: "choices[0].message.content"
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : JSON.stringify(current);
  } catch {
    return null;
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

async function callEndpoint(baseUrl: string, config: EvalScenarioConfig, input: string): Promise<string | null> {
  const method = config.method ?? "POST";
  const url = baseUrl.replace(/\/$/, "") + config.endpoint;

  let body: Record<string, unknown> = {};
  if (config.inputField) {
    setNestedValue(body, config.inputField, input);
  } else {
    // Default: wrap as { message: input } or { input }
    body = { message: input };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await resp.text();
    if (!resp.ok) return null;

    if (config.outputField) {
      try {
        const parsed = JSON.parse(text) as unknown;
        return getNestedValue(parsed, config.outputField);
      } catch {
        return text;
      }
    }
    // Auto-extract common output fields
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return (
        getNestedValue(parsed, "choices[0].message.content") ??
        getNestedValue(parsed, "content[0].text") ??
        getNestedValue(parsed, "candidates[0].content.parts[0].text") ??
        getNestedValue(parsed, "response") ??
        getNestedValue(parsed, "output") ??
        getNestedValue(parsed, "message") ??
        getNestedValue(parsed, "text") ??
        text.slice(0, 2000)
      );
    } catch {
      return text.slice(0, 2000);
    }
  } catch (error) {
    clearTimeout(timeout);
    return null;
  }
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

export async function runEvalScenario(
  scenario: Scenario,
  options: { runId: string; baseUrl: string },
): Promise<Result> {
  const startMs = Date.now();

  // Route pipeline scenarios to the pipeline runner
  const metadata = scenario.metadata as Record<string, unknown> | null;
  if (scenario.scenarioType === "pipeline" || metadata?.pipeline) {
    return runPipelineScenario(scenario, options);
  }

  // Parse eval config from scenario metadata
  const evalConfig = metadata?.eval as EvalScenarioConfig | undefined;
  if (!evalConfig || !evalConfig.testCases?.length) {
    const result = createResult({ runId: options.runId, scenarioId: scenario.id, model: "eval", stepsTotal: 0 });
    return updateResult(result.id, { status: "error", error: "Eval scenario missing 'eval' config in metadata" });
  }

  const judgeConfig: JudgeConfig = {
    model: evalConfig.judgeModel,
    provider: evalConfig.judgeProvider as JudgeConfig["provider"],
  };

  const caseResults: EvalCaseResult[] = [];
  let tokensUsed = 0;

  // Run test cases in parallel batches of 5
  const batchSize = 5;
  for (let i = 0; i < evalConfig.testCases.length; i += batchSize) {
    const batch = evalConfig.testCases.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (tc): Promise<EvalCaseResult> => {
      let output: string | null = null;
      let caseError: string | undefined;

      try {
        output = await callEndpoint(options.baseUrl, evalConfig, tc.input);
        if (output === null) {
          caseError = `Endpoint returned null or error response`;
        }
      } catch (err) {
        caseError = err instanceof Error ? err.message : String(err);
      }

      if (!output) {
        return { input: tc.input, output: null, rubricResults: [], passed: false, score: 0, error: caseError };
      }

      // Score each rubric
      const rubricResults: EvalCaseResult["rubricResults"] = [];
      for (const rubric of tc.rubrics) {
        const judgeResult = await judge({ input: tc.input, output, context: tc.context, rubric }, judgeConfig);
        tokensUsed += judgeResult.tokensUsed;
        rubricResults.push({ rubricType: judgeResult.rubricType, pass: judgeResult.pass, score: judgeResult.score, reason: judgeResult.reason });
      }

      const allPass = rubricResults.every((r) => r.pass);
      const avgScore = rubricResults.reduce((s, r) => s + r.score, 0) / (rubricResults.length || 1);
      return { input: tc.input, output, rubricResults, passed: allPass, score: avgScore };
    }));
    caseResults.push(...batchResults);
  }

  const passedCases = caseResults.filter((c) => c.passed).length;
  const avgScore = caseResults.reduce((s, c) => s + c.score, 0) / (caseResults.length || 1);
  const allPassed = passedCases === caseResults.length;
  const durationMs = Date.now() - startMs;

  const evalRunResult: EvalRunResult = {
    passed: allPassed,
    totalCases: caseResults.length,
    passedCases,
    avgScore,
    caseResults,
    tokensUsed,
    durationMs,
  };

  const result = createResult({
    runId: options.runId,
    scenarioId: scenario.id,
    model: "eval",
    stepsTotal: caseResults.length,
  });

  return updateResult(result.id, {
    status: allPassed ? "passed" : "failed",
    reasoning: `${passedCases}/${caseResults.length} test cases passed (avg score: ${(avgScore * 100).toFixed(0)}%)`,
    stepsCompleted: passedCases,
    tokensUsed,
    durationMs,
    metadata: evalRunResult as unknown as Record<string, unknown>,
  });
}

// ─── RAG Evaluation ───────────────────────────────────────────────────────────

export interface RagTestCase {
  question: string;
  sourceDocs: string[];        // source documents retrieved/expected
  expectedFacts?: string[];    // facts that MUST appear in answer
  forbiddenClaims?: string[];  // claims that must NOT appear (hallucination seeds)
}

export interface RagEvalConfig extends EvalScenarioConfig {
  ragTestCases: RagTestCase[];  // stored in scenario.metadata.rag
}

export interface RagCaseResult {
  question: string;
  output: string | null;
  faithfulnessScore: number;         // 0–1
  faithfulnessPass: boolean;
  factualCompletenessScore: number;  // 0–1 (1.0 if no expectedFacts)
  factualCompletenessPass: boolean;
  forbiddenClaimViolations: string[];  // which forbidden claims were found
  passed: boolean;
  error?: string;
  judgeResults: JudgeResult[];
}

export interface RagEvalResult {
  passed: boolean;
  totalCases: number;
  passedCases: number;
  avgFaithfulnessScore: number;
  avgFactualCompletenessScore: number;
  totalForbiddenViolations: number;
  caseResults: RagCaseResult[];
  tokensUsed: number;
  durationMs: number;
}

async function callEndpointRag(
  baseUrl: string,
  config: EvalScenarioConfig,
  question: string,
): Promise<string | null> {
  return callEndpoint(baseUrl, config, question);
}

export async function runRagEval(
  scenario: Scenario,
  options: { runId: string; baseUrl: string },
): Promise<Result> {
  const startMs = Date.now();

  // Parse config from scenario metadata
  const metadata = scenario.metadata as Record<string, unknown> | null;
  const ragConfig = metadata?.rag as (EvalScenarioConfig & { ragTestCases?: RagTestCase[] }) | undefined;

  if (!ragConfig || !ragConfig.ragTestCases?.length) {
    const result = createResult({ runId: options.runId, scenarioId: scenario.id, model: "rag-eval", stepsTotal: 0 });
    return updateResult(result.id, { status: "error", error: "RAG eval scenario missing 'rag' config with ragTestCases in metadata" });
  }

  const judgeConfig: JudgeConfig = {
    model: ragConfig.judgeModel,
    provider: ragConfig.judgeProvider as JudgeConfig["provider"],
  };

  const caseResults: RagCaseResult[] = [];
  let tokensUsed = 0;

  for (const tc of ragConfig.ragTestCases) {
    let output: string | null = null;
    let caseError: string | undefined;

    try {
      output = await callEndpointRag(options.baseUrl, ragConfig, tc.question);
      if (output === null) caseError = "Endpoint returned null or error response";
    } catch (err) {
      caseError = err instanceof Error ? err.message : String(err);
    }

    if (!output) {
      caseResults.push({
        question: tc.question,
        output: null,
        faithfulnessScore: 0,
        faithfulnessPass: false,
        factualCompletenessScore: 0,
        factualCompletenessPass: false,
        forbiddenClaimViolations: [],
        passed: false,
        error: caseError,
        judgeResults: [],
      });
      continue;
    }

    const judgeResults: JudgeResult[] = [];

    // 1. Faithfulness: score against source documents
    const faithfulResult = await judge(
      { input: tc.question, output, rubric: { type: "faithful", sourceDocs: tc.sourceDocs } },
      judgeConfig,
    );
    tokensUsed += faithfulResult.tokensUsed;
    judgeResults.push(faithfulResult);

    // 2. Factual completeness: check each expected fact
    let factualScore = 1.0;
    let factualPass = true;
    if (tc.expectedFacts && tc.expectedFacts.length > 0) {
      const factualResult = await judge(
        { input: tc.question, output, rubric: { type: "factual", facts: tc.expectedFacts } },
        judgeConfig,
      );
      tokensUsed += factualResult.tokensUsed;
      judgeResults.push(factualResult);
      factualScore = factualResult.score;
      factualPass = factualResult.pass;
    }

    // 3. Forbidden claims: check each forbidden claim is NOT present
    const forbiddenViolations: string[] = [];
    if (tc.forbiddenClaims && tc.forbiddenClaims.length > 0) {
      for (const claim of tc.forbiddenClaims) {
        const notContainsResult = await judge(
          { input: tc.question, output, rubric: { type: "not_contains", value: claim } },
          judgeConfig,
        );
        tokensUsed += notContainsResult.tokensUsed;
        judgeResults.push(notContainsResult);
        if (!notContainsResult.pass) {
          forbiddenViolations.push(claim);
        }
      }
    }

    const passed =
      faithfulResult.pass &&
      factualPass &&
      forbiddenViolations.length === 0;

    caseResults.push({
      question: tc.question,
      output,
      faithfulnessScore: faithfulResult.score,
      faithfulnessPass: faithfulResult.pass,
      factualCompletenessScore: factualScore,
      factualCompletenessPass: factualPass,
      forbiddenClaimViolations: forbiddenViolations,
      passed,
      judgeResults,
    });
  }

  const passedCases = caseResults.filter((c) => c.passed).length;
  const avgFaithfulnessScore = caseResults.reduce((s, c) => s + c.faithfulnessScore, 0) / (caseResults.length || 1);
  const avgFactualCompletenessScore = caseResults.reduce((s, c) => s + c.factualCompletenessScore, 0) / (caseResults.length || 1);
  const totalForbiddenViolations = caseResults.reduce((s, c) => s + c.forbiddenClaimViolations.length, 0);
  const allPassed = passedCases === caseResults.length;
  const durationMs = Date.now() - startMs;

  const ragEvalResult: RagEvalResult = {
    passed: allPassed,
    totalCases: caseResults.length,
    passedCases,
    avgFaithfulnessScore,
    avgFactualCompletenessScore,
    totalForbiddenViolations,
    caseResults,
    tokensUsed,
    durationMs,
  };

  const result = createResult({
    runId: options.runId,
    scenarioId: scenario.id,
    model: "rag-eval",
    stepsTotal: caseResults.length,
  });

  return updateResult(result.id, {
    status: allPassed ? "passed" : "failed",
    reasoning: `${passedCases}/${caseResults.length} RAG cases passed (faithfulness: ${(avgFaithfulnessScore * 100).toFixed(0)}%, factual: ${(avgFactualCompletenessScore * 100).toFixed(0)}%, forbidden violations: ${totalForbiddenViolations})`,
    stepsCompleted: passedCases,
    tokensUsed,
    durationMs,
    metadata: ragEvalResult as unknown as Record<string, unknown>,
  });
}

// ─── Pipeline scenario runner ─────────────────────────────────────────────────

export async function runPipelineScenario(
  scenario: Scenario,
  options: { runId: string; baseUrl: string },
): Promise<Result> {
  const startMs = Date.now();

  // Extract pipeline config from scenario metadata
  const metadata = scenario.metadata as Record<string, unknown> | null;
  const pipelineConfig = metadata?.pipeline as PipelineConfig | undefined;

  if (!pipelineConfig || !pipelineConfig.steps?.length) {
    const result = createResult({ runId: options.runId, scenarioId: scenario.id, model: "pipeline", stepsTotal: 0 });
    return updateResult(result.id, { status: "error", error: "Pipeline scenario missing 'pipeline' config with steps in metadata" });
  }

  const pipelineResult = await runPipeline(pipelineConfig, { baseUrl: options.baseUrl });
  const durationMs = Date.now() - startMs;

  const result = createResult({
    runId: options.runId,
    scenarioId: scenario.id,
    model: "pipeline",
    stepsTotal: pipelineConfig.steps.length,
  });

  return updateResult(result.id, {
    status: pipelineResult.passed ? "passed" : "failed",
    reasoning: `Pipeline ${pipelineResult.passed ? "passed" : "failed"}: ${pipelineResult.stepsCompleted}/${pipelineConfig.steps.length} steps completed`,
    stepsCompleted: pipelineResult.stepsCompleted,
    tokensUsed: pipelineResult.tokensUsed,
    durationMs,
    metadata: pipelineResult as unknown as Record<string, unknown>,
  });
}

// Re-export runPipeline for direct use
export { runPipeline } from "./pipeline-runner.js";
export type { PipelineConfig, PipelineStep, PipelineRunResult, PipelineStepResult } from "./pipeline-runner.js";
