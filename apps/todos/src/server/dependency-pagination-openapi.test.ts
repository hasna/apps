import { expect, test } from "bun:test";
import { TodosV1Client, type DependencyPage } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";

const PAGE: DependencyPage = {
  dependencies: [{ task_id: "task-51", depends_on: "task-50" }],
  count: 1,
  total: 100,
  limit: 25,
  offset: 50,
  has_more: true,
  next_offset: 51,
};

test("OpenAPI documents the storage-bounded /v1/dependencies page contract", () => {
  const operation = buildV1OpenApiDocument().paths["/v1/dependencies"].get;
  expect(operation.operationId).toBe("listDependencies");
  expect(operation.description).toContain("LIMIT/OFFSET before materializing edges");
  expect(operation.parameters).toEqual([
    expect.objectContaining({
      name: "limit",
      in: "query",
      schema: expect.objectContaining({ minimum: 1, maximum: 500, default: 500 }),
    }),
    expect.objectContaining({
      name: "offset",
      in: "query",
      schema: expect.objectContaining({ minimum: 0, default: 0 }),
    }),
  ]);
  expect(operation.responses["200"].content["application/json"].schema)
    .toEqual({ $ref: "#/components/schemas/DependencyPage" });
});

test("generated SDK sends bounded dependency pagination arguments", async () => {
  const requests: string[] = [];
  const client = new TodosV1Client({
    baseUrl: "https://todos.example",
    apiKey: "fixture-key",
    fetch: async (input, init) => {
      requests.push(String(input));
      expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-key");
      return Response.json(PAGE);
    },
  });

  await expect(client.listDependencies({ limit: 25, offset: 50 })).resolves.toEqual(PAGE);
  expect(requests).toEqual(["https://todos.example/v1/dependencies?limit=25&offset=50"]);
});
