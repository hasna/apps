/**
 * Server half of the tags-filter regression (todos task 90c0b178): the storage
 * adapters have always supported `filter.tags`, but `GET /v1/tasks` never mapped
 * the `tags` query param onto the filter — so the fleet had no working way to
 * retrieve tasks by tag over the hosted /v1 authority. The route now honors a
 * comma-separated `tags` param for both the page and the SQL-side `total`, and
 * the OpenAPI document advertises it so clients can preflight capability.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import { buildV1OpenApiDocument } from "./openapi.js";

let db: Database;
let store: TodosStorageAdapter;
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

beforeEach(() => {
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
});

afterEach(() => resetDatabase());

describe("GET /v1/tasks tags filtering", () => {
  test("filters the page and the total by tag", async () => {
    const tagged = await request("/v1/tasks", "POST", { title: "tagged", tags: ["modes-simplify", "oss"] });
    expect(tagged?.status).toBe(201);
    const other = await request("/v1/tasks", "POST", { title: "other", tags: ["unrelated"] });
    expect(other?.status).toBe(201);
    const untagged = await request("/v1/tasks", "POST", { title: "untagged" });
    expect(untagged?.status).toBe(201);

    const response = await request("/v1/tasks?tags=modes-simplify");
    expect(response?.status).toBe(200);
    const page = await response!.json() as { tasks: Array<{ title: string }>; count: number; total: number };
    expect(page.tasks.map((task) => task.title)).toEqual(["tagged"]);
    expect(page.count).toBe(1);
    expect(page.total).toBe(1);
  });

  test("multiple comma-separated tags match ANY tag (parity with the local CLI)", async () => {
    await request("/v1/tasks", "POST", { title: "both", tags: ["a", "b"] });
    await request("/v1/tasks", "POST", { title: "only-a", tags: ["a"] });
    await request("/v1/tasks", "POST", { title: "neither", tags: ["c"] });

    const response = await request("/v1/tasks?tags=a,b");
    const page = await response!.json() as { tasks: Array<{ title: string }>; total: number };
    expect(page.tasks.map((task) => task.title).sort()).toEqual(["both", "only-a"]);
    expect(page.total).toBe(2);
  });

  test("the OpenAPI document advertises the tags list parameter", () => {
    const document = buildV1OpenApiDocument() as {
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>;
    };
    const parameters = document.paths["/v1/tasks"]?.get?.parameters ?? [];
    expect(parameters.some((parameter) => parameter.name === "tags")).toBe(true);
  });
});
