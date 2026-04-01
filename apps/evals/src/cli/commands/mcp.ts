import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export function mcpCommand(): Command {
  const cmd = new Command("mcp")
    .description("MCP server management");

  cmd.addCommand(
    new Command("register")
      .description("Register evals-mcp with an agent (Claude Code, Codex, Gemini)")
      .option("--claude", "Register with Claude Code (~/.claude/mcp.json)")
      .option("--codex", "Register with Codex (~/.codex/config.json)")
      .option("--gemini", "Register with Gemini (~/.gemini/settings.json)")
      .option("--all", "Register with all agents")
      .action((opts: { claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }) => {
        if (opts.claude || opts.all) registerClaude();
        if (opts.codex || opts.all) registerCodex();
        if (opts.gemini || opts.all) registerGemini();
        if (!opts.claude && !opts.codex && !opts.gemini && !opts.all) {
          // default: register with Claude
          registerClaude();
        }
      })
  );

  cmd.addCommand(
    new Command("start")
      .description("Start MCP server (stdio)")
      .action(() => {
        const { spawnSync } = require("child_process");
        spawnSync(process.execPath, [join(import.meta.dir, "../../mcp/index.js")], { stdio: "inherit" });
      })
  );

  return cmd;
}

const ENTRY = { command: "/home/hasna/.bun/bin/evals-mcp", args: [] };

function registerClaude() {
  // Claude Code uses ~/.claude/mcp.json (not settings.json)
  const mcpPath = join(homedir(), ".claude", "mcp.json");
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    config = JSON.parse(readFileSync(mcpPath, "utf8")) as typeof config;
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), evals: ENTRY };
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
  console.log("\x1b[32m✓ Registered evals-mcp in ~/.claude/mcp.json\x1b[0m");
  console.log("  Restart Claude Code to load the new MCP server.");
}

function registerCodex() {
  const cfgPath = join(homedir(), ".codex", "config.json");
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(cfgPath)) {
    config = JSON.parse(readFileSync(cfgPath, "utf8")) as typeof config;
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), evals: { type: "stdio", ...ENTRY, env: {} } };
  writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  console.log("\x1b[32m✓ Registered evals-mcp in ~/.codex/config.json\x1b[0m");
}

function registerGemini() {
  const cfgPath = join(homedir(), ".gemini", "settings.json");
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(cfgPath)) {
    config = JSON.parse(readFileSync(cfgPath, "utf8")) as typeof config;
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), evals: ENTRY };
  writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  console.log("\x1b[32m✓ Registered evals-mcp in ~/.gemini/settings.json\x1b[0m");
}
