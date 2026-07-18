import { describe, expect, test } from "bun:test";
import { applyRoutePolicyToDrainOptions, routePolicyEvidenceFromOptions } from "./policies.js";

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

  test("requires explicit break-glass evidence when replaying a manual policy", () => {
    expect(() => routePolicyEvidenceFromOptions({
      routePolicyEvidence: "pilot",
      safetyReason: "operator approved isolated pilot",
    })).toThrow("requires explicit --manual-break-glass");

    expect(() => routePolicyEvidenceFromOptions({
      routePolicyEvidence: "pilot",
      manualBreakGlass: true,
    })).toThrow("requires an explicit non-empty --safety-reason");

    expect(() => routePolicyEvidenceFromOptions({
      routePolicyEvidence: "pilot",
      manualBreakGlass: true,
      safetyReason: "   ",
    })).toThrow("requires an explicit non-empty --safety-reason");

    expect(routePolicyEvidenceFromOptions({
      routePolicyEvidence: "pilot",
      manualBreakGlass: true,
      safetyReason: "operator approved isolated pilot",
    })).toMatchObject({ id: "pilot" });
  });

  test("preserves valid scheduled manual-policy replay evidence", () => {
    const expanded = applyRoutePolicyToDrainOptions({
      policy: "pilot",
      manualBreakGlass: true,
      safetyReason: "operator approved isolated pilot",
    });
    expect(expanded).toMatchObject({
      routePolicyEvidence: "pilot",
      manualBreakGlass: true,
      safetyReason: "operator approved isolated pilot",
    });
    const { policy: _policy, ...replay } = expanded;
    expect(routePolicyEvidenceFromOptions(replay)).toMatchObject({ id: "pilot" });
  });
});
