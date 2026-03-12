import type { Scenario, Run, Result } from "../types/index.js";
import { createRun, getRun, updateRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { createScreenshot } from "../db/screenshots.js";
import { listScenarios } from "../db/scenarios.js";
import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { Screenshotter } from "./screenshotter.js";
import { createClient, runAgentLoop, resolveModel } from "./ai-client.js";
import { loadConfig } from "./config.js";
import type { Browser, Page } from "playwright";

export interface RunOptions {
  url: string;
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeout?: number;
  projectId?: string;
  apiKey?: string;
  screenshotDir?: string;
}

export interface RunEvent {
  type: "scenario:start" | "scenario:pass" | "scenario:fail" | "scenario:error" | "screenshot:captured" | "run:complete";
  scenarioId?: string;
  scenarioName?: string;
  resultId?: string;
  runId?: string;
  error?: string;
  screenshotPath?: string;
}

export type RunEventHandler = (event: RunEvent) => void;

let eventHandler: RunEventHandler | null = null;

export function onRunEvent(handler: RunEventHandler): void {
  eventHandler = handler;
}

function emit(event: RunEvent): void {
  if (eventHandler) eventHandler(event);
}

export async function runSingleScenario(
  scenario: Scenario,
  runId: string,
  options: RunOptions
): Promise<Result> {
  const config = loadConfig();
  const model = resolveModel(options.model ?? scenario.model ?? config.defaultModel);
  const client = createClient(options.apiKey ?? config.anthropicApiKey);
  const screenshotter = new Screenshotter({
    baseDir: options.screenshotDir ?? config.screenshots.dir,
  });

  const result = createResult({
    runId,
    scenarioId: scenario.id,
    model,
    stepsTotal: scenario.steps.length || 10,
  });

  emit({ type: "scenario:start", scenarioId: scenario.id, scenarioName: scenario.name, resultId: result.id, runId });

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchBrowser({ headless: !(options.headed ?? false) });
    page = await getPage(browser, {
      viewport: config.browser.viewport,
    });

    const targetUrl = scenario.targetPath
      ? `${options.url.replace(/\/$/, "")}${scenario.targetPath}`
      : options.url;

    await page.goto(targetUrl, { timeout: options.timeout ?? config.browser.timeout });

    const agentResult = await runAgentLoop({
      client,
      page,
      scenario,
      screenshotter,
      model,
      runId,
      maxTurns: 30,
    });

    // Save screenshots to DB
    for (const ss of agentResult.screenshots) {
      createScreenshot({
        resultId: result.id,
        stepNumber: ss.stepNumber,
        action: ss.action,
        filePath: ss.filePath,
        width: ss.width,
        height: ss.height,
        description: ss.description,
        pageUrl: ss.pageUrl,
        thumbnailPath: ss.thumbnailPath,
      });
      emit({ type: "screenshot:captured", screenshotPath: ss.filePath, scenarioId: scenario.id, runId });
    }

    const updatedResult = updateResult(result.id, {
      status: agentResult.status,
      reasoning: agentResult.reasoning,
      stepsCompleted: agentResult.stepsCompleted,
      durationMs: Date.now() - new Date(result.createdAt).getTime(),
      tokensUsed: agentResult.tokensUsed,
      costCents: estimateCost(model, agentResult.tokensUsed),
    });

    const eventType = agentResult.status === "passed" ? "scenario:pass" : "scenario:fail";
    emit({ type: eventType, scenarioId: scenario.id, scenarioName: scenario.name, resultId: result.id, runId });

    return updatedResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const updatedResult = updateResult(result.id, {
      status: "error",
      error: errorMsg,
      durationMs: Date.now() - new Date(result.createdAt).getTime(),
    });

    emit({ type: "scenario:error", scenarioId: scenario.id, scenarioName: scenario.name, error: errorMsg, runId });
    return updatedResult;
  } finally {
    if (browser) await closeBrowser(browser);
  }
}

export async function runBatch(
  scenarios: Scenario[],
  options: RunOptions
): Promise<{ run: Run; results: Result[] }> {
  const config = loadConfig();
  const model = resolveModel(options.model ?? config.defaultModel);
  const parallel = options.parallel ?? 1;

  const run = createRun({
    url: options.url,
    model,
    headed: options.headed,
    parallel,
    projectId: options.projectId,
  });

  updateRun(run.id, { status: "running", total: scenarios.length });

  const results: Result[] = [];

  if (parallel <= 1) {
    // Sequential
    for (const scenario of scenarios) {
      const result = await runSingleScenario(scenario, run.id, options);
      results.push(result);
    }
  } else {
    // Parallel with concurrency limit
    const queue = [...scenarios];
    const running: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      const scenario = queue.shift();
      if (!scenario) return;

      const result = await runSingleScenario(scenario, run.id, options);
      results.push(result);
      await processNext();
    };

    const workers = Math.min(parallel, scenarios.length);
    for (let i = 0; i < workers; i++) {
      running.push(processNext());
    }
    await Promise.all(running);
  }

  // Finalize run
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const finalStatus = failed > 0 ? "failed" : "passed";

  const finalRun = updateRun(run.id, {
    status: finalStatus,
    passed,
    failed,
    total: scenarios.length,
    finished_at: new Date().toISOString(),
  });

  emit({ type: "run:complete", runId: run.id });

  return { run: finalRun, results };
}

export async function runByFilter(
  options: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] }
): Promise<{ run: Run; results: Result[] }> {
  let scenarios: Scenario[];

  if (options.scenarioIds && options.scenarioIds.length > 0) {
    const all = listScenarios({ projectId: options.projectId });
    scenarios = all.filter((s) => options.scenarioIds!.includes(s.id) || options.scenarioIds!.includes(s.shortId));
  } else {
    scenarios = listScenarios({
      projectId: options.projectId,
      tags: options.tags,
      priority: options.priority as "low" | "medium" | "high" | "critical" | undefined,
    });
  }

  if (scenarios.length === 0) {
    const config = loadConfig();
    const model = resolveModel(options.model ?? config.defaultModel);
    const run = createRun({ url: options.url, model, projectId: options.projectId });
    updateRun(run.id, { status: "passed", total: 0, finished_at: new Date().toISOString() });
    return { run: getRun(run.id)!, results: [] };
  }

  return runBatch(scenarios, options);
}

/**
 * Start a run asynchronously — creates the run record immediately and returns it,
 * then executes scenarios in the background. Poll getRun(id) to check progress.
 */
export function startRunAsync(
  options: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] }
): { runId: string; scenarioCount: number } {
  const config = loadConfig();
  const model = resolveModel(options.model ?? config.defaultModel);

  let scenarios: Scenario[];
  if (options.scenarioIds && options.scenarioIds.length > 0) {
    const all = listScenarios({ projectId: options.projectId });
    scenarios = all.filter((s) => options.scenarioIds!.includes(s.id) || options.scenarioIds!.includes(s.shortId));
  } else {
    scenarios = listScenarios({
      projectId: options.projectId,
      tags: options.tags,
      priority: options.priority as "low" | "medium" | "high" | "critical" | undefined,
    });
  }

  const parallel = options.parallel ?? 1;
  const run = createRun({
    url: options.url,
    model,
    headed: options.headed,
    parallel,
    projectId: options.projectId,
  });

  if (scenarios.length === 0) {
    updateRun(run.id, { status: "passed", total: 0, finished_at: new Date().toISOString() });
    return { runId: run.id, scenarioCount: 0 };
  }

  updateRun(run.id, { status: "running", total: scenarios.length });

  // Fire and forget — execute in background
  (async () => {
    const results: Result[] = [];
    try {
      if (parallel <= 1) {
        for (const scenario of scenarios) {
          const result = await runSingleScenario(scenario, run.id, options);
          results.push(result);
        }
      } else {
        const queue = [...scenarios];
        const running: Promise<void>[] = [];
        const processNext = async (): Promise<void> => {
          const scenario = queue.shift();
          if (!scenario) return;
          const result = await runSingleScenario(scenario, run.id, options);
          results.push(result);
          await processNext();
        };
        const workers = Math.min(parallel, scenarios.length);
        for (let i = 0; i < workers; i++) {
          running.push(processNext());
        }
        await Promise.all(running);
      }

      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
      updateRun(run.id, {
        status: failed > 0 ? "failed" : "passed",
        passed,
        failed,
        total: scenarios.length,
        finished_at: new Date().toISOString(),
      });
      emit({ type: "run:complete", runId: run.id });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      updateRun(run.id, {
        status: "failed",
        finished_at: new Date().toISOString(),
      });
      emit({ type: "run:complete", runId: run.id, error: errorMsg });
    }
  })();

  return { runId: run.id, scenarioCount: scenarios.length };
}

function estimateCost(model: string, tokens: number): number {
  // Rough cost estimates in cents per 1M tokens (input + output averaged)
  const costs: Record<string, number> = {
    "claude-haiku-4-5-20251001": 0.1,     // ~$1/MTok avg
    "claude-sonnet-4-6-20260311": 0.9,     // ~$9/MTok avg
    "claude-opus-4-6-20260311": 3.0,       // ~$30/MTok avg
  };
  const costPer1M = costs[model] ?? 0.5;
  return (tokens / 1_000_000) * costPer1M * 100; // cents
}
