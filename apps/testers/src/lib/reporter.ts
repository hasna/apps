import chalk from "chalk";
import type { Run, Result, Screenshot } from "../types/index.js";
import { listScreenshots } from "../db/screenshots.js";
import { getScenario } from "../db/scenarios.js";

export interface ReportOptions {
  json?: boolean;
  verbose?: boolean;
}

export function formatTerminal(run: Run, results: Result[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`  Run ${run.id.slice(0, 8)} — ${run.url}`));
  lines.push(chalk.dim(`  Model: ${run.model} | Parallel: ${run.parallel} | Headed: ${run.headed ? "yes" : "no"}`));
  lines.push("");

  for (const result of results) {
    const scenario = getScenario(result.scenarioId);
    const name = scenario ? `${scenario.shortId}: ${scenario.name}` : result.scenarioId.slice(0, 8);
    const screenshots = listScreenshots(result.id);
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    const screenshotCount = screenshots.length;

    let statusIcon: string;
    let statusColor: typeof chalk;
    switch (result.status) {
      case "passed":
        statusIcon = chalk.green("PASS");
        statusColor = chalk.green;
        break;
      case "failed":
        statusIcon = chalk.red("FAIL");
        statusColor = chalk.red;
        break;
      case "error":
        statusIcon = chalk.yellow("ERR ");
        statusColor = chalk.yellow;
        break;
      default:
        statusIcon = chalk.dim("SKIP");
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
  lines.push(formatSummary(run));
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

export function formatScenarioList(scenarios: Array<{ shortId: string; name: string; priority: string; tags: string[] }>): string {
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
    lines.push(`  ${chalk.cyan(s.shortId)}  ${s.name}  ${priorityColor(s.priority)}${tags}`);
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
