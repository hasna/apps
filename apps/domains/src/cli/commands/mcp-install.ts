import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const MCP_SERVER_NAME = "domains";

function getClaudeConfigPaths(): { global: string; project: string } {
  return {
    global: join(homedir(), ".claude", "claude_desktop_config.json"),
    project: join(process.cwd(), ".claude", "settings.json"),
  };
}

function getMcpBinaryPath(): string {
  try {
    return execSync("which domains-mcp", { encoding: "utf-8" }).trim();
  } catch {
    return "domains-mcp";
  }
}

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("MCP server management for AI agents");

  mcp
    .command("install")
    .description("Register domains MCP server with Claude Code")
    .option("--project", "Install in project .claude/settings.json instead of global config")
    .action((opts: { project?: boolean }) => {
      const paths = getClaudeConfigPaths();
      const configPath = opts.project ? paths.project : paths.global;
      const binary = getMcpBinaryPath();

      let config: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch { config = {}; }
      }

      const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers[MCP_SERVER_NAME] = { command: binary, args: [] };
      config.mcpServers = mcpServers;

      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`✓ MCP server registered: ${MCP_SERVER_NAME}`);
      console.log(`  Config: ${configPath}`);
      console.log(`  Binary: ${binary}`);
      console.log(`\n  Restart Claude Code to activate.`);
    });

  mcp
    .command("uninstall")
    .description("Remove domains MCP server from Claude Code config")
    .option("--project", "Remove from project config instead of global")
    .action((opts: { project?: boolean }) => {
      const paths = getClaudeConfigPaths();
      const configPath = opts.project ? paths.project : paths.global;

      if (!existsSync(configPath)) {
        console.log("Config file not found — nothing to remove.");
        return;
      }
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
      if (!mcpServers?.[MCP_SERVER_NAME]) {
        console.log(`MCP server '${MCP_SERVER_NAME}' is not registered.`);
        return;
      }
      delete mcpServers[MCP_SERVER_NAME];
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`✓ MCP server removed: ${MCP_SERVER_NAME}`);
    });

  mcp
    .command("status")
    .description("Check if domains MCP server is registered")
    .action(() => {
      const paths = getClaudeConfigPaths();
      for (const [label, configPath] of [["global", paths.global], ["project", paths.project]] as const) {
        if (!existsSync(configPath)) { console.log(`  ${label}: not found`); continue; }
        try {
          const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
          const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
          if (mcpServers?.[MCP_SERVER_NAME]) {
            console.log(`  ${label}: ✓ registered`);
          } else {
            console.log(`  ${label}: ✗ not registered`);
          }
        } catch {
          console.log(`  ${label}: error reading config`);
        }
      }
    });
}
