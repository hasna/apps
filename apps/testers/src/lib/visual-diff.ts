import { readFileSync, existsSync } from "fs";
import chalk from "chalk";
import { listScreenshots } from "../db/screenshots.js";
import { getResultsByRun } from "../db/results.js";
import { getRun, updateRun } from "../db/runs.js";
import { getScenario } from "../db/scenarios.js";
import { getDatabase } from "../db/database.js";
import type { Run } from "../types/index.js";

export interface VisualDiffResult {
  scenarioId: string;
  stepNumber: number;
  action: string;
  baselinePath: string;
  currentPath: string;
  diffPercent: number;
  isRegression: boolean;
}

const DEFAULT_THRESHOLD = 0.1; // 0.1% pixel difference

/**
 * Mark a run as the visual baseline. Unsets any previous baseline for the same project.
 */
export function setBaseline(runId: string): void {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const db = getDatabase();

  // Unset previous baselines for the same project (or all if no project)
  if (run.projectId) {
    db.query("UPDATE runs SET is_baseline = 0 WHERE project_id = ? AND is_baseline = 1").run(run.projectId);
  } else {
    db.query("UPDATE runs SET is_baseline = 0 WHERE project_id IS NULL AND is_baseline = 1").run();
  }

  // Set this run as baseline
  updateRun(run.id, { is_baseline: 1 });
}

/**
 * Get the most recent baseline run, optionally filtered by project.
 */
export function getBaseline(projectId?: string): Run | null {
  const db = getDatabase();
  let row;
  if (projectId) {
    row = db.query("SELECT * FROM runs WHERE is_baseline = 1 AND project_id = ? ORDER BY started_at DESC LIMIT 1").get(projectId);
  } else {
    row = db.query("SELECT * FROM runs WHERE is_baseline = 1 ORDER BY started_at DESC LIMIT 1").get();
  }

  if (!row) return null;

  // Use getRun to go through the standard row converter
  const runRow = row as { id: string };
  return getRun(runRow.id);
}

/**
 * Compare two image files at the byte level.
 * Since we cannot use sharp/canvas, we do a raw buffer comparison.
 */
export function compareImages(
  image1Path: string,
  image2Path: string,
): { diffPercent: number; diffPixels: number; totalPixels: number } {
  if (!existsSync(image1Path)) {
    throw new Error(`Baseline image not found: ${image1Path}`);
  }
  if (!existsSync(image2Path)) {
    throw new Error(`Current image not found: ${image2Path}`);
  }

  const buf1 = readFileSync(image1Path);
  const buf2 = readFileSync(image2Path);

  // If buffers are identical, 0% diff
  if (buf1.equals(buf2)) {
    // Estimate total pixels from PNG buffer size (rough: size / 4 bytes per pixel)
    const estimatedPixels = Math.max(1, Math.floor(buf1.length / 4));
    return { diffPercent: 0, diffPixels: 0, totalPixels: estimatedPixels };
  }

  // If different lengths, 100% diff
  if (buf1.length !== buf2.length) {
    const maxLen = Math.max(buf1.length, buf2.length);
    const estimatedPixels = Math.max(1, Math.floor(maxLen / 4));
    return { diffPercent: 100, diffPixels: estimatedPixels, totalPixels: estimatedPixels };
  }

  // Compare byte by byte, count differing bytes
  let diffBytes = 0;
  for (let i = 0; i < buf1.length; i++) {
    if (buf1[i] !== buf2[i]) {
      diffBytes++;
    }
  }

  const totalPixels = Math.max(1, Math.floor(buf1.length / 4));
  // Each pixel is ~4 bytes (RGBA in raw, but PNG is compressed — still use byte diff ratio)
  const diffPixels = Math.max(1, Math.floor(diffBytes / 4));
  const diffPercent = parseFloat(((diffBytes / buf1.length) * 100).toFixed(4));

  return { diffPercent, diffPixels, totalPixels };
}

/**
 * Compare screenshots from two runs, matching by scenario + step number.
 */
export function compareRunScreenshots(
  runId: string,
  baselineRunId: string,
  threshold: number = DEFAULT_THRESHOLD,
): VisualDiffResult[] {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const baselineRun = getRun(baselineRunId);
  if (!baselineRun) throw new Error(`Baseline run not found: ${baselineRunId}`);

  const currentResults = getResultsByRun(run.id);
  const baselineResults = getResultsByRun(baselineRun.id);

  // Build a map of baseline screenshots keyed by "scenarioId:stepNumber"
  const baselineMap = new Map<string, { path: string; action: string }>();
  for (const result of baselineResults) {
    const screenshots = listScreenshots(result.id);
    for (const ss of screenshots) {
      const key = `${result.scenarioId}:${ss.stepNumber}`;
      baselineMap.set(key, { path: ss.filePath, action: ss.action });
    }
  }

  const results: VisualDiffResult[] = [];

  for (const result of currentResults) {
    const screenshots = listScreenshots(result.id);
    for (const ss of screenshots) {
      const key = `${result.scenarioId}:${ss.stepNumber}`;
      const baseline = baselineMap.get(key);
      if (!baseline) continue; // No baseline screenshot to compare against

      if (!existsSync(baseline.path) || !existsSync(ss.filePath)) continue;

      try {
        const comparison = compareImages(baseline.path, ss.filePath);
        results.push({
          scenarioId: result.scenarioId,
          stepNumber: ss.stepNumber,
          action: ss.action,
          baselinePath: baseline.path,
          currentPath: ss.filePath,
          diffPercent: comparison.diffPercent,
          isRegression: comparison.diffPercent > threshold,
        });
      } catch {
        // Skip screenshots that can't be compared
      }
    }
  }

  return results;
}

/**
 * Format visual diff results for terminal output with colored diff percentages.
 */
export function formatVisualDiffTerminal(
  results: VisualDiffResult[],
  threshold: number = DEFAULT_THRESHOLD,
): string {
  if (results.length === 0) {
    return chalk.dim("\n  No screenshot comparisons found.\n");
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("  Visual Regression Summary"));
  lines.push("");

  const regressions = results.filter((r) => r.diffPercent >= threshold);
  const passed = results.filter((r) => r.diffPercent < threshold);

  if (regressions.length > 0) {
    lines.push(chalk.red.bold(`  Regressions (${regressions.length}):`));
    for (const r of regressions) {
      const scenario = getScenario(r.scenarioId);
      const label = scenario ? `${scenario.shortId}: ${scenario.name}` : r.scenarioId.slice(0, 8);
      const pct = chalk.red(`${r.diffPercent.toFixed(2)}%`);
      lines.push(`    ${chalk.red("!")} ${label} step ${r.stepNumber} (${r.action}) — ${pct} diff`);
    }
    lines.push("");
  }

  if (passed.length > 0) {
    lines.push(chalk.green.bold(`  Passed (${passed.length}):`));
    for (const r of passed) {
      const scenario = getScenario(r.scenarioId);
      const label = scenario ? `${scenario.shortId}: ${scenario.name}` : r.scenarioId.slice(0, 8);
      const pct = chalk.green(`${r.diffPercent.toFixed(2)}%`);
      lines.push(`    ${chalk.green("✓")} ${label} step ${r.stepNumber} (${r.action}) — ${pct} diff`);
    }
    lines.push("");
  }

  lines.push(
    chalk.bold(
      `  Visual Summary: ${regressions.length} regressions, ${passed.length} passed (threshold: ${threshold}%)`,
    ),
  );
  lines.push("");

  return lines.join("\n");
}
