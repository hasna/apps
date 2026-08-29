import type { Command } from "commander";
import chalk from "chalk";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { dbPackages, type PackageEntry } from "../registry.js";
import { dataPath, dirExists, fileExists, execSafe, formatBytes, pad, spawnSafe } from "../utils.js";

/**
 * Strict SQL identifier validation: only letters, digits and underscore,
 * never starting with a digit. Table names discovered from sqlite_master
 * (disk data) must pass before being interpolated into SQL, so a crafted
 * local database cannot inject statements (release-review P1: read-only
 * database commands execute shell-controlled disk identifiers).
 */
function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

interface DbFile {
  pkg: string;
  file: string;
  path: string;
  size: number;
}

function findDbFiles(pkg: PackageEntry): DbFile[] {
  const dp = dataPath(pkg.dataDir);
  if (!dirExists(dp)) return [];
  const files: DbFile[] = [];
  try {
    const entries = readdirSync(dp, { recursive: true });
    for (const entry of entries) {
      const full = join(dp, String(entry));
      if ((full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) && fileExists(full)) {
        files.push({ pkg: pkg.name, file: String(entry), path: full, size: statSync(full).size });
      }
    }
  } catch {
    /* unreadable dir */
  }
  return files;
}

export function registerDbCommand(program: Command): void {
  const dbCmd = program.command("db").description("Manage SQLite databases across @hasna/* packages");

  dbCmd
    .command("check")
    .description("Verify database files exist and are valid SQLite")
    .option("-f, --filter <name>", "Filter by package name")
    .action((opts) => {
      let packages = dbPackages();
      if (opts.filter) {
        const f = opts.filter.toLowerCase();
        packages = packages.filter((p) => p.name.toLowerCase().includes(f));
      }
      console.log(chalk.bold("hasna db check") + chalk.dim(` — verifying databases\n`));
      let totalFiles = 0;
      let validFiles = 0;
      let corruptFiles = 0;
      for (const pkg of packages) {
        const files = findDbFiles(pkg);
        if (files.length === 0) continue;
        for (const f of files) {
          totalFiles++;
          const result = spawnSafe("sqlite3", [f.path, "PRAGMA integrity_check;"], 10_000);
          if (result && result.includes("ok")) {
            validFiles++;
            console.log(`  ${chalk.green("[OK]")} ${pad(f.pkg, 16)} ${f.file} ${chalk.dim(`(${formatBytes(f.size)})`)}`);
          } else {
            corruptFiles++;
            console.log(`  ${chalk.red("[CORRUPT]")} ${pad(f.pkg, 16)} ${f.file} ${chalk.dim(`(${formatBytes(f.size)})`)}`);
          }
        }
      }
      if (totalFiles === 0) {
        console.log(chalk.dim("  No database files found."));
        return;
      }
      console.log();
      console.log(`  ${chalk.green(`${validFiles} valid`)}, ${chalk.red(`${corruptFiles} corrupt`)} out of ${totalFiles} databases`);
    });

  dbCmd
    .command("stats")
    .description("Show row counts and sizes for all databases")
    .option("-f, --filter <name>", "Filter by package name")
    .action((opts) => {
      let packages = dbPackages();
      if (opts.filter) {
        const f = opts.filter.toLowerCase();
        packages = packages.filter((p) => p.name.toLowerCase().includes(f));
      }
      console.log(chalk.bold(`hasna db stats\n`));
      console.log(chalk.bold(pad("Package", 18) + pad("File", 24) + pad("Size", 12) + pad("Tables", 8) + "Rows"));
      console.log(chalk.dim("─".repeat(76)));
      let totalSize = 0;
      let totalRows = 0;
      for (const pkg of packages) {
        const files = findDbFiles(pkg);
        if (files.length === 0) continue;
        for (const f of files) {
          totalSize += f.size;
          const tablesRaw = spawnSafe("sqlite3", [f.path, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"]);
          const tables = tablesRaw ? tablesRaw.split("\n").filter(Boolean).filter(isSafeIdentifier) : [];
          let rowCount = 0;
          for (const table of tables) {
            const countRaw = spawnSafe("sqlite3", [f.path, `SELECT COUNT(*) FROM "${table}";`]);
            if (countRaw) {
              rowCount += parseInt(countRaw, 10) || 0;
            }
          }
          totalRows += rowCount;
          console.log(pad(f.pkg, 18) + pad(f.file, 24) + pad(formatBytes(f.size), 12) + pad(String(tables.length), 8) + String(rowCount));
        }
      }
      console.log(chalk.dim("─".repeat(76)));
      console.log(chalk.bold(pad("Total", 18) + pad("", 24) + pad(formatBytes(totalSize), 12) + pad("", 8) + String(totalRows)));
    });

  dbCmd
    .command("vacuum [packages...]")
    .description("Run VACUUM on databases to reclaim space")
    .action((packages: string[]) => {
      const targets = packages.length > 0 ? dbPackages().filter((p) => packages.includes(p.name)) : dbPackages();
      console.log(chalk.bold(`hasna db vacuum\n`));
      let vacuumed = 0;
      for (const pkg of targets) {
        const files = findDbFiles(pkg);
        for (const f of files) {
          const sizeBefore = f.size;
          const result = spawnSafe("sqlite3", [f.path, "VACUUM;"], 30000);
          if (result !== null) {
            const sizeAfter = statSync(f.path).size;
            const saved = sizeBefore - sizeAfter;
            console.log(
              `  ${chalk.green("[OK]")} ${f.pkg}/${f.file}: ${formatBytes(sizeBefore)} -> ${formatBytes(sizeAfter)}` +
                (saved > 0 ? chalk.green(` (saved ${formatBytes(saved)})`) : chalk.dim(" (no change)")),
            );
            vacuumed++;
          } else {
            console.log(`  ${chalk.red("[FAIL]")} ${f.pkg}/${f.file}`);
          }
        }
      }
      if (vacuumed === 0) {
        console.log(chalk.dim("  No databases found to vacuum."));
      }
    });
}
