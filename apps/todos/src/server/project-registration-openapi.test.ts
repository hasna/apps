import { describe, expect, test } from "bun:test";
import {
  TodosV1Client,
  type ProjectRegistrationRequest,
} from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";

describe("project-registration OpenAPI and generated SDK", () => {
  test("publishes bind-existing and bounded project-resource capability contracts", () => {
    const document = buildV1OpenApiDocument() as Record<string, any>;
    expect(document.paths["/v1/project-registration/capability"].get.operationId)
      .toBe("getProjectRegistrationCapability");
    expect(document.paths["/v1/project-registration/resources"].get.operationId)
      .toBe("listProjectRegistrationResources");
    expect(document.paths["/v1/project-registration/resources"].get.responses["409"])
      .toMatchObject({
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      });
    expect(document.components.schemas.ProjectRegistrationCapability).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "bind_existing_adoption",
        "project_resource_enumeration",
        "project_resource_page_limit",
      ]),
      properties: {
        bind_existing_adoption: { type: "boolean", enum: [true] },
        project_resource_enumeration: { type: "boolean", enum: [true] },
        project_resource_page_limit: { type: "integer", minimum: 1 },
      },
    });
    expect(document.components.schemas.ProjectRegistrationRequest.properties.bind_existing)
      .toEqual({ type: "boolean" });
    expect(document.components.schemas.ProjectResourcePage).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "resources",
        "collection_revision",
        "has_more",
        "next_cursor",
        "complete",
        "truncated",
      ]),
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
        collection_revision: { type: "string" },
        truncated: { type: "boolean", enum: [false] },
      },
    });
  });

  test("generated SDK exposes every project-registration route with exact query and bodies", async () => {
    const requests: Request[] = [];
    const receipt = {
      receipt_id: "tpr_fixture",
      authority: "todos",
      route: "todos.project-registration.v1",
      package_version: "test",
      authority_id: "todos",
      tenant_id: "tenant",
      corpus_id: "corpus",
      operation_id: "operation-fixture",
      step_id: "step-fixture",
      resource_kind: "project",
      direction: "forward",
      idempotency_key: "prk_fixture",
      request_digest: "a".repeat(64),
      precondition_digest: "b".repeat(64),
      outcome: "accepted",
      reason: null,
      target_id: "11111111-1111-4111-8111-111111111111",
      result_revision: "2026-08-11T00:00:00.000Z",
      result_digest: "c".repeat(64),
      duplicate_of_receipt_id: null,
      accepted_receipt_id: null,
      created_by_operation: false,
      created_at: "2026-08-11T00:00:00.000Z",
    } as const;
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.invalid",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/capability")) {
          return Response.json({
            capability: {
              authority: "todos",
              route: "todos.project-registration.v1",
              package_version: "test",
              authority_id: "todos",
              tenant_id: "tenant",
              corpus_id: "corpus",
              supported_resources: ["project", "task_list"],
              conditional_create: true,
              immutable_receipts: true,
              exact_terminal_lookup: true,
              exact_readback: true,
              bind_existing_adoption: true,
              project_resource_enumeration: true,
              project_resource_page_limit: 500,
              conditional_inverse: true,
              ambiguous_outcome_reconciliation: true,
            },
          });
        }
        if (path.endsWith("/resources")) {
          return Response.json({
            page: {
              authority: "todos",
              route: "todos.project-registration.v1",
              package_version: "test",
              authority_id: "todos",
              tenant_id: "tenant",
              corpus_id: "corpus",
              source_project_id: "wks_sdkfixture0001",
              todos_project_id: receipt.target_id,
              task_list_id: "22222222-2222-4222-8222-222222222222",
              include_anchors: true,
              collection_revision: "sha256:" + "d".repeat(64),
              limit: 2,
              count: 0,
              resources: [],
              has_more: false,
              next_cursor: null,
              complete: true,
              truncated: false,
            },
          });
        }
        if (path.endsWith("/read-exact")) {
          return Response.json({
            record: {
              target_id: receipt.target_id,
              revision: receipt.result_revision,
              digest: receipt.result_digest,
            },
          });
        }
        if (path.endsWith("/receipts/lookup")) {
          return Response.json({
            receipt,
            response_control: {
              response_byte_limit: 65536,
              time_budget_ms: 5000,
              response_bytes: 1,
              elapsed_ms: 0,
              complete: true,
              truncated: false,
            },
          });
        }
        if (path.endsWith("/verify-inverse")) {
          return Response.json({
            verification: {
              target_id: receipt.target_id,
              accepted_receipt_id: receipt.receipt_id,
              absent: true,
              digest: receipt.result_digest,
            },
          });
        }
        return Response.json({ receipt }, { status: 201 });
      },
    });
    const request = {
      operation_id: "operation-fixture",
      step_id: "step-fixture",
      resource_kind: "project",
      direction: "forward",
      authority_route: "todos.project-registration.v1",
      package_version: "test",
      authority_id: "todos",
      tenant_id: "tenant",
      corpus_id: "corpus",
      target_selector: "wks_sdkfixture0001",
      idempotency_key: "prk_fixture",
      request_digest: "a".repeat(64),
      precondition_digest: "b".repeat(64),
      project_id: "wks_sdkfixture0001",
      project_slug: "sdk-fixture",
      project_name: "SDK fixture",
      desired: {},
      bind_existing: true,
      response_byte_limit: 65536,
      time_budget_ms: 5000,
    } satisfies ProjectRegistrationRequest;

    await client.getProjectRegistrationCapability();
    await client.createProjectRegistrationResource(request);
    await client.readExactProjectRegistrationResource({
      resource_kind: "project",
      target_id: receipt.target_id,
      response_byte_limit: 65536,
      time_budget_ms: 5000,
    });
    await client.lookupProjectRegistrationReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "todos",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      max_items: 1,
      response_byte_limit: 65536,
      time_budget_ms: 5000,
    });
    await client.listProjectRegistrationResources({
      source_project_id: request.project_id,
      include_anchors: true,
      limit: 2,
      cursor: "cursor-fixture",
    });
    await client.compensateProjectRegistrationResource(request);
    await client.verifyInverseProjectRegistrationResource(request);

    expect(requests.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual([
      "GET /v1/project-registration/capability",
      "POST /v1/project-registration/create",
      "POST /v1/project-registration/read-exact",
      "POST /v1/project-registration/receipts/lookup",
      "GET /v1/project-registration/resources",
      "POST /v1/project-registration/compensate",
      "POST /v1/project-registration/verify-inverse",
    ]);
    expect(new URL(requests[4]!.url).searchParams.get("source_project_id"))
      .toBe("wks_sdkfixture0001");
    expect(new URL(requests[4]!.url).searchParams.get("include_anchors")).toBe("true");
    expect(new URL(requests[4]!.url).searchParams.get("limit")).toBe("2");
    expect(new URL(requests[4]!.url).searchParams.get("cursor")).toBe("cursor-fixture");
    expect(await requests[1]!.json()).toMatchObject({ bind_existing: true });
  });
});
