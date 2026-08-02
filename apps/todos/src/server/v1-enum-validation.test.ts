/**
 * Server half of the silent-empty enum filter defect (todos task b7dbc881).
 *
 * `GET /v1/tasks?status=open` used to cast the raw param `as never` into the store,
 * which matched nothing, and answered HTTP 200 with `{"tasks":[],"count":0}`. An
 * unvalidated API is the same defect one layer below the CLI: it reports "there is
 * nothing" for a value it does not actually have.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";

let db: Database;
let store: TodosStorageAdapter;
let dependencies: V1RequestDependencies;

function request(path: string): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, { method: "GET" }), url, dependencies);
}

beforeEach(async () => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getPrGroupLedger: () => createLocalPrGroupLedger(db),
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal: { agent: null, scopes: ["todos:*"] } }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
  await store.tasks.create({ title: "Server enum fixture pending", priority: "critical" });
  await store.tasks.create({ title: "Server enum fixture medium", priority: "medium" });
});

afterEach(() => resetDatabase());

describe("GET /v1/tasks rejects an out-of-vocabulary status", () => {
  test.each(["open", "all", "totally_bogus_value"])("answers 400 for status=%s", async (value) => {
    const response = await request(`/v1/tasks?status=${value}`);
    expect(response?.status).toBe(400);
    const body = await response!.json() as { error: string; tasks?: unknown };
    expect(body.tasks).toBeUndefined();
    for (const status of TASK_STATUSES) expect(body.error).toContain(status);
  });

  test("does not answer 200 with an empty task list", async () => {
    const response = await request("/v1/tasks?status=open");
    expect(response?.status).not.toBe(200);
  });

  test("validates every element of a comma-separated status list", async () => {
    const response = await request("/v1/tasks?status=pending,bogus");
    expect(response?.status).toBe(400);
    expect((await response!.json() as { error: string }).error).toContain("bogus");
  });

  test("still serves a valid status and returns the matching rows", async () => {
    const response = await request("/v1/tasks?status=pending");
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ status: string }>; count: number; total: number };
    expect(body.count).toBe(2);
    expect(body.total).toBe(2);
    expect(body.tasks.every((task) => task.status === "pending")).toBe(true);
  });

  test("still serves a valid comma-separated status list", async () => {
    const response = await request("/v1/tasks?status=pending,completed");
    expect(response?.status).toBe(200);
    expect((await response!.json() as { count: number }).count).toBe(2);
  });

  test("treats an absent status param as no filter, not as an invalid value", async () => {
    const response = await request("/v1/tasks");
    expect(response?.status).toBe(200);
    expect((await response!.json() as { count: number }).count).toBe(2);
  });

  test("treats an empty status param as no filter", async () => {
    const response = await request("/v1/tasks?status=");
    expect(response?.status).toBe(200);
    expect((await response!.json() as { count: number }).count).toBe(2);
  });

  test("rejects a non-canonical case rather than silently matching nothing", async () => {
    const response = await request("/v1/tasks?status=Pending");
    expect(response?.status).toBe(400);
  });
});

describe("GET /v1/tasks rejects an out-of-vocabulary priority", () => {
  test("answers 400 and names every allowed priority", async () => {
    const response = await request("/v1/tasks?priority=totally_bogus_value");
    expect(response?.status).toBe(400);
    const body = await response!.json() as { error: string };
    for (const priority of TASK_PRIORITIES) expect(body.error).toContain(priority);
  });

  test("validates every element of a comma-separated priority list", async () => {
    const response = await request("/v1/tasks?priority=critical,bogus");
    expect(response?.status).toBe(400);
  });

  test("still serves a valid priority and returns the matching rows", async () => {
    const response = await request("/v1/tasks?priority=critical");
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ priority: string }>; count: number };
    expect(body.count).toBe(1);
    expect(body.tasks[0]!.priority).toBe("critical");
  });

  test("still serves a valid comma-separated priority list", async () => {
    const response = await request("/v1/tasks?priority=critical,medium");
    expect(response?.status).toBe(200);
    expect((await response!.json() as { count: number }).count).toBe(2);
  });
});

describe("the OpenAPI document publishes the filter vocabularies", () => {
  test("declares scalar-or-array status and priority enums on GET /v1/tasks", () => {
    const document = buildV1OpenApiDocument("0.0.0-test") as unknown as {
      paths: Record<string, { get: { parameters: Array<{
        name: string;
        style?: string;
        explode?: boolean;
        schema: { oneOf?: Array<{ enum?: string[]; items?: { enum?: string[] } }> };
      }> } }>;
    };
    const parameters = document.paths["/v1/tasks"]!.get.parameters;
    const status = parameters.find((parameter) => parameter.name === "status");
    const priority = parameters.find((parameter) => parameter.name === "priority");
    expect(status).toMatchObject({ style: "form", explode: false });
    expect(priority).toMatchObject({ style: "form", explode: false });
    expect(status?.schema.oneOf?.[0]?.enum).toEqual([...TASK_STATUSES]);
    expect(status?.schema.oneOf?.[1]?.items?.enum).toEqual([...TASK_STATUSES]);
    expect(priority?.schema.oneOf?.[0]?.enum).toEqual([...TASK_PRIORITIES]);
    expect(priority?.schema.oneOf?.[1]?.items?.enum).toEqual([...TASK_PRIORITIES]);
  });

  test("generated SDK accepts both scalar and comma-serialized array filters", () => {
    const { code, warnings } = generateSdkFromOpenApi(
      buildV1OpenApiDocument("0.0.0-test") as never,
      { className: "TodosV1Client", apiKeyHeader: "x-api-key" },
    );
    const listSignature = code.split("\n").find((line) => line.includes("async listTasks"));
    expect(warnings).toEqual([]);
    expect(listSignature).toContain('"status"?: "pending"');
    expect(listSignature).toContain('Array<"pending"');
    expect(listSignature).toContain('"priority"?: "low"');
    expect(listSignature).toContain('Array<"low"');
  });
});
