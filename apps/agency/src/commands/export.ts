import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { dbPackages, findPackage } from "../registry.js";
import { HASNA_HOME, dataPath, dirExists, execSafe, formatBytes, listTarball } from "../utils.js";

function generateExportName(format: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const ext = format === "json" ? "json.tar.gz" : "tar.gz";
  return `hasna-export-${ts}.${ext}`;
}

function findDbFiles(dir: string): string[] {
  if (!dirExists(dir)) return [];
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const full = join(dir, String(entry));
      if (full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) {
        try {
          if (statSync(full).isFile()) {
            files.push(full);
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return files;
}

function dumpDbToJson(dbPath: string, outputDir: string): number {
  const tablesRaw = execSafe(`sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null`);
  if (!tablesRaw) return 0;
  const tables = tablesRaw.split("\n").filter(Boolean);
  let tableCount = 0;
  for (const table of tables) {
    const jsonData = execSafe(`sqlite3 "${dbPath}" -json "SELECT * FROM "${table}";" 2>/dev/null`, 30000);
    if (jsonData === null) continue;
    try {
      const parsed = JSON.parse(jsonData);
      const outFile = join(outputDir, `${table}.json`);
      writeFileSync(outFile, JSON.stringify(parsed, null, 2));
      tableCount++;
    } catch {
      const csvData = execSafe(`sqlite3 "${dbPath}" -header -csv "SELECT * FROM "${table}";" 2>/dev/null`, 30000);
      if (csvData) {
        const outFile = join(outputDir, `${table}.csv`);
        writeFileSync(outFile, csvData);
        tableCount++;
      }
    }
  }
  return tableCount;
}

const EXCLUDE_PATTERNS = ["node_modules", ".next", ".cache", "backups", "__pycache__", ".git", "*.tmp"];

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command("export")
    .description("Export ~/.hasna data as tarball or JSON")
    .option("--format <format>", "Export format: tarball (default) or json", "tarball")
    .option("--service <name>", "Export only a specific service")
    .option("-o, --output <path>", "Output file path")
    .action((opts) => {
      if (!dirExists(HASNA_HOME)) {
        console.error(chalk.red("~/.hasna does not exist. Run 'agency init' first."));
        process.exit(1);
      }
      const format = opts.format === "json" ? "json" : "tarball";
      if (format === "json") {
        exportAsJson(opts.service, opts.output);
      } else {
        exportAsTarball(opts.service, opts.output);
      }
    });

  program
    .command("import <file>")
    .description("Restore from a previously exported archive")
    .option("--dry-run", "Show what would be restored without restoring")
    .option("--force", "Overwrite existing data without prompting")
    .action((file: string, opts) => {
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      console.log(chalk.bold(`agency import\n`));
      console.log(chalk.dim(`  Source: ${filePath}`));
      console.log(chalk.dim(`  Target: ${HASNA_HOME}\n`));
      // Validate the archive before listing or extracting: a corrupt tarball
      // must fail here, never after live data has been touched.
      const listing = listTarball(filePath, 40);
      if (listing === null) {
        console.error(chalk.red(`  Invalid or unreadable archive: ${filePath}`));
        console.error(chalk.red("  Refusing to import from an unverified archive."));
        process.exit(1);
      }
      console.log(chalk.dim("  Contents (first 40 entries):"));
      for (const line of listing.split("\n").filter(Boolean)) {
        console.log(chalk.dim(`    ${line}`));
      }
      console.log();
      try {
        const size = statSync(filePath).size;
        console.log(chalk.dim(`  Archive size: ${formatBytes(size)}`));
      } catch {
        /* ignore */
      }
      if (opts.dryRun) {
        console.log(chalk.yellow(`\n  Dry run — no changes made.`));
        return;
      }
      if (!opts.force) {
        console.log(chalk.yellow(`\n  Warning: this will overwrite existing data in ~/.hasna/`));
        console.log(chalk.dim("  Use --force to skip this warning."));
        console.log(chalk.dim(`  Use --dry-run to preview without changes.\n`));
        console.error(chalk.red("  Aborting. Use --force to proceed."));
        process.exit(1);
      }
      // Staged import: extract into a verified staging directory first, then
      // copy over ~/.hasna. A failed extraction leaves live data untouched.
      const staging = execSafe(`mktemp -d /tmp/hasna-import.XXXXXX`, 5000);
      if (staging === null) {
        console.error(chalk.red("  Import failed: could not create staging directory."));
        process.exit(1);
      }
      try {
        const extractResult = execSafe(`tar -xzf "${filePath}" -C "${staging}" 2>&1`, 120000);
        if (extractResult === null) {
          console.error(chalk.red("  Import failed: archive extraction into staging failed."));
          console.error(chalk.red(`  Live data untouched. Staging: ${staging}`));
          process.exit(1);
        }
        if (!dirExists(HASNA_HOME)) {
          mkdirSync(HASNA_HOME, { recursive: true });
        }
        const copyResult = execSafe(`cp -a "${staging}/." "${HASNA_HOME}/" 2>&1`, 120000);
        if (copyResult === null) {
          console.error(chalk.red("  Import failed: copying staged content into ~/.hasna failed."));
          console.error(chalk.red(`  Live data may be partially imported. Staged copy preserved at: ${staging}`));
          process.exit(1);
        }
        console.log(chalk.green(`\n  Import complete.`));
      } finally {
        const cleanup = execSafe(`rm -rf "${staging}" 2>&1`, 5000);
        if (cleanup === null) {
          console.error(chalk.yellow(`  Warning: could not remove staging dir: ${staging}`));
        }
      }
    });
}

function exportAsTarball(service: string | undefined, output: string | undefined): void {
  console.log(chalk.bold("agency export") + chalk.dim(` — tarball\n`));
  let sourceDir: string;
  let filename: string;
  if (service) {
    const pkg = findPackage(service);
    if (!pkg) {
      console.error(chalk.red(`Unknown service: ${service}`));
      process.exit(1);
    }
    sourceDir = dataPath(pkg.dataDir);
    if (!dirExists(sourceDir)) {
      console.error(chalk.red(`No data directory for ${service}: ${sourceDir}`));
      process.exit(1);
    }
    filename = `hasna-export-${service}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.tar.gz`;
  } else {
    sourceDir = HASNA_HOME;
    filename = generateExportName("tarball");
  }
  const outputPath = output ? resolve(output) : join(homedir(), filename);
  const excludeArgs = EXCLUDE_PATTERNS.map((p) => `--exclude="${p}"`).join(" ");
  console.log(chalk.dim(`  Source: ${sourceDir}`));
  console.log(chalk.dim(`  Output: ${outputPath}\n`));
  const cmd = service
    ? `tar -czf "${outputPath}" ${excludeArgs} -C "${HASNA_HOME}" "${service}" 2>&1`
    : `tar -czf "${outputPath}" ${excludeArgs} -C "${HASNA_HOME}" . 2>&1`;
  const result = execSafe(cmd, 120000);
  if (result !== null && existsSync(outputPath)) {
    const size = statSync(outputPath).size;
    console.log(chalk.green(`  Export created: ${outputPath}`));
    console.log(chalk.dim(`  Size: ${formatBytes(size)}`));
  } else {
    console.error(chalk.red(`  Export failed: ${result || "unknown error"}`));
    process.exit(1);
  }
}

function exportAsJson(service: string | undefined, output: string | undefined): void {
  console.log(chalk.bold("agency export") + chalk.dim(` — JSON\n`));
  const tmpBase = join(HASNA_HOME, ".export-tmp");
  if (existsSync(tmpBase)) {
    execSafe(`rm -rf "${tmpBase}"`, 10_000);
  }
  mkdirSync(tmpBase, { recursive: true });
  let packages = dbPackages();
  if (service) {
    packages = packages.filter((p) => p.name === service);
    if (packages.length === 0) {
      console.error(chalk.red(`Unknown or non-database service: ${service}`));
      execSafe(`rm -rf "${tmpBase}"`, 10_000);
      process.exit(1);
    }
  }
  let totalTables = 0;
  for (const pkg of packages) {
    const dp = dataPath(pkg.dataDir);
    const dbFiles = findDbFiles(dp);
    if (dbFiles.length === 0) continue;
    const svcDir = join(tmpBase, pkg.name);
    mkdirSync(svcDir, { recursive: true });
    for (const dbFile of dbFiles) {
      const dbName = basename(dbFile, ".db").replace(".sqlite3", "").replace(".sqlite", "");
      const tableDir = join(svcDir, dbName);
      mkdirSync(tableDir, { recursive: true });
      const count = dumpDbToJson(dbFile, tableDir);
      totalTables += count;
      if (count > 0) {
        console.log(chalk.dim(`  ${pkg.name}/${dbName}: ${count} table(s) exported`));
      }
    }
  }
  if (totalTables === 0) {
    console.log(chalk.yellow("  No data found to export."));
    execSafe(`rm -rf "${tmpBase}"`, 10_000);
    return;
  }
  const filename = service
    ? `hasna-export-${service}-json-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.tar.gz`
    : generateExportName("json");
  const outputPath = output ? resolve(output) : join(homedir(), filename);
  const result = execSafe(`tar -czf "${outputPath}" -C "${tmpBase}" . 2>&1`, 120000);
  execSafe(`rm -rf "${tmpBase}"`, 10_000);
  if (result !== null && existsSync(outputPath)) {
    const size = statSync(outputPath).size;
    console.log(chalk.green(`\n  JSON export created: ${outputPath}`));
    console.log(chalk.dim(`  Size: ${formatBytes(size)}`));
    console.log(chalk.dim(`  Tables: ${totalTables}`));
  } else {
    console.error(chalk.red(`\n  Export failed: ${result || "unknown error"}`));
    process.exit(1);
  }
}
