import chalk from "chalk";
import type { Run, Result, Screenshot } from "../types/index.js";
import { listScreenshots } from "../db/screenshots.js";
import { getScenario } from "../db/scenarios.js";
import { getDatabase } from "../db/database.js";

// ─── Color/emoji helpers ─────────────────────────────────────────────────────

function useEmoji(): boolean {
  return !process.env["NO_COLOR"] && process.argv.indexOf("--no-color") === -1;
}

export interface ReportOptions {
  json?: boolean;
  verbose?: boolean;
  failedOnly?: boolean;
}

export function formatTerminal(run: Run, results: Result[], options?: ReportOptions): string {
  const lines: string[] = [];
  const failedOnly = options?.failedOnly ?? false;

  lines.push("");
  lines.push(chalk.bold(`  Run ${run.id.slice(0, 8)} — ${run.url}`));
  lines.push(chalk.dim(`  Model: ${run.model} | Parallel: ${run.parallel} | Headed: ${run.headed ? "yes" : "no"}`));
  lines.push("");

  // When --failed-only, print a summary line for passed scenarios
  if (failedOnly) {
    const passedCount = results.filter((r) => r.status === "passed").length;
    if (passedCount > 0) {
      lines.push(chalk.dim(`  (${passedCount} passed scenario${passedCount !== 1 ? "s" : ""} hidden — use without --failed-only to see all)`));
      lines.push("");
    }
  }

  for (const result of results) {
    // Skip passed/skipped results when --failed-only is set
    if (failedOnly && result.status !== "failed" && result.status !== "error") {
      continue;
    }

    const scenario = getScenario(result.scenarioId);
    const name = scenario ? `${scenario.shortId}: ${scenario.name}` : result.scenarioId.slice(0, 8);
    const screenshots = listScreenshots(result.id);
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    const screenshotCount = screenshots.length;

    let statusIcon: string;
    let statusColor: typeof chalk;
    const emoji = useEmoji();
    switch (result.status) {
      case "passed":
        statusIcon = emoji ? "✅" : chalk.green("PASS");
        statusColor = chalk.green;
        break;
      case "failed":
        statusIcon = emoji ? "❌" : chalk.red("FAIL");
        statusColor = chalk.red;
        break;
      case "error":
        statusIcon = emoji ? "⚠️ " : chalk.yellow("ERR ");
        statusColor = chalk.yellow;
        break;
      default:
        statusIcon = emoji ? "⏭️ " : chalk.dim("SKIP");
        statusColor = chalk.dim;
        break;
    }

    lines.push(`  ${statusIcon}  ${statusColor(name)}  ${chalk.dim(duration)}  ${chalk.dim(`${screenshotCount} screenshots`)}`);

    if (result.reasoning && (result.status === "failed" || result.status === "error")) {
      lines.push(chalk.dim(`         ${result.reasoning}`));
    }
    if (result.error) {
      lines.push(chalk.red(`         ${result.error}`));
    }
  }

  lines.push("");
  lines.push(formatActionableSummary(run, results));
  lines.push("");

  return lines.join("\n");
}

export function formatSummary(run: Run): string {
  const duration = run.finishedAt
    ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
    : "running";

  const passedStr = chalk.green(`${run.passed} passed`);
  const failedStr = run.failed > 0 ? chalk.red(` ${run.failed} failed`) : "";
  const totalStr = chalk.dim(` (${run.total} total)`);

  return `  ${passedStr}${failedStr}${totalStr} in ${duration}`;
}

export function formatActionableSummary(run: Run, results: Result[]): string {
  const emoji = useEmoji();
  const passedCount = results.filter((r) => r.status === "passed").length;
  const failedCount = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const shortId = run.id.slice(0, 8);

  const passStr = `${emoji ? "✅" : "PASS"} ${passedCount} passed`;
  const failStr = failedCount > 0 ? `  ${emoji ? "❌" : "FAIL"} ${failedCount} failed` : "";

  const lines: string[] = [];
  lines.push(`  ${chalk.bold(passStr)}${failedCount > 0 ? chalk.bold(failStr) : ""}`);

  if (failedCount > 0) {
    lines.push(chalk.dim(`  retry failed: testers retry ${shortId}  |  view: testers results ${shortId}`));
  } else {
    lines.push(chalk.dim(`  view: testers results ${shortId}`));
  }

  // Cost line
  const totalCostCents = results.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
  const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
  if (totalTokens > 0) {
    const costStr = `$${(totalCostCents / 100).toFixed(4)}`;
    const tokensStr = totalTokens.toLocaleString();
    lines.push(chalk.dim(`  ${emoji ? "💰" : "cost:"} Cost: ${costStr} (${tokensStr} tokens)`));
  }

  return lines.join("\n");
}

export function formatJSON(run: Run, results: Result[]): string {
  const output = {
    run: {
      id: run.id,
      url: run.url,
      status: run.status,
      model: run.model,
      headed: run.headed,
      parallel: run.parallel,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    results: results.map((r) => {
      const scenario = getScenario(r.scenarioId);
      const screenshots = listScreenshots(r.id);
      return {
        id: r.id,
        scenarioId: r.scenarioId,
        scenarioName: scenario?.name ?? null,
        scenarioShortId: scenario?.shortId ?? null,
        status: r.status,
        reasoning: r.reasoning,
        error: r.error,
        stepsCompleted: r.stepsCompleted,
        stepsTotal: r.stepsTotal,
        durationMs: r.durationMs,
        model: r.model,
        tokensUsed: r.tokensUsed,
        costCents: r.costCents,
        screenshots: screenshots.map((s) => ({
          stepNumber: s.stepNumber,
          action: s.action,
          filePath: s.filePath,
        })),
      };
    }),
    summary: {
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      totalTokens: results.reduce((sum, r) => sum + r.tokensUsed, 0),
      totalCostCents: results.reduce((sum, r) => sum + r.costCents, 0),
      durationMs: run.finishedAt
        ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
        : null,
    },
  };

  return JSON.stringify(output, null, 2);
}

export function getExitCode(run: Run): number {
  if (run.status === "passed") return 0;
  if (run.status === "failed") return 1;
  return 2; // error or cancelled
}

export function formatRunList(runs: Run[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("  Recent Runs"));
  lines.push("");

  if (runs.length === 0) {
    lines.push(chalk.dim("  No runs found."));
    lines.push("");
    return lines.join("\n");
  }

  for (const run of runs) {
    const statusIcon = run.status === "passed"
      ? chalk.green("PASS")
      : run.status === "failed"
        ? chalk.red("FAIL")
        : run.status === "running"
          ? chalk.blue("RUN ")
          : chalk.dim(run.status.toUpperCase().padEnd(4));

    const date = new Date(run.startedAt).toLocaleString();
    const id = run.id.slice(0, 8);

    lines.push(`  ${statusIcon}  ${chalk.dim(id)}  ${run.url}  ${chalk.dim(`${run.passed}/${run.total}`)}  ${chalk.dim(date)}`);
  }

  lines.push("");
  return lines.join("\n");
}

export interface ScenarioRunStats {
  lastStatus: "passed" | "failed" | "error" | "skipped" | null;
  passRate: string; // e.g. "8/10"
}

export function getScenarioRunStats(scenarioId: string): ScenarioRunStats {
  const db = getDatabase();

  // Get last result for this scenario
  const lastRow = db.query(
    "SELECT status FROM results WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(scenarioId) as { status: string } | null;

  // Get all-time pass/total count
  const statsRow = db.query(
    "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed FROM results WHERE scenario_id = ?"
  ).get(scenarioId) as { total: number; passed: number } | null;

  return {
    lastStatus: lastRow ? (lastRow.status as ScenarioRunStats["lastStatus"]) : null,
    passRate: statsRow && statsRow.total > 0 ? `${statsRow.passed}/${statsRow.total}` : "—",
  };
}

export function formatScenarioList(scenarios: Array<{ id?: string; shortId: string; name: string; priority: string; tags: string[] }>): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("  Scenarios"));
  lines.push("");

  if (scenarios.length === 0) {
    lines.push(chalk.dim("  No scenarios found. Use 'testers add' to create one."));
    lines.push("");
    return lines.join("\n");
  }

  for (const s of scenarios) {
    const priorityColor = s.priority === "critical"
      ? chalk.red
      : s.priority === "high"
        ? chalk.yellow
        : s.priority === "medium"
          ? chalk.blue
          : chalk.dim;

    const tags = s.tags.length > 0 ? chalk.dim(` [${s.tags.join(", ")}]`) : "";

    // Run stats (last status + pass rate)
    let lastStatusIcon = chalk.dim("—");
    let passRateStr = chalk.dim("—");
    if (s.id) {
      const stats = getScenarioRunStats(s.id);
      if (stats.lastStatus === "passed") lastStatusIcon = chalk.green("✓");
      else if (stats.lastStatus === "failed") lastStatusIcon = chalk.red("✗");
      else if (stats.lastStatus === "error") lastStatusIcon = chalk.yellow("!");
      else if (stats.lastStatus === "skipped") lastStatusIcon = chalk.dim("~");
      passRateStr = stats.passRate === "—" ? chalk.dim("—") : chalk.dim(stats.passRate);
    }

    lines.push(`  ${chalk.cyan(s.shortId)}  ${s.name}  ${priorityColor(s.priority)}${tags}  ${lastStatusIcon} ${passRateStr}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function formatResultDetail(result: Result, screenshots: Screenshot[]): string {
  const lines: string[] = [];
  const scenario = getScenario(result.scenarioId);

  lines.push("");
  lines.push(chalk.bold(`  Result ${result.id.slice(0, 8)}`));
  if (scenario) {
    lines.push(`  Scenario: ${scenario.shortId} — ${scenario.name}`);
  }
  lines.push(`  Status: ${result.status === "passed" ? chalk.green("PASSED") : chalk.red(result.status.toUpperCase())}`);
  lines.push(`  Model: ${result.model}`);
  lines.push(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push(`  Steps: ${result.stepsCompleted}/${result.stepsTotal}`);
  lines.push(`  Tokens: ${result.tokensUsed} (~$${(result.costCents / 100).toFixed(4)})`);

  if (result.reasoning) {
    lines.push("");
    lines.push(chalk.bold("  Reasoning:"));
    lines.push(`  ${result.reasoning}`);
  }

  if (result.error) {
    lines.push("");
    lines.push(chalk.red.bold("  Error:"));
    lines.push(chalk.red(`  ${result.error}`));
  }

  if (screenshots.length > 0) {
    lines.push("");
    lines.push(chalk.bold(`  Screenshots (${screenshots.length}):`));
    for (const ss of screenshots) {
      lines.push(`  ${chalk.dim(`${String(ss.stepNumber).padStart(3, "0")}`)} ${ss.action} — ${chalk.dim(ss.filePath)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
