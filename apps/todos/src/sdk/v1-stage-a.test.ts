import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TodosV1Client, TodosV1ApiError } from "./index.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const V1_PUBLIC_METHODS = [
  "request",
  "importSnapshot",
  "listPlans",
  "createPlan",
  "getPlan",
  "deletePlan",
  "updatePlan",
  "listProjects",
  "createProject",
  "getProject",
  "deleteProject",
  "updateProject",
  "renameProject",
  "getStats",
  "listTaskLists",
  "createTaskList",
  "getTaskList",
  "deleteTaskList",
  "updateTaskList",
  "listTasks",
  "createTask",
  "getTask",
  "deleteTask",
  "updateTask",
  "listTaskComments",
  "createTaskComment",
  "completeTask",
  "startTask",
] as const;

const V1_BASELINE_METHOD_LENGTHS: Record<typeof V1_PUBLIC_METHODS[number], number> = {
  request: 3,
  importSnapshot: 2,
  listPlans: 2,
  createPlan: 2,
  getPlan: 2,
  deletePlan: 2,
  updatePlan: 3,
  listProjects: 1,
  createProject: 2,
  getProject: 2,
  deleteProject: 2,
  updateProject: 3,
  renameProject: 3,
  getStats: 1,
  listTaskLists: 2,
  createTaskList: 2,
  getTaskList: 2,
  deleteTaskList: 2,
  updateTaskList: 3,
  listTasks: 2,
  createTask: 2,
  getTask: 2,
  deleteTask: 2,
  updateTask: 3,
  listTaskComments: 3,
  createTaskComment: 3,
  completeTask: 2,
  startTask: 2,
};

function expectStageA(error: unknown): void {
  expect(error).toBeInstanceOf(TodosV1ApiError);
  expect(error).toMatchObject({
    status: 503,
    body: { code: "HOSTED_AUTHORITY_UNAVAILABLE" },
  });
}

async function expectClassShape(
  Client: Function,
  ApiErrorConstructor: new (...args: any[]) => Error,
): Promise<void> {
  expect(Client.name).toBe("TodosV1Client");
  expect(Function.prototype.toString.call(Client)).toMatch(/^class\s+TodosV1Client\b/);
  expect(Object.getOwnPropertyNames(Client.prototype).sort()).toEqual(
    ["constructor", ...V1_PUBLIC_METHODS].sort(),
  );
  expect(Client.prototype.constructor).toBe(Client);

  const forged = Object.create(Client.prototype) as Record<string, (...args: unknown[]) => unknown>;
  for (const method of V1_PUBLIC_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(Client.prototype, method);
    expect(descriptor).toMatchObject({ enumerable: false, configurable: true, writable: true });
    expect(typeof descriptor?.value).toBe("function");
    expect(descriptor?.value.name).toBe(method);
    expect(descriptor?.value.length).toBe(V1_BASELINE_METHOD_LENGTHS[method]);
    let returned: unknown;
    expect(() => {
      returned = Reflect.apply(forged[method]!, forged, []);
    }, `${method} must preserve its base async call boundary`).not.toThrow();
    expect(returned, `${method} must return a Promise`).toBeInstanceOf(Promise);
    await expect(returned as Promise<unknown>).rejects.toBeInstanceOf(ApiErrorConstructor);
    await expect(returned as Promise<unknown>).rejects.toMatchObject({
      status: 503,
      body: { code: "HOSTED_AUTHORITY_UNAVAILABLE" },
    });
  }
}

describe("generated V1 SDK Stage-A boundary", () => {
  test("the public source entrypoint rejects before reading or retaining options", () => {
    const reads: string[] = [];
    const options = {
      get baseUrl() { reads.push("baseUrl"); return "https://todos.example.test"; },
      get apiKey() { reads.push("apiKey"); return "synthetic-key"; },
      get fetch() { reads.push("fetch"); return globalThis.fetch; },
      get headers() { reads.push("headers"); return { "x-test": "value" }; },
    };

    let caught: unknown;
    try {
      new TodosV1Client(options);
    } catch (error) {
      caught = error;
    }

    expectStageA(caught);
    expect(reads).toEqual([]);
  });

  test("the source entrypoint remains a class with the generated public prototype", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({});
      }) as typeof fetch;
      await expectClassShape(TodosV1Client, TodosV1ApiError);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the built SDK entrypoint rejects before fetch", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "todos-v1-sdk-build-"));
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    try {
      const build = Bun.spawnSync([
        "bun", "build", "src/sdk/index.ts", "--outdir", outputRoot, "--target", "bun",
      ], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
      expect(build.exitCode).toBe(0);
      expect(build.stderr.toString()).not.toContain("error:");

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({});
      }) as typeof fetch;
      const built = await import(`${pathToFileURL(join(outputRoot, "index.js")).href}?stage-a=${Date.now()}`) as {
        TodosV1Client: typeof TodosV1Client;
        TodosV1ApiError: typeof TodosV1ApiError;
      };

      let caught: unknown;
      try {
        new built.TodosV1Client({
          baseUrl: "https://todos.example.test",
          apiKey: "synthetic-key",
          fetch: globalThis.fetch,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(built.TodosV1ApiError);
      expect(caught).toMatchObject({ status: 503 });
      await expectClassShape(built.TodosV1Client, built.TodosV1ApiError);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("the public hosted-client containment inventory includes both SDK clients", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    for (const entrypoint of ["TodosClient", "TodosV1Client"]) {
      expect(source).toContain(entrypoint);
    }
    expect(source).toContain('from "./v1-stage-a.js"');
  });
});
