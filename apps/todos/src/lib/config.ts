import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME, ensureDir, readJsonFile, writeJsonFile } from "./sync-utils.js";

export interface AgentConfig {
  task_list_id?: string;
  tasks_dir?: string;
}

export interface TaskPrefixConfig {
  prefix: string;       // e.g. "ALM" → produces "ALM-00001: Task Name"
  start_from?: number;  // starting number, defaults to 1
}

export interface CompletionGuardConfig {
  enabled?: boolean;
  min_work_seconds?: number;
  max_completions_per_window?: number;
  window_minutes?: number;
  cooldown_seconds?: number;
}

export interface ProjectOverrideConfig {
  completion_guard?: CompletionGuardConfig;
}

export type WorkspacePermissionPreset = "restricted" | "readonly" | "standard" | "trusted";
export type RunnerSandboxNetworkPolicy = "none" | "local" | "full";

export interface WorkspaceTrustProfile {
  root: string;
  trusted: boolean;
  preset: WorkspacePermissionPreset;
  command_allowlist: string[];
  command_denylist: string[];
  tool_permissions: string[];
  write_scopes: string[];
  env_redactions: string[];
  require_prompt_for_unsafe: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface RunnerSandboxProfile {
  name: string;
  root: string;
  command_allowlist: string[];
  command_denylist: string[];
  cwd_boundary: string;
  write_scopes: string[];
  env_allowlist: string[];
  env_redactions: string[];
  network_policy: RunnerSandboxNetworkPolicy;
  require_approval: boolean;
  audit_evidence: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AgentRunAdapterConfig {
  name: string;
  command: string;
  sandbox?: string;
  cwd?: string;
  env?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export type VerificationProviderKind = "command" | "testbox" | "ci_log" | "browser" | "script";

export interface VerificationProviderRetryConfig {
  attempts?: number;
  backoff_ms?: number;
}

export interface VerificationProviderConfig {
  name: string;
  kind: VerificationProviderKind;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  capabilities?: string[];
  retry?: VerificationProviderRetryConfig;
  timeout_ms?: number;
  created_at?: string;
  updated_at?: string;
}

export type LocalExtensionInstallStatus = "trusted" | "needs_review" | "incompatible";

export interface LocalExtensionManifest {
  schema_version?: number;
  name: string;
  version: string;
  description?: string;
  compatibility?: {
    todos?: string;
  };
  permissions?: string[];
  commands?: Array<{ name: string; command?: string; description?: string; permissions?: string[]; write_paths?: string[]; env?: string[]; network?: boolean }>;
  mcp_tools?: Array<{ name: string; description?: string; permissions?: string[] }>;
  hooks?: string[];
  checksum?: string;
  signature?: string;
  public_key?: string;
}

export interface LocalExtensionRecord {
  name: string;
  version: string;
  source: string;
  source_type: "manifest" | "directory" | "bundle";
  manifest: LocalExtensionManifest;
  checksum: string;
  signature_verified: boolean;
  trusted: boolean;
  status: LocalExtensionInstallStatus;
  warnings: string[];
  diagnostics?: Record<string, unknown>;
  installed_at: string;
  updated_at?: string;
}

export interface PolicyPackConfig {
  name: string;
  version: number;
  root: string;
  required_commands: string[];
  prohibited_commands: string[];
  prohibited_paths: string[];
  required_statuses: string[];
  require_passed_verification: boolean;
  require_commit: boolean;
  require_pull_request: boolean;
  require_approval: boolean;
  require_run: boolean;
  require_artifact: boolean;
  evidence_min_count: number;
  branch_pattern?: string;
  created_at?: string;
  updated_at?: string;
}

export type LocalEventHookTarget = "stdout" | "file" | "socket" | "script";

export interface LocalEventHookRetryConfig {
  attempts?: number;
  backoff_ms?: number;
}

export interface LocalEventHookConfig {
  name: string;
  enabled: boolean;
  events: string[];
  target: LocalEventHookTarget;
  file_path?: string;
  socket_path?: string;
  command?: string;
  cwd?: string;
  sandbox?: string;
  env?: Record<string, string>;
  retry?: LocalEventHookRetryConfig;
  created_at?: string;
  updated_at?: string;
}

export type TerminalNotificationSeverity = "info" | "warning" | "critical";
export type TerminalNotificationFormat = "line" | "json";

export interface TerminalNotificationRuleConfig {
  name: string;
  enabled: boolean;
  events: string[];
  min_severity: TerminalNotificationSeverity;
  format: TerminalNotificationFormat;
  bell: boolean;
  task_statuses?: string[];
  priorities?: string[];
  agent_ids?: string[];
  project_ids?: string[];
  contains?: string[];
  created_at?: string;
  updated_at?: string;
}

export type LocalEncryptionAlgorithm = "aes-256-gcm";
export type LocalEncryptionKdf = "scrypt";

export interface LocalEncryptionProfileConfig {
  name: string;
  algorithm: LocalEncryptionAlgorithm;
  kdf: LocalEncryptionKdf;
  key_env: string;
  salt: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SecretSafetyConfig {
  /** Additional local regex patterns to redact from comments, evidence, and exports. */
  redaction_patterns?: string[];
  /** Additional metadata/object key names whose values should be fully redacted. */
  redaction_keys?: string[];
}

export interface TodosConfig {
  /** Local HTTP server URL used by SDK clients. Defaults to http://localhost:19427. */
  apiUrl?: string;
  /** API key for the local HTTP server when local API keys are enabled. */
  apiKey?: string;
  sync_agents?: string[] | string;
  task_list_id?: string;
  agent_tasks_dir?: string;
  agents?: Record<string, AgentConfig>;
  task_prefix?: TaskPrefixConfig;
  completion_guard?: CompletionGuardConfig;
  project_overrides?: Record<string, ProjectOverrideConfig>;
  /** Global pool of allowed agent names. Used when no project-specific pool matches. */
  agent_pool?: string[];
  /** Per-project agent name pools, keyed by working directory path prefix. */
  project_pools?: Record<string, string[]>;
  /** Local workspace trust profiles, keyed by absolute project root. */
  workspace_trust?: Record<string, WorkspaceTrustProfile>;
  /** Local runner sandbox profiles, keyed by profile name. */
  runner_sandboxes?: Record<string, RunnerSandboxProfile>;
  /** Local agent run adapters, keyed by adapter name. */
  agent_run_adapters?: Record<string, AgentRunAdapterConfig>;
  /** Optional local verification provider adapters, keyed by provider name. */
  verification_providers?: Record<string, VerificationProviderConfig>;
  /** Local extension registry entries, keyed by extension name. */
  extension_registry?: Record<string, LocalExtensionRecord>;
  /** Local policy packs for task done gates, keyed by pack name. */
  policy_packs?: Record<string, PolicyPackConfig>;
  /** Local event hooks and automation triggers, keyed by hook name. */
  local_event_hooks?: Record<string, LocalEventHookConfig>;
  /** Local terminal notification watch rules, keyed by rule name. */
  terminal_notification_rules?: Record<string, TerminalNotificationRuleConfig>;
  /** Local encryption profiles. Profiles store key references and nonsecret KDF salt only. */
  encryption_profiles?: Record<string, LocalEncryptionProfileConfig>;
  /** Local secret safety settings for offline redaction and export scanning. */
  secret_safety?: SecretSafetyConfig;
}

function getTodosGlobalDir(): string {
  const home = process.env["HOME"] || HOME;
  const newDir = join(home, ".hasna", "todos");
  const legacyDir = join(home, ".todos");
  // Prefer legacy dir if it has the config file and new dir doesn't
  const newConfig = join(newDir, "config.json");
  const legacyConfig = join(legacyDir, "config.json");
  if (!existsSync(newConfig) && existsSync(legacyConfig)) return legacyDir;
  return newDir;
}

export function getConfigPath(): string {
  return join(getTodosGlobalDir(), "config.json");
}
let cached: TodosConfig | null = null;

export function resetConfig() {
  cached = null;
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase();
}

export function loadConfig(): TodosConfig {
  if (cached) return cached;
  if (!existsSync(getConfigPath())) {
    cached = {};
    return cached;
  }
  const config = readJsonFile<TodosConfig>(getConfigPath()) || {};
  if (typeof config.sync_agents === "string") {
    config.sync_agents = config.sync_agents.split(",").map((a) => a.trim()).filter(Boolean);
  }
  cached = config;
  return cached;
}

export function saveConfig(config: TodosConfig): TodosConfig {
  const configPath = getConfigPath();
  ensureDir(dirname(configPath));
  writeJsonFile(configPath, config);
  cached = config;
  return config;
}

export function updateConfig(patch: Partial<TodosConfig>): TodosConfig {
  return saveConfig({ ...loadConfig(), ...patch });
}

export function normalizeApiUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export interface LocalApiConfig {
  apiUrl: string | null;
  apiKey: string | null;
  source: {
    apiUrl: "TODOS_URL" | "config" | "none";
    apiKey: "TODOS_API_KEY" | "config" | "none";
  };
}

export function getLocalApiConfig(env: NodeJS.ProcessEnv = process.env): LocalApiConfig {
  const config = loadConfig();
  const envApiUrl = normalizeApiUrl(env["TODOS_URL"]);
  const configApiUrl = normalizeApiUrl(config.apiUrl);
  const apiUrl = envApiUrl ?? configApiUrl;

  const apiKey = env["TODOS_API_KEY"] || config.apiKey || null;

  return {
    apiUrl,
    apiKey,
    source: {
      apiUrl: envApiUrl ? "TODOS_URL" : configApiUrl ? "config" : "none",
      apiKey: env["TODOS_API_KEY"] ? "TODOS_API_KEY" : config.apiKey ? "config" : "none",
    },
  };
}

export function getSyncAgentsFromConfig(): string[] | null {
  const config = loadConfig();
  const agents = config.sync_agents;
  if (Array.isArray(agents) && agents.length > 0) return agents.map(normalizeAgent);
  return null;
}

export function getAgentTaskListId(agent: string): string | null {
  const config = loadConfig();
  const key = normalizeAgent(agent);
  return config.agents?.[key]?.task_list_id
    || config.task_list_id
    || null;
}

export function getAgentTasksDir(agent: string): string | null {
  const config = loadConfig();
  const key = normalizeAgent(agent);
  return config.agents?.[key]?.tasks_dir
    || config.agent_tasks_dir
    || null;
}

export function getTaskPrefixConfig(): TaskPrefixConfig | null {
  const config = loadConfig();
  return config.task_prefix || null;
}

const GUARD_DEFAULTS: Required<CompletionGuardConfig> = {
  enabled: false,
  min_work_seconds: 30,
  max_completions_per_window: 5,
  window_minutes: 10,
  cooldown_seconds: 60,
};

/**
 * Get the agent name pool for a given working directory.
 * Checks project_pools for the longest matching path prefix, then falls back
 * to agent_pool. Returns null if no pool is configured (no name restriction).
 */
export function getAgentPoolForProject(workingDir?: string): string[] | null {
  const config = loadConfig();

  if (workingDir && config.project_pools) {
    // Find the longest matching path prefix
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const key of Object.keys(config.project_pools)) {
      if (workingDir.startsWith(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey && config.project_pools[bestKey]) {
      return config.project_pools[bestKey]!;
    }
  }

  return config.agent_pool || null;
}

export function getCompletionGuardConfig(projectPath?: string | null): Required<CompletionGuardConfig> {
  const config = loadConfig();
  const global = { ...GUARD_DEFAULTS, ...config.completion_guard };

  if (projectPath && config.project_overrides?.[projectPath]?.completion_guard) {
    return { ...global, ...config.project_overrides[projectPath].completion_guard };
  }

  return global;
}
