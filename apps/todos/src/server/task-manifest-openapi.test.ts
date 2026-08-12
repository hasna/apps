import { describe, expect, test } from "bun:test";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";

describe("task-manifest binding lookup OpenAPI and generated SDK", () => {
  test("publishes the tenant-bearing capability and explicit creator contracts", () => {
    const document = buildV1OpenApiDocument() as Record<string, any>;
    const capability = document.paths["/v1/task-manifest/capability"].get;

    expect(capability.operationId).toBe("getTaskManifestCapability");
    expect(capability.responses["200"].content["application/json"].schema)
      .toEqual({ $ref: "#/components/schemas/TaskManifestCapabilityResponse" });
    expect(document.components.schemas.TaskManifestCapability).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining(["authority", "route", "schema_version", "tenant_id", "backend", "bounds"]),
      properties: {
        tenant_id: { type: "string", minLength: 1, maxLength: 200 },
        operation_step_identity: { type: "boolean", enum: [true] },
        deterministic_idempotency_keys: { type: "boolean", enum: [true] },
        terminal_nonacceptance_receipts: { type: "boolean", enum: [true] },
        plan_slug_provenance: { type: "string", enum: ["deterministic-v1"] },
      },
    });
    expect(document.components.schemas.TaskManifestCapabilityResponse).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["capability"],
      properties: {
        capability: { $ref: "#/components/schemas/TaskManifestCapability" },
      },
    });

    expect(document.components.schemas.CreateTaskInput.properties.created_by)
      .toEqual({ type: "string" });
    expect(document.components.schemas.Task.properties.created_by)
      .toEqual({ type: "string", nullable: true });
  });

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
        "operation_id",
        "plan_id",
        "route",
        "schema_version",
        "state",
        "step_id",
        "tenant_id",
      ]);
  });

  test("publishes apply, exact readback, and compensation contracts", () => {
    const document = buildV1OpenApiDocument() as Record<string, any>;
    expect(document.paths["/v1/task-manifest/apply"].post.operationId).toBe("applyTaskManifest");
    expect(document.paths["/v1/task-manifest/read-exact"].post.operationId).toBe("readExactTaskManifest");
    expect(document.paths["/v1/task-manifest/compensate"].post.operationId).toBe("compensateTaskManifest");
    expect(document.components.schemas.TaskManifest.required).toEqual(expect.arrayContaining([
      "operation_id", "step_id", "idempotency_key", "precondition_digest",
    ]));
    expect(document.components.schemas.TaskManifestCompensateRequest.required).toEqual([
      "receipt_id", "operation_id", "step_id", "idempotency_key", "precondition_digest", "if_binding_version",
    ]);
  });

  test("generated SDK posts the exact plan lookup request to the package route", async () => {
    const requests: Request[] = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.invalid",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (new URL(request.url).pathname === "/v1/task-manifest/capability") {
          return Response.json({
            capability: {
              authority: "todos",
              route: "todos.task-manifest.v1",
              schema_version: 1,
              tenant_id: "tenant-sdk-lookup",
              backend: "http",
              deterministic_ids: true,
              operation_step_identity: true,
              deterministic_idempotency_keys: true,
              terminal_nonacceptance_receipts: true,
              plan_slug_provenance: "deterministic-v1",
              immutable_receipts: true,
              transactional_outbox: true,
              idempotent_outbox_delivery: true,
              exact_bounded_readback: true,
              conditional_compensation: true,
              transcript_safe: false,
              bounds: {
                tasks: 100,
                dependencies: 200,
                comments: 200,
                verifications: 200,
                effects: 50,
                metadata_fields: 100,
                effect_payload_fields: 100,
                request_bytes: 262144,
                response_bytes: 262144,
              },
            },
          });
        }
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
    const capability = await client.getTaskManifestCapability();
    expect(capability.capability.tenant_id).toBe("tenant-sdk-lookup");
    await client.lookupTaskManifestBinding({
      authority: "todos",
      route: "todos.task-manifest.v1",
      schema_version: 1,
      tenant_id: "tenant-sdk-lookup",
      plan_id: "a0000000-0000-4000-8000-000000000099",
      max_items: 1,
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /v1/task-manifest/capability",
      "POST /v1/task-manifest/bindings/lookup",
    ]);
  });
});
