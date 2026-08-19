import { describe, expect, test } from "bun:test";
import type { AutomationRuntimeBinding } from "../types.js";
import { createOpenLoopsRuntimeBinding, listDefaultRuntimeBindings } from "./runtime.js";

// agent-authored (SOL consult bounded: capacity refusal + wall-time exhaustion)

describe("createOpenLoopsRuntimeBinding", () => {
  test("returns a stable open-loops lease-queue binding identity", () => {
    const binding = createOpenLoopsRuntimeBinding();
    expect(binding.kind).toBe("open-loops");
    expect(binding.name).toBe("open-loops-runtime");
    expect(binding.handoff).toBe("lease-queue");
    expect(binding.description).toContain("OpenLoops");
    expect(binding.description).toContain("lease admitted");
  });

  test("exposes the full lease-queue command contract for operator handoff", () => {
    const binding = createOpenLoopsRuntimeBinding();
    const queueClaim = binding.metadata?.queueClaim as Record<string, string>;
    expect(queueClaim.statusCommand).toBe("automations status");
    expect(queueClaim.claimCommand).toBe("automations queue lease --runner open-loops:<worker-id>");
    expect(queueClaim.completeCommand).toBe("automations queue complete <action-id> --runner open-loops:<worker-id>");
    expect(queueClaim.failCommand).toBe("automations queue fail <action-id> --runner open-loops:<worker-id> --code <code> --message <message>");
  });

  test("exposes the event-envelope handoff contract with the boundary statement", () => {
    const binding = createOpenLoopsRuntimeBinding();
    const eventEnvelope = binding.metadata?.eventEnvelope as Record<string, string>;
    expect(eventEnvelope.exportCommand).toBe("automations webhooks event <route-id-or-path> --body-json <json>");
    expect(eventEnvelope.openLoopsCommand).toBe("loops events handle generic");
    expect(eventEnvelope.pipeExample).toContain("automations --json webhooks event");
    expect(eventEnvelope.pipeExample).toContain("loops --json events handle generic");
    expect(eventEnvelope.boundary).toContain("OpenLoops owns agent workflow invocation");
    expect(eventEnvelope.boundary).toContain("OpenAutomations owns deterministic automation specs");
  });

  test("merges caller metadata over the defaults at the top level (shallow override)", () => {
    const binding = createOpenLoopsRuntimeBinding({ queueClaim: { statusCommand: "automations custom-status" } });
    const queueClaim = binding.metadata?.queueClaim as Record<string, string>;
    expect(queueClaim.statusCommand).toBe("automations custom-status");
    // The override replaces the whole queueClaim block: the defaults it did not
    // name are NOT preserved. This pins the documented shallow-merge contract.
    expect(queueClaim.claimCommand).toBeUndefined();
    // The eventEnvelope defaults survive because the override did not touch them.
    expect((binding.metadata?.eventEnvelope as Record<string, string>).exportCommand).toBe(
      "automations webhooks event <route-id-or-path> --body-json <json>",
    );
  });

  test("keeps nested default fields when metadata only adds a sibling key", () => {
    const binding = createOpenLoopsRuntimeBinding({ extra: { lane: "test" } });
    expect(binding.metadata?.queueClaim).toBeDefined();
    expect(binding.metadata?.eventEnvelope).toBeDefined();
    expect((binding.metadata?.extra as Record<string, string>).lane).toBe("test");
  });
});

describe("listDefaultRuntimeBindings", () => {
  test("returns exactly the open-loops binding with stable identity", () => {
    const bindings = listDefaultRuntimeBindings();
    expect(bindings).toHaveLength(1);
    const binding = bindings[0] as AutomationRuntimeBinding;
    expect(binding.kind).toBe("open-loops");
    expect(binding.name).toBe("open-loops-runtime");
    expect(binding.handoff).toBe("lease-queue");
  });

  test("produces a fresh copy on every call (callers may mutate one result)", () => {
    const first = listDefaultRuntimeBindings();
    const second = listDefaultRuntimeBindings();
    expect(first).not.toBe(second);
    (first[0].metadata as Record<string, unknown>).queueClaim = undefined;
    expect(second[0].metadata?.queueClaim).toBeDefined();
  });
});
