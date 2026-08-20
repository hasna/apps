import type { Command } from "commander";
import chalk from "chalk";
import { dbPackages, findPackage } from "../registry.js";
import { dataPath, dirExists, binaryExists, execSafe, pad } from "../utils.js";

export function registerSyncCommand(program: Command): void {
  const syncCmd = program
    .command("sync")
    .description("Sync local SQLite databases with remote PostgreSQL via @hasna/cloud");

  syncCmd
    .command("status")
    .description("Show sync status for all packages")
    .option("-f, --filter <name>", "Filter by package name")
    .action((opts) => {
      console.log(chalk.bold(`hasna sync status\n`));
      const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
      if (!rdsHost) {
        console.log(chalk.yellow("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
        return;
      }
      let packages = dbPackages();
      if (opts.filter) {
        const f = opts.filter.toLowerCase();
        packages = packages.filter((p) => p.name.toLowerCase().includes(f));
      }
      console.log(pad("Package", 18) + pad("Local DB", 12) + pad("CLI", 10) + pad("Sync Ready", 12));
      console.log(chalk.dim("─".repeat(52)));
      for (const pkg of packages) {
        const dp = dataPath(pkg.dataDir);
        const hasLocal = dirExists(dp);
        const hasCli = pkg.bins.cli ? binaryExists(pkg.bins.cli) : false;
        const syncReady = hasLocal && hasCli;
        console.log(
          pad(pkg.name, 18) +
            pad(hasLocal ? chalk.green("ok") : chalk.red("missing"), 12) +
            pad(hasCli ? chalk.green("ok") : chalk.red("missing"), 10) +
            pad(syncReady ? chalk.green("ready") : chalk.yellow("not ready"), 12),
        );
      }
      console.log(chalk.dim(`\nRDS: ${rdsHost}`));
    });

  syncCmd.command("push [packages...]").description("Push local data to remote PostgreSQL").action((packages: string[]) => {
    const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
    if (!rdsHost) {
      console.error(chalk.red("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
      process.exit(1);
    }
    const targets =
      packages.length > 0
        ? (packages.map((n) => findPackage(n)).filter(Boolean) as NonNullable<ReturnType<typeof findPackage>>[])
        : dbPackages().filter((p) => p.bins.cli && binaryExists(p.bins.cli));
    if (targets.length === 0) {
      console.log(chalk.yellow("No syncable packages found. Install packages first."));
      return;
    }
    console.log(chalk.bold("hasna sync push") + chalk.dim(` — pushing ${targets.length} packages\n`));
    for (const pkg of targets) {
      if (!pkg.bins.cli) continue;
      process.stdout.write(chalk.dim(`  ${pkg.name} ... `));
      const result = execSafe(`${pkg.bins.cli} sync push 2>&1`, 30000);
      if (result !== null) {
        console.log(chalk.green("ok"));
      } else {
        console.log(chalk.yellow("skipped (sync not supported or failed)"));
      }
    }
  });

  syncCmd.command("pull [packages...]").description("Pull remote data to local SQLite").action((packages: string[]) => {
    const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
    if (!rdsHost) {
      console.error(chalk.red("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
      process.exit(1);
    }
    const targets =
      packages.length > 0
        ? (packages.map((n) => findPackage(n)).filter(Boolean) as NonNullable<ReturnType<typeof findPackage>>[])
        : dbPackages().filter((p) => p.bins.cli && binaryExists(p.bins.cli));
    if (targets.length === 0) {
      console.log(chalk.yellow("No syncable packages found. Install packages first."));
      return;
    }
    console.log(chalk.bold("hasna sync pull") + chalk.dim(` — pulling ${targets.length} packages\n`));
    for (const pkg of targets) {
      if (!pkg.bins.cli) continue;
      process.stdout.write(chalk.dim(`  ${pkg.name} ... `));
      const result = execSafe(`${pkg.bins.cli} sync pull 2>&1`, 30000);
      if (result !== null) {
        console.log(chalk.green("ok"));
      } else {
        console.log(chalk.yellow("skipped (sync not supported or failed)"));
      }
    }
  });
}
