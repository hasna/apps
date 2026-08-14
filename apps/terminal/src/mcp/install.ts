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
    execSync(`claude mcp add --transport stdio --scope user terminal -- ${bin} mcp serve`, { stdio: ["pipe", "pipe", "pipe"] });
    log("✓", "Claude Code");
    return true;
  } catch {
    // May already exist
    try {
      execSync(`claude mcp remove terminal -s user`, { stdio: ["pipe", "pipe", "pipe"] });
      execSync(`claude mcp add --transport stdio --scope user terminal -- ${bin} mcp serve`, { stdio: ["pipe", "pipe", "pipe"] });
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
    content = content.replace(/\n?\[mcp_servers\.terminal\][^\[]*/g, "");
    content += `\n[mcp_servers.terminal]\ncommand = "${bin}"\nargs = ["mcp", "serve"]\n`;
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
    config.mcpServers["terminal"] = { command: bin, args: ["mcp", "serve"] };
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
  try { execSync(`claude mcp remove terminal -s user`, { stdio: ["pipe", "pipe", "pipe"] }); log("✓", "Removed from Claude Code"); return true; } catch { return false; }
}

function uninstallCodex(): boolean {
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) return false;
  try {
    let content = readFileSync(configPath, "utf8");
    if (!content.includes("terminal")) return false;
    content = content.replace(/\n?\[mcp_servers\.terminal\][^\[]*/g, "");
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
    if (!config.mcpServers?.["terminal"]) return false;
    delete config.mcpServers["terminal"];
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
    console.log("\n  Removing terminal MCP server...\n");
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

  console.log(`\n  terminal — setting up MCP...\n`);

  let count = 0;
  if (installClaude(bin)) count++;
  if (installCodex(bin)) count++;
  if (installGemini(bin)) count++;

  if (count === 0) {
    console.log(`\n  No agents found. Install Claude Code, Codex, or Gemini CLI first.\n`);
  } else {
    console.log(`\n  ${count} agent${count > 1 ? "s" : ""} ready. Restart to apply.\n`);
  }
}

// Re-export individual installers for programmatic use
export { installClaude, installCodex, installGemini, uninstallClaude, uninstallCodex, uninstallGemini };
