/**
 * Army runner — dispatch scenarios across multiple concurrent worker processes.
 *
 * Each worker is a separate Bun sub-process running a slice of the scenario list.
 * Results land in the shared SQLite DB (WAL mode supports concurrent writers).
 * The parent process polls until all workers complete, then returns aggregated stats.
 *
 * Usage:
 *   const { runId, workerCount } = await runWithArmy({ url, scenarioIds, workers: 5, ... });
 *   // Poll getRun(runId) to check progress
 */

import { join } from "node:path";
import { createRun, getRun, updateRun } from "../db/runs.js";
import { listScenarios } from "../db/scenarios.js";
import { getResultsByRun } from "../db/results.js";
import { resolveModel } from "./ai-client.js";
import { loadConfig } from "./config.js";
import type { Run } from "../types/index.js";

export interface ArmyRunOptions {
  url: string;
  workers?: number;           // number of worker processes (default: 4)
  scenarioIds?: string[];
  tags?: string[];
  projectId?: string;
  model?: string;
  parallel?: number;          // parallel browsers per worker (default: 2)
  timeout?: number;
  apiKey?: string;
  personaId?: string;
}

export interface ArmyRunResult {
  runId: string;
  workerCount: number;
  scenarioCount: number;
  status: "dispatched";
  message: string;
}

/**
 * Splits an array into N roughly equal chunks.
 */
function chunkArray<T>(arr: T[], n: number): T[][] {
  const chunks: T[][] = [];
  const size = Math.ceil(arr.length / n);
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Resolve the path to the testers CLI binary.
 */
function getCliPath(): string {
  // In development: run source directly
  const srcPath = join(import.meta.dir, "../cli/index.tsx");
  return srcPath;
}

/**
 * Dispatch scenarios to multiple worker processes. Returns immediately after
 * all workers are spawned — poll the run record to check progress.
 */
export async function runWithArmy(options: ArmyRunOptions): Promise<ArmyRunResult> {
  const config = loadConfig();
  const model = resolveModel(options.model ?? config.defaultModel);
  const workers = Math.max(1, options.workers ?? 4);

  // Resolve scenarios
  let scenarios;
  if (options.scenarioIds && options.scenarioIds.length > 0) {
    const all = listScenarios({ projectId: options.projectId });
    scenarios = all.filter((s) => options.scenarioIds!.includes(s.id) || options.scenarioIds!.includes(s.shortId));
  } else {
    scenarios = listScenarios({ projectId: options.projectId, tags: options.tags });
  }

  if (scenarios.length === 0) {
    const run = createRun({ url: options.url, model, projectId: options.projectId });
    updateRun(run.id, { status: "passed", total: 0, finished_at: new Date().toISOString() });
    return { runId: run.id, workerCount: 0, scenarioCount: 0, status: "dispatched", message: "No scenarios found" };
  }

  // Create a shared run record that all workers will populate
  const run = createRun({
    url: options.url,
    model,
    parallel: workers * (options.parallel ?? 2),
    projectId: options.projectId,
  });
  updateRun(run.id, { status: "running", total: scenarios.length });

  // Split scenarios across workers
  const actualWorkers = Math.min(workers, scenarios.length);
  const chunks = chunkArray(scenarios.map((s) => s.id), actualWorkers);
  const cliPath = getCliPath();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TESTERS_ARMY_RUN_ID: run.id,
    TESTERS_ARMY_WORKER: "1",
  };
  if (options.apiKey) env["ANTHROPIC_API_KEY"] = options.apiKey;

  // Spawn one worker process per chunk
  const workerPromises = chunks.map((chunkIds) => {
    const args = [
      "bun", "run", cliPath,
      "run",
      "--url", options.url,
      "--model", model,
      "--parallel", String(options.parallel ?? 2),
      "--run-id", run.id,
      "--scenario-ids", chunkIds.join(","),
    ];

    if (options.timeout) args.push("--timeout", String(options.timeout));
    if (options.personaId) args.push("--persona", options.personaId);

    const proc = Bun.spawn(args, {
      env,
      stdout: "ignore",
      stderr: "ignore",
    });

    return proc.exited;
  });

  // Monitor in background — update run status when all workers finish
  Promise.all(workerPromises).then(async () => {
    const results = getResultsByRun(run.id);
    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status !== "passed" && r.status !== "skipped").length;
    updateRun(run.id, {
      status: failed > 0 ? "failed" : "passed",
      passed,
      failed,
      total: scenarios.length,
      finished_at: new Date().toISOString(),
    });
  }).catch(() => {
    updateRun(run.id, { status: "failed", finished_at: new Date().toISOString() });
  });

  return {
    runId: run.id,
    workerCount: actualWorkers,
    scenarioCount: scenarios.length,
    status: "dispatched",
    message: `Dispatched ${scenarios.length} scenarios across ${actualWorkers} worker processes. Poll get_run/${run.id} for status.`,
  };
}

/**
 * Wait for an army run to complete. Polls every 3s up to timeoutMs.
 */
export async function waitForArmyRun(runId: string, timeoutMs = 600_000): Promise<Run> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (["passed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Army run ${runId} timed out after ${timeoutMs}ms`);
}
