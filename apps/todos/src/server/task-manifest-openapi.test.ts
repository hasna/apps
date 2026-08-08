import { describe, expect, test } from "bun:test";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";

describe("task-manifest binding lookup OpenAPI and generated SDK", () => {
  test("publishes one exact bounded lookup contract with safe response fields only", () => {
    const document = buildV1OpenApiDocument() as Record<string, any>;
    const operation = document.paths["/v1/task-manifest/bindings/lookup"].post;
    expect(operation.operationId).toBe("lookupTaskManifestBinding");
    expect(operation.requestBody.content["application/json"].schema)
      .toEqual({ $ref: "#/components/schemas/TaskManifestBindingLookupRequest" });
    expect(document.components.schemas.TaskManifestBindingLookupRequest).toMatchObject({
      additionalProperties: false,
      required: ["authority", "route", "schema_version", "tenant_id", "plan_id", "max_items"],
      properties: {
        max_items: { type: "integer", enum: [1] },
        plan_id: { type: "string", format: "uuid" },
      },
    });
    expect(Object.keys(document.components.schemas.TaskManifestBindingLookupResult.properties).sort())
      .toEqual([
        "apply_receipt_id",
        "authority",
        "binding_version",
        "plan_id",
        "route",
        "schema_version",
        "state",
        "tenant_id",
      ]);
  });

  test("generated SDK posts the exact plan lookup request to the package route", async () => {
    const requests: Request[] = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.invalid",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          result: {
            authority: "todos",
            route: "todos.task-manifest.v1",
            schema_version: 1,
            tenant_id: "tenant-sdk-lookup",
            plan_id: "a0000000-0000-4000-8000-000000000099",
            apply_receipt_id: "b0000000-0000-4000-8000-000000000099",
            binding_version: 1,
            state: "applied",
          },
        });
      },
    });
    await client.lookupTaskManifestBinding({
      authority: "todos",
      route: "todos.task-manifest.v1",
      schema_version: 1,
      tenant_id: "tenant-sdk-lookup",
      plan_id: "a0000000-0000-4000-8000-000000000099",
      max_items: 1,
    });
    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/task-manifest/bindings/lookup");
  });
});
