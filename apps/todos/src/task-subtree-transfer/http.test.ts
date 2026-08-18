import { describe, expect, test } from "bun:test";
import {
  createTodosTaskSubtreeTransferHttpClient,
  handleTodosTaskSubtreeTransferHttpRequest,
  type TodosTaskSubtreeTransferAuthority,
  type TodosTaskSubtreeTransferCapability,
  type TodosTaskSubtreeTransferInspection,
  type TodosTaskSubtreeTransferResult,
} from "./index.js";

const capability: TodosTaskSubtreeTransferCapability = {
  authority: "todos",
  route: "todos.task-subtree-transfer.v1",
  schema_version: 1,
  tenant_id: "http-test",
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
};

const inspection: TodosTaskSubtreeTransferInspection = {
  source_project_id: "10000000-0000-4000-8000-000000000001",
  destination_project_id: "20000000-0000-4000-8000-000000000002",
  destination_task_list_id: "30000000-0000-4000-8000-000000000003",
  root_task_id: "40000000-0000-4000-8000-000000000004",
  destination_parent_id: null,
  expected_root_parent_id: null,
  source_population_digest: "a".repeat(64),
  expected_tasks: [{ task_id: "40000000-0000-4000-8000-000000000004", version: 1 }],
  contained_plan_ids: [],
  shared_plan_ids: [],
  complete: true,
};

const result = {
  duplicate: false,
  receipt: {
    receipt_id: "50000000-0000-4000-8000-000000000005",
    authority: "todos",
    route: "todos.task-subtree-transfer.v1",
    schema_version: 1,
    kind: "apply",
    operation_id: "http-test",
    step_id: "apply",
    idempotency_key: "tstk_http-test",
    request_digest: "b".repeat(64),
    precondition_digest: "c".repeat(64),
    result_digest: "d".repeat(64),
    apply_receipt_id: null,
    source_project_id: inspection.source_project_id,
    destination_project_id: inspection.destination_project_id,
    destination_task_list_id: inspection.destination_task_list_id,
    root_task_id: inspection.root_task_id,
    source_population_digest: inspection.source_population_digest,
    prior_image: { tasks: [], plans: [] },
    post_image: { tasks: [], plans: [] },
    shared_plan_splits: [],
    created_at: "2026-08-18T20:00:00.000Z",
  },
  moved_task_ids: [inspection.root_task_id],
  moved_plan_ids: [],
  complete: true,
} satisfies TodosTaskSubtreeTransferResult;

function authority(): TodosTaskSubtreeTransferAuthority {
  return {
    capability: async () => capability,
    inspect: async () => inspection,
    apply: async () => result,
    readExact: async () => result,
    rollback: async () => result,
  };
}

describe("task-subtree-transfer HTTP surface", () => {
  test("serves the capability and rejects unknown routes", async () => {
    const auth = authority();
    const capabilityUrl = new URL("https://todos.example.test/v1/task-subtree-transfer/capability");
    const capabilityResponse = await handleTodosTaskSubtreeTransferHttpRequest(
      new Request(capabilityUrl),
      capabilityUrl,
      auth,
    );
    expect(capabilityResponse?.status).toBe(200);
    expect(await capabilityResponse!.json()).toEqual({ capability });

    const unknownUrl = new URL("https://todos.example.test/v1/task-subtree-transfer/unknown");
    const unknownResponse = await handleTodosTaskSubtreeTransferHttpRequest(
      new Request(unknownUrl, { method: "POST", body: "{}" }),
      unknownUrl,
      auth,
    );
    expect(unknownResponse?.status).toBe(404);
  });

  test("client and handler preserve all dedicated route envelopes", async () => {
    const auth = authority();
    const client = createTodosTaskSubtreeTransferHttpClient({
      baseUrl: "https://todos.example.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const response = await handleTodosTaskSubtreeTransferHttpRequest(request, url, auth);
        if (!response) throw new Error("route did not match");
        return response;
      },
    });

    expect(await client.capability()).toEqual(capability);
    expect(await client.inspect(inspection)).toEqual(inspection);
    expect(await client.apply({})).toEqual(result);
    expect(await client.readExact(result.receipt.receipt_id)).toEqual(result);
    expect(await client.rollback({})).toEqual(result);
  });
});
