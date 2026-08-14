import { describe, expect, test } from "bun:test";
import type { StoredWorkflowEvent, WorkflowSpec } from "../types.js";
import {
  createPrivateOperationDescriptor,
  DEFAULT_LOOP_MUTATION_LOOKUP_CAPS,
  loopMutationAdmissionReceipt,
  loopMutationTerminalReceipt,
  lookupOperationReceiptState,
  normalizeLoopMutationEnvelope,
  operationAdmissionReceipt,
  operationTerminalReceipt,
  publicLoopMutationResult,
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
    expect(first.descriptorRef).toBe("owner-operation-target:deliver");
    expect(first.descriptorDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("NON_SENSITIVE_OPERATION_SENTINEL");
    expect(JSON.stringify(first)).not.toContain("/private/worktree");
    expect(JSON.stringify(first)).not.toContain("private-profile");
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
    }, { maxCalls: 1, maxRecords: 2, maxBytes: 512 * 1024, maxWallMs: 100 })).toThrow("record cap");
    expect(() => lookupOperationReceiptState(events, {
      workflowRunId: "workflow-run-a",
      stepId: "deliver",
      authority,
    }, { maxCalls: 0, maxRecords: 3, maxBytes: 512 * 1024, maxWallMs: 100 })).toThrow("call cap");
  });

  test("loop mutation identity binds descriptor, plan, manifest, tenant, and full target id without raw target material", () => {
    const envelope = {
      schema: "openloops.loop_mutation.v1" as const,
      operationId: "operator-request-1",
      stepId: "pause-step",
      targetId: "0123456789abcdef0123456789abcdef",
      action: "pause" as const,
      expectedRevision: "2026-08-10T00:00:00.000Z",
      approvedPlanDigest: "1".repeat(64),
      manifestDigest: "2".repeat(64),
      descriptorRef: "owner-operation-target:loop-1",
      descriptorDigest: "3".repeat(64),
    };
    const binding = normalizeLoopMutationEnvelope(envelope, authority);
    const changedDescriptor = normalizeLoopMutationEnvelope(
      { ...envelope, descriptorDigest: "4".repeat(64) },
      authority,
    );
    const changedTenant = normalizeLoopMutationEnvelope(
      envelope,
      { ...authority, tenantId: "tenant-b" },
    );
    expect(binding.bindingDigest).not.toBe(changedDescriptor.bindingDigest);
    expect(binding.bindingDigest).not.toBe(changedTenant.bindingDigest);
    expect(JSON.stringify(binding)).not.toContain("prompt");
    expect(() => normalizeLoopMutationEnvelope(
      { ...envelope, targetId: "friendly-name" },
      authority,
    )).toThrow("full stable target id");

    const loop = {
      id: envelope.targetId,
      name: "private-name",
      labels: [],
      status: "paused" as const,
      schedule: { type: "interval" as const, everyMs: 60_000 },
      target: { type: "command" as const, command: "private-command" },
      catchUp: "latest" as const,
      catchUpLimit: 50,
      overlap: "skip" as const,
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:01.000Z",
    };
    const admission = loopMutationAdmissionReceipt(binding, loop.updatedAt);
    const terminal = loopMutationTerminalReceipt(binding, loop, loop.updatedAt);
    expect(admission).not.toHaveProperty("descriptorRef");
    expect(admission.descriptorCommitment).toMatch(/^loop-mutation-descriptor-ref:sha256:[a-f0-9]{64}$/);
    expect(admission.descriptorDigest).toBe(envelope.descriptorDigest);
    const publicResult = publicLoopMutationResult({
      binding,
      admission,
      terminal,
      loop,
      replayed: false,
    });
    expect(publicResult.binding).not.toHaveProperty("descriptorRef");
    expect(publicResult.binding.descriptorCommitment).toBe(admission.descriptorCommitment);
    expect(JSON.stringify(publicResult)).not.toContain(envelope.descriptorRef);
    expect(terminal.resultStatus).toBe("paused");
    expect(DEFAULT_LOOP_MUTATION_LOOKUP_CAPS).toEqual({
      maxCalls: 2,
      maxRecords: 2,
      maxBytes: 64 * 1024,
      maxWallMs: 250,
    });
  });

  test("loop mutation descriptor references accept only bounded canonical owner-operation-target ids", () => {
    const base = {
      schema: "openloops.loop_mutation.v1" as const,
      operationId: "operator-request-1",
      stepId: "pause-step",
      targetId: "0123456789abcdef0123456789abcdef",
      action: "pause" as const,
      expectedRevision: "2026-08-10T00:00:00.000Z",
      approvedPlanDigest: "1".repeat(64),
      manifestDigest: "2".repeat(64),
      descriptorDigest: "3".repeat(64),
    };
    expect(normalizeLoopMutationEnvelope({
      ...base,
      descriptorRef: "owner-operation-target:pause-step_01",
    }, authority).descriptorRef).toBe("owner-operation-target:pause-step_01");
    for (const descriptorRef of [
      "owner-operation-target:github-profile",
      "owner-operation-target:skip-project-step",
      "owner-operation-target:asia-region-step",
      "owner-operation-target:access-rotation-plan",
    ]) {
      expect(normalizeLoopMutationEnvelope({ ...base, descriptorRef }, authority).descriptorRef)
        .toBe(descriptorRef);
    }

    for (const descriptorRef of [
      "https://example.test/private",
      "owner-operation-target:step?token=synthetic",
      "owner-operation-target:step#fragment",
      "owner-operation-target:user@example.test",
      "owner-operation-target:step/child",
      "owner-operation-target:has whitespace",
      "owner-operation-target:line\nbreak",
      "owner-operation-target:token-synthetic",
      `owner-operation-target:ghp_${"a".repeat(36)}`,
      `owner-operation-target:gho_${"b".repeat(36)}`,
      `owner-operation-target:sk-${"c".repeat(32)}`,
      `owner-operation-target:sk-proj-${"d".repeat(32)}`,
      `owner-operation-target:xoxb-${"e".repeat(32)}`,
      `owner-operation-target:AKIA${"F".repeat(16)}`,
      `owner-operation-target:ASIA${"G".repeat(16)}`,
      "owner-operation-target:BEGIN_PRIVATE_KEY",
      `owner-operation-target:${"a".repeat(97)}`,
      "unknown-scheme:step",
    ]) {
      expect(() => normalizeLoopMutationEnvelope({ ...base, descriptorRef }, authority))
        .toThrow("descriptorRef");
    }
  });
});
