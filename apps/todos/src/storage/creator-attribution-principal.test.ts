import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { createLocalSqliteTodosStorageAdapter } from "./local-sqlite.js";
import { handleCreateTask } from "../server/routes.js";
import type { RouteContext } from "../server/routes.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import type { Task } from "../types/index.js";

/**
 * The server knows who is calling — the API-key principal reaches storage as
 * `context.agentId`, and the /v1 route builds it with `contextFromPrincipal`.
 * Discarding it there is the original defect (`agent_id: input.agent_id ?? null`,
 * with no context fallback, while session_id and project_id DID fall back).
 *
 * The first fix covered only the Postgres adapter. A self-hosted SQLite-backed
 * server is a supported deployment shape under the `sqlite | postgresql` model, and
 * it reproduced the same defect, so it is covered here.
 */

describe("SQLite storage adapter honours the calling principal", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => db.close());

  it("attributes a task to the principal when the client sent no author", async () => {
    const store = createLocalSqliteTodosStorageAdapter({ db });
    const task = await store.tasks.create({ title: "filed through the API" }, { agentId: "cassius" });
    expect(task.created_by).toBe("cassius");
    expect(task.agent_id).toBe("cassius");
  });

  // BEHAVIOUR LOCK, not a defect control — this already worked before the fix,
  // because an explicit created_by was passed straight through to createTask.
  it("lets an explicit author in the request body win over the principal", async () => {
    const store = createLocalSqliteTodosStorageAdapter({ db });
    const task = await store.tasks.create(
      { title: "filed on behalf of another agent", created_by: "brutus" },
      { agentId: "cassius" },
    );
    expect(task.created_by).toBe("brutus");
  });

  // BEHAVIOUR LOCK, not a defect control — null was the pre-fix behaviour in every
  // case. It is kept to pin that a missing principal is not backfilled with a guess.
  it("leaves the author null when there is no principal and no explicit author", async () => {
    const store = createLocalSqliteTodosStorageAdapter({ db });
    const task = await store.tasks.create({ title: "anonymous" }, {});
    expect(task.created_by).toBeNull();
  });
});

describe("the task-create route records authorship", () => {
  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
  });

  afterEach(() => closeDatabase());

  const ctx = {
    port: 0,
    sseClients: new Set(),
    filteredSseClients: new Set(),
    broadcastEvent: () => {},
    apiKey: null,
  } as unknown as RouteContext;

  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const identity = (task: Task) => task;

  async function post(body: Record<string, unknown>) {
    const res = await handleCreateTask(
      new Request("http://localhost/api/tasks", { method: "POST", body: JSON.stringify(body) }),
      ctx,
      json,
      identity as never,
    );
    return (await res.json()) as Task;
  }

  it("attributes a task filed without a caller identity, rather than leaving it unattributable", async () => {
    // This route dropped every field except title/description/priority/project_id, so
    // a task filed without created_by/agent_id used to land with a null author no matter what was sent.
    const task = await post({ title: "filed without an author" });
    expect(task.created_by).toBe("dashboard");
  });

  it("honours an explicit author when the caller supplies one", async () => {
    const task = await post({ title: "filed on behalf of cassius", created_by: "cassius" });
    expect(task.created_by).toBe("cassius");
  });

  it("carries agent_id and assigned_to through instead of discarding them", async () => {
    const task = await post({ title: "routed work", agent_id: "brutus", assigned_to: "cassius" });
    expect(task.agent_id).toBe("brutus");
    expect(task.created_by).toBe("brutus");
    expect(task.assigned_to).toBe("cassius");
  });
});
