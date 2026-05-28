import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { handleError, output } from "../helpers.js";

export function registerOnboardingCommands(program: Command) {
  program
    .command("onboarding")
    .alias("demo-fixtures")
    .description("List, show, write, or import bundled local onboarding fixtures")
    .option("--show <name>", "Show one fixture bridge bundle as JSON")
    .option("--write <dir>", "Write all bundled fixture bridge bundles to a directory")
    .option("--import <name>", "Dry-run or apply an onboarding fixture import")
    .option("--apply", "Apply an onboarding fixture import. Defaults to dry-run.")
    .option("--resolve-conflicts", "Safely merge existing local tasks while preserving divergent fields")
    .action(async (opts: { show?: string; write?: string; import?: string; apply?: boolean; resolveConflicts?: boolean }) => {
      const globalOpts = program.opts();
      try {
        const {
          getOnboardingFixtureBundle,
          importOnboardingFixture,
          listOnboardingFixtures,
          writeOnboardingFixtureFiles,
        } = await import("../../lib/onboarding-fixtures.js");

        if (opts.show) {
          output(getOnboardingFixtureBundle(opts.show), true);
          return;
        }

        if (opts.write) {
          const result = writeOnboardingFixtureFiles(resolve(opts.write));
          if (globalOpts.json) {
            output(result, true);
            return;
          }
          console.log(chalk.green(`Wrote ${result.written} onboarding fixture file(s) to ${result.directory}`));
          for (const file of result.files) console.log(chalk.dim(`  ${file}`));
          return;
        }

        if (opts.import) {
          const result = importOnboardingFixture({
            name: opts.import,
            dryRun: !opts.apply,
            conflictStrategy: opts.resolveConflicts ? "safe_merge" : "skip",
          });
          if (globalOpts.json) {
            output(result, true);
            return;
          }
          const mode = result.dry_run ? "Dry-run" : "Import";
          console.log(chalk.bold(`${mode} ${result.ok ? "ready" : "has issues"}`));
          for (const [key, count] of Object.entries(result.inserted)) {
            if (count > 0) console.log(`  ${key}: ${count}`);
          }
          for (const [key, count] of Object.entries(result.merged)) {
            if (count > 0) console.log(`  ${key} merged: ${count}`);
          }
          if (result.conflicts.length > 0) console.log(chalk.yellow(`  conflicts: ${result.conflicts.length}`));
          for (const issue of result.issues) console.error(chalk.red(`  ${issue}`));
          return;
        }

        const fixtures = listOnboardingFixtures();
        if (globalOpts.json) {
          output(fixtures, true);
          return;
        }
        console.log(chalk.bold(`${fixtures.length} bundled onboarding fixture(s):\n`));
        for (const fixture of fixtures) {
          console.log(`  ${chalk.bold(fixture.name)} ${chalk.dim(`[${fixture.version}]`)} ${chalk.yellow(`${fixture.stats.tasks} tasks`)}`);
          console.log(chalk.dim(`    ${fixture.description}`));
        }
      } catch (e) {
        handleError(e);
      }
    });
}
