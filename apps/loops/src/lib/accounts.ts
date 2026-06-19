import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { AccountRef, AgentProvider } from "../types.js";

const EXPORT_RE = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function accountToolForProvider(provider: AgentProvider): string {
  switch (provider) {
    case "claude":
      return "claude";
    case "cursor":
      return "cursor";
    case "codewith":
      return "codewith";
    case "aicopilot":
      return "aicopilot";
    case "opencode":
      return "opencode";
    case "codex":
      return "codex";
  }
}

function parseExportValue(raw: string): string {
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.replace(/^['"]|['"]$/g, "");
  }
}

export function parseAccountExportLines(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    env[match[1]] = parseExportValue(match[2]);
  }
  return env;
}

function primaryAccountDir(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    return parseExportValue(match[2]);
  }
  return undefined;
}

function accountDirEnvVar(tool: string): string | undefined {
  switch (tool) {
    case "claude":
      return "CLAUDE_CONFIG_DIR";
    case "codex":
    case "codex-app":
      return "CODEX_HOME";
    case "cursor":
      return "CURSOR_CONFIG_DIR";
    case "opencode":
      return "OPENCODE_CONFIG_DIR";
    case "codewith":
      return "CODEWITH_HOME";
    case "aicopilot":
      return "AICOPILOT_CONFIG_DIR";
    default:
      return undefined;
  }
}

export function resolveAccountEnv(
  account: AccountRef | undefined,
  toolHint?: string,
  env?: NodeJS.ProcessEnv,
): Record<string, string> {
  if (!account) return {};
  const tool = account.tool ?? toolHint;
  if (!tool) throw new Error("account.tool is required when no provider tool can be inferred");
  const result = spawnSync("accounts", ["env", account.profile, "--tool", tool], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`failed to run accounts env for ${account.profile}/${tool}: ${result.error.message}`);
  }
  if ((result.status ?? 0) !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`accounts env failed for ${account.profile}/${tool}${stderr ? `: ${stderr}` : ""}`);
  }
  const accountEnv = parseAccountExportLines(result.stdout);
  const profileDir = (accountDirEnvVar(tool) ? accountEnv[accountDirEnvVar(tool)!] : undefined) ?? primaryAccountDir(result.stdout);
  if (!profileDir) throw new Error(`accounts env returned no profile directory for ${account.profile}/${tool}`);
  if (!existsSync(profileDir)) throw new Error(`account profile directory does not exist for ${account.profile}/${tool}: ${profileDir}`);
  return {
    ...accountEnv,
    LOOPS_ACCOUNT_PROFILE: account.profile,
    LOOPS_ACCOUNT_TOOL: tool,
  };
}
