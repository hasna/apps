import { describe, expect, test } from "bun:test";
import type { StoredWorkflowEvent, WorkflowSpec } from "../types.js";
import {
  createPrivateOperationDescriptor,
  lookupOperationReceiptState,
  operationAdmissionReceipt,
  operationTerminalReceipt,
} from "./operation-contract.js";

const workflow: WorkflowSpec = {
  id: "workflow-private",
  name: "private workflow",
  version: 7,
  status: "active",
  steps: [{
    id: "deliver",
    target: {
      type: "agent",
      provider: "codewith",
      prompt: "NON_SENSITIVE_OPERATION_SENTINEL",
      cwd: "/private/worktree",
      authProfile: "private-profile",
    },
  }],
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:01.000Z",
};

const authority = { authorityId: "loops-control-plane", tenantId: "tenant-a" };

function event(
  sequence: number,
  eventType: StoredWorkflowEvent["eventType"],
  payload: Record<string, unknown>,
): StoredWorkflowEvent {
  return {
    id: `event-${sequence}`,
    workflowRunId: "workflow-run-a",
    sequence,
    eventType,
    stepId: "deliver",
    payload,
    createdAt: `2026-08-09T00:00:0${sequence}.000Z`,
  };
}

describe("private operation descriptors and receipts", () => {
  test("stable ids bind the exact workflow revision, authority, tenant, step, attempt, and idempotency key", () => {
    const input = {
      workflow,
      workflowRunId: "workflow-run-a",
      step: workflow.steps[0]!,
      attempt: 2,
      idempotencyKey: "idempotency-a",
      authority,
    };
    const first = createPrivateOperationDescriptor(input);
    const duplicate = createPrivateOperationDescriptor(input);
    const wrongTenant = createPrivateOperationDescriptor({
      ...input,
      authority: { ...authority, tenantId: "tenant-b" },
    });
    expect(first).toEqual(duplicate);
    expect(first.operationId).not.toBe(wrongTenant.operationId);
    expect(first.target).toMatchObject({
      prompt: "NON_SENSITIVE_OPERATION_SENTINEL",
      cwd: "/private/worktree",
      authProfile: "private-profile",
    });
  });

  test("finite lookup distinguishes positive, wrong-authority, wrong-scope, duplicate, and missing-result controls", () => {
    const descriptor = createPrivateOperationDescriptor({
      workflow,
      workflowRunId: "workflow-run-a",
      step: workflow.steps[0]!,
      idempotencyKey: "idempotency-a",
      authority,
    });
    const admission = operationAdmissionReceipt(descriptor);
    const terminal = operationTerminalReceipt(descriptor, {
      status: "succeeded",
      exitCode: 0,
      durationMs: 10,
      stdout: "NON_SENSITIVE_RESULT_SENTINEL",
      stderr: "",
    });
    const events = [
      event(1, "private_operation_descriptor", descriptor as unknown as Record<string, unknown>),
      event(2, "private_operation_admitted", admission as unknown as Record<string, unknown>),
      event(3, "private_operation_terminal", terminal as unknown as Record<string, unknown>),
    ];

    expect(lookupOperationReceiptState(events, {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
      operationId: descriptor.operationId,
    })).toMatchObject({
      descriptor: { operationId: descriptor.operationId },
      admission: { state: "admitted" },
      terminal: { state: "succeeded", resultRef: terminal.resultRef },
    });
    expect(() => lookupOperationReceiptState(events, {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority: { ...authority, tenantId: "tenant-b" },
    })).toThrow("authority mismatch");
    expect(() => lookupOperationReceiptState(events, {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
      operationId: "operation:sha256:wrong",
    })).toThrow("scope mismatch");
    expect(() => lookupOperationReceiptState([...events, event(
      4,
      "private_operation_terminal",
      terminal as unknown as Record<string, unknown>,
    )], {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
    })).toThrow("duplicate operation terminal receipt");
    expect(() => lookupOperationReceiptState([
      events[0]!,
      event(2, "private_operation_terminal", {
        ...terminal,
        resultRef: "",
      } as unknown as Record<string, unknown>),
    ], {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
    })).toThrow("resultRef");
    expect(() => lookupOperationReceiptState(events, {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
    }, { maxRecords: 2, maxBytes: 512 * 1024, maxWallMs: 100 })).toThrow("record cap");
  });
});
