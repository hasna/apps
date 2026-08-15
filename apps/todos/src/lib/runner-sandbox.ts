import { relative, resolve } from "node:path";
import {
  loadConfig,
  saveConfig,
  type RunnerSandboxNetworkPolicy,
  type RunnerSandboxProfile,
  type TodosConfig,
} from "./config.js";
import { checkWorkspacePermission } from "./workspace-trust.js";

export interface UpsertRunnerSandboxInput {
  name: string;
  root?: string;
  command_allowlist?: string[];
  command_denylist?: string[];
  cwd_boundary?: string;
  write_scopes?: string[];
  env_allowlist?: string[];
  env_redactions?: string[];
  network_policy?: RunnerSandboxNetworkPolicy;
  require_approval?: boolean;
  audit_evidence?: boolean;
}

export interface RunnerSandboxCheckInput {
  name?: string;
  path?: string;
  cwd?: string;
  command?: string;
  write_paths?: string[];
  env?: Record<string, string | undefined>;
  network?: boolean;
}

export interface RunnerSandboxCheck {
  allowed: boolean;
  requires_approval: boolean;
  reasons: string[];
  profile: RunnerSandboxProfile;
  redacted_env_keys: string[];
  omitted_env_keys: string[];
  effective_env_keys: string[];
  audit_evidence: {
    sandbox: string;
    root: string;
    cwd: string;
    command?: string;
    write_paths: string[];
    network_requested: boolean;
    network_policy: RunnerSandboxNetworkPolicy;
    allowed: boolean;
    reasons: string[];
  } | null;
}

const DEFAULT_COMMAND_DENYLIST = ["rm -rf", "mkfs", "dd if=", "curl | sh", "wget | sh"];
const DEFAULT_ENV_REDACTIONS = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "AUTH"];

function normalizePath(path: string): string {
  return resolve(path);
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function configuredProfiles(config: TodosConfig = loadConfig()): RunnerSandboxProfile[] {
  return Object.values(config.runner_sandboxes || {})
    .map((profile) => ({
      ...profile,
      root: normalizePath(profile.root),
      cwd_boundary: normalizePath(profile.cwd_boundary || profile.root),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isPathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel));
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(value);
  }
  return value === pattern || value.startsWith(`${pattern} `) || value.includes(pattern);
}

function resolveFromRoot(root: string, path: string): string {
  return normalizePath(path.startsWith("/") ? path : `${root}/${path}`);
}

function defaultProfile(name: string, root: string): RunnerSandboxProfile {
  const normalizedRoot = normalizePath(root);
  return {
    name,
    root: normalizedRoot,
    command_allowlist: ["todos", "git", "bun"],
    command_denylist: DEFAULT_COMMAND_DENYLIST,
    cwd_boundary: normalizedRoot,
    write_scopes: ["."],
    env_allowlist: ["PATH", "HOME", "SHELL", "TMPDIR", "TEMP", "TMP", "CI", "NODE_ENV", "BUN_ENV"],
    env_redactions: DEFAULT_ENV_REDACTIONS,
    network_policy: "none",
    require_approval: true,
    audit_evidence: true,
  };
}

function profileByName(name: string | undefined, path: string): RunnerSandboxProfile {
  const profiles = configuredProfiles();
  if (name) {
    const found = profiles.find((profile) => profile.name === name);
    if (found) return found;
    return defaultProfile(name, path);
  }
  const resolved = normalizePath(path);
  return profiles.find((profile) => isPathInside(profile.root, resolved)) || defaultProfile("default", resolved);
}

function redactedEnvKeys(profile: RunnerSandboxProfile, env: Record<string, string | undefined> | undefined): string[] {
  if (!env) return [];
  const patterns = unique([...DEFAULT_ENV_REDACTIONS, ...profile.env_redactions]).map((item) => item.toUpperCase());
  return Object.keys(env).filter((key) => patterns.some((pattern) => key.toUpperCase().includes(pattern)));
}

function omittedEnvKeys(profile: RunnerSandboxProfile, env: Record<string, string | undefined> | undefined): string[] {
  if (!env) return [];
  if (profile.env_allowlist.includes("*")) return [];
  return Object.keys(env).filter((key) => !profile.env_allowlist.some((pattern) => matchesPattern(key, pattern)));
}

function resolveFromCwd(cwd: string, path: string): string {
  return normalizePath(path.startsWith("/") ? path : `${cwd}/${path}`);
}

function writeAllowed(profile: RunnerSandboxProfile, cwd: string, writePath: string): boolean {
  const target = resolveFromCwd(cwd, writePath);
  return profile.write_scopes.some((scope) => isPathInside(resolveFromRoot(profile.root, scope), target));
}

export function listRunnerSandboxProfiles(): RunnerSandboxProfile[] {
  return configuredProfiles();
}

export function getRunnerSandboxProfile(name: string, path = process.cwd()): RunnerSandboxProfile {
  return profileByName(name, path);
}

export function upsertRunnerSandboxProfile(input: UpsertRunnerSandboxInput): RunnerSandboxProfile {
  const config = loadConfig();
  const existing = config.runner_sandboxes?.[input.name];
  const root = normalizePath(input.root || existing?.root || process.cwd());
  const base = existing || defaultProfile(input.name, root);
  const timestamp = new Date().toISOString();
  const profile: RunnerSandboxProfile = {
    ...base,
    name: input.name,
    root,
    command_allowlist: unique(input.command_allowlist ?? base.command_allowlist),
    command_denylist: unique(input.command_denylist ?? base.command_denylist),
    cwd_boundary: normalizePath(input.cwd_boundary || base.cwd_boundary || root),
    write_scopes: unique(input.write_scopes ?? base.write_scopes),
    env_allowlist: unique(input.env_allowlist ?? base.env_allowlist),
    env_redactions: unique(input.env_redactions ?? base.env_redactions),
    network_policy: input.network_policy || base.network_policy,
    require_approval: input.require_approval ?? base.require_approval,
    audit_evidence: input.audit_evidence ?? base.audit_evidence,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    runner_sandboxes: {
      ...(config.runner_sandboxes || {}),
      [profile.name]: profile,
    },
  });
  return profile;
}

export function removeRunnerSandboxProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.runner_sandboxes?.[name]) return false;
  const next = { ...config.runner_sandboxes };
  delete next[name];
  saveConfig({ ...config, runner_sandboxes: next });
  return true;
}

export function checkRunnerSandbox(input: RunnerSandboxCheckInput = {}): RunnerSandboxCheck {
  const path = normalizePath(input.path || input.cwd || process.cwd());
  const profile = profileByName(input.name, path);
  const cwd = resolveFromRoot(profile.root, input.cwd || profile.root);
  const reasons: string[] = [];
  const writePaths = input.write_paths || [];
  const resolvedWritePaths = writePaths.map((writePath) => resolveFromCwd(cwd, writePath));

  if (!isPathInside(profile.cwd_boundary, cwd)) reasons.push("cwd is outside sandbox boundary");
  if (input.command) {
    if (profile.command_denylist.some((pattern) => matchesPattern(input.command!, pattern))) {
      reasons.push("command matches sandbox denylist");
    } else if (!profile.command_allowlist.some((pattern) => matchesPattern(input.command!, pattern))) {
      reasons.push("command is not in sandbox allowlist");
    }
  }
  for (const writePath of writePaths) {
    if (!writeAllowed(profile, cwd, writePath)) {
      reasons.push(`write path is outside sandbox scopes: ${writePath}`);
    }
  }
  if (input.network && profile.network_policy === "none") {
    reasons.push("network access is disabled by sandbox policy");
  }

  const trustChecks = [
    checkWorkspacePermission({ path: profile.root, command: input.command, env: input.env }),
    ...resolvedWritePaths.map((writePath) => checkWorkspacePermission({ path: profile.root, write_path: writePath })),
  ];
  for (const trust of trustChecks) {
    for (const reason of trust.reasons) reasons.push(`workspace trust: ${reason}`);
  }

  const redacted = redactedEnvKeys(profile, input.env);
  const omitted = omittedEnvKeys(profile, input.env);
  const effective = Object.keys(input.env || {}).filter((key) => !omitted.includes(key));
  const uniqueReasons = unique(reasons);
  const allowed = uniqueReasons.length === 0;
  return {
    allowed,
    requires_approval: !allowed && profile.require_approval,
    reasons: uniqueReasons,
    profile,
    redacted_env_keys: redacted,
    omitted_env_keys: omitted,
    effective_env_keys: effective,
    audit_evidence: profile.audit_evidence ? {
      sandbox: profile.name,
      root: profile.root,
      cwd,
      command: input.command,
      write_paths: writePaths,
      network_requested: Boolean(input.network),
      network_policy: profile.network_policy,
      allowed,
      reasons: uniqueReasons,
    } : null,
  };
}

export function explainRunnerSandbox(input: RunnerSandboxCheckInput = {}): RunnerSandboxCheck {
  return checkRunnerSandbox(input);
}
