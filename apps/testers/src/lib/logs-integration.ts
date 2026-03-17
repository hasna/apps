import type { Run, Result, Scenario } from "../types/index.js";

/**
 * Push failed test results to open-logs if LOGS_URL env var is set.
 * No-op when LOGS_URL is not configured.
 */
export async function pushFailedRunToLogs(
  run: Run,
  failedResults: Result[],
  scenarios: Scenario[],
): Promise<void> {
  const logsUrl = process.env.LOGS_URL;
  if (!logsUrl) return;

  const scenarioMap = new Map(scenarios.map(s => [s.id, s]));

  const entries = failedResults.map(result => {
    const scenario = scenarioMap.get(result.scenarioId);
    return {
      level: "error",
      source: "sdk",
      service: "testers",
      message: `[testers] Scenario failed: ${scenario?.name ?? result.scenarioId}${result.error ? ` — ${result.error}` : ""}`,
      metadata: {
        run_id: run.id,
        scenario_id: result.scenarioId,
        scenario_name: scenario?.name,
        url: run.url,
        status: result.status,
        duration_ms: result.durationMs,
      },
    };
  });

  try {
    await fetch(`${logsUrl.replace(/\/$/, "")}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
  } catch {
    // Never throw — logs integration is optional
  }
}
