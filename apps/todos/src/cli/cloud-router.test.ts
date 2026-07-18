import { afterEach, describe, expect, test } from "bun:test";
import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliStorageMode,
  isCloudRouting,
  resetTodosCloudClient,
  cloudListTasks,
  cloudGetTask,
  cloudCreateTask,
  cloudUpdateTask,
  cloudDeleteTask,
  cloudTaskAction,
  cloudCompleteTask,
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
  cloudListProjects,
  cloudListTaskLists,
  cloudNextTask,
  cloudAllDependencies,
  cloudBlockingDepsMap,
  cloudRecap,
  cloudTimeline,
  cloudCreateTaskList,
  cloudDeleteTaskList,
  cloudResolveProjectRef,
  cloudResolvePlan,
  cloudResolveTaskListRef,
  cloudResolveTaskRef,
} from "./cloud-router.js";

const CLOUD_ENV = {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.hasna.xyz",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: RequestRedirect };

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
      redirect: init.redirect,
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

  test("mode=remote rejects an implicit default when HASNA_TODOS_API_URL is missing", () => {
    expect(() => getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_KEY: "fixture-key",
      TODOS_URL: "https://todos.md",
    } as never)).toThrow(
      "REMOTE_API_URL_MISSING: remote Todos storage requires HASNA_TODOS_API_URL",
    );
  });

  test("mode=self_hosted reports the exact missing API key without local fallback", () => {
    expect(() =>
      getTodosCloudClient({ HASNA_TODOS_STORAGE_MODE: "self_hosted", HASNA_TODOS_API_URL: "https://todos.hasna.xyz" }),
    ).toThrow(
      "REMOTE_API_KEY_MISSING: remote Todos storage requires HASNA_TODOS_API_KEY",
    );
  });

  test("blank canonical mode is invalid instead of masking a fallback selector", () => {
    expect(() => resolveTodosCliStorageMode({
      HASNA_TODOS_STORAGE_MODE: "   ",
      TODOS_STORAGE_MODE: "remote",
    })).toThrow("REMOTE_STORAGE_MODE_INVALID");
  });

  test("invalid and conflicting selectors fail closed before local routing", () => {
    expect(() => resolveTodosCliStorageMode({ HASNA_TODOS_STORAGE_MODE: "remtoe" })).toThrow(
      "REMOTE_STORAGE_MODE_INVALID",
    );
    expect(() => resolveTodosCliStorageMode({
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "remote",
    })).toThrow("REMOTE_STORAGE_MODE_CONFLICT");
  });

  test.each([
    "https://fixture-user@todos.example",
    "https://todos.example?route=v1",
    "https://todos.example#v1",
    "https://todos.example/api/v1",
    "https://todos.example/custom",
    "http://todos.example",
  ])("rejects ambiguous or credential-unsafe authority URL %s", (apiUrl) => {
    expect(() => getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: apiUrl,
      HASNA_TODOS_API_KEY: "fixture-key",
    })).toThrow("REMOTE_API_URL_INVALID");
  });

  test("accepts exact /v1 and loopback HTTP without duplicating the route prefix", () => {
    const status = getTodosRemoteAuthorityConfigStatus({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "http://127.0.0.1:18881/v1",
      HASNA_TODOS_API_KEY: "fixture-key",
    });
    expect(status).toMatchObject({ ok: true, v1_base_url: "http://127.0.0.1:18881/v1" });
  });

  test("never reuses a client across authority, mode, or API-key changes", async () => {
    const calls = installFetch(() => ({ body: { projects: [], count: 0 } }));
    const authorityA = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-key-a",
    })!;
    const authorityB = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority-b.example",
      HASNA_TODOS_API_KEY: "fixture-key-b",
    })!;
    expect(authorityA.baseUrl).toBe("https://authority-a.example/v1");
    expect(authorityB.baseUrl).toBe("https://authority-b.example/v1");
    expect(getTodosCloudClient({ HASNA_TODOS_STORAGE_MODE: "local" })).toBeNull();
    const authorityAWithNewKey = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-key-a-rotated",
    })!;

    await cloudListProjects(authorityA);
    await cloudListProjects(authorityB);
    await cloudListProjects(authorityAWithNewKey);
    expect(calls.map((call) => [call.url, call.headers["authorization"]])).toEqual([
      ["https://authority-a.example/v1/projects", "Bearer fixture-key-a"],
      ["https://authority-b.example/v1/projects", "Bearer fixture-key-b"],
      ["https://authority-a.example/v1/projects", "Bearer fixture-key-a-rotated"],
    ]);

    expect(getTodosCloudClient({})).toBeNull();
    expect(getTodosCloudClient(CLOUD_ENV)?.baseUrl).toBe("https://todos.hasna.xyz/v1");
    expect(getTodosCloudClient({ HASNA_TODOS_STORAGE_MODE: "local" })).toBeNull();
  });
});

describe("remote authority compatibility diagnostics", () => {
  test("does not treat a health-only platform host as a Todos /v1 CRUD authority", async () => {
    const calls = installFetch((call) => {
      if (call.url === "https://todos.md/v1/projects") {
        return { status: 404, body: { error: "not found" } };
      }
      return { status: 200, body: { status: "ok", service: "platform-todos", mode: "oss" } };
    });
    const client = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://todos.md",
      HASNA_TODOS_API_KEY: "fixture-key",
    } as never)!;

    await expect(cloudListProjects(client)).rejects.toThrow(
      "REMOTE_API_INCOMPATIBLE: configured Todos authority https://todos.md does not expose /v1/projects",
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.md/v1/projects",
    ]);
  });

  test.each([
    [401, "REMOTE_API_UNAUTHORIZED"],
    [403, "REMOTE_API_FORBIDDEN"],
    [503, "REMOTE_API_UNAVAILABLE"],
  ])("classifies HTTP %i without local fallback", async (status, expected) => {
    installFetch(() => ({ status, body: { error: "fixture rejection" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow(expected);
  });

  test("rejects redirects before fetch can forward authentication", async () => {
    const calls = installFetch(() => ({ status: 302, body: { redirect: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow("REMOTE_API_REDIRECT_REJECTED");
    expect(calls[0]!.redirect).toBe("manual");
  });

  test("classifies timeout-like transport failures", async () => {
    previousFetch ??= globalThis.fetch;
    globalThis.fetch = async () => {
      throw new DOMException("fixture timed out", "AbortError");
    };
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow("REMOTE_API_TIMEOUT");
  });
});

describe("cloud task CRUD maps /v1 envelopes and carries the bearer key", () => {
  test("full task UUID resolution remains a direct zero-request fast path", async () => {
    const calls = installFetch(() => ({ status: 500, body: { error: "must not be called" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const id = "abc00000-0000-4000-8000-000000000001";
    expect(await cloudResolveTaskRef(client, id.toUpperCase())).toBe(id);
    expect(calls).toHaveLength(0);
  });

  test("evidence completion requires an advertised OpenAPI request schema before POST", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": { post: { responses: { "200": { description: "ok" } } } },
            },
          },
        };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCompleteTask(client, "task-1", {
      agent_id: "agent-one",
      files_changed: ["src/a.ts"],
      confidence: 0.9,
    })).rejects.toThrow("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.hasna.xyz/v1/openapi.json",
    ]);
  });

  test("evidence capability is cached per authority while agent-only completion stays compatible", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                CompleteTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    attachment_ids: { type: "array", items: { type: "string" } },
                    files_changed: { type: "array", items: { type: "string" } },
                    test_results: { type: "string" },
                    commit_hash: { type: "string" },
                    notes: { type: "string" },
                    confidence: { type: "number" },
                  },
                },
              },
            },
          },
        };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await cloudCompleteTask(client, "task-1", { files_changed: ["src/a.ts"] });
    await cloudCompleteTask(client, "task-1", { notes: "verified" });
    await cloudCompleteTask(client, "task-1", { agent_id: "agent-only" });

    expect(calls.filter((call) => call.url.endsWith("/v1/openapi.json"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/complete"))).toHaveLength(3);
  });

  test("completion capability results never cross authority boundaries", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        const supported = call.url.startsWith("https://authority-b.example/");
        return { body: supported ? {
          paths: {
            "/v1/tasks/{id}/complete": {
              post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { notes: { type: "string" } } } } } } },
            },
          },
        } : { paths: { "/v1/tasks/{id}/complete": { post: {} } } } };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const clientA = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-a",
    })!;
    const clientB = getTodosCloudClient({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority-b.example",
      HASNA_TODOS_API_KEY: "fixture-b",
    })!;

    await expect(cloudCompleteTask(clientA, "task-1", { notes: "blocked" })).rejects.toThrow("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
    await cloudCompleteTask(clientB, "task-1", { notes: "supported" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://authority-a.example/v1/openapi.json",
      "GET https://authority-b.example/v1/openapi.json",
      "POST https://authority-b.example/v1/tasks/task-1/complete",
    ]);
  });

  test("short task references anchor exhaustive paging to stats and revalidate the chosen task", async () => {
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 2, tasks_all: 2 } };
      if (url.pathname.endsWith("/tasks/abc00000-0000-4000-8000-000000000001")) {
        return { body: { task: { id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" } } };
      }
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset === 0) {
        return {
          body: {
            tasks: [{ id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" }],
            count: 1,
            total: 2,
          },
        };
      }
      return {
        body: {
          tasks: [{ id: "abc00000-0000-4000-8000-000000000002", short_id: "TWO" }],
          count: 1,
          total: 2,
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "abc")).rejects.toThrow("Task reference is ambiguous");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/stats",
      "/v1/tasks",
      "/v1/tasks",
      "/v1/stats",
    ]);
    expect(calls[2]!.url).toContain("offset=1");
  });

  test("short task references recursively enumerate subtasks on a 0.11.91 authority", async () => {
    const parent = {
      id: "abc00000-0000-4000-8000-000000000001",
      short_id: "PARENT",
      parent_id: null,
    };
    const child = {
      id: "def00000-0000-4000-8000-000000000002",
      short_id: "CHILD",
      parent_id: parent.id,
    };
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 1, tasks_all: 2 } };
      if (url.pathname.endsWith(`/tasks/${child.id}`)) return { body: { task: child } };
      if (url.pathname !== "/v1/tasks") throw new Error(`unexpected request: ${call.url}`);
      const parentId = url.searchParams.get("parent_id");
      if (parentId === parent.id) return { body: { tasks: [child], count: 1 } };
      if (parentId === child.id) return { body: { tasks: [], count: 0 } };
      // 0.11.91 ignores include_subtasks and omits total, returning only roots.
      return { body: { tasks: [parent], count: 1 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskRef(client, "CHILD")).resolves.toBe(child.id);
    expect(calls.some((call) => new URL(call.url).searchParams.get("include_subtasks") === "true")).toBe(true);
    expect(calls.some((call) => new URL(call.url).searchParams.get("parent_id") === parent.id)).toBe(true);
    expect(calls.some((call) => new URL(call.url).searchParams.get("parent_id") === child.id)).toBe(true);
    expect(calls.filter((call) => new URL(call.url).pathname === "/v1/stats")).toHaveLength(2);
  });

  test("short task references fail closed when old-server hierarchy cannot account for tasks_all", async () => {
    const parent = {
      id: "abc00000-0000-4000-8000-000000000001",
      short_id: "PARENT",
      parent_id: null,
    };
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 1, tasks_all: 2 } };
      if (url.pathname === "/v1/tasks" && url.searchParams.has("parent_id")) {
        return { body: { tasks: [], count: 0 } };
      }
      return { body: { tasks: [parent], count: 1 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskRef(client, "PARENT")).rejects.toThrow("full task UUID");
    expect(calls.filter((call) => new URL(call.url).pathname === "/v1/stats")).toHaveLength(4);
  });

  test("short task references fail closed on a cyclic old-server hierarchy", async () => {
    const parent = {
      id: "abc00000-0000-4000-8000-000000000001",
      short_id: "PARENT",
      parent_id: null,
    };
    const child = {
      id: "def00000-0000-4000-8000-000000000002",
      short_id: "CHILD",
      parent_id: parent.id,
    };
    installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 1, tasks_all: 2 } };
      const parentId = url.searchParams.get("parent_id");
      if (parentId === parent.id) return { body: { tasks: [child], count: 1 } };
      if (parentId === child.id) {
        return { body: { tasks: [{ ...parent, parent_id: child.id }], count: 1 } };
      }
      return { body: { tasks: [parent], count: 1 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "CHILD")).rejects.toThrow("full task UUID");
  });

  test("short task references retry one unstable snapshot then fail closed with full-UUID guidance", async () => {
    let statsCalls = 0;
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) {
        statsCalls += 1;
        return { body: { tasks: 1, tasks_all: statsCalls % 2 === 1 ? 1 : 2 } };
      }
      if (url.pathname.endsWith("/tasks/abc00000-0000-4000-8000-000000000001")) {
        return { body: { task: { id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" } } };
      }
      return {
        body: {
          tasks: [{ id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" }],
          count: 1,
          total: 1,
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskRef(client, "abc")).rejects.toThrow("full task UUID");
    expect(calls.filter((call) => new URL(call.url).pathname === "/v1/stats")).toHaveLength(4);
  });

  test.each([
    ["duplicate ids", (url: URL) => url.pathname.endsWith("/stats")
      ? { body: { tasks: 2, tasks_all: 2 } }
      : { body: { tasks: [
        { id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" },
        { id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" },
      ], count: 2, total: 2 } }],
    ["malformed count", (url: URL) => url.pathname.endsWith("/stats")
      ? { body: { tasks: 1, tasks_all: 1 } }
      : { body: { tasks: [{ id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" }], count: 0, total: 1 } }],
  ] as const)("short task references retry %s snapshots before requiring a full UUID", async (_name, responseFor) => {
    const calls = installFetch((call) => responseFor(new URL(call.url)));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "abc")).rejects.toThrow("full task UUID");
    expect(calls.filter((call) => new URL(call.url).pathname === "/v1/tasks")).toHaveLength(2);
  });

  test("short task references retry when final GET no longer matches the snapshot", async () => {
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 1, tasks_all: 1 } };
      if (url.pathname.endsWith("/tasks/abc00000-0000-4000-8000-000000000001")) {
        return { body: { task: { id: "abc00000-0000-4000-8000-000000000001", short_id: "CHANGED" } } };
      }
      return { body: { tasks: [{ id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" }], count: 1, total: 1 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "ONE")).rejects.toThrow("full task UUID");
    expect(calls.filter((call) => new URL(call.url).pathname.endsWith("000000000001"))).toHaveLength(2);
  });

  test("short task references retry an empty page before total and then fail closed", async () => {
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/stats")) return { body: { tasks: 2, tasks_all: 2 } };
      if (url.searchParams.get("offset") === "1") return { body: { tasks: [], count: 0, total: 2 } };
      return { body: { tasks: [{ id: "abc00000-0000-4000-8000-000000000001", short_id: "ONE" }], count: 1, total: 2 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "ONE")).rejects.toThrow("full task UUID");
    expect(calls.filter((call) => new URL(call.url).pathname === "/v1/tasks")).toHaveLength(4);
  });

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

  test("delete preserves a resource 404 as a normal not-found result", async () => {
    installFetch(() => ({ status: 404, body: { error: "not found" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudDeleteTask(client, "missing")).resolves.toBe(false);
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

  test("comments gives an actionable compatibility error for an older server and classifies 5xx", async () => {
    for (const status of [404, 405]) {
      resetTodosCloudClient();
      installFetch(() => ({ status, body: { error: "unsupported" } }));
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudListComments(client, "t4")).rejects.toThrow(/compatible.*server|server.*compatible/i);
    }

    resetTodosCloudClient();
    installFetch(() => ({ status: 500, body: { error: "failed" } }));
    const retryingClient = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListComments(retryingClient, "t4")).rejects.toThrow("REMOTE_API_UNAVAILABLE");
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
  test("project resolution preserves exact UUIDs and resolves unique prefixes, names, slugs, and paths", async () => {
    installFetch(() => ({
      body: {
        projects: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Open Emails",
            path: "/workspace/hasna/opensource/open-emails",
            task_list_id: "emails-canonical",
          },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    for (const ref of [
      "99999999-9999-4999-8999-999999999999",
      "  99999999-9999-4999-8999-999999999999  ",
      "99999999",
      "Open Emails",
      "  OPEN EMAILS  ",
      "open-emails",
      "emails-canonical",
      "/workspace/hasna/opensource/open-emails",
      "/home/hasna/workspace/hasna/opensource/open-emails",
    ]) {
      await expect(cloudResolveProjectRef(client, ref))
        .resolves.toBe("99999999-9999-4999-8999-999999999999");
    }
  });

  test("project resolution fails explicitly for missing and ambiguous references", async () => {
    installFetch(() => ({
      body: {
        projects: [
          { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Shared", path: "/one/open-emails" },
          { id: "aaaaaaaa-2222-4222-8222-222222222222", name: "Shared", path: "/two/open-emails" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveProjectRef(client, "missing"))
      .rejects.toThrow('Project not found: "missing"');
    await expect(cloudResolveProjectRef(client, "Shared"))
      .rejects.toThrow('Project reference is ambiguous: "Shared"');
    await expect(cloudResolveProjectRef(client, "open-emails"))
      .rejects.toThrow('Project reference is ambiguous: "open-emails"');
    await expect(cloudResolveProjectRef(client, "aaaaaaaa"))
      .rejects.toThrow('Project reference is ambiguous: "aaaaaaaa"');
  });

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

  test("task-list resolution preserves exact UUIDs and resolves project-scoped slugs and unique UUID prefixes", async () => {
    const listId = "abcdef12-1111-4111-8111-111111111111";
    const calls = installFetch(() => ({
      body: {
        task_lists: [
          { id: listId, project_id: "project-1", slug: "release", name: "Release" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, `  ${listId.toUpperCase()}  `))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(client, "release", "project-1"))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(
      client,
      `  ${listId.toUpperCase()}  `,
      "project-1",
    ))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(client, "ABCDEF12"))
      .resolves.toBe(listId);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toContain("project_id=project-1");
    expect(calls[1]!.url).toContain("project_id=project-1");
    expect(calls[2]!.url).not.toContain("project_id=");
  });

  test("project-scoped plan resolution rejects an exact UUID from another project", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const calls = installFetch((call) => {
      if (call.url.endsWith(`/plans/${planId}`)) {
        return { body: { plan: { id: planId, project_id: "project-b", slug: "foreign", name: "Foreign" } } };
      }
      return { body: { plans: [] } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolvePlan(client, planId, "project-a")).resolves.toBeNull();
    expect(calls.map((call) => call.url)).toEqual([
      `https://todos.hasna.xyz/v1/plans/${planId}`,
      "https://todos.hasna.xyz/v1/plans?project_id=project-a",
    ]);
  });

  test("task-list resolution fails explicitly for missing and ambiguous references", async () => {
    installFetch(() => ({
      body: {
        task_lists: [
          { id: "aaaaaaaa-1111-4111-8111-111111111111", project_id: "project-1", slug: "shared", name: "Shared A" },
          { id: "aaaaaaaa-2222-4222-8222-222222222222", project_id: "project-1", slug: "shared", name: "Shared B" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, "missing", "project-1"))
      .rejects.toThrow('Task list not found: "missing"');
    await expect(cloudResolveTaskListRef(client, "shared", "project-1"))
      .rejects.toThrow('Task list reference is ambiguous: "shared"');
    await expect(cloudResolveTaskListRef(client, "aaaaaaaa", "project-1"))
      .rejects.toThrow('Task list reference is ambiguous: "aaaaaaaa"');
  });

  test("force unlock sends an explicit force flag instead of spoofing the lock holder", async () => {
    const calls = installFetch(() => ({ body: { success: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudUnlockTask(client, "task-1", undefined, true)).resolves.toBe(true);
    expect(calls[0]!.body).toEqual({ force: true });
  });
});
