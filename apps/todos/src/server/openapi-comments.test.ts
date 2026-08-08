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
      "tags",
      "updated_after",
      "limit",
      "offset",
    ]);
    // The since-cursor must be DECLARED, not merely implemented: an undeclared
    // parameter is dropped silently, so every caller believes it is bounding a
    // read that is in fact returning the whole table.
    expect(list.parameters.find((parameter) => parameter.name === "updated_after")).toMatchObject({
      in: "query",
      schema: { type: "string", format: "date-time" },
    });
    expect(list.responses["200"].content["application/json"].schema.required).toEqual(["tasks", "count", "total"]);
    expect(list.responses["200"].content["application/json"].schema.properties.total).toMatchObject({ type: "integer", minimum: 0 });
    expect(document.components.schemas.CreateTaskInput.properties.parent_id).toMatchObject({ type: "string" });
    expect(document.components.schemas.Task.properties.parent_id).toMatchObject({
      type: "string",
      nullable: true,
    });

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

  test("documents non-mutating task-list planning, idempotent apply, and conditional rollback", () => {
    const document = buildV1OpenApiDocument("test");
    const ensure = document.paths["/v1/projects/{id}/task-list/ensure"];
    const rollback = document.paths["/v1/projects/{id}/task-list/rollback"];

    expect(ensure.get.operationId).toBe("planProjectTaskListEnsure");
    expect(ensure.post.operationId).toBe("ensureProjectTaskList");
    expect(ensure.post.responses["201"]).toBeDefined();
    expect(ensure.post.responses["409"]).toBeDefined();
    expect(rollback.post.operationId).toBe("rollbackProjectTaskListEnsure");
    expect(document.components.schemas.ProjectTaskListEnsureApplyInput).toMatchObject({
      additionalProperties: false,
      required: ["expected_project_revision"],
    });
    expect(document.components.schemas.ProjectTaskListRollbackInput).toMatchObject({
      additionalProperties: false,
      required: ["receipt_id", "expected_task_list_revision"],
    });
    expect(document.components.schemas.ProjectTaskListEnsureResult.required)
      .toEqual(["mode", "action", "project", "task_list", "receipt"]);
  });

  test("generated SDK sends encoded project ids and exact revision/receipt bodies", async () => {
    const calls: Array<{ method: string; path: string; body?: string }> = [];
    const project = {
      id: "project/one",
      name: "Dubai Fraud",
      path: "/workspace/dubai-fraud",
      task_list_id: "dubai-fraud",
      updated_at: "2026-08-07T10:00:00.000Z",
    };
    const taskList = {
      id: "list-1",
      project_id: project.id,
      slug: "dubai-fraud",
      name: project.name,
      created_at: "2026-08-07T10:01:00.000Z",
      updated_at: "2026-08-07T10:01:00.000Z",
    };
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        calls.push({ method: init?.method ?? "GET", path, body: init?.body as string | undefined });
        if (path.endsWith("/rollback")) {
          return Response.json({
            schema_version: "todos.project-task-list-ensure.v1",
            action: "removed",
            project_id: project.id,
            task_list_id: taskList.id,
            accepted_receipt_id: "ptlr_fixture",
            rollback_receipt_id: "ptlr_inverse_fixture",
            removed_at: "2026-08-07T10:02:00.000Z",
          });
        }
        return Response.json(init?.method === "POST"
          ? {
            mode: "apply",
            action: "created",
            project,
            task_list: taskList,
            receipt: {
              schema_version: "todos.project-task-list-ensure.v1",
              receipt_id: "ptlr_fixture",
              idempotency_key: "dubai-fraud-default-list",
              project_id: project.id,
              task_list_id: taskList.id,
              slug: taskList.slug,
              created_by_operation: true,
              result_revision: taskList.updated_at,
              result_digest: "fixture-digest",
              rollback_supported: true,
              created_at: taskList.created_at,
            },
          }
          : { mode: "plan", action: "would_create", project, task_list: null, receipt: null },
          { status: init?.method === "POST" ? 201 : 200 });
      }) as typeof fetch,
    });

    expect((await client.planProjectTaskListEnsure(project.id)).action).toBe("would_create");
    expect((await client.ensureProjectTaskList(project.id, {
      expected_project_revision: project.updated_at,
      idempotency_key: "dubai-fraud-default-list",
    })).action).toBe("created");
    expect((await client.rollbackProjectTaskListEnsure(project.id, {
      receipt_id: "ptlr_fixture",
      expected_task_list_revision: taskList.updated_at,
    })).action).toBe("removed");
    expect(calls).toEqual([
      { method: "GET", path: "/v1/projects/project%2Fone/task-list/ensure", body: undefined },
      {
        method: "POST",
        path: "/v1/projects/project%2Fone/task-list/ensure",
        body: JSON.stringify({
          expected_project_revision: project.updated_at,
          idempotency_key: "dubai-fraud-default-list",
        }),
      },
      {
        method: "POST",
        path: "/v1/projects/project%2Fone/task-list/rollback",
        body: JSON.stringify({
          receipt_id: "ptlr_fixture",
          expected_task_list_revision: taskList.updated_at,
        }),
      },
    ]);
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
    expect(document.paths["/v1/plans/{id}/project-link"].get.operationId).toBe("planPlanProjectLink");
    expect(document.paths["/v1/plans/{id}/project-link"].post.operationId).toBe("applyPlanProjectLink");
    expect(document.paths["/v1/plans/{id}/project-link/rollback"].post.operationId).toBe("rollbackPlanProjectLink");
    expect(document.components.schemas.PlanProjectLinkApplyInput).toMatchObject({
      additionalProperties: false,
      required: ["project_id", "expected_plan_revision", "expected_project_revision", "idempotency_key"],
    });
    expect(document.components.schemas.PlanProjectLinkRollbackInput).toMatchObject({
      additionalProperties: false,
      required: ["project_id", "receipt_id", "expected_plan_revision"],
    });
    expect(document.components.schemas.CreateTaskInput.properties.plan_id).toEqual({ type: "string" });
    expect(document.components.schemas.UpdateTaskInput.properties.plan_id).toEqual({ type: "string", nullable: true });
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

  test("generated SDK sends guarded link, rollback, and future membership bodies exactly", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const plan = {
      id: "plan/one",
      slug: "plan-one",
      project_id: null,
      task_list_id: null,
      agent_id: null,
      name: "Plan one",
      description: null,
      status: "active" as const,
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:01:00.000Z",
    };
    const project = {
      id: "project/one",
      name: "Project one",
      path: "/workspace/project-one",
      description: null,
      task_list_id: null,
      task_prefix: null,
      machine_paths: [],
      metadata: {},
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:02:00.000Z",
    };
    const client = new TodosV1Client({
      baseUrl: "https://todos.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const url = String(input);
        calls.push({ method, url, body: init?.body as string | undefined });
        if (url.endsWith("/rollback")) {
          return Response.json({
            schema_version: "todos.plan-project-link.v1",
            action: "restored",
            plan,
            tasks: [],
            accepted_receipt_id: "ppl_fixture",
            rollback_receipt_id: "pplr_fixture",
            restored_at: "2026-08-07T00:03:00.000Z",
          });
        }
        if (url.endsWith("/tasks")) {
          const body = JSON.parse(String(init?.body)) as { title: string; plan_id: string };
          return Response.json({ task: { id: "task-one", ...body, project_id: project.id } }, { status: 201 });
        }
        const applied = method === "POST";
        return Response.json({
          mode: applied ? "apply" : "plan",
          action: applied ? "linked" : "would_link",
          plan: applied ? { ...plan, project_id: project.id } : plan,
          project,
          tasks: [],
          receipt: applied ? {
            schema_version: "todos.plan-project-link.v1",
            receipt_id: "ppl_fixture",
            idempotency_key: "plan-project-link-fixture",
            plan_id: plan.id,
            project_id: project.id,
            prior_plan_project_id: null,
            prior_task_project_ids: {},
            task_ids: [],
            task_count: 0,
            result_plan_revision: plan.updated_at,
            result_digest: "fixture-digest",
            rollback_supported: true,
            created_at: "2026-08-07T00:03:00.000Z",
          } : null,
        }, { status: applied ? 201 : 200 });
      }) as typeof fetch,
    });

    expect((await client.planPlanProjectLink(plan.id, { project_id: project.id })).action).toBe("would_link");
    expect((await client.applyPlanProjectLink(plan.id, {
      project_id: project.id,
      expected_plan_revision: plan.updated_at,
      expected_project_revision: project.updated_at,
      idempotency_key: "plan-project-link-fixture",
    })).action).toBe("linked");
    expect((await client.rollbackPlanProjectLink(plan.id, {
      project_id: project.id,
      receipt_id: "ppl_fixture",
      expected_plan_revision: plan.updated_at,
    })).action).toBe("restored");
    expect((await client.createTask({ title: "Future member", plan_id: plan.id })).task?.project_id).toBe(project.id);

    expect(calls.map((call) => ({
      method: call.method,
      path: `${new URL(call.url).pathname}${new URL(call.url).search}`,
      body: call.body,
    }))).toEqual([
      {
        method: "GET",
        path: "/v1/plans/plan%2Fone/project-link?project_id=project%2Fone",
        body: undefined,
      },
      {
        method: "POST",
        path: "/v1/plans/plan%2Fone/project-link",
        body: JSON.stringify({
          project_id: project.id,
          expected_plan_revision: plan.updated_at,
          expected_project_revision: project.updated_at,
          idempotency_key: "plan-project-link-fixture",
        }),
      },
      {
        method: "POST",
        path: "/v1/plans/plan%2Fone/project-link/rollback",
        body: JSON.stringify({
          project_id: project.id,
          receipt_id: "ppl_fixture",
          expected_plan_revision: plan.updated_at,
        }),
      },
      {
        method: "POST",
        path: "/v1/tasks",
        body: JSON.stringify({ title: "Future member", plan_id: plan.id }),
      },
    ]);
  });
});
