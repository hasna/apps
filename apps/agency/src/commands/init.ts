import type { Command } from "commander";
import chalk from "chalk";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { REGISTRY } from "../registry.js";
import { HASNA_HOME, dataPath, dirExists, execSafe, spawnWithTimeout } from "../utils.js";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve2) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve2(answer.trim());
    });
  });
}

function ensureDir(dir: string): boolean {
  if (dirExists(dir)) return false;
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    console.error(chalk.red(`  Failed to create ${dir}: ${err}`));
    return false;
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Set up the hasna ecosystem: create data dirs, optionally configure RDS, install packages")
    .option("--skip-install", "Skip npm install of all packages")
    .option("--skip-rds", "Skip RDS configuration prompt")
    .option("-y, --yes", "Non-interactive mode, accept all defaults")
    .action(async (opts) => {
      console.log(chalk.bold("hasna init") + chalk.dim(` — setting up your environment\n`));

      let created = 0;
      if (ensureDir(HASNA_HOME)) {
        console.log(chalk.green(`  Created ${HASNA_HOME}`));
        created++;
      } else {
        console.log(chalk.dim(`  ${HASNA_HOME} already exists`));
      }

      console.log(chalk.dim(`\n  Creating data directories...`));
      for (const pkg of REGISTRY) {
        const dp = dataPath(pkg.dataDir);
        if (ensureDir(dp)) {
          created++;
        }
      }
      console.log(chalk.green(`  ${created} directories created\n`));

      const configPath = join(HASNA_HOME, "cli", "config.json");
      ensureDir(join(HASNA_HOME, "cli"));
      if (!existsSync(configPath)) {
        const defaultConfig = {
          version: 1,
          rds: {
            host: "",
            port: 5432,
            user: "",
            database: "cli",
            configured: false,
          },
          lastInit: new Date().toISOString(),
          autoUpdate: false,
        };
        writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(chalk.green(`  Created config: ${configPath}`));
      } else {
        console.log(chalk.dim(`  Config exists: ${configPath}`));
      }

      if (!opts.skipRds) {
        console.log();
        let configureRds = false;
        if (opts.yes) {
          configureRds = !!(process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST);
        } else {
          const answer = await ask("  Configure RDS connection? [y/N] ");
          configureRds = answer.toLowerCase() === "y";
        }
        if (configureRds) {
          // NOTE (reconstruction, 2026-08-20): the published 0.3.1 bundle
          // prefilled this prompt with a live internal RDS endpoint as the
          // default. Reconstructed source does not carry that internal-infra
          // string; the environment variables below are the operative path in
          // every non-interactive flow, so this only changes the interactive
          // prompt prefill.
          const host =
            process.env.HASNA_RDS_HOST ||
            process.env.CLOUD_PG_HOST ||
            (opts.yes ? "" : await ask(`  RDS host []: `));
          const user =
            process.env.HASNA_RDS_USER || process.env.CLOUD_PG_USER || (opts.yes ? "hasna_admin" : (await ask("  RDS user [hasna_admin]: ")) || "hasna_admin");
          const db = opts.yes ? "cli" : (await ask("  RDS database [cli]: ")) || "cli";
          if (host) {
            const pw = process.env.HASNA_RDS_PASSWORD || process.env.CLOUD_PG_PASSWORD || "";
            // Credentials via child env, connection fields via argv — never a
            // shell command string (no process-argument secret exposure).
            const result = await spawnWithTimeout(
              "psql",
              ["-h", host, "-U", user, "-d", db, "-c", "SELECT 1;"],
              5000,
              { PGPASSWORD: pw },
            );
            if (result.code === 0 && result.stdout.includes("1")) {
              console.log(chalk.green(`  RDS connection successful: ${host}/${db}`));
              try {
                const cfg = JSON.parse(readFileSync(configPath, "utf8"));
                cfg.rds = { host, port: 5432, user, database: db, configured: true };
                writeFileSync(configPath, JSON.stringify(cfg, null, 2));
              } catch {
                /* config write failure is non-fatal */
              }
            } else {
              console.log(chalk.yellow(`  RDS connection failed — skipping. You can reconfigure later with "hasna init".`));
            }
          }
        }
      }

      if (!opts.skipInstall) {
        console.log();
        let doInstall = false;
        if (opts.yes) {
          doInstall = true;
        } else {
          const answer = await ask("  Install all @hasna/* packages globally? [y/N] ");
          doInstall = answer.toLowerCase() === "y";
        }
        if (doInstall) {
          console.log(chalk.dim(`\n  Installing packages (this may take a while)...\n`));
          const npmNames = REGISTRY.filter((p) => Object.keys(p.bins).length > 0).map((p) => p.npm);
          const cmd = `bun install -g ${npmNames.join(" ")} 2>&1`;
          const result = execSafe(cmd, 120000);
          if (result) {
            console.log(chalk.green("  Packages installed successfully."));
          } else {
            console.log(chalk.yellow("  Some packages may have failed to install. Run 'hasna update' to retry."));
          }
        }
      }

      console.log(chalk.bold(`\nDone! Run 'hasna doctor' to verify your setup.`));
    });
}
