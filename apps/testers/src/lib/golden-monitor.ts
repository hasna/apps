import { judge } from "./judge.js";
import type { GoldenAnswer, GoldenCheckResult } from "../db/golden-answers.js";
import {
  listGoldenAnswers,
  createGoldenCheckResult,
  listGoldenCheckResults,
} from "../db/golden-answers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoldenMonitorOptions {
  projectId?: string;
  baseUrl: string;
  judgeModel?: string;
}

export interface GoldenMonitorResult {
  checked: number;
  passed: number;
  drifted: number;
}

// ─── Core check ───────────────────────────────────────────────────────────────

/**
 * Hit golden.endpoint, score the response vs golden_answer using the judge,
 * detect drift (score drop > 0.15 vs 7-day average), and save the result.
 */
export async function checkGoldenAnswer(
  golden: GoldenAnswer,
  options: { baseUrl: string; judgeModel?: string }
): Promise<GoldenCheckResult> {
  const endpoint = golden.endpoint.startsWith("http")
    ? golden.endpoint
    : `${options.baseUrl.replace(/\/$/, "")}${golden.endpoint}`;

  // Hit the endpoint
  let responseText: string;
  let provider: string = "http";

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      responseText = `HTTP ${response.status}: ${await response.text()}`;
    } else {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await response.json() as unknown;
        responseText = typeof json === "string" ? json : JSON.stringify(json);
      } else {
        responseText = await response.text();
      }
    }
  } catch (err) {
    responseText = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Score vs golden answer using the judge
  const judgeResult = await judge(
    {
      input: golden.question,
      output: responseText,
      rubric: {
        type: "llm",
        prompt: "Does this response convey the same information as the golden answer without hallucinating new facts? Score 1.0 if identical in substance, 0.0 if completely different or contains fabricated information.",
        threshold: 0.7,
      },
    },
    {
      model: options.judgeModel ?? golden.judgeModel ?? undefined,
    }
  );

  const similarityScore = judgeResult.score;
  const passed = judgeResult.pass;
  provider = judgeResult.provider;

  // Drift detection: compare score vs 7-day average
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentResults = listGoldenCheckResults(golden.id, { since: sevenDaysAgo });

  let driftDetected = false;
  if (recentResults.length >= 3) {
    const avgScore =
      recentResults.reduce((sum, r) => sum + (r.similarityScore ?? 0), 0) / recentResults.length;
    if (avgScore - similarityScore > 0.15) {
      driftDetected = true;
    }
  }

  return createGoldenCheckResult({
    goldenId: golden.id,
    response: responseText,
    similarityScore,
    passed,
    driftDetected,
    judgeModel: options.judgeModel ?? golden.judgeModel ?? judgeResult.model,
    provider,
  });
}

/**
 * Run all enabled golden answer checks for a project (or all if no projectId).
 */
export async function runGoldenMonitor(
  options: { projectId?: string; baseUrl: string; judgeModel?: string }
): Promise<GoldenMonitorResult> {
  const goldens = listGoldenAnswers({
    projectId: options.projectId,
    enabled: true,
  });

  let checked = 0;
  let passed = 0;
  let drifted = 0;

  for (const golden of goldens) {
    try {
      const result = await checkGoldenAnswer(golden, {
        baseUrl: options.baseUrl,
        judgeModel: options.judgeModel,
      });

      checked++;
      if (result.passed) passed++;
      if (result.driftDetected) drifted++;
    } catch {
      // Count as checked but not passed
      checked++;
    }
  }

  return { checked, passed, drifted };
}
