// MCP installation — one command to rule them all
// `npx @hasna/terminal install` → installs globally + configures all AI agents

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function which(cmd: string): string | null {
  try { return execSync(`which ${cmd}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch { return null; }
}

function log(icon: string, msg: string) { console.log(`  ${icon} ${msg}`); }

// ── Detect what's installed ──────────────────────────────────────────────────

function hasClaude(): boolean { return !!which("claude"); }
function hasCodex(): boolean { return !!which("codex"); }
function hasGemini(): boolean { return !!which("gemini"); }

// ── Install for Claude Code ─────────────────────────────────────────────────

function installClaude(bin: string): boolean {
  if (!hasClaude()) { log("–", "Claude Code not found, skipping"); return false; }
  try {
    execSync(`claude mcp add --transport stdio --scope user open-terminal -- ${bin} mcp serve`, { stdio: ["pipe", "pipe", "pipe"] });
    log("✓", "Claude Code");
    return true;
  } catch {
    // May already exist
    try {
      execSync(`claude mcp remove open-terminal -s user`, { stdio: ["pipe", "pipe", "pipe"] });
      execSync(`claude mcp add --transport stdio --scope user open-terminal -- ${bin} mcp serve`, { stdio: ["pipe", "pipe", "pipe"] });
      log("✓", "Claude Code (updated)");
      return true;
    } catch (e) {
      log("✗", `Claude Code — ${e}`);
      return false;
    }
  }
}

// ── Install for Codex ───────────────────────────────────────────────────────

function installCodex(bin: string): boolean {
  if (!hasCodex()) { log("–", "Codex not found, skipping"); return false; }
  const dir = join(homedir(), ".codex");
  const configPath = join(dir, "config.toml");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    // Remove old entry if exists
    content = content.replace(/\n?\[mcp_servers\.open-terminal\][^\[]*/g, "");
    content += `\n[mcp_servers.open-terminal]\ncommand = "${bin}"\nargs = ["mcp", "serve"]\n`;
    writeFileSync(configPath, content);
    log("✓", "Codex");
    return true;
  } catch (e) {
    log("✗", `Codex — ${e}`);
    return false;
  }
}

// ── Install for Gemini ──────────────────────────────────────────────────────

function installGemini(bin: string): boolean {
  if (!hasGemini()) { log("–", "Gemini CLI not found, skipping"); return false; }
  const dir = join(homedir(), ".gemini");
  const configPath = join(dir, "settings.json");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let config: any = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, "utf8")); } catch {}
    }
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers["open-terminal"] = { command: bin, args: ["mcp", "serve"] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    log("✓", "Gemini CLI");
    return true;
  } catch (e) {
    log("✗", `Gemini — ${e}`);
    return false;
  }
}

// ── Uninstall ───────────────────────────────────────────────────────────────

function uninstallClaude(): boolean {
  if (!hasClaude()) return false;
  try { execSync(`claude mcp remove open-terminal -s user`, { stdio: ["pipe", "pipe", "pipe"] }); log("✓", "Removed from Claude Code"); return true; } catch { return false; }
}

function uninstallCodex(): boolean {
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) return false;
  try {
    let content = readFileSync(configPath, "utf8");
    if (!content.includes("open-terminal")) return false;
    content = content.replace(/\n?\[mcp_servers\.open-terminal\][^\[]*/g, "");
    writeFileSync(configPath, content);
    log("✓", "Removed from Codex");
    return true;
  } catch { return false; }
}

function uninstallGemini(): boolean {
  const configPath = join(homedir(), ".gemini", "settings.json");
  if (!existsSync(configPath)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (!config.mcpServers?.["open-terminal"]) return false;
    delete config.mcpServers["open-terminal"];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    log("✓", "Removed from Gemini CLI");
    return true;
  } catch { return false; }
}

// ── Main install handler ────────────────────────────────────────────────────

export function handleInstall(args: string[]): void {
  const flags = new Set(args);

  // Uninstall
  if (flags.has("uninstall") || flags.has("--uninstall")) {
    console.log("\n  Removing open-terminal MCP server...\n");
    uninstallClaude();
    uninstallCodex();
    uninstallGemini();
    console.log("\n  Done. Restart your agents to apply.\n");
    return;
  }

  // Targeted install
  if (flags.has("--claude") || flags.has("--codex") || flags.has("--gemini")) {
    const bin = which("terminal") ?? which("t") ?? "npx @hasna/terminal";
    console.log("");
    if (flags.has("--claude")) installClaude(bin);
    if (flags.has("--codex")) installCodex(bin);
    if (flags.has("--gemini")) installGemini(bin);
    console.log("");
    return;
  }

  // ── Default: install everything ─────────────────────────────────────────

  const bin = which("terminal") ?? which("t") ?? "npx @hasna/terminal";

  console.log(`
  ┌─────────────────────────────────────┐
  │         open-terminal               │
  │   Smart terminal for AI agents      │
  └─────────────────────────────────────┘

  Setting up MCP server for all agents...
`);

  let count = 0;
  if (installClaude(bin)) count++;
  if (installCodex(bin)) count++;
  if (installGemini(bin)) count++;

  if (count === 0) {
    console.log(`
  No AI agents found. Install one first:

    npm i -g @anthropic-ai/claude-code    # Claude Code
    npm i -g @openai/codex                # Codex
    npm i -g @anthropic-ai/gemini-cli     # Gemini CLI

  Then run: terminal install
`);
  } else {
    console.log(`
  Done. ${count} agent${count > 1 ? "s" : ""} configured.
  Restart your agent to start using open-terminal.

  Your AI agent now has these tools:
    execute_smart   Run any command, get AI-summarized output
    execute_diff    Run command, see only what changed
    search_content  Smart grep with file grouping
    search_files    Find files by pattern
    read_symbol     Read a function by name (not whole file)
    boot            Full project context in one call
    repo_state      Git status + log + diff in one call
`);
  }
}

// Re-export individual installers for programmatic use
export { installClaude, installCodex, installGemini, uninstallClaude, uninstallCodex, uninstallGemini };
