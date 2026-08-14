import { relative, resolve } from "node:path";
import {
  loadConfig,
  saveConfig,
  type TodosConfig,
  type WorkspacePermissionPreset,
  type WorkspaceTrustProfile,
} from "./config.js";

export interface UpsertWorkspaceTrustInput {
  root: string;
  trusted?: boolean;
  preset?: WorkspacePermissionPreset;
  command_allowlist?: string[];
  command_denylist?: string[];
  tool_permissions?: string[];
  write_scopes?: string[];
  env_redactions?: string[];
  require_prompt_for_unsafe?: boolean;
}

export interface WorkspaceTrustStatus {
  root: string;
  trusted: boolean;
  matched_root: string | null;
  profile: WorkspaceTrustProfile;
}

export interface WorkspacePermissionCheckInput {
  path?: string;
  command?: string;
  tool?: string;
  write_path?: string;
  env?: Record<string, string | undefined>;
}

export interface WorkspacePermissionCheck {
  allowed: boolean;
  requires_prompt: boolean;
  reasons: string[];
  status: WorkspaceTrustStatus;
  redacted_env_keys: string[];
}

const DEFAULT_DENYLIST = ["rm -rf", "mkfs", "dd if=", "curl | sh", "wget | sh"];
const DEFAULT_ENV_REDACTIONS = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "AUTH"];

const PRESET_DEFAULTS: Record<WorkspacePermissionPreset, Omit<WorkspaceTrustProfile, "root" | "created_at" | "updated_at">> = {
  restricted: {
    trusted: false,
    preset: "restricted",
    command_allowlist: ["todos"],
    command_denylist: DEFAULT_DENYLIST,
    tool_permissions: ["read"],
    write_scopes: [],
    env_redactions: DEFAULT_ENV_REDACTIONS,
    require_prompt_for_unsafe: true,
  },
  readonly: {
    trusted: false,
    preset: "readonly",
    command_allowlist: ["todos", "git status", "git diff", "bun test"],
    command_denylist: DEFAULT_DENYLIST,
    tool_permissions: ["read", "list", "search"],
    write_scopes: [],
    env_redactions: DEFAULT_ENV_REDACTIONS,
    require_prompt_for_unsafe: true,
  },
  standard: {
    trusted: true,
    preset: "standard",
    command_allowlist: ["todos", "git", "bun", "rg"],
    command_denylist: DEFAULT_DENYLIST,
    tool_permissions: ["read", "write", "test", "mcp"],
    write_scopes: ["."],
    env_redactions: DEFAULT_ENV_REDACTIONS,
    require_prompt_for_unsafe: true,
  },
  trusted: {
    trusted: true,
    preset: "trusted",
    command_allowlist: ["*"],
    command_denylist: DEFAULT_DENYLIST,
    tool_permissions: ["*"],
    write_scopes: ["."],
    env_redactions: DEFAULT_ENV_REDACTIONS,
    require_prompt_for_unsafe: false,
  },
};

function normalizePath(path: string): string {
  return resolve(path);
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function defaultProfile(root: string, preset: WorkspacePermissionPreset): WorkspaceTrustProfile {
  return {
    root,
    ...PRESET_DEFAULTS[preset],
  };
}

function configuredProfiles(config: TodosConfig = loadConfig()): WorkspaceTrustProfile[] {
  return Object.values(config.workspace_trust || {})
    .map((profile) => ({ ...profile, root: normalizePath(profile.root) }))
    .sort((a, b) => b.root.length - a.root.length);
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

function profileFor(path: string): { profile: WorkspaceTrustProfile; matchedRoot: string | null } {
  const resolved = normalizePath(path);
  for (const profile of configuredProfiles()) {
    if (isPathInside(profile.root, resolved)) return { profile, matchedRoot: profile.root };
  }
  return { profile: defaultProfile(resolved, "restricted"), matchedRoot: null };
}

export function listWorkspaceTrustProfiles(): WorkspaceTrustProfile[] {
  return configuredProfiles();
}

export function getWorkspaceTrustStatus(path = process.cwd()): WorkspaceTrustStatus {
  const root = normalizePath(path);
  const { profile, matchedRoot } = profileFor(root);
  return {
    root,
    trusted: profile.trusted,
    matched_root: matchedRoot,
    profile,
  };
}

export function upsertWorkspaceTrustProfile(input: UpsertWorkspaceTrustInput): WorkspaceTrustProfile {
  const root = normalizePath(input.root);
  const config = loadConfig();
  const existing = config.workspace_trust?.[root];
  const preset = input.preset || existing?.preset || "standard";
  const presetChanged = Boolean(existing && input.preset && input.preset !== existing.preset);
  const base = presetChanged ? defaultProfile(root, preset) : existing || defaultProfile(root, preset);
  const timestamp = new Date().toISOString();
  const profile: WorkspaceTrustProfile = {
    ...base,
    ...PRESET_DEFAULTS[preset],
    root,
    preset,
    trusted: input.trusted ?? base.trusted ?? PRESET_DEFAULTS[preset].trusted,
    command_allowlist: unique(input.command_allowlist ?? base.command_allowlist ?? PRESET_DEFAULTS[preset].command_allowlist),
    command_denylist: unique(input.command_denylist ?? base.command_denylist ?? PRESET_DEFAULTS[preset].command_denylist),
    tool_permissions: unique(input.tool_permissions ?? base.tool_permissions ?? PRESET_DEFAULTS[preset].tool_permissions),
    write_scopes: unique(input.write_scopes ?? base.write_scopes ?? PRESET_DEFAULTS[preset].write_scopes),
    env_redactions: unique(input.env_redactions ?? base.env_redactions ?? PRESET_DEFAULTS[preset].env_redactions),
    require_prompt_for_unsafe: input.require_prompt_for_unsafe ?? base.require_prompt_for_unsafe ?? PRESET_DEFAULTS[preset].require_prompt_for_unsafe,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    workspace_trust: {
      ...(config.workspace_trust || {}),
      [root]: profile,
    },
  });
  return profile;
}

export function removeWorkspaceTrustProfile(root: string): boolean {
  const normalized = normalizePath(root);
  const config = loadConfig();
  if (!config.workspace_trust?.[normalized]) return false;
  const next = { ...config.workspace_trust };
  delete next[normalized];
  saveConfig({ ...config, workspace_trust: next });
  return true;
}

function writeAllowed(profile: WorkspaceTrustProfile, root: string, writePath: string): boolean {
  const target = normalizePath(writePath.startsWith("/") ? writePath : `${root}/${writePath}`);
  return profile.write_scopes.some((scope) => {
    const scopeRoot = normalizePath(scope.startsWith("/") ? scope : `${root}/${scope}`);
    return isPathInside(scopeRoot, target);
  });
}

function redactedEnvKeys(profile: WorkspaceTrustProfile, env: Record<string, string | undefined> | undefined): string[] {
  if (!env) return [];
  const patterns = unique([...DEFAULT_ENV_REDACTIONS, ...profile.env_redactions]).map((item) => item.toUpperCase());
  return Object.keys(env).filter((key) => patterns.some((pattern) => key.toUpperCase().includes(pattern)));
}

export function checkWorkspacePermission(input: WorkspacePermissionCheckInput = {}): WorkspacePermissionCheck {
  const status = getWorkspaceTrustStatus(input.path || process.cwd());
  const reasons: string[] = [];
  const profile = status.profile;

  if (!status.matched_root) reasons.push("workspace is not trusted");
  if (input.command) {
    if (profile.command_denylist.some((pattern) => matchesPattern(input.command!, pattern))) {
      reasons.push("command matches denylist");
    } else if (!profile.command_allowlist.some((pattern) => matchesPattern(input.command!, pattern))) {
      reasons.push("command is not in allowlist");
    }
  }
  if (input.tool && !profile.tool_permissions.some((permission) => matchesPattern(input.tool!, permission))) {
    reasons.push("tool permission is not allowed");
  }
  if (input.write_path && !writeAllowed(profile, status.matched_root || status.root, input.write_path)) {
    reasons.push("write path is outside allowed scopes");
  }

  const redacted = redactedEnvKeys(profile, input.env);
  const allowed = reasons.length === 0;
  return {
    allowed,
    requires_prompt: !allowed && profile.require_prompt_for_unsafe,
    reasons,
    status,
    redacted_env_keys: redacted,
  };
}
