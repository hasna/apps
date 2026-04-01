import type { Scenario, Run, Result } from "../types/index.js";
import { BudgetExceededError } from "../types/index.js";
import { runEvalScenario } from "./eval-runner.js";
import { createRun, getRun, updateRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { analyzeFailure } from "./failure-analyzer.js";
import { estimateRunCostCents } from "./costs.js";
import { createScreenshot } from "../db/screenshots.js";
import { listScenarios, updateScenarioPassedCache } from "../db/scenarios.js";
import { getPersona } from "../db/personas.js";
import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { Screenshotter } from "./screenshotter.js";
import { createClientForModel, runAgentLoop, resolveModel } from "./ai-client.js";
import { loadConfig } from "./config.js";
import { ensurePersonaAuthenticated, loginWithAuthConfig } from "./persona-auth.js";
import { enableNetworkLogging } from "@hasna/browser";
import { registerSession, closeSession as closeTrackedSession } from "./session-tracker.js";
import { dispatchWebhooks } from "./webhooks.js";
import { pushFailedRunToLogs } from "./logs-integration.js";
import { createFailureTasks, notifyFailureToConversations, notifyRunToConversations } from "./failure-pipeline.js";
import type { Browser, Page } from "playwright";

export interface RunOptions {
  url: string;
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeout?: number;
  retry?: number;
  projectId?: string;
  apiKey?: string;
  screenshotDir?: string;
  engine?: import("../types/index.js").BrowserEngine;
  personaId?: string;
  personaIds?: string[];  // run with multiple personas for divergence testing
  samples?: number;           // run each scenario N times for flakiness detection
  flakinessThreshold?: number; // pass rate below this = "flaky" (default 0.95)
  a11y?: boolean | { level?: "A" | "AA" | "AAA" }; // enable axe-core a11y scan after each navigation
  selfHeal?: boolean;    // override config.selfHeal for this run
  maxCostCents?: number;  // hard budget cap — throws BudgetExceededError if estimated cost exceeds this
  skipBudgetCheck?: boolean; // bypass maxCostCents check
  cacheMaxAgeMs?: number; // skip scenario if it passed at the same URL within this many ms (0 = disabled)
  minimal?: boolean;  // fastest possible run: cheapest model, fastest browser, max parallelism, min turns
}

export interface RunEvent {
  type:
    | "scenario:start"
    | "scenario:pass"
    | "scenario:fail"
    | "scenario:error"
    | "screenshot:captured"
    | "run:complete"
    | "step:tool_call"
    | "step:tool_result"
    | "step:thinking"
    | "scenario:timeout_warning";
  scenarioId?: string;
  scenarioName?: string;
  resultId?: string;
  runId?: string;
  error?: string;
  screenshotPath?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  thinking?: string;
  stepNumber?: number;
  retryAttempt?: number;
  maxRetries?: number;
  stepDurationMs?: number;
  timeoutMs?: number;
  elapsedMs?: number;
}

export type RunEventHandler = (event: RunEvent) => void;

let eventHandler: RunEventHandler | null = null;

export function onRunEvent(handler: RunEventHandler): void {
  eventHandler = handler;
}

function emit(event: RunEvent): void {
  if (eventHandler) eventHandler(event);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Soft warning at 80% of timeout
    const warningAt = Math.floor(ms * 0.8);
    const warningTimer = setTimeout(() => {
      emit({
        type: "scenario:timeout_warning",
        scenarioName: label,
        timeoutMs: ms,
        elapsedMs: warningAt,
      });
    }, warningAt);

    const timer = setTimeout(() => {
      clearTimeout(warningTimer);
      reject(new Error(`Scenario '${label}' timed out after ${ms}ms. Try: testers run --timeout ${ms * 2} or simplify the scenario steps.`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); clearTimeout(warningTimer); resolve(val); },
      (err) => { clearTimeout(timer); clearTimeout(warningTimer); reject(err); },
    );
  });
}

export async function runSingleScenario(
  scenario: Scenario,
  runId: string,
  options: RunOptions
): Promise<Result> {
  // Dispatch eval scenarios to the eval runner
  const scenarioType = (scenario as Scenario & { scenarioType?: string }).scenarioType ?? "browser";
  if (scenarioType === "eval") {
    return runEvalScenario(scenario, { runId, baseUrl: options.url });
  }

  const config = loadConfig();
  // Allow per-run override of self-healing
  if (options.selfHeal !== undefined) config.selfHeal = options.selfHeal;

  // Minimal mode: override to cheapest/fastest settings
  let effectiveOptions = options;
  if (options.minimal) {
    effectiveOptions = {
      ...options,
      engine: options.engine ?? "playwright", // use playwright as fallback
    };
    // Try to pick fastest available engine
    try {
      const { isLightpandaAvailable } = await import("./browser-lightpanda.js").catch(() => ({ isLightpandaAvailable: () => false }));
      if (isLightpandaAvailable()) effectiveOptions = { ...effectiveOptions, engine: "lightpanda" };
    } catch { /* use playwright */ }
  }

  const model = resolveModel(
    effectiveOptions.minimal ? "quick" : (effectiveOptions.model ?? scenario.model ?? config.defaultModel)
  );

  // Cache check: skip if scenario passed recently at the same URL
  if (options.cacheMaxAgeMs && options.cacheMaxAgeMs > 0 && scenario.lastPassedAt && scenario.lastPassedUrl === options.url) {
    const age = Date.now() - new Date(scenario.lastPassedAt).getTime();
    if (age < options.cacheMaxAgeMs) {
      const cached = createResult({ runId, scenarioId: scenario.id, model, stepsTotal: 0 });
      return updateResult(cached.id, {
        status: "passed",
        reasoning: `Cache hit: passed ${Math.round(age / 1000)}s ago at ${options.url}`,
        stepsCompleted: 0,
        durationMs: 0,
        tokensUsed: 0,
      });
    }
  }
  const client = createClientForModel(model, effectiveOptions.apiKey ?? config.anthropicApiKey);
  const screenshotter = new Screenshotter({
    baseDir: effectiveOptions.screenshotDir ?? config.screenshots.dir,
  });

  // Resolve persona before creating result so we can store the name
  const resolvedPersonaId = options.personaId ?? scenario.personaId;
  const persona = resolvedPersonaId ? getPersona(resolvedPersonaId) : null;

  const result = createResult({
    runId,
    scenarioId: scenario.id,
    model,
    stepsTotal: scenario.steps.length || 10,
    personaId: persona?.id ?? null,
    personaName: persona?.name ?? null,
  });

  emit({ type: "scenario:start", scenarioId: scenario.id, scenarioName: scenario.name, resultId: result.id, runId });

  let browser: Browser | null = null;
  let page: Page | null = null;
  let stopNetworkLogging: (() => void) | null = null;
  const networkErrors: Array<{ url: string; status: number; method: string }> = [];

  try {
    browser = await launchBrowser({ headless: !(effectiveOptions.headed ?? false), engine: effectiveOptions.engine });
    page = await getPage(browser, {
      viewport: config.browser.viewport,
    });

    const targetUrl = scenario.targetPath
      ? `${options.url.replace(/\/$/, "")}${scenario.targetPath}`
      : options.url;

    const scenarioTimeout = scenario.timeoutMs ?? options.timeout ?? config.browser.timeout ?? 60000;

    // Register session in open-browser's session DB (enables cross-tool session visibility)
    registerSession({
      resultId: result.id,
      runId,
      scenarioId: scenario.id,
      engine: effectiveOptions.engine ?? "playwright",
      startUrl: targetUrl,
    });

    // Capture network errors (4xx/5xx) per scenario using @hasna/browser network logging
    try {
      // Use result ID as session ID so network events are linked to this result
      stopNetworkLogging = enableNetworkLogging(page, result.id);
    } catch {
      // Non-fatal — network logging is best-effort
    }
    // Also capture high-level request failures directly for metadata
    page.on("response", (response) => {
      const status = response.status();
      if (status >= 400 && !response.url().includes("favicon")) {
        networkErrors.push({ url: response.url(), status, method: response.request().method() });
      }
    });

    // Attach listeners BEFORE page.goto() to capture initial page load events
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => { consoleErrors.push(err.message); });

    // Authenticate using persona credentials (if persona has auth configured)
    if (persona?.auth) {
      const loginResult = await ensurePersonaAuthenticated(page, persona, options.url);
      if (!loginResult.success) {
        const updatedResult = updateResult(result.id, {
          status: "error",
          error: `Persona auth failed (${loginResult.method}): ${loginResult.error}`,
          durationMs: Date.now() - new Date(result.createdAt).getTime(),
        });
        emit({ type: "scenario:error", scenarioId: scenario.id, scenarioName: scenario.name, error: updatedResult.error ?? "", runId });
        return updatedResult;
      }
    } else if (scenario.requiresAuth && scenario.authConfig) {
      // Authenticate using the scenario's authConfig (email/password or token-based)
      const loginResult = await loginWithAuthConfig(page, scenario.authConfig, options.url);
      if (!loginResult.success && loginResult.method !== "none") {
        const updatedResult = updateResult(result.id, {
          status: "error",
          error: `Auth failed (${loginResult.method}): ${loginResult.error}`,
          durationMs: Date.now() - new Date(result.createdAt).getTime(),
        });
        emit({ type: "scenario:error", scenarioId: scenario.id, scenarioName: scenario.name, error: updatedResult.error ?? "", runId });
        return updatedResult;
      }
    }

    await page.goto(targetUrl, { timeout: Math.min(scenarioTimeout, 30000) });

    // Per-step timing: track when each tool call started
    const stepStartTimes = new Map<number, number>();

    const agentResult = await withTimeout(runAgentLoop({
      client,
      page,
      scenario,
      screenshotter,
      model,
      runId,
      maxTurns: effectiveOptions.minimal ? 10 : 30,
      a11y: effectiveOptions.a11y,
      persona: persona ? {
        name: persona.name,
        role: persona.role,
        description: persona.description,
        instructions: persona.instructions,
        traits: persona.traits,
        goals: persona.goals,
        behaviors: (persona as import("../types/index.js").Persona).behaviors,
        painPoints: (persona as import("../types/index.js").Persona).painPoints,
      } : null,
      onStep: (stepEvent) => {
        let stepDurationMs: number | undefined;
        if (stepEvent.type === "tool_call") {
          stepStartTimes.set(stepEvent.stepNumber, Date.now());
        } else if (stepEvent.type === "tool_result") {
          const startTime = stepStartTimes.get(stepEvent.stepNumber);
          if (startTime !== undefined) {
            stepDurationMs = Date.now() - startTime;
            stepStartTimes.delete(stepEvent.stepNumber);
          }
        }
        emit({
          type: `step:${stepEvent.type}` as RunEvent["type"],
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          runId,
          toolName: stepEvent.toolName,
          toolInput: stepEvent.toolInput,
          toolResult: stepEvent.toolResult,
          thinking: stepEvent.thinking,
          stepNumber: stepEvent.stepNumber,
          stepDurationMs,
        });
      },
    }), scenarioTimeout, scenario.name);

    // Save screenshots to DB (Lightpanda has no rendering — skip silently)
    if (options.engine !== "lightpanda" && options.engine !== "bun") {
      for (const ss of agentResult.screenshots) {
        try {
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
        } catch {
          // Screenshot save failed — continue without blocking the run
        }
      }
    }

    // Stop network logging and close session tracking
    if (stopNetworkLogging) { try { stopNetworkLogging(); } catch {} }
    closeTrackedSession(result.id);

    const lightpandaNote = options.engine === "lightpanda" ? " (Running with Lightpanda — no screenshots)" : options.engine === "bun" ? " (Running with Bun.WebView — native, ~11x faster)" : "";
    const networkMeta = networkErrors.length > 0 ? { networkErrors: networkErrors.slice(0, 20) } : {};
    let updatedResult = updateResult(result.id, {
      status: agentResult.status,
      reasoning: agentResult.reasoning ? agentResult.reasoning + lightpandaNote : lightpandaNote || undefined,
      stepsCompleted: agentResult.stepsCompleted,
      durationMs: Date.now() - new Date(result.createdAt).getTime(),
      tokensUsed: agentResult.tokensUsed,
      costCents: estimateCost(model, agentResult.tokensUsed),
      metadata: networkErrors.length > 0 ? networkMeta : undefined,
    });

    // Wire failure analysis for non-passing results
    if (agentResult.status === "failed" || agentResult.status === "error") {
      const failureAnalysis = analyzeFailure(null, agentResult.reasoning ?? null);
      if (failureAnalysis) {
        updatedResult = updateResult(result.id, { failureAnalysis });
      }
    }

    // Update the cache when the scenario passes
    if (agentResult.status === "passed") {
      try {
        updateScenarioPassedCache(scenario.id, options.url);
      } catch {
        // Non-critical — don't fail the run if cache update fails
      }
    }

    const eventType = agentResult.status === "passed" ? "scenario:pass" : "scenario:fail";
    emit({ type: eventType, scenarioId: scenario.id, scenarioName: scenario.name, resultId: result.id, runId });

    return updatedResult;
  } catch (error) {
    if (stopNetworkLogging) { try { stopNetworkLogging(); } catch {} }
    closeTrackedSession(result.id);
    const errorMsg = error instanceof Error ? error.message : String(error);
    let updatedResult = updateResult(result.id, {
      status: "error",
      error: errorMsg,
      durationMs: Date.now() - new Date(result.createdAt).getTime(),
    });

    // Wire failure analysis for caught errors
    const failureAnalysis = analyzeFailure(errorMsg, null);
    if (failureAnalysis) {
      updatedResult = updateResult(result.id, { failureAnalysis });
    }

    emit({ type: "scenario:error", scenarioId: scenario.id, scenarioName: scenario.name, error: errorMsg, runId });
    return updatedResult;
  } finally {
    if (browser) await closeBrowser(browser, effectiveOptions.engine);
  }
}

export async function runBatch(
  scenarios: Scenario[],
  options: RunOptions
): Promise<{ run: Run; results: Result[] }> {
  const config = loadConfig();
  const model = resolveModel(options.minimal ? "quick" : (options.model ?? config.defaultModel));
  // Minimal mode: boost parallelism to at least 5 to finish faster
  const parallel = options.minimal ? Math.max(5, options.parallel ?? 1) : (options.parallel ?? 1);
  const samples = options.samples ?? 1;
  const flakinessThreshold = options.flakinessThreshold ?? 0.95;

  // Budget guard: estimate cost and throw if it exceeds the cap
  if (!options.skipBudgetCheck) {
    const cap = options.maxCostCents ?? config.defaultMaxCostCents;
    if (cap !== undefined && cap > 0) {
      const estimated = estimateRunCostCents(scenarios.length, model, samples);
      if (estimated > cap) {
        throw new BudgetExceededError(estimated, cap);
      }
    }
  }

  const run = createRun({
    url: options.url,
    model,
    headed: options.headed,
    parallel,
    projectId: options.projectId,
    samples,
    flakinessThreshold,
  });

  updateRun(run.id, { status: "running", total: scenarios.length });

  // Try topological sort if dependencies exist, fallback to original order
  let sortedScenarios = scenarios;
  try {
    const { topologicalSort } = await import("../db/flows.js");
    const scenarioIds = scenarios.map((s) => s.id);
    const sortedIds = topologicalSort(scenarioIds);
    const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
    sortedScenarios = sortedIds.map((id) => scenarioMap.get(id)).filter((s): s is Scenario => s !== undefined);
    // Add any scenarios not in the sort (no deps)
    for (const s of scenarios) {
      if (!sortedIds.includes(s.id)) sortedScenarios.push(s);
    }
  } catch {
    // flows module not available or no deps — use original order
  }

  const results: Result[] = [];
  const failedScenarioIds = new Set<string>();

  // Check if a scenario's dependencies have all passed
  const canRun = async (scenario: Scenario): Promise<boolean> => {
    try {
      const { getDependencies } = await import("../db/flows.js");
      const deps = getDependencies(scenario.id);
      for (const depId of deps) {
        if (failedScenarioIds.has(depId)) return false;
      }
    } catch {
      // No deps module — run everything
    }
    return true;
  };

  const maxRetries = options.retry ?? 0;

  if (parallel <= 1) {
    // Sequential — respects dependency order
    for (const scenario of sortedScenarios) {
      if (!(await canRun(scenario))) {
        // Skip — dependency failed
        const result = createResult({ runId: run.id, scenarioId: scenario.id, model, stepsTotal: 0 });
        const skipped = updateResult(result.id, { status: "skipped", error: "Skipped: dependency failed" });
        results.push(skipped);
        failedScenarioIds.add(scenario.id);
        emit({ type: "scenario:error", scenarioId: scenario.id, scenarioName: scenario.name, error: "Dependency failed — skipped", runId: run.id });
        continue;
      }

      let result = await runSingleScenario(scenario, run.id, options);
      let attempt = 1;
      while ((result.status === "failed" || result.status === "error") && attempt <= maxRetries) {
        emit({ type: "scenario:start", scenarioId: scenario.id, scenarioName: scenario.name, runId: run.id, retryAttempt: attempt + 1, maxRetries: maxRetries + 1 });
        result = await runSingleScenario(scenario, run.id, options);
        attempt++;
      }

      // Multi-sample flakiness detection
      if (samples > 1) {
        const sampleResults = [result];
        for (let s = 1; s < samples; s++) {
          emit({ type: "scenario:start", scenarioId: scenario.id, scenarioName: scenario.name, runId: run.id });
          const sampleResult = await runSingleScenario(scenario, run.id, options);
          sampleResults.push(sampleResult);
        }
        const passCount = sampleResults.filter((r) => r.status === "passed").length;
        const passRate = passCount / samples;
        if (passCount > 0 && passCount < samples && passRate < flakinessThreshold) {
          // Flaky: passed some but not all samples
          result = updateResult(result.id, {
            status: "flaky",
            reasoning: `Flaky: ${passCount}/${samples} samples passed (${Math.round(passRate * 100)}% pass rate, threshold ${Math.round(flakinessThreshold * 100)}%)`,
            metadata: { samples, passCount, passRate, sampleResultIds: sampleResults.map((r) => r.id) },
          });
        } else if (passCount === 0) {
          // All failed — keep as failed but add sample info
          result = updateResult(result.id, {
            metadata: { samples, passCount, passRate, sampleResultIds: sampleResults.map((r) => r.id) },
          });
        } else if (passCount === samples) {
          // All passed — keep as passed but add sample info
          result = updateResult(result.id, {
            metadata: { samples, passCount, passRate, sampleResultIds: sampleResults.map((r) => r.id) },
          });
        }
      }

      results.push(result);
      if (result.status === "failed" || result.status === "error" || result.status === "flaky") {
        failedScenarioIds.add(scenario.id);
      }
    }
  } else {
    // Parallel with concurrency limit (no dependency ordering in parallel mode)
    const queue = [...sortedScenarios];
    const running: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      const scenario = queue.shift();
      if (!scenario) return;

      if (!(await canRun(scenario))) {
        const result = createResult({ runId: run.id, scenarioId: scenario.id, model, stepsTotal: 0 });
        const skipped = updateResult(result.id, { status: "skipped", error: "Skipped: dependency failed" });
        results.push(skipped);
        failedScenarioIds.add(scenario.id);
        await processNext();
        return;
      }

      const result = await runSingleScenario(scenario, run.id, options);
      results.push(result);
      if (result.status === "failed" || result.status === "error") {
        failedScenarioIds.add(scenario.id);
      }
      await processNext();
    };

    const workers = Math.min(parallel, sortedScenarios.length);
    for (let i = 0; i < workers; i++) {
      running.push(processNext());
    }
    await Promise.all(running);
  }

  // Persona divergence testing: if personaIds has multiple entries, run each scenario
  // under each additional persona and collect divergence results.
  let divergenceResults: Result[] = [];
  if (options.personaIds && options.personaIds.length > 1) {
    const additionalPersonaIds = options.personaIds.slice(1);
    for (const personaId of additionalPersonaIds) {
      for (const scenario of sortedScenarios) {
        const personaResult = await runSingleScenario(scenario, run.id, { ...options, personaId });
        divergenceResults.push(personaResult);
        results.push(personaResult);
      }
    }
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

  // Dispatch webhooks (fire and forget)
  const eventType = finalRun.status === "failed" ? "failed" : "completed";
  dispatchWebhooks(eventType, finalRun).catch(() => {});

  // Push failures to open-logs / todos / conversations (fire and forget)
  if (finalRun.status === "failed") {
    const failedResults = results.filter(r => r.status === "failed" || r.status === "error");
    pushFailedRunToLogs(finalRun, failedResults, scenarios).catch(() => {});
    createFailureTasks(finalRun, failedResults, scenarios).catch(() => {});
    notifyFailureToConversations(finalRun, failedResults, scenarios).catch(() => {});
  }

  // Notify conversations on all run completions (pass or fail) if space is configured
  const conversationsSpaceId = (config as unknown as { conversationsSpace?: string }).conversationsSpace
    ?? process.env["TESTERS_CONVERSATIONS_SPACE"];
  if (conversationsSpaceId) {
    notifyRunToConversations(finalRun, results, { spaceId: conversationsSpaceId }).catch(() => {});
  }

  return { run: finalRun, results };
}

export async function runByFilter(
  options: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] }
): Promise<{ run: Run; results: Result[] }> {
  let scenarios: Scenario[];

  if (options.scenarioIds && options.scenarioIds.length > 0) {
    // When explicit scenario IDs are provided, search within project first, then globally
    const all = listScenarios({ projectId: options.projectId });
    scenarios = all.filter((s) => options.scenarioIds!.includes(s.id) || options.scenarioIds!.includes(s.shortId));
    // Fallback: if not found in project scope, search globally
    if (scenarios.length === 0 && options.projectId) {
      const global = listScenarios({});
      scenarios = global.filter((s) => options.scenarioIds!.includes(s.id) || options.scenarioIds!.includes(s.shortId));
    }
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

  // Budget guard: check before creating the run record
  if (!options.skipBudgetCheck) {
    const cap = options.maxCostCents ?? config.defaultMaxCostCents;
    if (cap !== undefined && cap > 0 && scenarios.length > 0) {
      const samples = options.samples ?? 1;
      const estimated = estimateRunCostCents(scenarios.length, model, samples);
      if (estimated > cap) {
        throw new BudgetExceededError(estimated, cap);
      }
    }
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
      const asyncRun = getRun(run.id);
      if (asyncRun) dispatchWebhooks(asyncRun.status === "failed" ? "failed" : "completed", asyncRun).catch(() => {});
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      updateRun(run.id, {
        status: "failed",
        finished_at: new Date().toISOString(),
      });
      emit({ type: "run:complete", runId: run.id, error: errorMsg });
      const failedRun = getRun(run.id);
      if (failedRun) dispatchWebhooks("failed", failedRun).catch(() => {});
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
