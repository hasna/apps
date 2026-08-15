import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("value must be a positive integer");
  }
  return parsed;
}

export function registerScaleHardeningCommands(program: Command) {
  const scale = program
    .command("scale")
    .description("Benchmark local performance, archive readiness, compaction, and SQLite integrity");

  scale
    .command("report")
    .description("Build a local scale hardening report without network access")
    .option("--older-than-days <days>", "Archive-readiness window for terminal tasks", "30")
    .option("--format <format>", "json or markdown", "markdown")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { olderThanDays?: string; format?: string; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { createScalePerformanceReport, renderScalePerformanceReportMarkdown } = await import("../../lib/scale-hardening.js");
        const report = createScalePerformanceReport({
          older_than_days: parsePositiveInteger(opts.olderThanDays, 30),
        });
        const format = (opts.json || globalOpts.json) ? "json" : opts.format || "markdown";
        if (format === "json") {
          output(report, true);
          return;
        }
        if (format !== "markdown") throw new Error("--format must be json or markdown");
        console.log(renderScalePerformanceReportMarkdown(report));
      } catch (error) {
        handleError(error);
      }
    });

  scale
    .command("compact")
    .description("Preview or apply local SQLite optimization and VACUUM compaction")
    .option("--apply", "Run PRAGMA optimize and VACUUM; dry-run by default")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { apply?: boolean; format?: string; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { compactScaleStorage } = await import("../../lib/scale-hardening.js");
        const result = compactScaleStorage({ apply: Boolean(opts.apply) });
        const format = (opts.json || globalOpts.json) ? "json" : opts.format || "json";
        if (format === "json") {
          output(result, true);
          return;
        }
        if (format !== "markdown") throw new Error("--format must be json or markdown");
        console.log(chalk.bold("todos scale compaction\n"));
        console.log(`Mode: ${result.dry_run ? "dry run" : "applied"}`);
        console.log(`Before: ${result.before.page_count} pages, ${result.before.freelist_count} free`);
        console.log(`After: ${result.after.page_count} pages, ${result.after.freelist_count} free`);
        console.log(`Actions: ${result.actions.join(", ")}`);
      } catch (error) {
        handleError(error);
      }
    });
}
