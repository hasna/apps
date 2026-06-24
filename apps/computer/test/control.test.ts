import { beforeEach, describe, expect, test } from "bun:test";
import {
  cancelSession,
  clearEmergencyStop,
  clearSessionCancellation,
  getEmergencyStop,
  getEmergencyStopSignal,
  getRunControlDecision,
  pauseSession,
  registerSessionAbortController,
  requestEmergencyStop,
  resumeSession,
  resetRunControlForTests,
} from "../src/agent/control.js";
import { executeComputerAction } from "../src/agent/policy.js";
import { resetRateLimiter } from "../src/agent/safety.js";
import type { ActionExecutor, SafetyConfig } from "../src/index.js";

const SAFETY: SafetyConfig = {
  confirmClicks: false,
  maxActionsPerMinute: 60,
  allowPasswordTyping: true,
};

describe("run control", () => {
  beforeEach(() => {
    resetRunControlForTests();
    resetRateLimiter();
  });

  test("emergency stop blocks policy-backed action execution", async () => {
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      return { success: true, duration_ms: 1 };
    };

    requestEmergencyStop("operator stop");
    const result = await executeComputerAction(
      { type: "wait", ms: 1 },
      { safety: SAFETY, executor, audit: false }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("operator stop");
    expect(calls).toBe(0);
    expect(getEmergencyStop().active).toBe(true);
  });

  test("clearEmergencyStop allows actions again", async () => {
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      return { success: true, duration_ms: 1 };
    };

    requestEmergencyStop("operator stop");
    clearEmergencyStop();
    const result = await executeComputerAction(
      { type: "wait", ms: 1 },
      { safety: SAFETY, executor, audit: false }
    );

    expect(result.success).toBe(true);
    expect(calls).toBe(1);
  });

  test("per-session cancellation is isolated by session id", () => {
    cancelSession("session-a", "stop session");

    expect(getRunControlDecision("session-a")).toEqual({
      allowed: false,
      status: "cancelled",
      reason: "stop session",
    });
    expect(getRunControlDecision("session-b")).toEqual({
      allowed: true,
      status: "running",
    });

    clearSessionCancellation("session-a");
    expect(getRunControlDecision("session-a").allowed).toBe(true);
  });

  test("cancelSession aborts the registered in-flight action signal", () => {
    const signal = registerSessionAbortController("session-a");

    expect(signal.aborted).toBe(false);
    cancelSession("session-a", "operator cancelled");

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("operator cancelled");
  });

  test("pauseSession blocks the session without aborting in-flight actions", () => {
    const signal = registerSessionAbortController("session-a");

    pauseSession("session-a", "operator paused");

    expect(getRunControlDecision("session-a")).toEqual({
      allowed: false,
      status: "paused",
      reason: "operator paused",
    });
    expect(signal.aborted).toBe(false);

    resumeSession("session-a");
    expect(getRunControlDecision("session-a")).toEqual({
      allowed: true,
      status: "running",
    });
  });

  test("emergency stop aborts all registered in-flight action signals", () => {
    const signalA = registerSessionAbortController("session-a");
    const signalB = registerSessionAbortController("session-b");

    requestEmergencyStop("global stop");

    expect(signalA.aborted).toBe(true);
    expect(signalA.reason).toBe("global stop");
    expect(signalB.aborted).toBe(true);
    expect(signalB.reason).toBe("global stop");
  });

  test("emergency stop exposes a global abort signal for direct actions", () => {
    const signal = getEmergencyStopSignal();
    expect(signal.aborted).toBe(false);

    requestEmergencyStop("global stop");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("global stop");

    clearEmergencyStop();
    expect(getEmergencyStopSignal().aborted).toBe(false);
  });

  test("emergency stop aborts an in-flight direct policy-backed action", async () => {
    const resultPromise = executeComputerAction(
      { type: "wait", ms: 10_000 },
      {
        safety: SAFETY,
        audit: false,
        executor: async (_action, context) => {
          await new Promise<void>((resolve) => {
            if (context?.signal?.aborted) return resolve();
            context?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return {
            success: false,
            error: String(context?.signal?.reason ?? "missing abort"),
            duration_ms: 1,
          };
        },
      },
    );

    requestEmergencyStop("global stop");
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("global stop");
  });
});
