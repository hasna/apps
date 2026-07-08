import { afterEach, describe, expect, test } from "bun:test";
import {
  getTodosCloudClient,
  isCloudRouting,
  resetTodosCloudClient,
  cloudListTasks,
  cloudGetTask,
  cloudCreateTask,
  cloudUpdateTask,
  cloudDeleteTask,
  cloudTaskAction,
  cloudRegisterAgent,
  cloudLockTask,
  cloudUnlockTask,
  cloudAddDependency,
  cloudRemoveDependency,
  cloudGetDependencies,
  cloudRecordVerification,
} from "./cloud-router.js";

const CLOUD_ENV = {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.hasna.xyz",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function installFetch(handler: (call: Call) => { status?: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const headers: Record<string, string> = {};
    const h = new Headers(init.headers);
    h.forEach((v, k) => (headers[k] = v));
    const call: Call = {
      url: String(input),
      method: (init.method || "GET").toUpperCase(),
      headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status = 200, body = {} } = handler(call);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

afterEach(() => {
  resetTodosCloudClient();
});

describe("todos client self_hosted resolver", () => {
  test("no env -> local (null client, isCloudRouting false)", () => {
    expect(getTodosCloudClient({})).toBeNull();
    expect(isCloudRouting({})).toBe(false);
  });

  test("self_hosted + API_URL + API_KEY -> cloud-http client at /v1", () => {
    const client = getTodosCloudClient(CLOUD_ENV);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://todos.hasna.xyz/v1");
    expect(isCloudRouting(CLOUD_ENV)).toBe(true);
  });

  test("API_URL + API_KEY WITHOUT a mode var -> local (flip-safety guard)", () => {
    // contracts >=0.5.1 would resolve bare URL+KEY to cloud; the todos guard keeps
    // it local so the flip is only ever armed by an explicit HASNA_TODOS_STORAGE_MODE.
    const noMode = { HASNA_TODOS_API_URL: "https://todos.hasna.xyz", HASNA_TODOS_API_KEY: "k" } as never;
    expect(getTodosCloudClient(noMode)).toBeNull();
    expect(isCloudRouting(noMode)).toBe(false);
  });

  test("mode=cloud + API_URL + API_KEY -> cloud-http client", () => {
    const client = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "cloud",
      HASNA_TODOS_API_URL: "https://todos.hasna.xyz",
      HASNA_TODOS_API_KEY: "hasna_todos_test_key",
    } as never);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://todos.hasna.xyz/v1");
  });

  test("mode=self_hosted but missing API key -> throws (no silent local drift)", () => {
    expect(() =>
      getTodosCloudClient({ HASNA_TODOS_STORAGE_MODE: "self_hosted", HASNA_TODOS_API_URL: "https://todos.hasna.xyz" }),
    ).toThrow();
  });
});

describe("cloud task CRUD maps /v1 envelopes and carries the bearer key", () => {
  test("list -> GET /v1/tasks, unwraps { tasks }", async () => {
    const calls = installFetch(() => ({ body: { tasks: [{ id: "t1", title: "a" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudListTasks(client, { status: "pending", limit: 5 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("t1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("https://todos.hasna.xyz/v1/tasks");
    expect(calls[0]!.url).toContain("status=pending");
    expect(calls[0]!.url).toContain("limit=5");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("get -> GET /v1/tasks/:id, unwraps { task }; 404 -> null", async () => {
    const calls = installFetch((c) =>
      c.url.endsWith("/tasks/missing") ? { status: 404, body: { error: "not found" } } : { body: { task: { id: "t9", title: "z" } } },
    );
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudGetTask(client, "t9");
    expect(task!.id).toBe("t9");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t9");
    const gone = await cloudGetTask(client, "missing");
    expect(gone).toBeNull();
  });

  test("create -> POST /v1/tasks with Idempotency-Key, unwraps { task }", async () => {
    const calls = installFetch(() => ({ status: 201, body: { task: { id: "new1", title: "made" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudCreateTask(client, { title: "made" });
    expect(task.id).toBe("new1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks");
    expect(calls[0]!.body).toEqual({ title: "made" });
    expect(calls[0]!.headers["idempotency-key"]).toBeTruthy();
  });

  test("update -> PATCH /v1/tasks/:id, unwraps { task }", async () => {
    const calls = installFetch(() => ({ body: { task: { id: "t2", title: "patched" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudUpdateTask(client, "t2", { title: "patched" });
    expect(task.title).toBe("patched");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t2");
  });

  test("delete -> DELETE /v1/tasks/:id (204 ok)", async () => {
    const calls = installFetch(() => ({ status: 204 }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudDeleteTask(client, "t3")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t3");
  });

  test("action -> POST /v1/tasks/:id/start, unwraps { task }", async () => {
    const calls = installFetch(() => ({ body: { task: { id: "t4", status: "in_progress" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudTaskAction(client, "t4", "start", { agent_id: "cli" });
    expect(task.status).toBe("in_progress");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t4/start");
  });
});

describe("cloud agent + lock + deps + verification routing (identity/coordination fixes)", () => {
  test("register_agent -> POST /v1/agents, unwraps { agent }, carries bearer key", async () => {
    const calls = installFetch(() => ({ status: 201, body: { agent: { id: "ag1", name: "seneca" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const agent = await cloudRegisterAgent(client, { name: "seneca", description: "worker" });
    expect(agent.id).toBe("ag1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/agents");
    expect(calls[0]!.body).toEqual({ name: "seneca", description: "worker" });
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("register_agent -> a 409 conflict throws (no silent local duplicate)", async () => {
    installFetch(() => ({ status: 409, body: { error: "Agent name 'seneca' is already active", conflict: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudRegisterAgent(client, { name: "seneca" })).rejects.toBeDefined();
  });

  test("lock -> POST /v1/tasks/:id/lock with agent_id, unwraps { result }", async () => {
    const calls = installFetch(() => ({ body: { result: { success: true, locked_by: "cli", locked_at: "2026-01-01T00:00:00Z" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const result = await cloudLockTask(client, "t1", "cli");
    expect(result.success).toBe(true);
    expect(result.locked_by).toBe("cli");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/lock");
    expect(calls[0]!.body).toEqual({ agent_id: "cli" });
  });

  test("unlock -> POST /v1/tasks/:id/unlock, returns success boolean", async () => {
    const calls = installFetch(() => ({ body: { success: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudUnlockTask(client, "t1", "cli")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/unlock");
    expect(calls[0]!.body).toEqual({ agent_id: "cli" });
  });

  test("deps add -> POST /v1/tasks/:id/dependencies, unwraps { dependency }", async () => {
    const calls = installFetch(() => ({ status: 201, body: { dependency: { task_id: "t1", depends_on: "t2" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const dep = await cloudAddDependency(client, "t1", "t2");
    expect(dep.depends_on).toBe("t2");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/dependencies");
    expect(calls[0]!.body).toEqual({ depends_on: "t2" });
  });

  test("deps remove -> DELETE /v1/tasks/:id/dependencies/:dep, returns removed", async () => {
    const calls = installFetch(() => ({ body: { removed: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudRemoveDependency(client, "t1", "t2")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/dependencies/t2");
  });

  test("deps list -> GET /v1/tasks/:id/dependencies, defaults arrays", async () => {
    const calls = installFetch(() => ({ body: { dependencies: [{ task_id: "t1", depends_on: "t2" }], blocked_by: [] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const edges = await cloudGetDependencies(client, "t1");
    expect(edges.dependencies).toHaveLength(1);
    expect(edges.blocked_by).toEqual([]);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/dependencies");
  });

  test("record-verification -> POST /v1/tasks/:id/verifications, unwraps { verification }", async () => {
    const calls = installFetch(() => ({ status: 201, body: { verification: { id: "v1", task_id: "t1", command: "bun test", status: "passed" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const v = await cloudRecordVerification(client, "t1", { command: "bun test", status: "passed" });
    expect(v.status).toBe("passed");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/t1/verifications");
    expect(calls[0]!.body).toEqual({ command: "bun test", status: "passed" });
  });
});
