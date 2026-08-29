import type { Command } from "commander";
import chalk from "chalk";
import { REGISTRY } from "../registry.js";
import { HASNA_HOME, dataPath, dirExists, execSafe, getInstalledVersion, getLatestVersion, binaryExists, spawnWithTimeout } from "../utils.js";

interface Check {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function icon(status: Check["status"]): string {
  switch (status) {
    case "pass":
      return chalk.green("[PASS]");
    case "warn":
      return chalk.yellow("[WARN]");
    case "fail":
      return chalk.red("[FAIL]");
  }
}

async function runChecks(verbose: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({
    label: "Base data directory",
    status: dirExists(HASNA_HOME) ? "pass" : "fail",
    detail: dirExists(HASNA_HOME) ? HASNA_HOME : `${HASNA_HOME} does not exist — run "hasna init"`,
  });

  let missingDirs = 0;
  for (const pkg of REGISTRY) {
    if (!pkg.hasDb) continue;
    const dp = dataPath(pkg.dataDir);
    if (!dirExists(dp)) {
      missingDirs++;
      if (verbose) {
        checks.push({ label: `Data dir: ${pkg.name}`, status: "warn", detail: `${dp} missing` });
      }
    }
  }
  if (!verbose && missingDirs > 0) {
    checks.push({
      label: "Missing data directories",
      status: "warn",
      detail: `${missingDirs} package data dirs missing — run "hasna init" to create them`,
    });
  }

  const bunVersion = execSafe("bun --version");
  checks.push({
    label: "Bun runtime",
    status: bunVersion ? "pass" : "fail",
    detail: bunVersion ? `v${bunVersion}` : "bun not found on PATH",
  });

  const nodeVersion = execSafe("node --version");
  checks.push({
    label: "Node.js runtime",
    status: nodeVersion ? "pass" : "warn",
    detail: nodeVersion || "node not found on PATH",
  });

  const npmVersion = execSafe("npm --version");
  checks.push({
    label: "npm",
    status: npmVersion ? "pass" : "fail",
    detail: npmVersion ? `v${npmVersion}` : "npm not found",
  });

  const cloudVersion = getInstalledVersion("@hasna/cloud");
  checks.push({
    label: "@hasna/cloud installed",
    status: cloudVersion ? "pass" : "warn",
    detail: cloudVersion ? `v${cloudVersion}` : "not installed globally",
  });

  const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
  if (rdsHost) {
    // Credentials and connection fields go to the child via argv + env, never
    // interpolated into a shell command string (no process-argument exposure,
    // no shell interpretation of connection fields).
    const rdsUser = process.env.HASNA_RDS_USER || process.env.CLOUD_PG_USER || "hasna_admin";
    const rdsPassword = process.env.HASNA_RDS_PASSWORD || process.env.CLOUD_PG_PASSWORD || "";
    const pgResult = await spawnWithTimeout(
      "psql",
      ["-h", rdsHost, "-U", rdsUser, "-d", "postgres", "-c", "SELECT 1;"],
      5000,
      { PGPASSWORD: rdsPassword },
    );
    const connected = pgResult.code === 0 && pgResult.stdout.includes("1");
    checks.push({
      label: "RDS connection",
      status: connected ? "pass" : "fail",
      detail: connected ? `Connected to ${rdsHost}` : `Failed to connect to ${rdsHost}`,
    });
  } else {
    checks.push({
      label: "RDS connection",
      status: "warn",
      detail: "No RDS configured (set HASNA_RDS_HOST or CLOUD_PG_HOST)",
    });
  }

  const keyPackages = ["@hasna/cloud", "@hasna/todos", "@hasna/mementos", "@hasna/conversations"];
  for (const npm of keyPackages) {
    const installed = getInstalledVersion(npm);
    if (!installed) continue;
    const latest = getLatestVersion(npm);
    if (!latest) continue;
    const upToDate = installed === latest;
    checks.push({
      label: `${npm} version`,
      status: upToDate ? "pass" : "warn",
      detail: upToDate ? `v${installed} (latest)` : `v${installed} -> v${latest} available`,
    });
  }

  let missingMcp = 0;
  let totalMcp = 0;
  for (const pkg of REGISTRY) {
    if (!pkg.bins.mcp) continue;
    totalMcp++;
    if (!binaryExists(pkg.bins.mcp)) {
      missingMcp++;
      if (verbose) {
        checks.push({ label: `MCP binary: ${pkg.bins.mcp}`, status: "warn", detail: "not found on PATH" });
      }
    }
  }
  if (!verbose) {
    checks.push({
      label: "MCP binaries",
      status: missingMcp === 0 ? "pass" : missingMcp === totalMcp ? "fail" : "warn",
      detail: `${totalMcp - missingMcp}/${totalMcp} found on PATH`,
    });
  }

  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks: dirs, configs, RDS, versions, MCP binaries")
    .option("-v, --verbose", "Show individual check details for every package")
    .action(async (opts) => {
      console.log(chalk.bold("hasna doctor") + chalk.dim(` — running health checks...\n`));
      const checks = await runChecks(!!opts.verbose);
      const passed = checks.filter((c) => c.status === "pass").length;
      const warned = checks.filter((c) => c.status === "warn").length;
      const failed = checks.filter((c) => c.status === "fail").length;
      for (const check of checks) {
        console.log(`  ${icon(check.status)} ${check.label}: ${chalk.dim(check.detail)}`);
      }
      console.log();
      console.log(`  ${chalk.green(`${passed} passed`)}, ${chalk.yellow(`${warned} warnings`)}, ${chalk.red(`${failed} failed`)}`);
      if (failed > 0) {
        console.log(chalk.red(`\nSome checks failed. Run 'hasna init' to fix common issues.`));
        process.exit(1);
      }
    });
}
