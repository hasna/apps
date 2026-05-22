import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { handleError, output } from "../helpers.js";

export function registerSdkFixtureCommands(program: Command) {
  program
    .command("sdk-fixtures")
    .description("List, show, or write local SDK integration fixtures")
    .option("--show", "Print the full fixture pack JSON")
    .option("--write <dir>", "Write fixture pack, bridge fixture, contract snapshots, and example index to a directory")
    .action(async (opts: { show?: boolean; write?: string }) => {
      const globalOpts = program.opts();
      try {
        const {
          createSdkIntegrationFixturePack,
          listSdkIntegrationExamples,
          writeSdkIntegrationFixtures,
        } = await import("../../lib/sdk-integration-fixtures.js");

        if (opts.write) {
          const result = writeSdkIntegrationFixtures(resolve(opts.write));
          if (globalOpts.json) {
            console.log(JSON.stringify(result));
            return;
          }
          console.log(chalk.green(`Wrote ${result.files.length} SDK integration fixture file(s) to ${result.directory}`));
          for (const file of result.files) console.log(chalk.dim(`  ${file}`));
          return;
        }

        if (opts.show) {
          console.log(JSON.stringify(createSdkIntegrationFixturePack()));
          return;
        }

        const examples = listSdkIntegrationExamples();
        if (globalOpts.json) {
          output(examples, true);
          return;
        }
        console.log(chalk.bold(`${examples.length} local SDK integration example(s):\n`));
        for (const example of examples) {
          console.log(`  ${chalk.bold(example.id)} ${chalk.dim(`[${example.surface}]`)}`);
          console.log(chalk.dim(`    ${example.command}`));
        }
      } catch (e) {
        handleError(e);
      }
    });
}
