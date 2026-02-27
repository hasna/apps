import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOME, readJsonFile } from "./sync-utils.js";

export interface AgentConfig {
  task_list_id?: string;
  tasks_dir?: string;
}

export interface TaskPrefixConfig {
  prefix: string;       // e.g. "ALM" → produces "ALM-00001: Task Name"
  start_from?: number;  // starting number, defaults to 1
}

export interface TodosConfig {
  sync_agents?: string[] | string;
  task_list_id?: string;
  agent_tasks_dir?: string;
  agents?: Record<string, AgentConfig>;
  task_prefix?: TaskPrefixConfig;
}

const CONFIG_PATH = join(HOME, ".todos", "config.json");
let cached: TodosConfig | null = null;

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase();
}

export function loadConfig(): TodosConfig {
  if (cached) return cached;
  if (!existsSync(CONFIG_PATH)) {
    cached = {};
    return cached;
  }
  const config = readJsonFile<TodosConfig>(CONFIG_PATH) || {};
  if (typeof config.sync_agents === "string") {
    config.sync_agents = config.sync_agents.split(",").map((a) => a.trim()).filter(Boolean);
  }
  cached = config;
  return cached;
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
