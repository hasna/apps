// MCP installation helper — register open-terminal as MCP server for various agents

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const TERMINAL_BIN = "terminal"; // the CLI binary name

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function installClaude(): boolean {
  try {
    execSync(
      `claude mcp add --transport stdio --scope user open-terminal -- ${which(TERMINAL_BIN) ?? "npx"} ${which(TERMINAL_BIN) ? "mcp serve" : "@hasna/terminal mcp serve"}`,
      { stdio: "inherit" }
    );
    console.log("✓ Installed open-terminal MCP server for Claude Code");
    return true;
  } catch (e) {
    console.error("Failed to install for Claude Code:", e);
    return false;
  }
}

export function installCodex(): boolean {
  const configPath = join(homedir(), ".codex", "config.toml");
  try {
    let content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    if (content.includes("[mcp_servers.open-terminal]")) {
      console.log("✓ open-terminal already configured for Codex");
      return true;
    }
    const bin = which(TERMINAL_BIN) ?? "npx @hasna/terminal";
    content += `\n[mcp_servers.open-terminal]\ncommand = "${bin}"\nargs = ["mcp", "serve"]\n`;
    writeFileSync(configPath, content);
    console.log("✓ Installed open-terminal MCP server for Codex");
    return true;
  } catch (e) {
    console.error("Failed to install for Codex:", e);
    return false;
  }
}

export function installGemini(): boolean {
  const configPath = join(homedir(), ".gemini", "settings.json");
  try {
    let config: any = {};
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    }
    if (!config.mcpServers) config.mcpServers = {};
    const bin = which(TERMINAL_BIN) ?? "npx";
    const args = which(TERMINAL_BIN) ? ["mcp", "serve"] : ["@hasna/terminal", "mcp", "serve"];
    config.mcpServers["open-terminal"] = { command: bin, args };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("✓ Installed open-terminal MCP server for Gemini");
    return true;
  } catch (e) {
    console.error("Failed to install for Gemini:", e);
    return false;
  }
}

export function installAll(): void {
  installClaude();
  installCodex();
  installGemini();
}

export function handleMcpInstall(args: string[]): void {
  const flags = new Set(args);

  if (flags.has("--all")) { installAll(); return; }
  if (flags.has("--claude")) { installClaude(); return; }
  if (flags.has("--codex")) { installCodex(); return; }
  if (flags.has("--gemini")) { installGemini(); return; }

  console.log("Usage: t mcp install [--claude|--codex|--gemini|--all]");
  console.log("");
  console.log("Install open-terminal as an MCP server for AI coding agents.");
  console.log("");
  console.log("Options:");
  console.log("  --claude    Install for Claude Code");
  console.log("  --codex     Install for OpenAI Codex");
  console.log("  --gemini    Install for Gemini CLI");
  console.log("  --all       Install for all agents");
}
