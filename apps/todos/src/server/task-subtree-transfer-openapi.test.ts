import { describe, expect, test } from "bun:test";
import { TodosV1Client } from "../sdk/v1.generated.js";
import type { TodosTaskSubtreeTransferAuthority } from "../task-subtree-transfer/index.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

describe("task-subtree-transfer OpenAPI and generated SDK", () => {
  test("publishes the exact inspect/apply/rollback contract", () => {
    const document = buildV1OpenApiDocument() as Record<string, any>;
    expect(document.paths["/v1/task-subtree-transfer/capability"].get.operationId)
      .toBe("getTaskSubtreeTransferCapability");
    expect(document.paths["/v1/task-subtree-transfer/inspect"].post.operationId)
      .toBe("inspectTaskSubtreeTransfer");
    expect(document.paths["/v1/task-subtree-transfer/apply"].post.operationId)
      .toBe("applyTaskSubtreeTransfer");
    expect(document.paths["/v1/task-subtree-transfer/read-exact"].post.operationId)
      .toBe("readExactTaskSubtreeTransfer");
    expect(document.paths["/v1/task-subtree-transfer/rollback"].post.operationId)
      .toBe("rollbackTaskSubtreeTransfer");
    expect(document.components.schemas.TaskSubtreeTransferApplyRequest.required).toEqual(expect.arrayContaining([
      "version",
      "operation_id",
      "step_id",
      "idempotency_key",
      "precondition_digest",
      "expected_tasks",
      "shared_plan_splits",
    ]));
    expect(document.components.schemas.TaskSubtreeTransferReceipt.properties.prior_image)
      .toEqual({ $ref: "#/components/schemas/TaskSubtreeTransferImage" });
  });

  test("generated SDK calls the dedicated task-subtree-transfer routes", async () => {
    const paths: string[] = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.invalid",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        paths.push(new URL(request.url).pathname);
        if (new URL(request.url).pathname.endsWith("/capability")) {
          return Response.json({
            capability: {
              authority: "todos",
              route: "todos.task-subtree-transfer.v1",
              schema_version: 1,
              tenant_id: "sdk-test",
              backend: "http",
              exact_descendant_closure: true,
              complete_source_population_digest: true,
              per_task_version_cas: true,
              explicit_shared_plan_splits: true,
              atomic_apply: true,
              immutable_forward_inverse_receipts: true,
              prior_image_receipts: true,
              cas_protected_rollback: true,
              preserves_descendant_parent_ids: true,
              preserves_task_and_relation_identities: true,
            },
          });
        }
        return Response.json({
          result: {
            duplicate: false,
            receipt: {
              receipt_id: "50000000-0000-4000-8000-000000000005",
              authority: "todos",
              route: "todos.task-subtree-transfer.v1",
              schema_version: 1,
              kind: "apply",
              operation_id: "sdk-test",
              step_id: "apply",
              idempotency_key: "tstk_sdk-test",
              request_digest: "b".repeat(64),
              precondition_digest: "c".repeat(64),
              result_digest: "d".repeat(64),
              apply_receipt_id: null,
              source_project_id: "10000000-0000-4000-8000-000000000001",
              destination_project_id: "20000000-0000-4000-8000-000000000002",
              destination_task_list_id: "30000000-0000-4000-8000-000000000003",
              root_task_id: "40000000-0000-4000-8000-000000000004",
              source_population_digest: "a".repeat(64),
              prior_image: { tasks: [], plans: [] },
              post_image: { tasks: [], plans: [] },
              shared_plan_splits: [],
              created_at: "2026-08-18T20:00:00.000Z",
            },
            moved_task_ids: [],
            moved_plan_ids: [],
            complete: true,
          },
        });
      },
    });

    await client.getTaskSubtreeTransferCapability();
    await client.inspectTaskSubtreeTransfer({
      source_project_id: "10000000-0000-4000-8000-000000000001",
      destination_project_id: "20000000-0000-4000-8000-000000000002",
      destination_task_list_id: "30000000-0000-4000-8000-000000000003",
      root_task_id: "40000000-0000-4000-8000-000000000004",
      destination_parent_id: null,
    });
    await client.applyTaskSubtreeTransfer({} as never);
    await client.readExactTaskSubtreeTransfer({ receipt_id: "50000000-0000-4000-8000-000000000005" });
    await client.rollbackTaskSubtreeTransfer({} as never);

    expect(paths).toEqual([
      "/v1/task-subtree-transfer/capability",
      "/v1/task-subtree-transfer/inspect",
      "/v1/task-subtree-transfer/apply",
      "/v1/task-subtree-transfer/read-exact",
      "/v1/task-subtree-transfer/rollback",
    ]);
  });

  test("production v1 router dispatches the dedicated authority before the generic store", async () => {
    const authority: TodosTaskSubtreeTransferAuthority = {
      capability: async () => ({
        authority: "todos",
        route: "todos.task-subtree-transfer.v1",
        schema_version: 1,
        tenant_id: "v1-test",
        backend: "http",
        exact_descendant_closure: true,
        complete_source_population_digest: true,
        per_task_version_cas: true,
        explicit_shared_plan_splits: true,
        atomic_apply: true,
        immutable_forward_inverse_receipts: true,
        prior_image_receipts: true,
        cas_protected_rollback: true,
        preserves_descendant_parent_ids: true,
        preserves_task_and_relation_identities: true,
      }),
      inspect: async () => {
        throw new Error("not exercised");
      },
      apply: async () => {
        throw new Error("not exercised");
      },
      readExact: async () => {
        throw new Error("not exercised");
      },
      rollback: async () => {
        throw new Error("not exercised");
      },
    };
    const dependencies: V1RequestDependencies = {
      getVerifier: () => ({
        authenticate: async () => ({
          ok: true,
          principal: { agent: "test", kid: "kid", scopes: ["todos:*"] },
        }),
      }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
      ensureSchema: async () => {},
      getTaskSubtreeTransferAuthority: () => authority,
    };
    const url = new URL("https://todos.example.test/v1/task-subtree-transfer/capability");
    const response = await handleV1Request(new Request(url), url, dependencies);
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      capability: { route: "todos.task-subtree-transfer.v1", backend: "http" },
    });
  });
});
