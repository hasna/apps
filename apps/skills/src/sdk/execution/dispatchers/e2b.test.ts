import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../../test-preload.js";
useDefaultTestTimeout();

import { E2B_LANE_STATUS, E2bDispatcher } from "./e2b.js";
import type { ServerRunRecord } from "../../../server/types.js";

describe("e2b lane stub", () => {
  test("submit and cancel fail closed with the TODO marker, never claiming a dispatch", async () => {
    const dispatcher = new E2bDispatcher();
    const run = { id: "run_e2b_stub" } as ServerRunRecord;

    const submitted = await dispatcher.submit(run);
    expect(submitted.accepted).toBe(false);
    expect(submitted.detail).toContain(E2B_LANE_STATUS);

    const cancelled = await dispatcher.cancel("run_e2b_stub");
    expect(cancelled.accepted).toBe(false);
    expect(cancelled.detail).toContain(E2B_LANE_STATUS);
  });
});
