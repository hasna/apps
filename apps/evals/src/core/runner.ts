import { randomUUID } from "crypto";
import { runAssertions, allAssertionsPassed } from "./assertions.js";
import { runJudge } from "./judge.js";
import { callHttpAdapter } from "../adapters/http.js";
import { callAnthropicAdapter } from "../adapters/anthropic.js";
import { callOpenAIAdapter } from "../adapters/openai.js";
import { callMcpAdapter } from "../adapters/mcp.js";
import { callFunctionAdapter } from "../adapters/function.js";
import { callCliAdapter } from "../adapters/cli.js";
import type {
  AdapterConfig,
  EvalCase,
  EvalResult,
  EvalRun,
  EvalRunStats,
  RunOptions,
  Verdict,
  ConversationTurn,
} from "../types/index.js";
import type { AdapterResponse } from "../adapters/http.js";

// ─── Adapter dispatch ─────────────────────────────────────────────────────────

async function callAdapter(
  config: AdapterConfig,
  input: string,
  turns?: ConversationTurn[]
): Promise<AdapterResponse> {
  switch (config.type) {
    case "http":       return callHttpAdapter(config, input, turns);
    case "anthropic":  return callAnthropicAdapter(config, input, turns);
    case "openai":     return callOpenAIAdapter(config, input, turns);
    case "mcp":        return callMcpAdapter(config, input);
    case "function":   return callFunctionAdapter(config, input);
    case "cli":        return callCliAdapter(config, input);
  }
}

// ─── Single case execution ────────────────────────────────────────────────────

async function runCase(
  evalCase: EvalCase,
  adapterConfig: AdapterConfig,
  skipJudge = false
): Promise<EvalResult> {
  const start = Date.now();

  try {
    const input = evalCase.input ?? evalCase.turns?.[0]?.content ?? "";

    // Call adapter
    const adapterResult = await callAdapter(
      evalCase.adapter ?? adapterConfig,
      input,
      evalCase.turns
    );

    if (adapterResult.error) {
      return {
        caseId: evalCase.id,
        verdict: "UNKNOWN",
        output: "",
        assertionResults: [],
        durationMs: Date.now() - start,
        error: adapterResult.error,
      };
    }

    // Run assertions (cheapest-first, short-circuit on failure)
    const assertionResults = evalCase.assertions
      ? await runAssertions(evalCase.assertions, {
          output: adapterResult.output,
          durationMs: adapterResult.durationMs,
          inputTokens: adapterResult.inputTokens,
          outputTokens: adapterResult.outputTokens,
          costUsd: adapterResult.costUsd,
          toolCalls: adapterResult.toolCalls,
        })
      : [];

    const assertionsOk = assertionResults.length === 0 || allAssertionsPassed(assertionResults);

    // Run judge only if assertions pass (and judge is configured, and not skipped)
    let judgeResult = undefined;
    let verdict: Verdict = assertionsOk ? "PASS" : "FAIL";

    if (!skipJudge && evalCase.judge && assertionsOk) {
      judgeResult = await runJudge(
        input,
        adapterResult.output,
        evalCase.judge,
        evalCase.expected
      );
      verdict = judgeResult.verdict;
    }

    return {
      caseId: evalCase.id,
      verdict,
      output: adapterResult.output,
      assertionResults,
      judgeResult,
      durationMs: Date.now() - start,
      inputTokens: adapterResult.inputTokens,
      outputTokens: adapterResult.outputTokens,
      costUsd: (adapterResult.costUsd ?? 0) + (judgeResult?.costUsd ?? 0) || undefined,
    };
  } catch (err) {
    return {
      caseId: evalCase.id,
      verdict: "UNKNOWN",
      output: "",
      assertionResults: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Pass^k execution ─────────────────────────────────────────────────────────

async function runCaseWithPassK(
  evalCase: EvalCase,
  adapterConfig: AdapterConfig,
  skipJudge: boolean,
  repeat: number
): Promise<EvalResult> {
  const results = await Promise.all(
    Array.from({ length: repeat }, () => runCase(evalCase, adapterConfig, skipJudge))
  );

  const verdicts = results.map((r) => r.verdict);
  const passed = verdicts.filter((v) => v === "PASS").length;
  const passRate = passed / repeat;
  const threshold = evalCase.passThreshold ?? 1.0;
  const verdict: Verdict = passRate >= threshold ? "PASS" : passRate === 0 ? "FAIL" : "UNKNOWN";

  // Return the first result enriched with Pass^k data
  const base = results[0]!;
  return {
    ...base,
    verdict,
    repeatVerdicts: verdicts,
    passRate,
    costUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) || undefined,
    durationMs: Math.max(...results.map((r) => r.durationMs)),
  };
}

// ─── Run a full dataset ───────────────────────────────────────────────────────

export async function runEvals(
  cases: EvalCase[],
  options: RunOptions
): Promise<EvalRun> {
  if (!options.adapter) throw new Error("No adapter config provided");

  const concurrency = options.concurrency ?? 5;
  const skipJudge = options.skipJudge ?? false;

  // Filter by tags if provided
  const filteredCases = options.tags && options.tags.length > 0
    ? cases.filter((c) => c.tags?.some((t) => options.tags!.includes(t)))
    : cases;

  const results: EvalResult[] = [];

  // Run in parallel with concurrency limit
  for (let i = 0; i < filteredCases.length; i += concurrency) {
    const batch = filteredCases.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((c) => {
        const repeat = c.repeat ?? options.repeat ?? 1;
        return repeat > 1
          ? runCaseWithPassK(c, options.adapter!, skipJudge, repeat)
          : runCase(c, options.adapter!, skipJudge);
      })
    );
    results.push(...batchResults);
  }

  const stats = computeStats(results);

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    dataset: options.dataset,
    adapterConfig: options.adapter,
    results,
    stats,
  };
}

// ─── Run a single case (for MCP ad-hoc use) ───────────────────────────────────

export async function runSingleCase(
  evalCase: EvalCase,
  adapterConfig: AdapterConfig,
  skipJudge = false
): Promise<EvalResult> {
  const repeat = evalCase.repeat ?? 1;
  return repeat > 1
    ? runCaseWithPassK(evalCase, adapterConfig, skipJudge, repeat)
    : runCase(evalCase, adapterConfig, skipJudge);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function computeStats(results: EvalResult[]): EvalRunStats {
  const total = results.length;
  const passed = results.filter((r) => r.verdict === "PASS").length;
  const failed = results.filter((r) => r.verdict === "FAIL").length;
  const unknown = results.filter((r) => r.verdict === "UNKNOWN").length;
  const errors = results.filter((r) => r.error !== undefined).length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalCostUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const totalTokens = results.reduce(
    (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0
  );

  return {
    total,
    passed,
    failed,
    unknown,
    errors,
    passRate: total > 0 ? passed / total : 0,
    totalDurationMs,
    totalCostUsd,
    totalTokens,
  };
}
