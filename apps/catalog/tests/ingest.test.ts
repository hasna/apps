import { describe, expect, it } from "bun:test";
import { createRolloutIngestionHook } from "../src/ingest.js";

const validData = {
  appId: "open-todos",
  package: "@hasna/todos",
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
});
