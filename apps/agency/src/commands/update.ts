import type { Command } from "commander";
import chalk from "chalk";
import { REGISTRY, findPackage, type PackageEntry } from "../registry.js";
import { getInstalledVersion, getLatestVersion, execSafe, pad } from "../utils.js";

interface UpdateInfo {
  name: string;
  npm: string;
  current: string;
  latest: string;
  needsUpdate: boolean;
}

function gatherUpdateInfo(pkgNames?: string[]): UpdateInfo[] {
  const packages: PackageEntry[] = pkgNames
    ? (pkgNames.map((n) => findPackage(n)).filter(Boolean) as PackageEntry[])
    : REGISTRY.filter((p) => Object.keys(p.bins).length > 0);
  const infos: UpdateInfo[] = [];
  for (const pkg of packages) {
    const current = getInstalledVersion(pkg.npm);
    if (!current) continue;
    const latest = getLatestVersion(pkg.npm);
    infos.push({
      name: pkg.name,
      npm: pkg.npm,
      current,
      latest: latest || current,
      needsUpdate: !!latest && latest !== current,
    });
  }
  return infos;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [packages...]")
    .description("Update @hasna/* packages. No args = update all installed. --check = dry run.")
    .option("--check", "Dry run — show what would be updated without installing")
    .option("--force", "Force reinstall even if version matches")
    .action((packages: string[], opts) => {
      const specific = packages.length > 0 ? packages : undefined;
      if (specific) {
        for (const name of specific) {
          if (!findPackage(name)) {
            console.error(chalk.red(`Unknown package: ${name}`));
            console.log(chalk.dim(`Available: ${REGISTRY.map((p) => p.name).join(", ")}`));
            process.exit(1);
          }
        }
      }
      console.log(chalk.bold("hasna update") + chalk.dim(` — checking for updates...\n`));

      const infos = gatherUpdateInfo(specific);
      if (infos.length === 0) {
        if (specific) {
          console.log(chalk.yellow("Specified packages are not installed. Install them first with 'hasna init'."));
        } else {
          console.log(chalk.yellow("No @hasna/* packages installed. Run 'hasna init' first."));
        }
        return;
      }

      const updatable = infos.filter((i) => i.needsUpdate);
      console.log(chalk.bold(pad("Package", 22) + pad("Current", 14) + pad("Latest", 14) + pad("Status", 12)));
      console.log(chalk.dim("─".repeat(62)));
      for (const info of infos) {
        const status = info.needsUpdate ? chalk.yellow("update available") : chalk.green("up to date");
        console.log(pad(info.name, 22) + pad(info.current, 14) + pad(info.latest, 14) + status);
      }
      console.log();

      if (opts.check) {
        if (updatable.length === 0) {
          console.log(chalk.green("All packages are up to date."));
        } else {
          console.log(chalk.yellow(`${updatable.length} package(s) can be updated.`));
          console.log(chalk.dim("Run 'hasna update' without --check to install updates."));
        }
        return;
      }

      const toUpdate = opts.force ? infos : updatable;
      if (toUpdate.length === 0) {
        console.log(chalk.green("All packages are up to date."));
        return;
      }

      console.log(chalk.dim(`Updating ${toUpdate.length} package(s)...\n`));
      let succeeded = 0;
      let failed = 0;
      for (const info of toUpdate) {
        process.stdout.write(chalk.dim(`  ${info.npm}@${info.latest} ... `));
        const result = execSafe(`bun install -g ${info.npm}@latest 2>&1`, 60000);
        if (result !== null) {
          console.log(chalk.green("ok"));
          succeeded++;
        } else {
          console.log(chalk.red("failed"));
          failed++;
        }
      }
      console.log();
      console.log(chalk.bold(`${chalk.green(`${succeeded} updated`)}, ${chalk.red(`${failed} failed`)}`));
    });
}
