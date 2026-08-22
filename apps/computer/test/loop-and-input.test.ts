// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
// Remediated 2026-08-20 (hygiene-s2-remediate, cycle 2): the original file also
// imported `remapCoordinates` from ../src/agent/loop.js and `mapKeys` from
// ../src/drivers/mac/input.js — both are module-private (measured: no export
// keyword at loop.ts:251 or input.ts:165) and reachable only through runTask /
// executeAction on live hardware. Under the tests-only constraint they cannot be
// imported, and bun failed the whole file at import time in CI and locally
// (`SyntaxError: Export named 'remapCoordinates' not found`). This file now
// asserts only the exported, platform-independent surface: executeAction's
// fail-closed contract.
import { describe, expect, test } from "bun:test";
import { executeAction } from "../src/drivers/mac/input.js";

describe("executeAction — fail-closed on unsupported platforms", () => {
  test("unknown action types fail with a named error instead of hanging", async () => {
    const result = await executeAction({ type: "teleport" } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action type");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("macOS-only actions fail closed when macOS tools are absent (non-darwin only)", async () => {
    // On macOS with screencapture this test would exercise real hardware; the
    // fail-closed contract below is about unsupported platforms, so only run
    // where the driver cannot work by construction.
    if (process.platform === "darwin") return;
    const result = await executeAction({ type: "wait", ms: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
