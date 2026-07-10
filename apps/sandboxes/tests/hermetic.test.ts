import { expect, test } from "bun:test";
import { E2BRunnerPendingV1, DaytonaCloudRunnerPendingV1 } from "../src/runner.js";
import { createInert, harness } from "./fixtures.js";

test("bubblewrap profile clears ambient authority and blocks host effects", async () => {
  if (process.env.HOME !== "/nonexistent") return;
  expect(process.env).toEqual({ HOME: "/nonexistent", PATH: "/runtime", TMPDIR: "/tmp" });
  expect(await Bun.file("/etc/passwd").exists()).toBe(false);
  await expect(fetch("https://example.invalid")).rejects.toThrow("hermetic isolation denied");
  expect(() => Bun.spawn(["/usr/bin/true"])).toThrow("hermetic isolation denied");
  expect(() => Bun.connect({ hostname: "127.0.0.1", port: 9, socket: { data() {} } }))
    .toThrow("hermetic isolation denied");
});

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
