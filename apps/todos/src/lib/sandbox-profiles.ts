/**
 * Local runner sandbox profiles — command allowlists, deny patterns, dry-run explain.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const SANDBOX_PROFILE_VERSION = "todos.sandbox-profile.v1";

export interface SandboxProfile {
  name: string;
  version: number;
  description?: string;
  allow_commands: string[];
  deny_commands: string[];
  allow_paths?: string[];
  deny_network?: boolean;
  redact_env_keys?: string[];
}

export interface SandboxCheckInput {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SandboxCheckResult {
  allowed: boolean;
  profile: string;
  violations: string[];
  explanations: string[];
  redacted_env?: Record<string, string>;
}

function getProfilesPath(): string {
  if (process.env["TODOS_SANDBOX_PROFILES_PATH"]) {
    return process.env["TODOS_SANDBOX_PROFILES_PATH"];
  }
  const localDir = join(process.cwd(), ".todos");
  const local = join(localDir, "sandbox-profiles.json");
  if (existsSync(localDir)) return local;
  if (existsSync(local)) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "sandbox-profiles.json");
}

let cached: SandboxProfile[] | null = null;

export function resetSandboxProfileCache(): void {
  cached = null;
}

export function getDefaultSandboxProfiles(): SandboxProfile[] {
  return [
    {
      name: "default",
      version: 1,
      description: "Safe local agent runs",
      allow_commands: ["bun", "npm", "node", "git", "todos", "rg", "grep", "ls", "cat", "echo"],
      deny_commands: ["curl", "wget", "ssh", "scp", "rm -rf /", "sudo"],
      deny_network: true,
      redact_env_keys: ["API_KEY", "SECRET", "TOKEN", "PASSWORD"],
    },
    {
      name: "strict",
      version: 1,
      description: "Minimal command surface",
      allow_commands: ["bun test", "bun run typecheck", "git status", "git diff", "todos"],
      deny_commands: ["curl", "wget", "ssh", "npm publish"],
      deny_network: true,
      redact_env_keys: ["API_KEY", "SECRET", "TOKEN", "PASSWORD", "AWS_"],
    },
  ];
}

export function loadSandboxProfiles(): SandboxProfile[] {
  if (cached) return cached;
  const path = getProfilesPath();
  if (!existsSync(path)) {
    cached = getDefaultSandboxProfiles();
    return cached;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { profiles: SandboxProfile[] };
  cached = parsed.profiles?.length ? parsed.profiles : getDefaultSandboxProfiles();
  return cached;
}

export function getSandboxProfile(name: string): SandboxProfile | null {
  return loadSandboxProfiles().find((p) => p.name === name) ?? null;
}

export function saveSandboxProfiles(profiles: SandboxProfile[]): void {
  const path = getProfilesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema_version: SANDBOX_PROFILE_VERSION, profiles }, null, 2));
  cached = profiles;
}

function commandMatchesAllowlist(command: string, allow: string[]): boolean {
  const bin = command.trim().split(/\s+/)[0] ?? "";
  return allow.some((a) => command.startsWith(a) || bin === a);
}

function commandMatchesDenylist(command: string, deny: string[]): string | null {
  for (const d of deny) {
    if (command.includes(d)) return d;
  }
  return null;
}

export function checkSandboxCommand(
  input: SandboxCheckInput,
  profileName = "default",
  dryRun = false,
): SandboxCheckResult {
  const profile = getSandboxProfile(profileName);
  if (!profile) throw new Error(`Sandbox profile not found: ${profileName}`);

  const violations: string[] = [];
  const explanations: string[] = [];

  if (!commandMatchesAllowlist(input.command, profile.allow_commands)) {
    violations.push(`Command not in allowlist: ${input.command.split(/\s+/)[0]}`);
    explanations.push(`Allowed prefixes: ${profile.allow_commands.join(", ")}`);
  }

  const denied = commandMatchesDenylist(input.command, profile.deny_commands);
  if (denied) {
    violations.push(`Command matches deny pattern: ${denied}`);
  }

  if (profile.deny_network && /\b(curl|wget|fetch|http:\/\/|https:\/\/)\b/i.test(input.command)) {
    violations.push("Network access denied by profile");
  }

  let redacted_env: Record<string, string> | undefined;
  if (input.env && profile.redact_env_keys?.length) {
    redacted_env = { ...input.env };
    for (const key of Object.keys(redacted_env)) {
      if (profile.redact_env_keys.some((r) => key.toUpperCase().includes(r.replace(/_$/, "")))) {
        redacted_env[key] = "[REDACTED]";
      }
    }
  }

  if (dryRun) {
    explanations.push(`Dry-run check for profile '${profileName}'`);
  }

  return {
    allowed: violations.length === 0,
    profile: profileName,
    violations,
    explanations,
    redacted_env,
  };
}
