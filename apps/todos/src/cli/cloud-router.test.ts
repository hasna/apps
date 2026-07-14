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
  cloudAddComment,
  cloudListComments,
  cloudRegisterAgent,
  cloudLockTask,
  cloudUnlockTask,
  cloudAddDependency,
  cloudRemoveDependency,
  cloudGetDependencies,
  cloudRecordVerification,
  cloudActiveWork,
  cloudStaleTasks,
  cloudOverdueTasks,
  cloudEscalatedTasks,
  cloudChangedSince,
  cloudTaskStats,
  cloudRecentActivity,
  cloudListTaskLists,
  cloudNextTask,
  cloudAllDependencies,
  cloudBlockingDepsMap,
  cloudRecap,
  cloudTimeline,
  cloudCreateTaskList,
  cloudDeleteTaskList,
  cloudResolveTaskListRef,
} from "./cloud-router.js";

const CLOUD_ENV = {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.hasna.xyz",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

let previousFetch: typeof globalThis.fetch | undefined;

function installFetch(handler: (call: Call) => { status?: number; body?: unknown }): Call[] {
  previousFetch ??= globalThis.fetch;
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
  if (previousFetch) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }
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

  test("comments -> validates the envelope, count, method, auth, and encoded task path", async () => {
    const comment = {
      id: "c1",
      task_id: "task/with ? reserved",
      agent_id: null,
      session_id: null,
      content: "safe comment",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    const calls = installFetch(() => ({ body: { comments: [comment], count: 1, has_more: false, next_cursor: null } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudListComments(client, comment.task_id)).resolves.toEqual({
      comments: [comment],
      count: 1,
      has_more: false,
      next_cursor: null,
      limit: 100,
      pagination_supported: true,
    });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/tasks/task%2Fwith%20%3F%20reserved/comments?limit=100");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("comment write responses are redacted before JSON callers can emit them", async () => {
    const rawComment = {
      id: "c-write",
      task_id: "t-write",
      agent_id: null,
      session_id: null,
      content: "Bearer abcdefghijklmnop should redact",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    installFetch(() => ({ status: 201, body: { comment: rawComment } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const comment = await cloudAddComment(client, rawComment.task_id, { content: rawComment.content });
    expect(comment.content).toContain("[REDACTED]");
    expect(comment.content).not.toContain("abcdefghijklmnop");
  });

  test("comments accepts the legacy bare-array response", async () => {
    const comment = {
      id: "c2",
      task_id: "t2",
      agent_id: null,
      session_id: null,
      content: "legacy response",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    installFetch(() => ({ body: [comment] }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListComments(client, "t2")).resolves.toEqual({
      comments: [comment],
      count: 1,
      has_more: false,
      next_cursor: null,
      limit: 100,
      pagination_supported: false,
    });
  });

  test("comments exposes bounded cursor pagination without silently consuming every page", async () => {
    const comment = {
      id: "c-page",
      task_id: "t-page",
      agent_id: null,
      session_id: null,
      content: "newest page",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    const calls = installFetch(() => ({
      body: { comments: [comment], count: 1, has_more: true, next_cursor: "opaque-next" },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudListComments(client, "t-page", { limit: 25, cursor: "opaque-current" });
    expect(page).toMatchObject({
      count: 1,
      has_more: true,
      next_cursor: "opaque-next",
      limit: 25,
      pagination_supported: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://todos.hasna.xyz/v1/tasks/t-page/comments?limit=25&cursor=opaque-current",
    );
  });

  test("comments fails closed on malformed or internally inconsistent 2xx responses", async () => {
    const malformed = [
      null,
      {},
      { comments: null },
      { comments: [{}], count: 1 },
      { comments: [], count: 1 },
      { comments: [], count: 0, has_more: false },
      { comments: [], count: 0, next_cursor: null },
      { comments: [], count: 0, has_more: true, next_cursor: null },
      { comments: [], count: 0, has_more: false, next_cursor: "unexpected" },
    ];
    for (const body of malformed) {
      resetTodosCloudClient();
      installFetch(() => ({ body }));
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudListComments(client, "t3")).rejects.toThrow(/invalid cloud comments.*response/i);
    }
  });

  test("comments rejects invalid limits and paginated server pages larger than requested", async () => {
    const client = getTodosCloudClient(CLOUD_ENV)!;
    for (const limit of [0, 501, 1.5, Number.NaN]) {
      await expect(cloudListComments(client, "t-limit", { limit })).rejects.toThrow(/limit/i);
    }
    for (const cursor of ["", "a".repeat(1_025)]) {
      await expect(cloudListComments(client, "t-limit", { cursor })).rejects.toThrow(/cursor/i);
    }

    resetTodosCloudClient();
    installFetch(() => ({ body: { comments: [
      { id: "c1", task_id: "t-limit", agent_id: null, session_id: null, content: "one", type: "comment", progress_pct: null, created_at: "2026-07-10T00:00:00.000Z" },
      { id: "c2", task_id: "t-limit", agent_id: null, session_id: null, content: "two", type: "comment", progress_pct: null, created_at: "2026-07-10T00:00:01.000Z" },
    ], count: 2, has_more: false, next_cursor: null } }));
    await expect(cloudListComments(getTodosCloudClient(CLOUD_ENV)!, "t-limit", { limit: 1 }))
      .rejects.toThrow(/exceeds requested limit/i);
  });

  test("comments caps an unpaginated predecessor response and explicitly reports legacy truncation", async () => {
    const comments = Array.from({ length: 150 }, (_, index) => ({
      id: `legacy-${String(index).padStart(3, "0")}`,
      task_id: "t-legacy",
      agent_id: null,
      session_id: null,
      content: `legacy ${index}`,
      type: "comment" as const,
      progress_pct: null,
      created_at: `2026-07-10T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    }));
    const calls = installFetch(() => ({ body: { comments, count: comments.length } }));
    const page = await cloudListComments(getTodosCloudClient(CLOUD_ENV)!, "t-legacy", { limit: 100 });
    expect(page.comments).toHaveLength(100);
    expect(page.comments[0]!.id).toBe("legacy-050");
    expect(page).toMatchObject({
      count: 100,
      has_more: true,
      next_cursor: null,
      limit: 100,
      pagination_supported: false,
    });
    expect(calls).toHaveLength(1);
  });

  test("comments gives an actionable compatibility error for an older server and propagates 5xx", async () => {
    for (const status of [404, 405]) {
      resetTodosCloudClient();
      installFetch(() => ({ status, body: { error: "unsupported" } }));
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudListComments(client, "t4")).rejects.toThrow(/compatible.*server|server.*compatible/i);
    }

    resetTodosCloudClient();
    installFetch(() => ({ status: 500, body: { error: "failed" } }));
    const retryingClient = getTodosCloudClient(CLOUD_ENV)!;
    try {
      await cloudListComments(retryingClient, "t4");
      throw new Error("expected cloudListComments to reject");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(500);
    }
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

describe("cloud read/analytics routing reads the shared cloud dataset", () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  test("active work -> GET /v1/tasks?status=in_progress, priority-sorted", async () => {
    const calls = installFetch(() => ({
      body: {
        tasks: [
          { id: "a", title: "low", priority: "low", status: "in_progress", updated_at: iso(1000) },
          { id: "b", title: "crit", priority: "critical", status: "in_progress", updated_at: iso(5000) },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const work = await cloudActiveWork(client, {});
    expect(work.map((t) => t.id)).toEqual(["b", "a"]);
    expect(calls[0]!.url).toContain("/v1/tasks");
    expect(calls[0]!.url).toContain("status=in_progress");
  });

  test("stale tasks -> in_progress older than threshold", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "fresh", status: "in_progress", updated_at: iso(60 * 1000), locked_at: null },
          { id: "stale", status: "in_progress", updated_at: iso(60 * 60 * 1000), locked_at: null },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudStaleTasks(client, 30, {});
    expect(tasks.map((t) => t.id)).toEqual(["stale"]);
  });

  test("overdue tasks -> active tasks past due_at", async () => {
    installFetch((c) => {
      const status = c.url.includes("status=pending") ? "pending" : "in_progress";
      return {
        body: {
          tasks:
            status === "pending"
              ? [
                  { id: "overdue", status: "pending", due_at: iso(24 * 60 * 60 * 1000) },
                  { id: "future", status: "pending", due_at: new Date(Date.now() + 8.64e7).toISOString() },
                ]
              : [],
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudOverdueTasks(client);
    expect(tasks.map((t) => t.id)).toEqual(["overdue"]);
  });

  test("escalated tasks -> overdue and sla_breached reasons", async () => {
    installFetch((c) => ({
      body: {
        tasks: c.url.includes("status=pending")
          ? [{ id: "od", status: "pending", due_at: iso(60 * 60 * 1000), created_at: iso(9e7) }]
          : [{ id: "sla", status: "in_progress", sla_minutes: 1, started_at: iso(60 * 60 * 1000), created_at: iso(9e7) }],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const esc = await cloudEscalatedTasks(client, {});
    const byId = Object.fromEntries(esc.map((e) => [e.task.id, e.reasons]));
    expect(byId["od"]).toEqual(["overdue"]);
    expect(byId["sla"]).toEqual(["sla_breached"]);
  });

  test("changed-since -> filters updated_at > since", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "new", updated_at: iso(1000) },
          { id: "old", updated_at: iso(48 * 60 * 60 * 1000) },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const since = iso(24 * 60 * 60 * 1000);
    const tasks = await cloudChangedSince(client, since);
    expect(tasks.map((t) => t.id)).toEqual(["new"]);
  });

  test("task stats -> counts by status/priority/agent from cloud", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "1", status: "completed", priority: "high", assigned_to: "julius" },
          { id: "2", status: "pending", priority: "low", assigned_to: null, agent_id: "cato" },
          { id: "3", status: "completed", priority: "high", assigned_to: "julius" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const stats = await cloudTaskStats(client, {});
    expect(stats.total).toBe(3);
    expect(stats.by_status["completed"]).toBe(2);
    expect(stats.by_priority["high"]).toBe(2);
    expect(stats.by_agent["julius"]).toBe(2);
    expect(stats.completion_rate).toBe(67);
  });

  test("recent activity -> GET /v1/activity?limit, unwraps { activity }", async () => {
    const calls = installFetch(() => ({ body: { activity: [{ id: "h1", task_id: "t1", action: "create", created_at: iso(0) }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const entries = await cloudRecentActivity(client, 30);
    expect(entries).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("/v1/activity");
    expect(calls[0]!.url).toContain("limit=30");
  });

  test("task lists -> GET /v1/task-lists?project_id, unwraps { task_lists }", async () => {
    const calls = installFetch(() => ({ body: { task_lists: [{ id: "tl1", name: "Backlog", slug: "backlog" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const lists = await cloudListTaskLists(client, "proj1");
    expect(lists).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1/task-lists");
    expect(calls[0]!.url).toContain("project_id=proj1");
  });

  test("next -> GET /v1/next, unwraps { task }; empty -> null", async () => {
    const calls = installFetch((c) =>
      c.url.includes("agent=julius") ? { body: { task: { id: "best", title: "do this" } } } : { body: { task: null } },
    );
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudNextTask(client, "julius", { project_id: "p1" });
    expect(task!.id).toBe("best");
    expect(calls[0]!.url).toContain("/v1/next");
    expect(calls[0]!.url).toContain("agent=julius");
    expect(calls[0]!.url).toContain("project_id=p1");
    const none = await cloudNextTask(client);
    expect(none).toBeNull();
  });

  test("all dependencies -> GET /v1/dependencies, unwraps { dependencies }", async () => {
    const calls = installFetch(() => ({ body: { dependencies: [{ task_id: "a", depends_on: "b" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const edges = await cloudAllDependencies(client);
    expect(edges).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://todos.hasna.xyz/v1/dependencies");
  });

  test("blocking deps map -> incomplete blockers only", async () => {
    installFetch((c) => {
      if (c.url.endsWith("/dependencies")) {
        return { body: { dependencies: [{ task_id: "cand", depends_on: "done" }, { task_id: "cand", depends_on: "open" }] } };
      }
      if (c.url.endsWith("/tasks/done")) return { body: { task: { id: "done", status: "completed", title: "done" } } };
      if (c.url.endsWith("/tasks/open")) return { body: { task: { id: "open", status: "pending", title: "open" } } };
      return { body: { task: null } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const map = await cloudBlockingDepsMap(client, [{ id: "cand" } as never]);
    expect(map.get("cand")!.map((t) => t.id)).toEqual(["open"]);
  });

  test("recap -> completed/created/in_progress/stale/blocked/agents from cloud", async () => {
    installFetch((c) => {
      if (c.url.endsWith("/agents")) {
        return { body: { agents: [{ id: "ag1", name: "julius", last_seen_at: iso(60 * 1000) }] } };
      }
      if (c.url.endsWith("/dependencies")) return { body: { dependencies: [] } };
      // /v1/tasks (list, no status filter)
      return {
        body: {
          tasks: [
            { id: "c1", status: "completed", completed_at: iso(60 * 1000), started_at: iso(60 * 60 * 1000), created_at: iso(60 * 60 * 1000), assigned_to: "ag1", title: "done" },
            { id: "p1", status: "in_progress", updated_at: iso(1000), created_at: iso(90 * 60 * 1000), assigned_to: "ag1", title: "wip" },
            { id: "s1", status: "in_progress", updated_at: iso(60 * 60 * 1000), created_at: iso(90 * 60 * 1000), title: "stuck" },
          ],
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const recap = await cloudRecap(client, 8);
    expect(recap.completed.map((t) => t.id)).toEqual(["c1"]);
    expect(recap.completed[0]!.duration_minutes).toBe(59);
    expect(recap.in_progress.map((t) => t.id).sort()).toEqual(["p1", "s1"]);
    expect(recap.stale.map((t) => t.id)).toEqual(["s1"]);
    expect(recap.agents[0]!.name).toBe("julius");
    expect(recap.agents[0]!.completed_count).toBe(1);
  });

  test("timeline -> maps /v1/activity to entries, honors order + since", async () => {
    installFetch(() => ({
      body: {
        activity: [
          { id: "h1", task_id: "t1", action: "create", agent_id: "julius", created_at: iso(60 * 60 * 1000), field: null },
          { id: "h2", task_id: "t2", action: "complete", agent_id: null, created_at: iso(1000), field: "status", old_value: "pending", new_value: "completed" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudTimeline(client, { order: "desc", limit: 10 });
    expect(page.total).toBe(2);
    expect(page.entries[0]!.task_id).toBe("t2");
    expect(page.entries[0]!.event_type).toBe("complete");
    expect(page.entries[0]!.message).toContain("status");
  });

  test("timeline -> non-task entity filter yields no rows (cloud degradation)", async () => {
    installFetch(() => ({ body: { activity: [{ id: "h1", task_id: "t1", action: "create", created_at: iso(0) }] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudTimeline(client, { entity_type: "project", entity_id: "p1" });
    expect(page.total).toBe(0);
  });
});

describe("cloud task-list, filter, and force-unlock parity", () => {
  test("list forwards task-list, parent, and multi-status filters", async () => {
    const calls = installFetch(() => ({ body: { tasks: [] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await cloudListTasks(client, {
      task_list_id: "list-1",
      parent_id: "parent-1",
      status: ["pending", "in_progress"],
    });
    expect(calls[0]!.url).toContain("task_list_id=list-1");
    expect(calls[0]!.url).toContain("parent_id=parent-1");
    expect(calls[0]!.url).toContain("status=pending%2Cin_progress");
  });

  test("task-list create/delete and slug/prefix resolution use /v1/task-lists", async () => {
    const calls = installFetch((call) => {
      if (call.method === "POST") {
        return { status: 201, body: { task_list: { id: "12345678-full", slug: "todos-open-emails", name: "Open Emails" } } };
      }
      if (call.method === "DELETE") return { status: 204 };
      return { body: { task_lists: [{ id: "12345678-full", slug: "todos-open-emails", name: "Open Emails" }] } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudCreateTaskList(client, { name: "Open Emails", slug: "todos-open-emails" }))
      .resolves.toMatchObject({ id: "12345678-full" });
    await expect(cloudResolveTaskListRef(client, "todos-open-emails")).resolves.toBe("12345678-full");
    await expect(cloudResolveTaskListRef(client, "12345678")).resolves.toBe("12345678-full");
    await expect(cloudDeleteTaskList(client, "12345678-full")).resolves.toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/task-lists"))).toBe(true);
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/v1/task-lists/12345678-full"))).toBe(true);
  });

  test("force unlock sends an explicit force flag instead of spoofing the lock holder", async () => {
    const calls = installFetch(() => ({ body: { success: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudUnlockTask(client, "task-1", undefined, true)).resolves.toBe(true);
    expect(calls[0]!.body).toEqual({ force: true });
  });
});
