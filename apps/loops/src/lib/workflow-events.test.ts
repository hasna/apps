import { describe, expect, test } from "bun:test";
import type { StoredWorkflowEvent } from "../types.js";
import { publicWorkflowEvent } from "./workflow-events.js";

function stored(overrides: Partial<StoredWorkflowEvent>): StoredWorkflowEvent {
  return {
    id: "event-1",
    workflowRunId: "run-1",
    sequence: 1,
    eventType: "created",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("public workflow events", () => {
  test("validates and exposes a discriminated agent session contract event", () => {
    const event = publicWorkflowEvent(stored({
      eventType: "agent_session_contract",
      stepId: "worker",
      payload: {
        version: 1,
        provider: "codewith",
        permissionMode: "default",
        sandbox: "workspace-write",
        manualBreakGlass: false,
        timeoutMs: null,
        restrictions: { enforcement: "metadata_only", providerEnforced: false },
      },
    }));

    expect(event.eventType).toBe("agent_session_contract");
    if ("eventKind" in event || event.eventType !== "agent_session_contract") {
      throw new Error("contract event was not discriminated");
    }
    expect(event.stepId).toBe("worker");
    expect(event.payload.provider).toBe("codewith");
  });

  test("preserves sanitized historical custom events and rejects malformed contract payloads", () => {
    const prompt = "caller-controlled prompt";
    const credential = `ghp_${"a1".repeat(12)}`;
    const apiKey = "opaque-value-without-a-known-token-shape";
    const event = publicWorkflowEvent(stored({
      eventType: "legacy_worker_note",
      stepId: "worker",
      payload: {
        note: "historical event",
        prompt,
        diagnostic: credential,
        apiKey,
        routeKey: "route-key-is-an-identifier",
      },
    })) as unknown as Record<string, unknown>;

    expect(event).toMatchObject({
      eventType: "legacy_worker_note",
      eventKind: "custom",
      stepId: "worker",
      payload: {
        note: "historical event",
        prompt: `[redacted ${prompt.length} chars]`,
        diagnostic: "[SCRUBBED]",
        apiKey: `[redacted ${apiKey.length} chars]`,
        routeKey: "route-key-is-an-identifier",
      },
    });
    expect(() => publicWorkflowEvent(stored({
      eventType: "agent_session_contract",
      stepId: "worker",
      payload: { version: 1 },
    }))).toThrow("invalid agent_session_contract workflow event");
  });

  test("rejects malformed base fields and schema-forbidden properties", () => {
    expect(() => publicWorkflowEvent(stored({ sequence: 0 }))).toThrow("invalid workflow event sequence");
    expect(() => publicWorkflowEvent(stored({ createdAt: "not-a-date" }))).toThrow("invalid workflow event createdAt");
    expect(() => publicWorkflowEvent(stored({ createdAt: "2025-02-30T12:00:00Z" }))).toThrow("invalid workflow event createdAt");
    expect(() => publicWorkflowEvent(stored({ createdAt: "2026-01-01T24:00:00Z" }))).toThrow("invalid workflow event createdAt");
    expect(() => publicWorkflowEvent(stored({ createdAt: "2026-01-01T12:60:00Z" }))).toThrow("invalid workflow event createdAt");
    expect(() => publicWorkflowEvent(stored({ createdAt: "2026-01-01T12:00:60Z" }))).toThrow("invalid workflow event createdAt");
    expect(() => publicWorkflowEvent(stored({ createdAt: "2026-01-01T12:00:00+24:00" }))).toThrow("invalid workflow event createdAt");
    expect(publicWorkflowEvent(stored({ createdAt: "2024-02-29T23:59:59.123+14:00" })).createdAt).toBe(
      "2024-02-29T23:59:59.123+14:00",
    );
    expect(() => publicWorkflowEvent({
      ...stored({}),
      stepId: 99,
    } as unknown as StoredWorkflowEvent)).toThrow("invalid workflow event stepId");
    expect(() => publicWorkflowEvent({
      ...stored({}),
      unexpected: "not declared by the public schema",
    } as StoredWorkflowEvent)).toThrow("invalid workflow event envelope");
    expect(() => publicWorkflowEvent({
      ...stored({ eventType: "created" }),
      eventKind: "custom",
    } as unknown as StoredWorkflowEvent)).toThrow("invalid workflow event kind for created");
    expect(() => publicWorkflowEvent(stored({
      eventType: "agent_session_contract",
      stepId: "worker",
      payload: {
        version: 1,
        provider: "codewith",
        permissionMode: "default",
        sandbox: "workspace-write",
        manualBreakGlass: false,
        timeoutMs: null,
        restrictions: { enforcement: "metadata_only", providerEnforced: false },
        fabricated: true,
      },
    }))).toThrow("invalid agent_session_contract workflow event");
    expect(() => publicWorkflowEvent({
      ...stored({
        eventType: "agent_session_contract",
        stepId: "worker",
        payload: {
          version: 1,
          provider: "codewith",
          permissionMode: "default",
          sandbox: "workspace-write",
          manualBreakGlass: false,
          timeoutMs: null,
          restrictions: { enforcement: "metadata_only", providerEnforced: false },
        },
      }),
      eventKind: "custom",
    } as unknown as StoredWorkflowEvent)).toThrow("invalid agent_session_contract workflow event");
    expect(() => publicWorkflowEvent(stored({
      eventType: "agent_session_contract",
      stepId: "worker",
      payload: {
        version: 1,
        provider: "codewith",
        permissionMode: "default",
        sandbox: "workspace-write",
        manualBreakGlass: false,
        routing: { role: "worker", fabricated: "not declared by the public schema" },
        timeoutMs: null,
        restrictions: { enforcement: "metadata_only", providerEnforced: false },
      },
    }))).toThrow("invalid agent_session_contract workflow event");
  });
});
