import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { McpServerEntry } from "../types.js";
import { assertLocalCommandConsent, type LocalCommandConsent } from "./local-command-consent.js";
import {
  credentialRefPlaceholders,
  CredentialReferenceError,
  isSecretLikeEnvKey,
  isSecretLikeValue,
} from "./credentials.js";

export type AgentTarget = "claude" | "codex" | "gemini";

export interface InstallResult {
  agent: AgentTarget;
  success: boolean;
  error?: string;
}

export interface InstallToAgentsOptions {
  localCommandConsent?: LocalCommandConsent;
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
    for (const [k, v] of Object.entries(assertAgentInstallEnv(entry))) {
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
    const env = assertAgentInstallEnv(entry);
    settings.mcpServers[entry.id] = {
      command: entry.command,
      args: entry.args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
    writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
    return { agent: "gemini", success: true };
  } catch (err) {
    return { agent: "gemini", success: false, error: (err as Error).message };
  }
}

function assertAgentInstallEnv(entry: McpServerEntry): Record<string, string> {
  const refs = entry.credentialRefs ?? {};
  if (Object.keys(refs).length > 0) {
    throw new CredentialReferenceError(
      `Server "${entry.id}" uses credential references; refusing to materialize secrets into local agent config files`,
    );
  }
  for (const [key, value] of Object.entries(entry.env)) {
    if (isSecretLikeEnvKey(key) || isSecretLikeValue(value)) {
      throw new CredentialReferenceError(
        `Server "${entry.id}" has legacy raw secret-like env "${key}"; move it to a credential reference before installing to agents`,
      );
    }
  }
  return entry.env;
}

export function installToAgents(
  entry: McpServerEntry,
  targets: AgentTarget[] = ["claude", "codex", "gemini"],
  options: InstallToAgentsOptions = {},
): InstallResult[] {
  try {
    assertLocalCommandConsent(
      {
        command: entry.command,
        args: entry.args,
        env: { ...entry.env, ...credentialRefPlaceholders(entry.credentialRefs) },
        transport: entry.transport,
        operation: "install",
      },
      options.localCommandConsent,
    );
  } catch (err) {
    return targets.map((target) => ({
      agent: target,
      success: false,
      error: (err as Error).message,
    }));
  }

  try {
    assertAgentInstallEnv(entry);
  } catch (err) {
    return targets.map((target) => ({
      agent: target,
      success: false,
      error: (err as Error).message,
    }));
  }

  return targets.map((target) => {
    if (target === "claude") return installToClaude(entry);
    if (target === "codex") return installToCodex(entry);
    if (target === "gemini") return installToGemini(entry);
    return { agent: target as AgentTarget, success: false, error: "Unknown target" };
  });
}
