import { describe, expect, test } from "bun:test";
import { applyRoutePolicyToDrainOptions } from "./policies.js";

describe("route policy explicit safety", () => {
  test("requires safetyReason to be an explicitly supplied non-empty string", () => {
    expect(() => applyRoutePolicyToDrainOptions({
      policy: "pilot",
      manualBreakGlass: true,
      safetyReason: true as unknown as string,
    })).toThrow("requires an explicit non-empty --safety-reason");

    expect(() => applyRoutePolicyToDrainOptions({
      policy: "pilot",
      manualBreakGlass: true,
      safetyReason: "   ",
    })).toThrow("requires an explicit non-empty --safety-reason");

    expect(applyRoutePolicyToDrainOptions({
      policy: "pilot",
      manualBreakGlass: true,
      safetyReason: "operator approved isolated pilot",
    })).toMatchObject({
      routePolicyEvidence: "pilot",
      manualBreakGlass: true,
      safetyReason: "operator approved isolated pilot",
    });
  });
});
