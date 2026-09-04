import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId } from "../db/database.js";
import { registerAgent } from "../db/agents.js";
import { createProject } from "../db/projects.js";
import { createTask, listTasks } from "../db/tasks.js";
import type { Task } from "../types/index.js";
import { applyFocus } from "./index.js";
import { registerTaskCrudTools } from "./tools/task-crud.js";
import { persistIdentity } from "../lib/creator-identity.js";
import { resetConfig } from "../lib/config.js";

// This machine carries LIVE self-hosted credentials in the ambient environment. Without
// scrubbing them the tool routes to the real fleet API instead of the in-memory store —
// the run that discovered this silently attempted writes against production before the
// cloud call failed and the error was swallowed by the tool's own formatError.
const ROUTING_ENV_KEYS = [
  "HASNA_TODOS_STORAGE_MODE",
  "TODOS_STORAGE_MODE",
  "HASNA_TODOS_API_URL",
  "HASNA_TODOS_API_KEY",
  "TODOS_API_URL",
  "TODOS_API_KEY",
] as const;
let originalRoutingEnv: Partial<Record<(typeof ROUTING_ENV_KEYS)[number], string>> = {};

/**
 * The MCP `create_task` tool had no way to express a creator at all — no agent_id
 * parameter, no created_by, nothing. Agents filing through MCP could not be
 * attributed even in principle, which matters because MCP is how several runtimes
 * file most of their tasks.
 *
 * A fix covering the CLI and leaving MCP untouched would look complete and leave the
 * hole open for exactly the callers that use it most, so this path gets its own
 * behavioural coverage rather than riding on the CLI's.
 */

type CapturedTool = {
  description: string;
  schema: Record<string, any>;
  handler: (params: Record<string, any>) => unknown | Promise<unknown>;
};

function captureTools(register: (server: any, ctx: any) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    resource() {},
    tool(name: string, description: string, schemaOrHandler: Record<string, any> | CapturedTool["handler"], maybeHandler?: CapturedTool["handler"]) {
      const schema = typeof schemaOrHandler === "function" ? {} : schemaOrHandler;
      const handler = typeof schemaOrHandler === "function" ? schemaOrHandler : maybeHandler!;
      tools.set(name, { description, schema, handler });
    },
  };
  const ctx = {
    shouldRegisterTool: () => true,
    resolveId: (partialId: string, table = "tasks") => {
      const id = resolvePartialId(getDatabase(), table, partialId);
      if (!id) throw new Error(`Could not resolve ID: ${partialId}`);
      return id;
    },
    formatError: (error: unknown) => JSON.stringify({ code: "TEST_ERROR", message: String(error) }),
    formatTask: (task: Task) => `${task.id.slice(0, 8)} ${task.status} ${task.priority} ${task.title}`,
    formatTaskDetail: (task: Task) => `${task.id} ${task.title}`,
    getAgentFocus: () => undefined,
    applyFocus,
    agentFocusMap: new Map(),
  };
  register(server, ctx);
  return tools;
}

let homeDir = "";
let prevHome: string | undefined;

beforeEach(() => {
  originalRoutingEnv = {};
  for (const key of ROUTING_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) originalRoutingEnv[key] = value;
    delete process.env[key];
  }
  process.env["TODOS_DB_PATH"] = ":memory:";
  homeDir = mkdtempSync(join(tmpdir(), "todos-mcp-identity-"));
  prevHome = process.env["HOME"];
  process.env["HOME"] = homeDir;
  delete process.env["TODOS_AGENT_ID"];
  delete process.env["HASNA_TODOS_AGENT_ID"];
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  for (const key of ROUTING_ENV_KEYS) {
    const value = originalRoutingEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (prevHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = prevHome;
  delete process.env["TODOS_AGENT_ID"];
  rmSync(homeDir, { recursive: true, force: true });
});

function createTool() {
  return captureTools(registerTaskCrudTools).get("create_task")!;
}

function onlyTask(title: string): Task {
  const match = listTasks({}, getDatabase()).find((t) => t.title === title);
  expect(match).toBeDefined();
  return match!;
}

describe("MCP create_task records the filer", () => {
  it("exposes created_by and unassigned parameters at all", () => {
    const tool = createTool();
    expect(tool.schema["created_by"]).toBeDefined();
    expect(tool.schema["unassigned"]).toBeDefined();
  });

  it("attributes to the ambient identity from the environment", async () => {
    process.env["TODOS_AGENT_ID"] = "cassius";
    await createTool().handler({ title: "mcp env identity" });
    expect(onlyTask("mcp env identity").created_by).toBe("cassius");
  });

  it("does NOT attribute to the identity `todos init` persisted — it names the station, not the caller (todos task 9090972e)", async () => {
    // This used to assert the opposite. `the todos data root/identity.json` is
    // keyed on $HOME and shared by every agent session on the station, so
    // "attributing" to it is exactly the misrouting #142 already refused for
    // assigned_to/agent_id. Measured live 2026-08-03/04 on station01's hosted
    // store: 489 real rows carrying a station-shared name as created_by that
    // never filed them. created_by must be unattributable (null) here, same
    // as assigned_to/agent_id, unless a PROCESS-BOUND identity (--agent /
    // TODOS_AGENT_ID / an explicit created_by param) is given.
    persistIdentity({ agent_id: "uuid", agent_name: "cassius" });
    await createTool().handler({ title: "mcp persisted identity" });
    expect(onlyTask("mcp persisted identity").created_by).toBeNull();
  });

  // Regression: MCP was the SECOND DOOR onto the same defect (todos task 64131fb1),
  // and created_by was a THIRD DOOR left open on both CLI and MCP after #142
  // closed the first two (assigned_to, agent_id) — see
  // src/cli/ambient-identity-misrouting.test.ts (todos task 9090972e) for the
  // measured evidence that falsified the "inert on the hosted path" premise
  // #142 shipped it under.
  it("does not ROUTE to the persisted identity, and no longer attributes to it either", async () => {
    persistIdentity({ agent_id: "uuid", agent_name: "cassius" });
    await createTool().handler({ title: "mcp persisted must not route" });
    const task = onlyTask("mcp persisted must not route");
    expect(task.created_by).not.toBe("cassius");
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).not.toBe("cassius");
    expect(task.agent_id).not.toBe("cassius");
  });

  it("does not stamp agent_id from the persisted identity when an assignee IS given", async () => {
    persistIdentity({ agent_id: "uuid", agent_name: "cassius" });
    await createTool().handler({ title: "mcp persisted with assignee", assigned_to: "brutus" });
    const task = onlyTask("mcp persisted with assignee");
    expect(task.assigned_to).toBe("brutus");
    expect(task.agent_id).not.toBe("cassius");
  });

  it("still routes from a PROCESS-bound identity, which cannot leak between sessions", async () => {
    persistIdentity({ agent_id: "uuid", agent_name: "cassius" });
    process.env["TODOS_AGENT_ID"] = "brutus";
    await createTool().handler({ title: "mcp env routes" });
    const task = onlyTask("mcp env routes");
    expect(task.assigned_to).toBe("brutus");
    expect(task.created_by).toBe("brutus");
  });

  it("prefers an explicit created_by parameter", async () => {
    process.env["TODOS_AGENT_ID"] = "cassius";
    await createTool().handler({ title: "mcp explicit", created_by: "brutus" });
    expect(onlyTask("mcp explicit").created_by).toBe("brutus");
  });

  it("records the filer even when assigning to someone else", async () => {
    process.env["TODOS_AGENT_ID"] = "cassius";
    await createTool().handler({ title: "mcp routed", assigned_to: "brutus" });
    const task = onlyTask("mcp routed");
    expect(task.created_by).toBe("cassius");
    expect(task.assigned_to).toBe("brutus");
  });
});

describe("MCP create_task applies focus", () => {
  it("uses the caller's focus project when create_task omits project_id", async () => {
    const project = createProject({ name: "Focused project", path: "/tmp/focused-project" });
    registerAgent({ name: "cassius", session_id: "focus-session", project_id: project.id });
    process.env["TODOS_AGENT_ID"] = "cassius";

    await createTool().handler({ title: "mcp focused task" });

    expect(onlyTask("mcp focused task").project_id).toBe(project.id);
  });

  it("sends the caller's focus project to the HTTP authority", async () => {
    const project = createProject({ name: "Remote focused project", path: "/tmp/remote-focused-project" });
    const explicitProject = createProject({ name: "Explicit remote project", path: "/tmp/explicit-remote-project" });
    registerAgent({ name: "cassius", session_id: "remote-focus-session", project_id: project.id });
    process.env["TODOS_AGENT_ID"] = "cassius";
    process.env["HASNA_TODOS_API_URL"] = "https://todos.example.test";
    process.env["HASNA_TODOS_API_KEY"] = "nonsecret-test-value";

    const responseTask = createTask({ title: "remote response" });
    const postedBodies: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init = {}) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      postedBodies.push(body);
      return new Response(JSON.stringify({ task: { ...responseTask, ...body } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await createTool().handler({ title: "remote focused task" });
      await createTool().handler({ title: "explicit remote task", project_id: explicitProject.id });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(postedBodies).toHaveLength(2);
    expect(postedBodies[0]?.["project_id"]).toBe(project.id);
    expect(postedBodies[1]?.["project_id"]).toBe(explicitProject.id);
  });
});

describe("MCP create_task makes an unassigned task deliberate", () => {
  it("defaults the assignee to the filer", async () => {
    process.env["TODOS_AGENT_ID"] = "cassius";
    await createTool().handler({ title: "mcp default assignee" });
    expect(onlyTask("mcp default assignee").assigned_to).toBe("cassius");
  });

  it("leaves it ownerless when unassigned is passed, but still attributed", async () => {
    process.env["TODOS_AGENT_ID"] = "cassius";
    await createTool().handler({ title: "mcp deliberate", unassigned: true });
    const task = onlyTask("mcp deliberate");
    expect(task.assigned_to).toBeNull();
    expect(task.created_by).toBe("cassius");
  });

  it("leaves both null when nothing identifies the caller", async () => {
    await createTool().handler({ title: "mcp anonymous" });
    const task = onlyTask("mcp anonymous");
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).toBeNull();
  });
});

describe("MCP list_tasks can express the inbox query", () => {
  it("filters to work assigned to me that a different agent filed", async () => {
    const tools = captureTools(registerTaskCrudTools);
    const create = tools.get("create_task")!;
    await create.handler({ title: "routed to me", created_by: "brutus", assigned_to: "cassius" });
    await create.handler({ title: "my own note", created_by: "cassius", assigned_to: "cassius" });

    const listTool = tools.get("list_tasks")!;
    expect(listTool.schema["created_by"]).toBeDefined();
    expect(listTool.schema["not_created_by"]).toBeDefined();

    const inbox = listTasks({ assigned_to: "cassius", not_created_by: "cassius" }, getDatabase());
    expect(inbox.map((t) => t.title)).toEqual(["routed to me"]);
  });
});
