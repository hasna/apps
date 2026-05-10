import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME, ensureDir, readJsonFile, writeJsonFile } from "./sync-utils.js";

export type TodosMode = "local" | "remote";

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

export interface TodosConfig {
  /** Explicit mode. Defaults to local unless apiUrl/TODOS_API_URL is set. */
  mode?: TodosMode;
  /** Hosted compatible API URL used by remote CLI/SDK mode. */
  apiUrl?: string;
  /** API key for remote API mode. Prefer TODOS_API_KEY for shared machines. */
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

function normalizeMode(value: unknown): TodosMode | null {
  return value === "local" || value === "remote" ? value : null;
}

export interface RemoteApiConfig {
  mode: TodosMode;
  apiUrl: string | null;
  apiKey: string | null;
  source: {
    mode: "env" | "config" | "derived";
    apiUrl: "TODOS_API_URL" | "TODOS_URL" | "config" | "none";
    apiKey: "TODOS_API_KEY" | "config" | "none";
  };
}

export function getRemoteApiConfig(env: NodeJS.ProcessEnv = process.env): RemoteApiConfig {
  const config = loadConfig();
  const envApiUrl = normalizeApiUrl(env["TODOS_API_URL"]);
  const legacyEnvUrl = normalizeApiUrl(env["TODOS_URL"]);
  const configApiUrl = normalizeApiUrl(config.apiUrl);
  const apiUrl = envApiUrl ?? legacyEnvUrl ?? configApiUrl;

  const envMode = normalizeMode(env["TODOS_MODE"]);
  const configMode = normalizeMode(config.mode);
  const mode = envMode ?? configMode ?? (apiUrl ? "remote" : "local");

  const apiKey = env["TODOS_API_KEY"] || config.apiKey || null;

  return {
    mode,
    apiUrl: mode === "remote" ? apiUrl : null,
    apiKey,
    source: {
      mode: envMode ? "env" : configMode ? "config" : "derived",
      apiUrl: envApiUrl ? "TODOS_API_URL" : legacyEnvUrl ? "TODOS_URL" : configApiUrl ? "config" : "none",
      apiKey: env["TODOS_API_KEY"] ? "TODOS_API_KEY" : config.apiKey ? "config" : "none",
    },
  };
}

export function isRemoteMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getRemoteApiConfig(env).mode === "remote";
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
