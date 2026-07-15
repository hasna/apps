import { describe, expect, test } from "bun:test";
import { buildV1OpenApiDocument } from "./openapi.js";
import { TodosV1Client } from "../sdk/v1.generated.js";

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

describe("project mutation OpenAPI contract", () => {
  test("keeps slug fields out of generic create/update and exposes atomic rename", () => {
    const document = buildV1OpenApiDocument("test");
    const createProperties = document.components.schemas.CreateProjectInput.properties;
    const updateProperties = document.components.schemas.UpdateProjectInput.properties;

    expect(Object.keys(createProperties)).toEqual(["name", "path", "description"]);
    expect(Object.keys(updateProperties)).toEqual(["name", "path", "description"]);
    expect(document.paths["/v1/projects"].post.responses["409"]).toBeDefined();
    expect(document.paths["/v1/projects/{id}/rename"].post.operationId).toBe("renameProject");
    expect(document.paths["/v1/projects/{id}/rename"].post.responses["409"]).toBeDefined();
  });
});
