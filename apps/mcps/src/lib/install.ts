import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { McpServerEntry } from "../types.js";

export type AgentTarget = "claude" | "codex" | "gemini";

export interface InstallResult {
  agent: AgentTarget;
  success: boolean;
  error?: string;
}

/** Install to Claude Code via `claude mcp add` */
function installToClaude(entry: McpServerEntry): InstallResult {
  try {
    const args = [
      "mcp",
      "add",
      "--transport",
      entry.transport,
      "--scope",
      "user",
    ];

    // Add env vars as --env KEY=VALUE pairs (before the --)
    for (const [k, v] of Object.entries(entry.env)) {
      args.push("--env", `${k}=${v}`);
    }

    args.push(entry.id, "--", entry.command, ...entry.args);

    execFileSync("claude", args, { stdio: "pipe" });
    return { agent: "claude", success: true };
  } catch (err) {
    return { agent: "claude", success: false, error: (err as Error).message };
  }
}

/** Install to Codex by appending to ~/.codex/config.toml */
function installToCodex(entry: McpServerEntry): InstallResult {
  try {
    const configDir = join(homedir(), ".codex");
    const configPath = join(configDir, "config.toml");

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const block =
      `\n[mcp_servers.${entry.id}]\n` +
      `command = ${JSON.stringify(entry.command)}\n` +
      `args = [${entry.args.map((a) => JSON.stringify(a)).join(", ")}]\n`;

    const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
    if (existing.includes(`[mcp_servers.${entry.id}]`)) {
      return { agent: "codex", success: true }; // already installed
    }
    writeFileSync(configPath, existing + block, "utf-8");
    return { agent: "codex", success: true };
  } catch (err) {
    return { agent: "codex", success: false, error: (err as Error).message };
  }
}

/** Install to Gemini by updating ~/.gemini/settings.json */
function installToGemini(entry: McpServerEntry): InstallResult {
  try {
    const configDir = join(homedir(), ".gemini");
    const configPath = join(configDir, "settings.json");

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    let settings: any = {};
    if (existsSync(configPath)) {
      settings = JSON.parse(readFileSync(configPath, "utf-8"));
    }
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers[entry.id] = {
      command: entry.command,
      args: entry.args,
      ...(Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
    };
    writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
    return { agent: "gemini", success: true };
  } catch (err) {
    return { agent: "gemini", success: false, error: (err as Error).message };
  }
}

export function installToAgents(
  entry: McpServerEntry,
  targets: AgentTarget[] = ["claude", "codex", "gemini"]
): InstallResult[] {
  return targets.map((target) => {
    if (target === "claude") return installToClaude(entry);
    if (target === "codex") return installToCodex(entry);
    if (target === "gemini") return installToGemini(entry);
    return { agent: target as AgentTarget, success: false, error: "Unknown target" };
  });
}
