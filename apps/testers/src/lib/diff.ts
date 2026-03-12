import chalk from "chalk";
import { getRun } from "../db/runs.js";
import { getResultsByRun } from "../db/results.js";
import { getScenario } from "../db/scenarios.js";
import type { Run, Result } from "../types/index.js";

export interface DiffResult {
  run1: Run;
  run2: Run;
  regressions: ScenarioDiff[];
  fixes: ScenarioDiff[];
  unchanged: ScenarioDiff[];
  newScenarios: ScenarioDiff[];
  removedScenarios: ScenarioDiff[];
}

export interface ScenarioDiff {
  scenarioId: string;
  scenarioName: string | null;
  scenarioShortId: string | null;
  status1: string | null;
  status2: string | null;
  duration1: number | null;
  duration2: number | null;
  tokens1: number | null;
  tokens2: number | null;
}

export function diffRuns(runId1: string, runId2: string): DiffResult {
  const run1 = getRun(runId1);
  if (!run1) {
    throw new Error(`Run not found: ${runId1}`);
  }

  const run2 = getRun(runId2);
  if (!run2) {
    throw new Error(`Run not found: ${runId2}`);
  }

  const results1 = getResultsByRun(run1.id);
  const results2 = getResultsByRun(run2.id);

  const map1 = new Map<string, Result>();
  for (const r of results1) {
    map1.set(r.scenarioId, r);
  }

  const map2 = new Map<string, Result>();
  for (const r of results2) {
    map2.set(r.scenarioId, r);
  }

  const allScenarioIds = new Set([...map1.keys(), ...map2.keys()]);

  const regressions: ScenarioDiff[] = [];
  const fixes: ScenarioDiff[] = [];
  const unchanged: ScenarioDiff[] = [];
  const newScenarios: ScenarioDiff[] = [];
  const removedScenarios: ScenarioDiff[] = [];

  for (const scenarioId of allScenarioIds) {
    const r1 = map1.get(scenarioId) ?? null;
    const r2 = map2.get(scenarioId) ?? null;

    const scenario = getScenario(scenarioId);

    const diff: ScenarioDiff = {
      scenarioId,
      scenarioName: scenario?.name ?? null,
      scenarioShortId: scenario?.shortId ?? null,
      status1: r1?.status ?? null,
      status2: r2?.status ?? null,
      duration1: r1?.durationMs ?? null,
      duration2: r2?.durationMs ?? null,
      tokens1: r1?.tokensUsed ?? null,
      tokens2: r2?.tokensUsed ?? null,
    };

    if (!r1 && r2) {
      newScenarios.push(diff);
    } else if (r1 && !r2) {
      removedScenarios.push(diff);
    } else if (r1 && r2) {
      const wasPass = r1.status === "passed";
      const nowPass = r2.status === "passed";
      const wasFail = r1.status === "failed" || r1.status === "error";
      const nowFail = r2.status === "failed" || r2.status === "error";

      if (wasPass && nowFail) {
        regressions.push(diff);
      } else if (wasFail && nowPass) {
        fixes.push(diff);
      } else {
        unchanged.push(diff);
      }
    }
  }

  return { run1, run2, regressions, fixes, unchanged, newScenarios, removedScenarios };
}

function formatScenarioLabel(diff: ScenarioDiff): string {
  if (diff.scenarioShortId && diff.scenarioName) {
    return `${diff.scenarioShortId}: ${diff.scenarioName}`;
  }
  if (diff.scenarioName) {
    return diff.scenarioName;
  }
  return diff.scenarioId.slice(0, 8);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDurationComparison(d1: number | null, d2: number | null): string {
  const s1 = formatDuration(d1);
  const s2 = formatDuration(d2);
  if (d1 !== null && d2 !== null) {
    const delta = d2 - d1;
    const sign = delta > 0 ? "+" : "";
    return `${s1} -> ${s2} (${sign}${formatDuration(delta)})`;
  }
  return `${s1} -> ${s2}`;
}

export function formatDiffTerminal(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("  Run Comparison"));
  lines.push(`  Run 1: ${chalk.dim(diff.run1.id.slice(0, 8))} (${diff.run1.status}) — ${diff.run1.startedAt}`);
  lines.push(`  Run 2: ${chalk.dim(diff.run2.id.slice(0, 8))} (${diff.run2.status}) — ${diff.run2.startedAt}`);
  lines.push("");

  if (diff.regressions.length > 0) {
    lines.push(chalk.red.bold(`  Regressions (${diff.regressions.length}):`));
    for (const d of diff.regressions) {
      const label = formatScenarioLabel(d);
      const dur = formatDurationComparison(d.duration1, d.duration2);
      lines.push(chalk.red(`    \u2B07 ${label}  ${d.status1} -> ${d.status2}  ${chalk.dim(dur)}`));
    }
    lines.push("");
  }

  if (diff.fixes.length > 0) {
    lines.push(chalk.green.bold(`  Fixes (${diff.fixes.length}):`));
    for (const d of diff.fixes) {
      const label = formatScenarioLabel(d);
      const dur = formatDurationComparison(d.duration1, d.duration2);
      lines.push(chalk.green(`    \u2B06 ${label}  ${d.status1} -> ${d.status2}  ${chalk.dim(dur)}`));
    }
    lines.push("");
  }

  if (diff.unchanged.length > 0) {
    lines.push(chalk.dim(`  Unchanged (${diff.unchanged.length}):`));
    for (const d of diff.unchanged) {
      const label = formatScenarioLabel(d);
      const dur = formatDurationComparison(d.duration1, d.duration2);
      lines.push(chalk.dim(`    = ${label}  ${d.status2}  ${dur}`));
    }
    lines.push("");
  }

  if (diff.newScenarios.length > 0) {
    lines.push(chalk.cyan(`  New in run 2 (${diff.newScenarios.length}):`));
    for (const d of diff.newScenarios) {
      const label = formatScenarioLabel(d);
      lines.push(chalk.cyan(`    + ${label}  ${d.status2}`));
    }
    lines.push("");
  }

  if (diff.removedScenarios.length > 0) {
    lines.push(chalk.yellow(`  Removed from run 2 (${diff.removedScenarios.length}):`));
    for (const d of diff.removedScenarios) {
      const label = formatScenarioLabel(d);
      lines.push(chalk.yellow(`    - ${label}  was ${d.status1}`));
    }
    lines.push("");
  }

  lines.push(
    chalk.bold(
      `  Summary: ${diff.regressions.length} regressions, ${diff.fixes.length} fixes, ${diff.unchanged.length} unchanged`
    )
  );
  lines.push("");

  return lines.join("\n");
}

export function formatDiffJSON(diff: DiffResult): string {
  return JSON.stringify(diff, null, 2);
}
