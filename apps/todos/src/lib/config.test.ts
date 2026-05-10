import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getSyncAgentsFromConfig,
  getAgentTaskListId,
  getAgentTasksDir,
  getTaskPrefixConfig,
  getAgentPoolForProject,
  getCompletionGuardConfig,
  getRemoteApiConfig,
  normalizeApiUrl,
  resetConfig,
  updateConfig,
} from "./config.js";

// The config module has an in-memory cache. We set up a config file once
// and test the behavior. The cache is a limitation for testing all branches,
// but we can still test the functions with a single config setup.

const testHomeDir = `/tmp/todos-test-config-home-${Date.now()}`;
const configDir = join(testHomeDir, ".hasna", "todos");

beforeAll(() => {
  resetConfig();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    sync_agents: ["alice", "bob"],
    task_list_id: "default-list",
    agent_tasks_dir: "/tmp/agent-tasks",
    task_prefix: { prefix: "TST", start_from: 100 },
    completion_guard: { enabled: true, min_work_seconds: 60 },
    agent_pool: ["pool-agent-1", "pool-agent-2"],
    project_pools: {
      "/home/user/my-project": ["proj-agent-a"],
      "/home/user/other": ["proj-agent-b", "proj-agent-c"],
    },
    project_overrides: {
      "/some/project": {
        completion_guard: { enabled: false, window_minutes: 30 },
      },
    },
    agents: {
      alice: { task_list_id: "alice-list", tasks_dir: "/tmp/alice" },
      bob: { tasks_dir: "/tmp/bob" },
    },
  }));
  process.env["HOME"] = testHomeDir;
});

afterAll(() => {
  rmSync(testHomeDir, { recursive: true, force: true });
  resetConfig();
});

describe("getSyncAgentsFromConfig", () => {
  it("should return normalized sync agents", () => {
    const result = getSyncAgentsFromConfig();
    expect(result).toEqual(["alice", "bob"]);
  });
});

describe("getAgentTaskListId", () => {
  it("should return agent-specific task list", () => {
    expect(getAgentTaskListId("alice")).toBe("alice-list");
  });

  it("should normalize agent name (case insensitive)", () => {
    expect(getAgentTaskListId("ALICE")).toBe("alice-list");
  });

  it("should return default task list id for unknown agent", () => {
    expect(getAgentTaskListId("unknown")).toBe("default-list");
  });

  it("should return null for agent with no task_list_id and no default", () => {
    expect(getAgentTaskListId("bob")).toBe("default-list");
  });
});

describe("getAgentTasksDir", () => {
  it("should return agent-specific tasks dir", () => {
    expect(getAgentTasksDir("alice")).toBe("/tmp/alice");
  });

  it("should return default dir for unknown agent", () => {
    expect(getAgentTasksDir("unknown")).toBe("/tmp/agent-tasks");
  });

  it("should normalize agent name", () => {
    expect(getAgentTasksDir("ALICE")).toBe("/tmp/alice");
  });
});

describe("getTaskPrefixConfig", () => {
  it("should return task prefix config", () => {
    const config = getTaskPrefixConfig();
    expect(config).not.toBeNull();
    expect(config!.prefix).toBe("TST");
    expect(config!.start_from).toBe(100);
  });
});

describe("getAgentPoolForProject", () => {
  it("should return project-specific pool for matching path", () => {
    expect(getAgentPoolForProject("/home/user/my-project/task")).toEqual(["proj-agent-a"]);
  });

  it("should match longest path prefix", () => {
    expect(getAgentPoolForProject("/home/user/other/sub/deep")).toEqual(["proj-agent-b", "proj-agent-c"]);
  });

  it("should return global agent_pool for non-matching path", () => {
    expect(getAgentPoolForProject("/some/other/path")).toEqual(["pool-agent-1", "pool-agent-2"]);
  });

  it("should return global agent_pool when no workingDir matches", () => {
    expect(getAgentPoolForProject()).toEqual(["pool-agent-1", "pool-agent-2"]);
  });

  it("should return global pool when undefined workingDir", () => {
    expect(getAgentPoolForProject(undefined)).toEqual(["pool-agent-1", "pool-agent-2"]);
  });
});

describe("getCompletionGuardConfig", () => {
  it("should return merged global config", () => {
    const config = getCompletionGuardConfig();
    expect(config.enabled).toBe(true);
    expect(config.min_work_seconds).toBe(60);
    expect(config.window_minutes).toBe(10);
    expect(config.cooldown_seconds).toBe(60);
    expect(config.max_completions_per_window).toBe(5);
  });

  it("should return project override when path matches", () => {
    const config = getCompletionGuardConfig("/some/project");
    expect(config.enabled).toBe(false);
    expect(config.window_minutes).toBe(30);
  });

  it("should return defaults for unknown project path (global config applies)", () => {
    const config = getCompletionGuardConfig("/nonexistent/project");
    // Global config has completion_guard: { enabled: true, min_work_seconds: 60 }
    expect(config.enabled).toBe(true);
    expect(config.min_work_seconds).toBe(60);
    expect(config.window_minutes).toBe(10);
  });
});

describe("remote API config", () => {
  it("normalizes hosted API URLs", () => {
    expect(normalizeApiUrl(" https://todos.example/api/// ")).toBe("https://todos.example/api");
    expect(normalizeApiUrl("   ")).toBeNull();
  });

  it("stays local by default when no API URL is configured", () => {
    resetConfig();
    updateConfig({ apiUrl: undefined, apiKey: undefined, mode: undefined });
    const config = getRemoteApiConfig({
      HOME: testHomeDir,
      PATH: process.env["PATH"] || "",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("local");
    expect(config.apiUrl).toBeNull();
  });

  it("uses config apiUrl for remote mode without deleting local config", () => {
    updateConfig({ apiUrl: "https://todos.example/", apiKey: "config-key" });
    const config = getRemoteApiConfig({
      HOME: testHomeDir,
      PATH: process.env["PATH"] || "",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("remote");
    expect(config.apiUrl).toBe("https://todos.example");
    expect(config.apiKey).toBe("config-key");
    expect(config.source.apiUrl).toBe("config");
  });

  it("lets env vars override config values", () => {
    const config = getRemoteApiConfig({
      HOME: testHomeDir,
      PATH: process.env["PATH"] || "",
      TODOS_MODE: "remote",
      TODOS_API_URL: "https://env.todos.example//",
      TODOS_API_KEY: "env-key",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("remote");
    expect(config.apiUrl).toBe("https://env.todos.example");
    expect(config.apiKey).toBe("env-key");
    expect(config.source.apiUrl).toBe("TODOS_API_URL");
    expect(config.source.apiKey).toBe("TODOS_API_KEY");
  });

  it("ignores invalid persisted mode values", () => {
    updateConfig({ mode: "hybrid" as "remote" });
    const config = getRemoteApiConfig({
      HOME: testHomeDir,
      PATH: process.env["PATH"] || "",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("remote");
    expect(config.source.mode).toBe("derived");
  });
});
