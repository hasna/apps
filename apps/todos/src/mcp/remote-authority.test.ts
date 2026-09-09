import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REMOTE_API_CONFIG_MISSING,
  RemoteApiConfigMissingError,
  requireTodosCloudClient,
} from "./remote-authority.js";
import { formatError } from "./index.js";
import { registerTaskProjectTools } from "./tools/task-project-tools.js";

const ROUTING_KEYS = [
  "HASNA_TODOS_LOCAL",
  "TODOS_LOCAL",
  "HASNA_TODOS_API_URL",
  "HASNA_TODOS_API_KEY",
  "TODOS_API_URL",
  "TODOS_API_KEY",
  "HASNA_API_URL",
  "HASNA_API_KEY",
  "HASNA_STATION",
  "HOME",
] as const;

const savedEnv: Partial<Record<(typeof ROUTING_KEYS)[number], string | undefined>> = {};
for (const key of ROUTING_KEYS) savedEnv[key] = process.env[key];

function setEnv(vars: Partial<Record<(typeof ROUTING_KEYS)[number], string>>): void {
  for (const key of ROUTING_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
}

const tempHomes: string[] = [];

afterEach(() => {
  for (const key of ROUTING_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of tempHomes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolatedHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-remote-authority-"));
  tempHomes.push(dir);
  return dir;
}

type CapturedTool = { handler: (params: Record<string, any>) => Promise<{ content: { text: string }[]; isError?: boolean }> };

function captureTools(): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    resource() {},
    tool(name: string, _description: string, schemaOrHandler: any, maybeHandler?: any) {
      const handler = typeof schemaOrHandler === "function" ? schemaOrHandler : maybeHandler;
      tools.set(name, { handler });
    },
  };
  registerTaskProjectTools(server as any, {
    shouldRegisterTool: () => true,
    resolveId: (partialId: string) => partialId,
    formatError,
    formatTask: (task: any) => `${task.id} ${task.title}`,
    formatTaskDetail: (task: any) => `${task.id} ${task.title}`,
    getAgentFocus: () => undefined,
  });
  return tools;
}

describe("RemoteApiConfigMissingError", () => {
  test("carries the CLI's REMOTE_API_CONFIG_MISSING code and an actionable suggestion", () => {
    const error = new RemoteApiConfigMissingError("Plan");
    expect(error.code).toBe(REMOTE_API_CONFIG_MISSING);
    expect(error.message).toStartWith(`${REMOTE_API_CONFIG_MISSING}: Plan tools require the authenticated Todos API`);
    expect(error.suggestion).toContain("HASNA_TODOS_API_URL");
    expect(error.suggestion).toContain("HASNA_TODOS_API_KEY");
  });

  test("formatError returns the typed code, message and suggestion instead of UNKNOWN_ERROR", () => {
    const formatted = JSON.parse(formatError(new RemoteApiConfigMissingError("Task-list")));
    expect(formatted.code).toBe(REMOTE_API_CONFIG_MISSING);
    expect(formatted.message).toContain("Task-list tools require the authenticated Todos API");
    expect(formatted.suggestion).toContain("HASNA_TODOS_API_URL");
    expect(formatted.code).not.toBe("UNKNOWN_ERROR");
  });
});

describe("requireTodosCloudClient", () => {
  test("local opt-in fails closed with the typed, actionable error instead of a null client", () => {
    setEnv({ HASNA_TODOS_LOCAL: "1", HOME: isolatedHome() });
    let thrown: unknown;
    try {
      requireTodosCloudClient("Plan");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RemoteApiConfigMissingError);
    const error = thrown as RemoteApiConfigMissingError;
    expect(error.code).toBe(REMOTE_API_CONFIG_MISSING);
    expect(error.message).toContain("HASNA_TODOS_LOCAL");
    expect(error.message).toContain("require the authenticated Todos API");
  });

  test("an unresolvable credential preserves the CLI's REMOTE_API_* code and detail", () => {
    setEnv({ HOME: isolatedHome(), HASNA_STATION: `mcp-remote-authority-${randomUUID()}` });
    let thrown: unknown;
    try {
      requireTodosCloudClient("Task-list");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RemoteApiConfigMissingError);
    const error = thrown as RemoteApiConfigMissingError;
    expect(error.code).toMatch(/^REMOTE_API_[A-Z_]+$/);
    expect(error.message).toStartWith(`${error.code}: Task-list tools require the authenticated Todos API`);
    expect(error.suggestion).toContain("HASNA_TODOS_API_URL");
  });
});

describe("plan and task-list MCP tools in local mode", () => {
  for (const [tool, params] of [
    ["list_plans", {}],
    ["list_task_lists", {}],
    ["get_plan", { plan_id: "missing" }],
    ["get_task_list", { task_list_id: "missing" }],
    ["create_plan", { name: "probe" }],
  ] as const) {
    test(`${tool} returns the typed REMOTE_API_CONFIG_MISSING payload, not UNKNOWN_ERROR`, async () => {
      setEnv({ HASNA_TODOS_LOCAL: "1", HOME: isolatedHome() });
      const result = await captureTools().get(tool)!.handler(params as Record<string, any>);
      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.code).toBe(REMOTE_API_CONFIG_MISSING);
      expect(payload.code).not.toBe("UNKNOWN_ERROR");
      expect(payload.suggestion).toContain("HASNA_TODOS_API_URL");
    });
  }

  test("tools with a genuine local path still answer locally (no error-shape regression)", async () => {
    setEnv({ HASNA_TODOS_LOCAL: "1", HOME: isolatedHome() });
    const result = await captureTools().get("list_projects")!.handler({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("No projects found.");
  });
});
