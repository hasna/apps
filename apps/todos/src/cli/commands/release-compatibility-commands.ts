import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output, parseNonNegativeSafeInteger } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function parseLevels(value?: string): number[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => parseNonNegativeSafeInteger(item, "--levels"));
}

export function registerReleaseCompatibilityCommands(program: Command) {
  const releaseCompat = program
    .command("release-compat")
    .description("Check local release compatibility, migrations, exports, and Bun install guidance");

  releaseCompat
    .command("check")
    .description("Build a local release compatibility report")
    .option("--root <path>", "Package root (defaults to the current directory at execution)")
    .option("--levels <csv>", "Comma-separated migration levels to simulate")
    .option("--format <format>", "json or markdown", "json")
    .action(async (opts: { root?: string; levels?: string; format?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { createReleaseCompatibilityReport, renderReleaseCompatibilityMarkdown } = await import("../../lib/release-compatibility.js");
        const report = createReleaseCompatibilityReport({
          root: opts.root ?? process.cwd(),
          simulated_levels: parseLevels(opts.levels),
        });
        if (opts.format === "markdown") {
          console.log(renderReleaseCompatibilityMarkdown(report));
          if (!report.ok) process.exitCode = 1;
          return;
        }
        if (globalOpts.json || opts.format === "json") {
          output(report, true);
          if (!report.ok) process.exitCode = 1;
          return;
        }
        console.log(report.ok ? chalk.green("Release compatibility passed.") : chalk.red("Release compatibility failed."));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        handleError(error);
      }
    });
}
