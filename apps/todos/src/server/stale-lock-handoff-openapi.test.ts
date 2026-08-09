import { describe, expect, test } from "bun:test";
import {
  TodosV1Client,
  type StaleLockHandoffInput,
  type StaleLockHandoffReceipt,
} from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";

const TASK_ID = "a1000000-0000-4000-8000-000000000001";
const PREVIOUS_VERSION = "2026-08-09T08:00:00.000Z";
const NEW_VERSION = "2026-08-09T10:00:00.000Z";

describe("stale-lock handoff OpenAPI contract", () => {
  test("publishes explicit CAS inputs, exact-id routing, receipt fields, and conflict responses", () => {
    const document = buildV1OpenApiDocument("test");
    const operation = document.paths["/v1/tasks/{id}/stale-lock-handoff"].post;
    const input = document.components.schemas.StaleLockHandoffInput;
    const receipt = document.components.schemas.StaleLockHandoffReceipt;

    expect(operation.operationId).toBe("handoffStaleTaskLock");
    expect(operation.parameters).toEqual([
      expect.objectContaining({
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      }),
    ]);
    expect(input).toMatchObject({
      additionalProperties: false,
      required: [
        "expected_holder",
        "expected_lock_version",
        "stale_after_seconds",
        "new_holder",
        "reason",
      ],
    });
    expect(Object.keys(input.properties)).toEqual([
      "expected_holder",
      "expected_lock_version",
      "stale_after_seconds",
      "new_holder",
      "reason",
    ]);
    expect(input.properties.expected_lock_version).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(input.properties.stale_after_seconds).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(receipt.required).toEqual([
      "schema_version",
      "receipt_id",
      "task_id",
      "actor",
      "previous_holder",
      "previous_lock_version",
      "new_holder",
      "new_lock_version",
      "stale_after_seconds",
      "stale_cutoff",
      "reason",
      "created_at",
    ]);
    expect(operation.responses["403"]).toBeDefined();
    expect(operation.responses["404"]).toBeDefined();
    expect(operation.responses["409"]).toBeDefined();
  });

  test("generated SDK sends every caller-supplied guard without adding an actor default", async () => {
    const body: StaleLockHandoffInput = {
      expected_holder: "holder-a",
      expected_lock_version: PREVIOUS_VERSION,
      stale_after_seconds: 3600,
      new_holder: "nausicaa",
      reason: "Recover abandoned task after the stale threshold",
    };
    const receipt: StaleLockHandoffReceipt = {
      schema_version: "todos.stale-lock-handoff.v1",
      receipt_id: "b1000000-0000-4000-8000-000000000001",
      task_id: TASK_ID,
      actor: "nausicaa",
      previous_holder: "holder-a",
      previous_lock_version: PREVIOUS_VERSION,
      new_holder: "nausicaa",
      new_lock_version: NEW_VERSION,
      stale_after_seconds: 3600,
      stale_cutoff: "2026-08-09T09:00:00.000Z",
      reason: body.reason,
      created_at: NEW_VERSION,
    };
    const requests: Request[] = [];
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.invalid",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ receipt });
      },
    });

    const result = await client.handoffStaleTaskLock(TASK_ID, body);

    expect(result.receipt).toEqual(receipt);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("POST");
    expect(new URL(requests[0]!.url).pathname)
      .toBe(`/v1/tasks/${TASK_ID}/stale-lock-handoff`);
    expect(await requests[0]!.json()).toEqual(body);
    expect(Object.hasOwn(body, "actor")).toBe(false);
  });
});
