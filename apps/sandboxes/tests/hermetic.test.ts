import { expect, test } from "bun:test";
import { E2BRunnerPendingV1, DaytonaCloudRunnerPendingV1 } from "../src/runner.js";
import { createInert, harness } from "./fixtures.js";

test("unit lifecycle uses only explicitly injected memory, fake authority, and fake runner", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("real network is forbidden in hermetic tests");
  }) as unknown as typeof fetch;
  try {
    const h = harness();
    const record = await createInert(h);
    expect(record.state).toBe("inert");
    expect(h.repository.backend).toBe("memory");
    expect(networkCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed adapters are honest pending stubs and cannot execute", async () => {
  for (const runner of [new E2BRunnerPendingV1(), new DaytonaCloudRunnerPendingV1()]) {
    expect((await runner.descriptor()).status).toBe("pending_conformance");
    await expect(runner.createInert()).rejects.toMatchObject({ code: "unsupported_runtime_feature" });
  }
});
