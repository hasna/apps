import type { Command } from "commander";
import chalk from "chalk";
import { mcpPackages } from "../registry.js";
import { binaryExists, spawnWithTimeout, pad } from "../utils.js";

interface McpCheckResult {
  name: string;
  binary: string;
  installed: boolean;
  starts: boolean;
  error?: string;
}

async function checkMcp(pkg: { name: string; bins: { mcp?: string } }): Promise<McpCheckResult> {
  const binary = pkg.bins.mcp!;
  const installed = binaryExists(binary);
  if (!installed) {
    return { name: pkg.name, binary, installed: false, starts: false, error: "not on PATH" };
  }
  const result = await spawnWithTimeout(binary, ["--help"], 3000);
  // Only a clean exit-0 counts as started. A timeout or a spawn error
  // (code === null) is a FAILURE, never a healthy start — the old
  // `code === 0 || code === null` classification reported hung or crashed
  // binaries as healthy.
  const starts = result.code === 0;
  return {
    name: pkg.name,
    binary,
    installed: true,
    starts,
    error: !starts
      ? result.timedOut
        ? "timeout (no response within 3s)"
        : result.stderr.split("\n")[0] || `exit ${result.code ?? "spawn error"}`
      : undefined,
  };
}

export function registerMcpCommand(program: Command): void {
  const mcpCmd = program.command("mcp").description("Manage MCP servers across all @hasna/* packages");

  mcpCmd
    .command("check")
    .description("Spawn each MCP binary (3s timeout), check for errors, report table")
    .option("-f, --filter <name>", "Filter by package name")
    .action(async (opts) => {
      let packages = mcpPackages();
      if (opts.filter) {
        const f = opts.filter.toLowerCase();
        packages = packages.filter((p) => p.name.toLowerCase().includes(f));
      }
      console.log(chalk.bold("hasna mcp check") + chalk.dim(` — testing ${packages.length} MCP servers\n`));
      const results: McpCheckResult[] = [];
      for (const pkg of packages) {
        process.stdout.write(chalk.dim(`  Checking ${pkg.name}...`));
        const result = await checkMcp(pkg);
        results.push(result);
        process.stdout.write("\r" + " ".repeat(60) + "\r");
      }
      console.log(chalk.bold(pad("Package", 18) + pad("Binary", 22) + pad("Installed", 12) + pad("Starts", 10) + "Error"));
      console.log(chalk.dim("─".repeat(80)));
      let passCount = 0;
      let failCount = 0;
      for (const r of results) {
        const installedStr = r.installed ? chalk.green("yes") : chalk.red("no");
        const startsStr = r.starts ? chalk.green("yes") : chalk.red("no");
        const errorStr = r.error ? chalk.red(r.error) : "";
        console.log(pad(r.name, 18) + pad(r.binary, 22) + pad(installedStr, 12) + pad(startsStr, 10) + errorStr);
        if (r.installed && r.starts) passCount++;
        else failCount++;
      }
      console.log();
      console.log(`  ${chalk.green(`${passCount} ok`)}, ${chalk.red(`${failCount} issues`)} out of ${results.length} MCP servers`);
    });

  mcpCmd.command("list").description("List all known MCP server binaries").action(() => {
    const packages = mcpPackages();
    console.log(chalk.bold(`MCP Servers\n`));
    console.log(pad("Package", 18) + pad("Binary", 22) + pad("Installed", 10));
    console.log(chalk.dim("─".repeat(50)));
    for (const pkg of packages) {
      const binary = pkg.bins.mcp!;
      const installed = binaryExists(binary);
      console.log(pad(pkg.name, 18) + pad(binary, 22) + (installed ? chalk.green("yes") : chalk.red("no")));
    }
  });
}
