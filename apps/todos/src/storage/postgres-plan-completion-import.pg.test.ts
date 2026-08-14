/**
 * REAL HTTP + /v1/import + Postgres coverage for hosted plan completion.
 *
 * Set TODOS_TEST_PG_URL to an isolated PostgreSQL database before running this
 * file directly; the default no-Postgres lane skips it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import type { Plan, Task } from "../types/index.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-plan-completion-${process.pid}-${Date.now()}`;
const WRITER_A = "plan-field-writer";
const WRITER_B = "plan-completion-writer";

describe.skipIf(!PG_URL)("postgres /v1/import atomic plan completion", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;
  let server: ReturnType<typeof Bun.serve>;
  const authenticatedAgents: string[] = [];

  const requestJson = async (
    path: string,
    method: "GET" | "POST",
    body: unknown,
    writer: typeof WRITER_A | typeof WRITER_B,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const target = new URL(path, `http://127.0.0.1:${server.port}`);
    if (
      target.protocol !== "http:"
      || target.hostname !== "127.0.0.1"
      || target.port !== String(server.port)
      || !target.pathname.startsWith("/v1/")
    ) {
      throw new Error(`refusing non-loopback test request: ${target.origin}${target.pathname}`);
    }
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${writer}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  };

  const seedPlan = async (plan: Plan): Promise<void> => {
    const seeded = await requestJson("/v1/import", "POST", {
      exportedAt: plan.updated_at,
      source: "postgres",
      plans: [plan],
    }, WRITER_A);
    expect(seeded.status).toBe(200);
    expect(seeded.body).toMatchObject({
      received: 1,
      result: { errors: [] },
    });
  };

  const createLinks = async (label: string, agentName: string) => {
    const project = await store.projects.create({
      name: `${label} project`,
      path: `/postgres-plan-completion-${label.toLowerCase().replaceAll(" ", "-")}-${Date.now()}`,
    });
    const taskList = await store.taskLists.create({
      name: `${label} task list`,
      slug: `${label.toLowerCase().replaceAll(" ", "-")}-task-list`,
      project_id: project.id,
    });
    const agentResult = await store.agents.register({ name: agentName });
    if ("conflict" in agentResult) throw new Error(agentResult.message);
    return {
      project_id: project.id,
      task_list_id: taskList.id,
      agent_id: agentResult.id,
    };
  };

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
    const dependencies: V1RequestDependencies = {
      ensureSchema: async () => {},
      getStorageAdapter: () => store,
      getVerifier: () => ({
        authenticate: async (headers: Headers) => {
          const authorization = headers.get("authorization");
          const agent = authorization?.replace(/^Bearer /, "") ?? "";
          if (agent !== WRITER_A && agent !== WRITER_B) {
            return {
              ok: false,
              status: 401,
              message: "unauthorized test principal",
              reason: "invalid_api_key",
            };
          }
          authenticatedAgents.push(agent);
          return {
            ok: true,
            principal: { agent, kid: `${agent}-kid`, scopes: ["todos:*"] },
          };
        },
      }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
    };
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        return await handleV1Request(request, new URL(request.url), dependencies)
          ?? new Response("not found", { status: 404 });
      },
    });
  });

  afterAll(async () => {
    server?.stop(true);
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  test("completion wins: equal-clock full import cannot revert status or protected fields", async () => {
    const observedUpdatedAt = "2099-08-08T20:00:00.000Z";
    const observedLinks = await createLinks("Completion wins observed", "cassius");
    const concurrentLinks = await createLinks("Completion wins concurrent", "cicero");
    const plan: Plan = {
      id: "71000000-0000-4000-8000-000000000001",
      slug: "completion-wins",
      project_id: observedLinks.project_id,
      task_list_id: observedLinks.task_list_id,
      agent_id: observedLinks.agent_id,
      name: "Observed name",
      description: "Observed description",
      status: "active",
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: observedUpdatedAt,
    };
    await seedPlan(plan);
    const taskResponse = await requestJson("/v1/tasks", "POST", {
      title: "Protected member",
      plan_id: plan.id,
    }, WRITER_A);
    expect(taskResponse.status).toBe(201);
    const taskBefore = (taskResponse.body["task"] as Task);

    const completed = await requestJson("/v1/import", "POST", {
      source: "postgres",
      planCompletions: [{
        id: plan.id,
        expected_updated_at: observedUpdatedAt,
        status: "completed",
      }],
    }, WRITER_B);
    expect(completed).toMatchObject({ status: 200 });
    const receipt = (
      completed.body["planCompletions"] as Array<{
        result_updated_at: string;
        applied: boolean;
      }>
    )[0]!;
    expect(receipt).toEqual({
      id: plan.id,
      status: "completed",
      expected_updated_at: observedUpdatedAt,
      result_updated_at: "2099-08-08T20:00:00.002Z",
      applied: true,
    });

    const equalClockWriter = await requestJson("/v1/import", "POST", {
      exportedAt: receipt.result_updated_at,
      source: "postgres",
      plans: [{
        ...plan,
        name: "Concurrent name",
        description: "Concurrent description",
        project_id: concurrentLinks.project_id,
        task_list_id: concurrentLinks.task_list_id,
        agent_id: concurrentLinks.agent_id,
        status: "active",
        updated_at: receipt.result_updated_at,
      }],
    }, WRITER_A);
    expect(equalClockWriter.status).toBe(200);

    const readPlan = await requestJson(`/v1/plans/${plan.id}`, "GET", undefined, WRITER_B);
    expect(readPlan.status).toBe(200);
    expect(readPlan.body["plan"]).toMatchObject({
      id: plan.id,
      status: "completed",
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      project_id: plan.project_id,
      task_list_id: plan.task_list_id,
      agent_id: plan.agent_id,
      created_at: plan.created_at,
      updated_at: receipt.result_updated_at,
    });
    const taskAfter = await store.tasks.get(taskBefore.id);
    expect(taskAfter).toMatchObject({
      id: taskBefore.id,
      status: taskBefore.status,
      plan_id: plan.id,
      parent_id: taskBefore.parent_id,
      project_id: taskBefore.project_id,
      task_list_id: taskBefore.task_list_id,
    });
  });

  test("field writer wins: stale completion returns 409 and cannot report false success", async () => {
    const observedUpdatedAt = "2099-08-08T20:00:01.000Z";
    const equalClock = "2099-08-08T20:00:01.002Z";
    const observedLinks = await createLinks("Field writer observed", "brutus");
    const concurrentLinks = await createLinks("Field writer concurrent", "caesar");
    const plan: Plan = {
      id: "71000000-0000-4000-8000-000000000002",
      slug: "field-writer-wins",
      project_id: observedLinks.project_id,
      task_list_id: observedLinks.task_list_id,
      agent_id: observedLinks.agent_id,
      name: "Observed name",
      description: "Observed description",
      status: "active",
      created_at: "2026-08-08T20:00:01.000Z",
      updated_at: observedUpdatedAt,
    };
    await seedPlan(plan);

    const fieldWrite = await requestJson("/v1/import", "POST", {
      exportedAt: equalClock,
      source: "postgres",
      plans: [{
        ...plan,
        name: "Concurrent name",
        description: "Concurrent description",
        project_id: concurrentLinks.project_id,
        task_list_id: concurrentLinks.task_list_id,
        agent_id: concurrentLinks.agent_id,
        updated_at: equalClock,
      }],
    }, WRITER_A);
    expect(fieldWrite.status).toBe(200);

    const completion = await requestJson("/v1/import", "POST", {
      source: "postgres",
      planCompletions: [{
        id: plan.id,
        expected_updated_at: observedUpdatedAt,
        status: "completed",
      }],
    }, WRITER_B);
    expect(completion).toMatchObject({ status: 409 });
    expect(completion.body).toMatchObject({
      code: "PLAN_REVISION_CONFLICT",
      conflict: true,
      plan_id: plan.id,
      expected_updated_at: observedUpdatedAt,
      current_updated_at: equalClock,
    });

    const readPlan = await requestJson(`/v1/plans/${plan.id}`, "GET", undefined, WRITER_B);
    expect(readPlan.body["plan"]).toMatchObject({
      status: "active",
      name: "Concurrent name",
      description: "Concurrent description",
      project_id: concurrentLinks.project_id,
      task_list_id: concurrentLinks.task_list_id,
      agent_id: concurrentLinks.agent_id,
      updated_at: equalClock,
    });
    expect(new Set(authenticatedAgents)).toEqual(new Set([WRITER_A, WRITER_B]));
  });
});
