process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { registerProject } from "../db/projects.js";
import { matchRoute } from "./router.js";
import { buildOpenApiDocument } from "./openapi.js";
import "./routes/projects.js";

beforeEach(() => {
  resetDatabase();
});

describe("project resource producer routes", () => {
  test("lists a bounded page and reads one exact project-owned resource", async () => {
    const project = registerProject("API Resources", "/projects/api-resources");
    const memory = createMemory({
      key: "api-resource",
      value: "api",
      category: "history",
      project_id: project.id,
    });

    const list = matchRoute("GET", `/api/projects/${project.id}/resources`);
    expect(list).not.toBeNull();
    const listRequest = new Request(
      `http://mementos.test/api/projects/${project.id}/resources?limit=1`,
    );
    const listResponse = await list!.handler(
      listRequest,
      new URL(listRequest.url),
      list!.params,
    );
    const listBody = await listResponse.json() as Record<string, unknown>;
    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({
      project_id: project.id,
      count: 1,
      total: 2,
      has_more: true,
      complete: true,
      truncated: false,
    });

    const exact = matchRoute(
      "GET",
      `/api/projects/${project.id}/resources/memory/${memory.id}`,
    );
    expect(exact).not.toBeNull();
    const exactRequest = new Request(
      `http://mementos.test/api/projects/${project.id}/resources/memory/${memory.id}`,
    );
    const exactResponse = await exact!.handler(
      exactRequest,
      new URL(exactRequest.url),
      exact!.params,
    );
    expect(exactResponse.status).toBe(200);
    await expect(exactResponse.json()).resolves.toMatchObject({
      project_id: project.id,
      resource: {
        resource_kind: "memory",
        stable_id: memory.id,
      },
    });
  });

  test("publishes typed page and exact-read OpenAPI surfaces", () => {
    const document = buildOpenApiDocument("test");
    const paths = document["paths"] as Record<string, Record<string, any>>;
    const components = document["components"] as Record<string, any>;

    expect(paths["/v1/projects/{id}/resources"]?.["get"]).toMatchObject({
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "limit", in: "query" }),
        expect.objectContaining({ name: "cursor", in: "query" }),
        expect.objectContaining({ name: "resource_kinds", in: "query" }),
      ]),
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MementosProjectResourcePage" },
            },
          },
        },
      },
    });
    expect(paths["/v1/projects/{id}/resources/{kind}/{resource_id}"]?.["get"])
      .toMatchObject({
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MementosProjectResourceExactResult" },
              },
            },
          },
        },
      });
    expect(components["schemas"]).toHaveProperty("MementosProjectResource");
    expect(components["schemas"]).toHaveProperty("MementosProjectResourcePage");
    expect(components["schemas"]).toHaveProperty("MementosProjectResourceExactResult");
  });
});
