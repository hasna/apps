import { describe, expect, test } from "bun:test";
import { buildV1OpenApiDocument } from "./openapi.js";
import { TodosV1Client, type CreateTemplateInput } from "../sdk/v1.generated.js";

describe("task comments OpenAPI contract", () => {
  test("documents bounded cursor reads and comment writes", () => {
    const document = buildV1OpenApiDocument("test");
    const path = document.paths["/v1/tasks/{id}/comments"];

    expect(path.get.operationId).toBe("listTaskComments");
    expect(path.get.parameters.map((parameter) => parameter.name)).toEqual(["id", "limit", "cursor"]);
    expect(path.get.parameters.find((parameter) => parameter.name === "limit")?.required).toBe(true);
    expect(path.get.responses["200"].content["application/json"].schema.required)
      .toEqual(["comments", "count", "has_more", "next_cursor"]);
    expect(path.get.responses["426"].description).toMatch(/storage adapter.*cursor pagination/i);
    expect(path.post.operationId).toBe("createTaskComment");
    expect(document.components.schemas.TaskComment.required).toContain("content");
    expect(document.components.schemas.CreateTaskCommentInput.required).toEqual(["content"]);
  });

  test("generated SDK sends encoded task ids, page cursors, and typed create bodies", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const comment = {
      id: "comment-1",
      task_id: "task/one",
      agent_id: null,
      session_id: null,
      content: "safe",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined });
        return Response.json(
          init?.method === "POST"
            ? { comment }
            : { comments: [comment], count: 1, has_more: true, next_cursor: "next-page" },
          { status: init?.method === "POST" ? 201 : 200 },
        );
      }) as typeof fetch,
    });

    const page = await client.listTaskComments("task/one", { limit: 25, cursor: "current-page" });
    expect(page).toMatchObject({ count: 1, has_more: true, next_cursor: "next-page" });
    const created = await client.createTaskComment("task/one", { content: "safe", type: "comment" });
    expect(created.comment.id).toBe("comment-1");
    expect(calls).toEqual([
      {
        url: "https://todos.test/v1/tasks/task%2Fone/comments?limit=25&cursor=current-page",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://todos.test/v1/tasks/task%2Fone/comments",
        method: "POST",
        body: JSON.stringify({ content: "safe", type: "comment" }),
      },
    ]);
  });
});

describe("task list and completion OpenAPI contract", () => {
  test("documents exhaustive task pagination, total, filters, and completion evidence", () => {
    const document = buildV1OpenApiDocument("test");
    const list = document.paths["/v1/tasks"].get;
    expect(list.parameters.map((parameter) => parameter.name)).toEqual([
      "status",
      "priority",
      "project_id",
      "parent_id",
      "include_subtasks",
      "plan_id",
      "task_list_id",
      "assigned_to",
      "agent_id",
      "limit",
      "offset",
    ]);
    expect(list.responses["200"].content["application/json"].schema.required).toEqual(["tasks", "count", "total"]);
    expect(list.responses["200"].content["application/json"].schema.properties.total).toMatchObject({ type: "integer", minimum: 0 });

    const complete = document.paths["/v1/tasks/{id}/complete"].post;
    expect(complete.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/CompleteTaskInput");
    expect(document.components.schemas.CompleteTaskInput.properties).toMatchObject({
      attachment_ids: { type: "array" },
      files_changed: { type: "array" },
      test_results: { type: "string" },
      commit_hash: { type: "string" },
      notes: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    });
  });

  test("generated SDK listTasks exposes total and all supported query fields", async () => {
    const calls: string[] = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({ tasks: [], count: 0, total: 7 });
      }) as typeof fetch,
    });
    const result = await client.listTasks({
      status: "pending",
      priority: "high",
      project_id: "project",
      parent_id: "parent",
      include_subtasks: true,
      plan_id: "plan",
      task_list_id: "list",
      assigned_to: "assignee",
      agent_id: "agent",
      limit: 1,
      offset: 6,
    });
    expect(result.total).toBe(7);
    expect(new URL(calls[0]!).searchParams.toString()).toBe(
      "status=pending&priority=high&project_id=project&parent_id=parent&include_subtasks=true&plan_id=plan&task_list_id=list&assigned_to=assignee&agent_id=agent&limit=1&offset=6",
    );
  });
});

describe("snapshot OpenAPI contract", () => {
  test("generated SDK accepts and sends typed template checklist snapshot rows", async () => {
    const snapshot: Parameters<TodosV1Client["importSnapshot"]>[0] = {
      source: "postgres",
      templateTasks: [{
        id: "template-task-1",
        template_id: "template-1",
        position: 0,
        title_pattern: "Collect statements {month}",
        description: null,
        priority: "medium",
        tags: [],
        task_type: null,
        condition: null,
        include_template_id: null,
        depends_on_positions: [],
        metadata: {},
        created_at: "2026-07-22T00:00:00.000Z",
      }],
    };
    const calls: Array<{ url: string; body?: string }> = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body as string | undefined });
        return Response.json({ received: 1, result: { inserted: 1, updated: 0, errors: [] } });
      }) as typeof fetch,
    });
    await client.importSnapshot(snapshot);
    expect(calls).toEqual([{ url: "https://todos.test/v1/import", body: JSON.stringify(snapshot) }]);
  });
});

describe("reusable template OpenAPI contract", () => {
  test("models the canonical template-export shape and generated SDK create request exactly", async () => {
    const document = buildV1OpenApiDocument("test");
    const schema = document.components.schemas.CreateTemplateInput;
    expect(schema.properties).toMatchObject({
      description: { type: "string", nullable: true },
      project_id: { type: "string", nullable: true },
      plan_id: { type: "string", nullable: true },
      tasks: { type: "array", items: { $ref: "#/components/schemas/CreateTemplateTaskInput" } },
    });

    const canonicalExport: CreateTemplateInput = {
      name: "Monthly accounting",
      title_pattern: "Monthly accounting {month}",
      description: null,
      priority: "medium",
      tags: ["accounting"],
      variables: [],
      project_id: null,
      plan_id: null,
      metadata: {},
      tasks: [{
        position: 0,
        title_pattern: "Collect statements {month}",
        description: null,
        priority: "high",
        tags: [],
        task_type: null,
        condition: null,
        include_template_id: null,
        depends_on_positions: [],
        metadata: {},
      }],
    };
    const calls: Array<{ url: string; body?: string }> = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body as string | undefined });
        return Response.json({ template: { id: "template-1" } }, { status: 201 });
      }) as typeof fetch,
    });
    await client.createTemplate(canonicalExport);
    expect(calls).toEqual([{ url: "https://todos.test/v1/templates", body: JSON.stringify(canonicalExport) }]);
  });
});

describe("project mutation OpenAPI contract", () => {
  test("preserves create routing compatibility, closes generic update, and exposes atomic rename", () => {
    const document = buildV1OpenApiDocument("test");
    const createProperties = document.components.schemas.CreateProjectInput.properties;
    const updateProperties = document.components.schemas.UpdateProjectInput.properties;

    expect(Object.keys(createProperties)).toEqual(["name", "path", "description", "task_list_id", "task_prefix"]);
    expect(Object.keys(updateProperties)).toEqual(["name", "path", "description"]);
    expect(createProperties.task_list_id).toMatchObject({ minLength: 1, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });
    expect(document.paths["/v1/projects"].post.responses["409"]).toBeDefined();
    expect(document.paths["/v1/projects/{id}/rename"].post.operationId).toBe("renameProject");
    expect(document.paths["/v1/projects/{id}/rename"].post.responses["409"]).toBeDefined();
  });

  test("documents non-empty slug-bearing inputs and closed task-list bodies", () => {
    const schemas = buildV1OpenApiDocument("test").components.schemas;

    expect(schemas.CreateProjectInput.properties.name.pattern).toBe(".*[A-Za-z0-9].*");
    expect(schemas.RenameProjectInput.properties.new_slug.pattern).toBe(".*[A-Za-z0-9].*");
    expect(schemas.CreateTaskListInput).toMatchObject({ additionalProperties: false });
    expect(schemas.CreateTaskListInput.properties.slug).toMatchObject({ minLength: 1, pattern: ".*[A-Za-z0-9].*" });
    expect(schemas.UpdateTaskListInput).toMatchObject({ additionalProperties: false, minProperties: 1 });
  });
});

describe("plan mutation OpenAPI contract", () => {
  test("documents plan create, list, get, update, and delete for SDK generation", () => {
    const document = buildV1OpenApiDocument();
    expect(document.paths["/v1/plans"].get.operationId).toBe("listPlans");
    expect(document.paths["/v1/plans"].post.operationId).toBe("createPlan");
    expect(document.paths["/v1/plans/{id}"].get.operationId).toBe("getPlan");
    expect(document.paths["/v1/plans/{id}"].patch.operationId).toBe("updatePlan");
    expect(document.paths["/v1/plans/{id}"].delete.operationId).toBe("deletePlan");
    expect(document.components.schemas.UpdatePlanInput).toMatchObject({
      additionalProperties: false,
      minProperties: 1,
      properties: { status: { enum: ["active", "completed", "archived"] } },
    });
    expect(document.components.schemas.Plan.properties.slug).toMatchObject({ type: "string", nullable: true });
  });

  test("generated SDK exposes the complete plan lifecycle", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const plan = {
      id: "plan/one",
      slug: "plan-one",
      name: "Plan one",
      status: "active" as const,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:00:00.000Z",
    };
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url: String(input), body: init?.body as string | undefined });
        if (method === "DELETE") return Response.json({ deleted: true, id: plan.id });
        if (String(input).endsWith("/v1/plans")) {
          return Response.json(method === "GET" ? { plans: [plan], count: 1 } : { plan }, { status: method === "POST" ? 201 : 200 });
        }
        return Response.json({ plan: method === "PATCH" ? { ...plan, status: "completed" } : plan });
      }) as typeof fetch,
    });

    expect((await client.listPlans()).plans).toHaveLength(1);
    expect((await client.createPlan({ name: plan.name })).plan?.id).toBe(plan.id);
    expect((await client.getPlan(plan.id)).plan?.id).toBe(plan.id);
    expect((await client.updatePlan(plan.id, { status: "completed" })).plan?.status).toBe("completed");
    expect((await client.deletePlan(plan.id)).deleted).toBe(true);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /v1/plans",
      "POST /v1/plans",
      "GET /v1/plans/plan%2Fone",
      "PATCH /v1/plans/plan%2Fone",
      "DELETE /v1/plans/plan%2Fone",
    ]);
  });
});
