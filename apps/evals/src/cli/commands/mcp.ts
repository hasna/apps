import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export function mcpCommand(): Command {
  return new Command("mcp")
    .description("MCP server management")
    .addCommand(new Command("--claude").description("Register evals-mcp with Claude Code").action(registerClaude))
    .addCommand(new Command("start").description("Start MCP server (stdio)").action(() => {
      // Exec the MCP server
      const { spawnSync } = require("child_process");
      spawnSync(process.execPath, [join(import.meta.dir, "../../mcp/index.js")], { stdio: "inherit" });
    }));
}

function registerClaude() {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  }

  const mcpServers = (settings["mcpServers"] ?? {}) as Record<string, unknown>;
  mcpServers["evals"] = { command: "evals-mcp", args: [] };
  settings["mcpServers"] = mcpServers;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("\x1b[32m✓ Registered evals-mcp in ~/.claude/settings.json\x1b[0m");
  console.log("  Restart Claude Code to load the new MCP server.");
}
