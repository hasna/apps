import type { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import chalk from "chalk";

function getMcpBinPath(): string {
  try {
    const resolved = execSync("which security-mcp", { encoding: "utf-8" }).trim();
    if (resolved) return resolved;
  } catch {}
  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8" }).trim();
    const candidate = `${bunBin}/security-mcp`;
    if (existsSync(candidate)) return candidate;
  } catch {}
  return "security-mcp";
}

function addCodexMcp(configPath: string, mcpBin: string): void {
  let content = "";
  try { content = readFileSync(configPath, "utf-8"); } catch {}
  if (content.includes("[mcp_servers.security]")) {
    content = content.replace(/\[mcp_servers\.security\][^\[]*/s, `[mcp_servers.security]\ncommand = "${mcpBin}"\nargs = []\n\n`);
  } else {
    content += `\n[mcp_servers.security]\ncommand = "${mcpBin}"\nargs = []\n`;
  }
  mkdirSync(configPath.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(configPath, content, "utf-8");
}

function removeCodexMcp(configPath: string): void {
  let content = "";
  try { content = readFileSync(configPath, "utf-8"); } catch { return; }
  content = content.replace(/\n?\[mcp_servers\.security\][^\[]*/s, "");
  writeFileSync(configPath, content, "utf-8");
}

function addGeminiMcp(configPath: string, mcpBin: string): void {
  mkdirSync(configPath.replace(/\/[^/]+$/, ""), { recursive: true });
  let config: Record<string, any> = {};
  try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers["security"] = { command: mcpBin, args: [] };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function removeGeminiMcp(configPath: string): void {
  let config: Record<string, any> = {};
  try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch { return; }
  if (config.mcpServers?.["security"]) delete config.mcpServers["security"];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function registerMcpInstallCommand(program: Command): void {
  program
    .command("mcp")
    .description("Install/uninstall security as MCP server for AI agents")
    .option("--claude", "Install for Claude Code")
    .option("--codex", "Install for Codex")
    .option("--gemini", "Install for Gemini")
    .option("--all", "Install for all agents")
    .option("--uninstall", "Uninstall instead of install")
    .option("--scope <scope>", "Claude Code scope (user/project/local)", "user")
    .action(async (options) => {
      const uninstall = options.uninstall ?? false;
      const targets: string[] = [];

      if (options.all) targets.push("claude", "codex", "gemini");
      else {
        if (options.claude) targets.push("claude");
        if (options.codex) targets.push("codex");
        if (options.gemini) targets.push("gemini");
      }

      if (targets.length === 0) {
        console.log(chalk.bold("\n  security mcp \u2014 Install MCP server for AI agents\n"));
        console.log("  Usage:");
        console.log(chalk.gray("    security mcp --claude          Install for Claude Code"));
        console.log(chalk.gray("    security mcp --codex           Install for Codex"));
        console.log(chalk.gray("    security mcp --gemini          Install for Gemini"));
        console.log(chalk.gray("    security mcp --all             Install for all agents"));
        console.log(chalk.gray("    security mcp --all --uninstall Uninstall from all"));
        console.log(chalk.gray("    security mcp --claude --scope project  Install per-project\n"));
        return;
      }

      const mcpBin = getMcpBinPath();

      for (const target of targets) {
        try {
          if (target === "claude") {
            if (uninstall) {
              execSync("claude mcp remove security", { stdio: "pipe" });
              console.log(chalk.green("  Removed from Claude Code"));
            } else {
              execSync(`claude mcp add --transport stdio --scope ${options.scope || "user"} security -- ${mcpBin}`, { stdio: "pipe" });
              console.log(chalk.green(`  Installed for Claude Code (scope: ${options.scope || "user"})`));
            }
          } else if (target === "codex") {
            const configPath = `${process.env.HOME}/.codex/config.toml`;
            if (uninstall) { removeCodexMcp(configPath); console.log(chalk.green("  Removed from Codex")); }
            else { addCodexMcp(configPath, mcpBin); console.log(chalk.green("  Installed for Codex")); }
          } else if (target === "gemini") {
            const configPath = `${process.env.HOME}/.gemini/settings.json`;
            if (uninstall) { removeGeminiMcp(configPath); console.log(chalk.green("  Removed from Gemini")); }
            else { addGeminiMcp(configPath, mcpBin); console.log(chalk.green("  Installed for Gemini")); }
          }
        } catch (error) {
          console.error(chalk.red(`  Failed for ${target}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      console.log();
      if (!uninstall) {
        console.log(chalk.gray("  Restart your AI agent to use security MCP tools."));
        console.log();
      }
    });
}
