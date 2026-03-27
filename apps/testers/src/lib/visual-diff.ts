import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
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

export interface CompareImagesResult {
  diffPercent: number;
  diffPixels: number;
  totalPixels: number;
  diffImagePath?: string;
}

/**
 * Compare two image files using @hasna/browser's pixel-level diff engine (sharp-based).
 * Falls back to byte comparison if sharp is unavailable.
 * Optionally saves a diff image highlighting changed pixels.
 */
export async function compareImages(
  image1Path: string,
  image2Path: string,
  options?: { saveDiff?: boolean; diffDir?: string },
): Promise<CompareImagesResult> {
  if (!existsSync(image1Path)) throw new Error(`Baseline image not found: ${image1Path}`);
  if (!existsSync(image2Path)) throw new Error(`Current image not found: ${image2Path}`);

  try {
    // Use sharp for accurate pixel-level diff (available via @hasna/browser dep)
    const sharp = await import("sharp");
    const img1 = sharp.default(image1Path);
    const img2 = sharp.default(image2Path);
    const [meta1, meta2] = await Promise.all([img1.metadata(), img2.metadata()]);
    const w = Math.min(meta1.width ?? 1280, meta2.width ?? 1280);
    const h = Math.min(meta1.height ?? 720, meta2.height ?? 720);
    const [raw1, raw2] = await Promise.all([
      sharp.default(image1Path).resize(w, h, { fit: "fill" }).raw().toBuffer(),
      sharp.default(image2Path).resize(w, h, { fit: "fill" }).raw().toBuffer(),
    ]);
    const totalPixels = w * h;
    const channels = 3;
    const diffBuffer = Buffer.alloc(raw1.length);
    let changedPixels = 0;
    for (let i = 0; i < raw1.length; i += channels) {
      const dr = Math.abs((raw1[i] ?? 0) - (raw2[i] ?? 0));
      const dg = Math.abs((raw1[i + 1] ?? 0) - (raw2[i + 1] ?? 0));
      const db = Math.abs((raw1[i + 2] ?? 0) - (raw2[i + 2] ?? 0));
      if ((dr + dg + db) / 3 > 10) {
        changedPixels++;
        diffBuffer[i] = 255; diffBuffer[i + 1] = 0; diffBuffer[i + 2] = 0;
      } else {
        diffBuffer[i] = raw2[i] ?? 0;
        diffBuffer[i + 1] = raw2[i + 1] ?? 0;
        diffBuffer[i + 2] = raw2[i + 2] ?? 0;
      }
    }
    const diffPercent = parseFloat(((changedPixels / totalPixels) * 100).toFixed(4));
    let diffImagePath: string | undefined;
    if (options?.saveDiff) {
      const dir = options.diffDir ?? dirname(image2Path);
      mkdirSync(dir, { recursive: true });
      diffImagePath = join(dir, `diff-${Date.now()}.png`);
      await sharp.default(diffBuffer, { raw: { width: w, height: h, channels } }).png().toFile(diffImagePath);
    }
    return { diffPercent, diffPixels: changedPixels, totalPixels, diffImagePath };
  } catch {
    // Fallback: fast byte comparison (imprecise but dependency-free)
    const buf1 = readFileSync(image1Path);
    const buf2 = readFileSync(image2Path);
    if (buf1.equals(buf2)) {
      return { diffPercent: 0, diffPixels: 0, totalPixels: Math.max(1, Math.floor(buf1.length / 4)) };
    }
    if (buf1.length !== buf2.length) {
      const px = Math.max(1, Math.floor(Math.max(buf1.length, buf2.length) / 4));
      return { diffPercent: 100, diffPixels: px, totalPixels: px };
    }
    let diffBytes = 0;
    for (let i = 0; i < buf1.length; i++) { if (buf1[i] !== buf2[i]) diffBytes++; }
    const totalPixels = Math.max(1, Math.floor(buf1.length / 4));
    return {
      diffPercent: parseFloat(((diffBytes / buf1.length) * 100).toFixed(4)),
      diffPixels: Math.max(1, Math.floor(diffBytes / 4)),
      totalPixels,
    };
  }
}

/**
 * Compare screenshots from two runs, matching by scenario + step number.
 */
export async function compareRunScreenshots(
  runId: string,
  baselineRunId: string,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<VisualDiffResult[]> {
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
        const comparison = await compareImages(baseline.path, ss.filePath);
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
