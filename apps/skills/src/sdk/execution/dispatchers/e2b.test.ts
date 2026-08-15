import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../../test-preload.js";
useDefaultTestTimeout();

import { E2B_LANE_STATUS, E2bDispatcher } from "./e2b.js";
import type { FrozenAdmission } from "../types.js";

function stubAdmission(): FrozenAdmission {
  return {
    contractVersion: 1,
    runId: "run_e2b_stub",
    tenantId: "t",
    skillId: "s",
    skillVersion: "1.0.0",
    bundleDigest: "sha256:" + "0".repeat(64),
    runtimeImageDigest: "sha256:" + "0".repeat(64),
    dependencyLayerTag: null,
    inputDigest: "0".repeat(64),
    runtime: "bun",
    policy: { egress: "deny", egressAllowlist: [], networkByteCap: 0 },
    limits: { maxDurationMs: 1, maxMemoryMb: 1, maxCpuUnits: 256, maxArtifactsBytes: 1, maxConcurrency: 1 },
    idempotencyKey: "stub",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("e2b lane stub", () => {
  test("submit and cancel fail closed with the TODO marker, never claiming a dispatch", async () => {
    const dispatcher = new E2bDispatcher();
    const run = stubAdmission();

    const submitted = await dispatcher.submit(run);
    expect(submitted.accepted).toBe(false);
    expect(submitted.detail).toContain(E2B_LANE_STATUS);

    const cancelled = await dispatcher.cancel("run_e2b_stub");
    expect(cancelled.accepted).toBe(false);
    expect(cancelled.detail).toContain(E2B_LANE_STATUS);
  });
});
