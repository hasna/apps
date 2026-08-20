import type { Command } from "commander";
import chalk from "chalk";
import { REGISTRY, type PackageEntry } from "../registry.js";
import { dataPath, dirExists, dbSize, formatBytes, getInstalledVersion, binaryExists, pad, truncate } from "../utils.js";

interface StatusRow {
  name: string;
  installed: string;
  db: string;
  mcp: string;
  http: string;
  dir: string;
}

function getStatusRow(pkg: PackageEntry): StatusRow {
  const installed = getInstalledVersion(pkg.npm);
  const dp = dataPath(pkg.dataDir);
  const hasDir = dirExists(dp);
  const size = pkg.hasDb ? dbSize(dp) : 0;
  return {
    name: pkg.name,
    installed: installed || chalk.dim("--"),
    db: pkg.hasDb ? (size > 0 ? formatBytes(size) : chalk.yellow("empty")) : chalk.dim("--"),
    mcp: pkg.hasMcp ? (pkg.bins.mcp && binaryExists(pkg.bins.mcp) ? chalk.green("ok") : chalk.red("missing")) : chalk.dim("--"),
    http: pkg.hasHttp ? (pkg.bins.serve && binaryExists(pkg.bins.serve) ? chalk.green("ok") : chalk.red("missing")) : chalk.dim("--"),
    dir: hasDir ? chalk.green("ok") : chalk.red("missing"),
  };
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show table of all @hasna/* packages: installed version, DB size, MCP/HTTP status")
    .option("-f, --filter <name>", "Filter by package name (substring match)")
    .option("--installed", "Only show installed packages")
    .option("--json", "Output as JSON")
    .action((opts) => {
      let packages = REGISTRY;
      if (opts.filter) {
        const f = opts.filter.toLowerCase();
        packages = packages.filter((p) => p.name.toLowerCase().includes(f));
      }
      const rows = packages.map(getStatusRow);
      if (opts.installed) {
        const filtered = rows.filter((r) => !r.installed.includes("--"));
        if (filtered.length === 0) {
          console.log(chalk.yellow("No @hasna/* packages installed globally."));
          return;
        }
        printTable(filtered, opts.json);
      } else {
        printTable(rows, opts.json);
      }
    });
}

function printTable(rows: StatusRow[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const cols = { name: 18, installed: 12, db: 12, mcp: 9, http: 9, dir: 9 };
  console.log(
    chalk.bold(
      pad("Package", cols.name) +
        pad("Version", cols.installed) +
        pad("DB Size", cols.db) +
        pad("MCP", cols.mcp) +
        pad("HTTP", cols.http) +
        pad("DataDir", cols.dir),
    ),
  );
  console.log(chalk.dim("─".repeat(cols.name + cols.installed + cols.db + cols.mcp + cols.http + cols.dir)));
  for (const row of rows) {
    console.log(
      pad(truncate(row.name, cols.name - 1), cols.name) +
        pad(row.installed, cols.installed) +
        pad(row.db, cols.db) +
        pad(row.mcp, cols.mcp) +
        pad(row.http, cols.http) +
        pad(row.dir, cols.dir),
    );
  }
  console.log();
  console.log(chalk.dim(`${rows.length} packages total`));
}
