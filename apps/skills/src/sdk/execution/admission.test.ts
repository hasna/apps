import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService, digestInput, DEFAULT_RUN_LIMITS, DEFAULT_RUN_POLICY } from "./admission.js";
import { ImageProfileResolutionError, createImageProfileRegistry, dependencyLayerRule } from "./image-profile.js";
import { MemoryRunExecutionStore, SqliteRunExecutionStore } from "./storage.js";
import type { RunExecutionStore } from "./storage.js";

const TEST_IMAGE_PROFILES = createImageProfileRegistry({
  runtimes: [
    { runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) },
    { runtime: "node", version: "22.14.0", imageDigest: "sha256:" + "b".repeat(64) },
    { runtime: "python3", version: "3.12.9", imageDigest: "sha256:" + "c".repeat(64) },
  ],
  dependencyLayers: {
    [dependencyLayerRule("layer-ffmpeg-v1", ["ffmpeg", "libavcodec"]).canonicalKey]: "layer-ffmpeg-v1",
  },
});

const BASE_INPUT = {
  tenantId: "tenant-admission-test",
  skillId: "pdf-generate",
  skillVersion: "1.0.0",
  bundleDigest: "sha256:" + "d".repeat(64),
  input: { pages: 2 },
  runtime: "bun",
} as const;

const stores: Array<[string, () => RunExecutionStore]> = [
  ["memory", () => new MemoryRunExecutionStore()],
  ["sqlite", () => new SqliteRunExecutionStore(":memory:")],
];

for (const [label, makeStore] of stores) {
  describe(`admission idempotency (${label})`, () => {
    test("same Idempotency-Key returns the existing run, created: false", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      const first = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-1" });
      expect(first.created).toBe(true);
      expect(first.run.runId).toBeTruthy();

      const second = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-1" });
      expect(second.created).toBe(false);
      expect(second.run.runId).toBe(first.run.runId);
    });

    test("same digest tuple (different key) returns the existing run", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      const first = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-a" });
      const second = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-b" });
      expect(second.created).toBe(false);
      expect(second.run.runId).toBe(first.run.runId);
    });

    test("different input digest mints a different run", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      const first = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-a" });
      const second = await service.submit({ ...BASE_INPUT, input: { pages: 3 }, idempotencyKey: "idem-b" });
      expect(second.created).toBe(true);
      expect(second.run.runId).not.toBe(first.run.runId);
      expect(digestInput({ pages: 2 })).not.toBe(digestInput({ pages: 3 }));
    });

    test("admission freezes every immutable field under the run_id", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      const { run } = await service.submit({ ...BASE_INPUT, idempotencyKey: "idem-freeze", limits: { maxDurationMs: 60_000 } });
      expect(run.contractVersion).toBe(1);
      expect(run.tenantId).toBe(BASE_INPUT.tenantId);
      expect(run.skillId).toBe(BASE_INPUT.skillId);
      expect(run.skillVersion).toBe(BASE_INPUT.skillVersion);
      expect(run.bundleDigest).toBe(BASE_INPUT.bundleDigest);
      expect(run.runtimeImageDigest).toBe("sha256:" + "a".repeat(64));
      expect(run.inputDigest).toBe(digestInput(BASE_INPUT.input));
      expect(run.runtime).toBe("bun");
      expect(run.policy).toEqual(DEFAULT_RUN_POLICY);
      expect(run.limits).toEqual({ ...DEFAULT_RUN_LIMITS, maxDurationMs: 60_000 });
      expect(run.dependencyLayerTag).toBeNull();
    });

    test("owns contract identity across awaited lookup and returned receipt mutation", async () => {
      const store = makeStore();
      const original = store.getRunByKey.bind(store);
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      store.getRunByKey = async (...args) => { await waiting; return original(...args); };
      const service = createSubmitRunService({ store, imageProfiles: TEST_IMAGE_PROFILES });
      const contract = { id: "regex-test.v1" as const, descriptorDigest: "e".repeat(64), entrypoint: "src/index.ts", entrypointDigest: "f".repeat(64) };
      const expected = { ...contract };
      const pending = service.submit({ ...BASE_INPUT, executionContract: contract, idempotencyKey: "owned-contract" });
      contract.entrypoint = "src/changed.ts";
      release();
      const first = await pending;
      expect(first.run.executionContract).toEqual(expected);
      first.run.executionContract!.descriptorDigest = "0".repeat(64);
      const replay = await service.submit({ ...BASE_INPUT, executionContract: contract, idempotencyKey: "owned-contract" });
      expect(replay.run.executionContract).toEqual(expected);
      expect(replay.run.runId).toBe(first.run.runId);
    });

    test("pure input can be deliberately repeated under a new key and reviewed image", async () => {
      const store = makeStore();
      const contract = { id: "regex-test.v1" as const, descriptorDigest: "e".repeat(64), entrypoint: "src/index.ts", entrypointDigest: "f".repeat(64) };
      const first = await createSubmitRunService({ store, imageProfiles: TEST_IMAGE_PROFILES }).submit({ ...BASE_INPUT, executionContract: contract, idempotencyKey: "pure-old-image" });
      const profiles = createImageProfileRegistry({ runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "0".repeat(64) }], dependencyLayers: {} });
      const second = await createSubmitRunService({ store, imageProfiles: profiles }).submit({ ...BASE_INPUT, executionContract: contract, idempotencyKey: "pure-new-image" });
      expect(second.run.runId).not.toBe(first.run.runId);
      expect(second.run.runtimeImageDigest).toBe("sha256:" + "0".repeat(64));
      expect((await store.getRun(first.run.runId))!.admission.runtimeImageDigest).toBe(first.run.runtimeImageDigest);
    });

    test("allowlisted system_deps resolve a prebuilt dependency layer into the admission", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      const { run } = await service.submit({
        ...BASE_INPUT,
        systemDeps: ["libavcodec", "ffmpeg"],
        idempotencyKey: "idem-layer",
      });
      expect(run.dependencyLayerTag).toBe("layer-ffmpeg-v1");
    });

    test("unallowlisted system_deps fail closed at admission", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      await expect(
        service.submit({ ...BASE_INPUT, systemDeps: ["nmap"], idempotencyKey: "idem-nmap" }),
      ).rejects.toThrow(ImageProfileResolutionError);
    });

    test("empty idempotency key is refused", async () => {
      const service = createSubmitRunService({ store: makeStore(), imageProfiles: TEST_IMAGE_PROFILES });
      await expect(service.submit({ ...BASE_INPUT, idempotencyKey: "  " })).rejects.toThrow(/idempotencyKey/);
    });
  });
}

describe("image profile registry", () => {
  test("resolves a pinned runtime with a configured digest", () => {
    const registry = createImageProfileRegistry({
      runtimes: [{ runtime: "python3", version: "3.12.9", imageDigest: "sha256:" + "c".repeat(64) }],
      dependencyLayers: {},
    });
    const resolved = registry.resolve("python3", []);
    expect(resolved.runtime.version).toBe("3.12.9");
    expect(resolved.runtimeImageDigest).toBe("sha256:" + "c".repeat(64));
    expect(resolved.dependencyLayerTag).toBeNull();
  });

  test("unknown runtime is refused", () => {
    const registry = createImageProfileRegistry();
    expect(() => registry.resolve("bun", [])).toThrow(/no image digest/);
    expect(() => registry.resolve("ruby" as never, [])).toThrow(/unknown runtime/);
  });

  test("an unpinned runtime is refused (no un-pinned launches)", () => {
    const registry = createImageProfileRegistry();
    expect(() => registry.resolve("bun", [])).toThrow(ImageProfileResolutionError);
    try {
      registry.resolve("bun", []);
    } catch (error) {
      expect(error).toBeInstanceOf(ImageProfileResolutionError);
      expect((error as ImageProfileResolutionError).failure.reason).toBe("UNPINNED_RUNTIME");
    }
  });

  test("canonical system_deps key is sorted and deduplicated", async () => {
    const registry = createImageProfileRegistry({
      runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }],
      dependencyLayers: {
        "ffmpeg,libavcodec": "layer-ffmpeg-v1",
      },
    });
    const resolved = registry.resolve("bun", ["ffmpeg", "libavcodec", "ffmpeg"]);
    expect(resolved.dependencyLayerTag).toBe("layer-ffmpeg-v1");
  });
});
