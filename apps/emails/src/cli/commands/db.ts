import type { Command } from "commander";
import chalk from "../../lib/chalk-lite.js";
import { handleError } from "../utils.js";

/**
 * `emails db` — api Postgres schema management.
 */
export function registerDbCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const dbCmd = program.command("db").description("Api Postgres schema: migrate / status");

  dbCmd
    .command("migrate")
    .description("Apply all pending api schema migrations (idempotent)")
    .option("--dry-run", "Report the migration plan without applying", false)
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const { runMigrations } = await import("../../server/api/migrate.js");
        const result = await runMigrations({ dryRun: opts.dryRun === true });
        const lines: string[] = [];
        if (opts.dryRun) {
          lines.push(chalk.bold("Migration plan (dry run):"));
          lines.push(`  pending: ${result.pending.length ? result.pending.join(", ") : chalk.dim("(none)")}`);
          lines.push(`  already applied: ${result.alreadyApplied.length}`);
        } else {
          lines.push(chalk.green(`Applied ${result.applied.length} migration(s).`));
          if (result.applied.length) lines.push(`  ${result.applied.join(", ")}`);
          lines.push(chalk.dim(`Already applied: ${result.alreadyApplied.length}`));
        }
        output(result, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  dbCmd
    .command("status")
    .description("Show applied vs pending api schema migrations")
    .action(async () => {
      try {
        const { runMigrations } = await import("../../server/api/migrate.js");
        const result = await runMigrations({ dryRun: true });
        const lines: string[] = [
          chalk.bold("Api schema status:"),
          `  applied: ${result.alreadyApplied.length}`,
          `  pending: ${result.pending.length ? chalk.yellow(result.pending.join(", ")) : chalk.dim("(none)")}`,
        ];
        output(result, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });
}
