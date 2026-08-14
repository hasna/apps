/**
 * Multi-agent pipeline tester.
 *
 * Runs a sequence of AI endpoint calls where each step's output feeds into
 * the next step's input via template substitution ({{prev.field}} / {{input.key}}).
 *
 * Each step can assert its output before proceeding, enabling fail-fast or
 * continue-on-fail pipelines.
 */

import { judge } from "./judge.js";
import type { JudgeRubric, JudgeConfig, JudgeResult } from "./judge.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineStep {
  name: string;
  endpoint: string;
  method?: string;
  headers?: Record<string, string>;
  inputTemplate: string;   // JSON template with {{prev.field}} and {{input.field}} substitution
  outputCapture: string;   // JSONPath to capture for next step
  assertions: JudgeRubric[];  // validate before passing to next step
  onFail?: "stop" | "continue";  // default "stop"
}

export interface PipelineConfig {
  steps: PipelineStep[];
  input?: Record<string, string>;  // initial variables
  judgeModel?: string;
  judgeProvider?: string;
  baseUrl?: string;
}

export interface PipelineStepResult {
  stepName: string;
  passed: boolean;
  output: string | null;
  assertionResults: JudgeResult[];
  error?: string;
  durationMs: number;
}

export interface PipelineRunResult {
  passed: boolean;
  stepsCompleted: number;
  stepResults: PipelineStepResult[];
  durationMs: number;
  tokensUsed: number;
}

// ─── Template substitution ────────────────────────────────────────────────────

function extractJsonPath(obj: unknown, path: string): string | null {
  try {
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

export function substituteTemplate(
  template: string,
  prevOutput: unknown,
  inputVars: Record<string, string>,
): string {
  return template
    // Replace {{prev.field}} with JSONPath into previous output
    .replace(/\{\{prev\.([^}]+)\}\}/g, (_, path: string) => {
      return extractJsonPath(prevOutput, path) ?? "";
    })
    // Replace {{input.key}} with initial input variables
    .replace(/\{\{input\.([^}]+)\}\}/g, (_, key: string) => {
      return inputVars[key] ?? "";
    });
}

// ─── HTTP call ────────────────────────────────────────────────────────────────

async function callStep(
  baseUrl: string,
  step: PipelineStep,
  prevOutput: unknown,
  inputVars: Record<string, string>,
): Promise<{ responseText: string; statusCode: number } | null> {
  const substituted = substituteTemplate(step.inputTemplate, prevOutput, inputVars);
  const url = baseUrl.replace(/\/$/, "") + step.endpoint;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(url, {
      method: step.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...(step.headers ?? {}),
      },
      body: substituted,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const responseText = await resp.text();
    return { responseText, statusCode: resp.status };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

// ─── Main pipeline runner ─────────────────────────────────────────────────────

export async function runPipeline(
  config: PipelineConfig,
  options: { baseUrl: string; judgeConfig?: JudgeConfig },
): Promise<PipelineRunResult> {
  const startMs = Date.now();
  const stepResults: PipelineStepResult[] = [];
  let prevOutput: unknown = null;
  let stepsCompleted = 0;
  let tokensUsed = 0;

  const judgeConfig: JudgeConfig = {
    model: config.judgeModel ?? options.judgeConfig?.model,
    provider: (config.judgeProvider ?? options.judgeConfig?.provider) as JudgeConfig["provider"],
    apiKey: options.judgeConfig?.apiKey,
  };

  const baseUrl = config.baseUrl ?? options.baseUrl;
  const inputVars = config.input ?? {};

  for (const step of config.steps) {
    const stepStart = Date.now();

    // Call the endpoint
    const callResult = await callStep(baseUrl, step, prevOutput, inputVars);
    if (!callResult) {
      const stepResult: PipelineStepResult = {
        stepName: step.name,
        passed: false,
        output: null,
        assertionResults: [],
        error: `Step "${step.name}" failed: endpoint call returned null (network error or timeout)`,
        durationMs: Date.now() - stepStart,
      };
      stepResults.push(stepResult);

      if ((step.onFail ?? "stop") === "stop") break;
      continue;
    }

    // Extract the output value via JSONPath
    let capturedOutput: string | null = null;
    try {
      const parsed = JSON.parse(callResult.responseText) as unknown;
      capturedOutput = extractJsonPath(parsed, step.outputCapture);
    } catch {
      // Response is not JSON — use raw text
      capturedOutput = callResult.responseText.slice(0, 2000);
    }

    if (capturedOutput === null) {
      // Try common AI output fields
      try {
        const parsed = JSON.parse(callResult.responseText) as Record<string, unknown>;
        capturedOutput =
          extractJsonPath(parsed, "choices[0].message.content") ??
          extractJsonPath(parsed, "content[0].text") ??
          extractJsonPath(parsed, "candidates[0].content.parts[0].text") ??
          extractJsonPath(parsed, "response") ??
          extractJsonPath(parsed, "output") ??
          extractJsonPath(parsed, "message") ??
          extractJsonPath(parsed, "text") ??
          callResult.responseText.slice(0, 2000);
      } catch {
        capturedOutput = callResult.responseText.slice(0, 2000);
      }
    }

    // Run assertions
    const assertionResults: JudgeResult[] = [];
    let stepPassed = true;

    for (const rubric of step.assertions) {
      const judgeResult = await judge(
        { input: step.name, output: capturedOutput ?? "", rubric },
        judgeConfig,
      );
      tokensUsed += judgeResult.tokensUsed;
      assertionResults.push(judgeResult);
      if (!judgeResult.pass) stepPassed = false;
    }

    // If no assertions, step passes if we got a response
    if (step.assertions.length === 0) {
      stepPassed = callResult.statusCode >= 200 && callResult.statusCode < 300;
    }

    const stepResult: PipelineStepResult = {
      stepName: step.name,
      passed: stepPassed,
      output: capturedOutput,
      assertionResults,
      durationMs: Date.now() - stepStart,
    };
    stepResults.push(stepResult);
    stepsCompleted++;

    if (stepPassed) {
      // Pass output to next step
      try {
        prevOutput = JSON.parse(callResult.responseText);
      } catch {
        prevOutput = capturedOutput;
      }
    } else {
      // Step failed
      if ((step.onFail ?? "stop") === "stop") break;
      // continue: pass output anyway so next step can try
      try {
        prevOutput = JSON.parse(callResult.responseText);
      } catch {
        prevOutput = capturedOutput;
      }
    }
  }

  const allPassed = stepResults.length === config.steps.length &&
    stepResults.every((s) => s.passed);

  return {
    passed: allPassed,
    stepsCompleted,
    stepResults,
    durationMs: Date.now() - startMs,
    tokensUsed,
  };
}
