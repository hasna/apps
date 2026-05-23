/**
 * Local workspace trust and permission profiles — no hosted auth.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const WORKSPACE_TRUST_VERSION = 1;

export const PERMISSION_OPERATIONS = [
  "task:read",
  "task:write",
  "task:delete",
  "task:complete",
  "project:write",
  "command:run",
  "file:write",
  "export:data",
  "admin",
] as const;
export type PermissionOperation = (typeof PERMISSION_OPERATIONS)[number];

export interface WorkspaceTrustProfile {
  name: string;
  description?: string;
  allow: PermissionOperation[];
  deny?: PermissionOperation[];
  trusted_paths?: string[];
}

export interface WorkspaceTrustConfig {
  version: number;
  default_profile: string;
  trusted_workspaces: string[];
  profiles: WorkspaceTrustProfile[];
  agent_profiles?: Record<string, string>;
}

export class WorkspacePermissionError extends Error {
  constructor(
    public operation: PermissionOperation,
    public profile: string,
    message?: string,
  ) {
    super(message ?? `Operation '${operation}' denied for profile '${profile}'`);
    this.name = "WorkspacePermissionError";
  }
}

function getConfigPath(): string {
  if (process.env["TODOS_WORKSPACE_TRUST_PATH"]) {
    return process.env["TODOS_WORKSPACE_TRUST_PATH"];
  }
  const local = join(process.cwd(), ".todos", "workspace-trust.json");
  if (existsSync(local)) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "workspace-trust.json");
}

let cached: WorkspaceTrustConfig | null = null;

export function resetWorkspaceTrustCache(): void {
  cached = null;
}

export function getDefaultWorkspaceTrustProfiles(): WorkspaceTrustProfile[] {
  return [
    {
      name: "read_only",
      description: "Read tasks and projects only",
      allow: ["task:read", "export:data"],
      deny: ["task:write", "task:delete", "command:run", "file:write", "admin"],
    },
    {
      name: "agent_safe",
      description: "Agent-safe task workflow without destructive ops",
      allow: ["task:read", "task:write", "task:complete", "export:data", "command:run"],
      deny: ["task:delete", "project:write", "file:write", "admin"],
    },
    {
      name: "admin",
      description: "Full local workspace access",
      allow: [...PERMISSION_OPERATIONS],
    },
  ];
}

export function getDefaultWorkspaceTrustConfig(): WorkspaceTrustConfig {
  return {
    version: WORKSPACE_TRUST_VERSION,
    default_profile: "agent_safe",
    trusted_workspaces: [],
    profiles: getDefaultWorkspaceTrustProfiles(),
  };
}

export function loadWorkspaceTrustConfig(): WorkspaceTrustConfig {
  if (cached) return cached;
  const path = getConfigPath();
  if (!existsSync(path)) {
    cached = getDefaultWorkspaceTrustConfig();
    return cached;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkspaceTrustConfig;
  cached = {
    ...getDefaultWorkspaceTrustConfig(),
    ...parsed,
    profiles: parsed.profiles?.length ? parsed.profiles : getDefaultWorkspaceTrustProfiles(),
  };
  return cached;
}

export function saveWorkspaceTrustConfig(config: WorkspaceTrustConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
  cached = config;
}

export function getWorkspaceTrustProfile(name?: string): WorkspaceTrustProfile {
  const config = loadWorkspaceTrustConfig();
  const profileName = name ?? config.default_profile;
  const profile = config.profiles.find((p) => p.name === profileName);
  if (!profile) throw new Error(`Workspace trust profile not found: ${profileName}`);
  return profile;
}

export function getAgentTrustProfile(agentId?: string): WorkspaceTrustProfile {
  const config = loadWorkspaceTrustConfig();
  const mapped = agentId ? config.agent_profiles?.[agentId] : undefined;
  return getWorkspaceTrustProfile(mapped ?? config.default_profile);
}

export function isWorkspaceTrusted(cwd?: string): boolean {
  const config = loadWorkspaceTrustConfig();
  const dir = cwd || process.cwd();
  if (config.trusted_workspaces.length === 0) return true;
  return config.trusted_workspaces.some((p) => dir.startsWith(p));
}

export function checkPermission(
  operation: PermissionOperation,
  options: { profile?: string; agent_id?: string; cwd?: string } = {},
): { allowed: boolean; profile: string; reason?: string } {
  if (!isWorkspaceTrusted(options.cwd)) {
    return { allowed: false, profile: options.profile ?? "unknown", reason: "Workspace is not trusted" };
  }

  const profile = options.profile
    ? getWorkspaceTrustProfile(options.profile)
    : getAgentTrustProfile(options.agent_id);

  if (profile.deny?.includes(operation)) {
    return { allowed: false, profile: profile.name, reason: `Denied by profile '${profile.name}'` };
  }

  if (profile.allow.includes("admin") || profile.allow.includes(operation)) {
    return { allowed: true, profile: profile.name };
  }

  return { allowed: false, profile: profile.name, reason: `Operation '${operation}' not in allow list` };
}

export function assertPermission(
  operation: PermissionOperation,
  options: { profile?: string; agent_id?: string; cwd?: string } = {},
): void {
  const result = checkPermission(operation, options);
  if (!result.allowed) {
    throw new WorkspacePermissionError(operation, result.profile, result.reason);
  }
}

export function trustWorkspace(path: string): WorkspaceTrustConfig {
  const config = loadWorkspaceTrustConfig();
  const resolved = path.trim();
  if (!config.trusted_workspaces.includes(resolved)) {
    config.trusted_workspaces.push(resolved);
    saveWorkspaceTrustConfig(config);
  }
  return config;
}

export function untrustWorkspace(path: string): WorkspaceTrustConfig {
  const config = loadWorkspaceTrustConfig();
  config.trusted_workspaces = config.trusted_workspaces.filter((p) => p !== path.trim());
  saveWorkspaceTrustConfig(config);
  return config;
}
