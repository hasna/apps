import { describe, expect, it } from "bun:test";
import type { DistributionEventEnvelope } from "../src/contracts.js";
import { createRolloutIngestionHook } from "../src/ingest.js";

const validData = {
  appId: "open-alpha",
  package: "@example/alpha",
  version: "1.2.3",
  machine: "spark01",
  action: "install",
};

describe("createRolloutIngestionHook (read-only stub)", () => {
  const hook = createRolloutIngestionHook();

  it("declares the rollout event types", () => {
    expect(hook.eventTypes).toEqual([
      "release.rollout.started",
      "release.rollout.completed",
      "release.rollout.failed",
      "app.installed",
    ]);
  });

  it("accepts a valid rollout event without persisting", () => {
    const result = hook.handleEvent({ type: "release.rollout.started", data: validData });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.persisted).toBe(false);
      expect(result.data.machine).toBe("spark01");
    }
  });

  it("rejects unsupported event types", () => {
    const result = hook.handleEvent({ type: "announcement.sent", data: validData });
    expect(result.accepted).toBe(false);
  });

  it("rejects payloads missing required fields", () => {
    const { machine: _machine, ...missingMachine } = validData;
    const result = hook.handleEvent({ type: "app.installed", data: missingMachine });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toContain("machine");
  });

  it("requires result on rollout.completed and rollout.failed", () => {
    expect(hook.handleEvent({ type: "release.rollout.completed", data: validData }).accepted).toBe(false);
    expect(
      hook.handleEvent({ type: "release.rollout.completed", data: { ...validData, result: "succeeded" } }).accepted
    ).toBe(true);
    expect(hook.handleEvent({ type: "release.rollout.failed", data: validData }).accepted).toBe(false);
  });

  it("allows open extra keys on the payload", () => {
    const result = hook.handleEvent({
      type: "app.installed",
      data: { ...validData, extra: "fine" },
    });
    expect(result.accepted).toBe(true);
  });

  it("rejects missing, null, and non-string event types", () => {
    // The invalid payloads are deliberately smuggled past the type system: the
    // hook's runtime guard is the contract for hostile/foreign envelopes.
    expect(hook.handleEvent({} as unknown as DistributionEventEnvelope).accepted).toBe(false);
    expect(hook.handleEvent(null as unknown as DistributionEventEnvelope).accepted).toBe(false);
    expect(hook.handleEvent({ type: 42, data: validData } as unknown as DistributionEventEnvelope).accepted).toBe(false);
  });

  it("rejects non-object event data, including arrays", () => {
    expect(
      hook.handleEvent({ type: "app.installed", data: [] } as unknown as DistributionEventEnvelope).accepted
    ).toBe(false);
    expect(
      hook.handleEvent({ type: "app.installed", data: "nope" } as unknown as DistributionEventEnvelope).accepted
    ).toBe(false);
    expect(hook.handleEvent({ type: "app.installed" } as unknown as DistributionEventEnvelope).accepted).toBe(false);
  });

  it("rejects whitespace-only required fields, not just absent ones", () => {
    // A field that is present but blank is the same failure as a missing one:
    // the payload would carry an empty machine name downstream.
    const result = hook.handleEvent({
      type: "app.installed",
      data: { ...validData, machine: "   " },
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toContain("machine");
  });

  it("accepts any action string — the hook validates fields, not the action enum", () => {
    // The hook intentionally validates presence, not the action vocabulary
    // (the payload is an open-key mirror of the future @hasna/events payload).
    // Pin that an unknown action is accepted so the looseness is deliberate.
    const result = hook.handleEvent({
      type: "app.installed",
      data: { ...validData, action: "installx" },
    });
    expect(result.accepted).toBe(true);
  });

  it("protects the shared event-type allowlist from caller mutation", () => {
    // Every hook exposes the SAME array as its eventTypes. If a caller could
    // push into it, one hook's caller would widen every other hook's
    // allowlist forever. The array must be frozen at runtime.
    const before = [...hook.eventTypes];
    expect(() => (hook.eventTypes as string[]).push("announcement.sent")).toThrow(TypeError);
    expect([...hook.eventTypes]).toEqual(before);
    const freshHook = createRolloutIngestionHook();
    expect(freshHook.eventTypes).toEqual(before);
    expect(freshHook.handleEvent({ type: "announcement.sent", data: validData }).accepted).toBe(false);
    expect(hook.handleEvent({ type: "release.rollout.started", data: validData }).accepted).toBe(true);
  });
});
