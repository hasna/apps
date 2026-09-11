import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();
import { createImageProfileRegistry, canonicalSystemDepsKey, dependencyLayerRule, resolveImageProfile, type ImageProfileRegistryConfig } from "./image-profile.js";
import { createSubmitRunService, digestInput, type SubmitRunInput } from "./admission.js";
import { MemoryRunExecutionStore, SqliteRunExecutionStore, type RunExecutionStore } from "./storage.js";
const image = `sha256:${"a".repeat(64)}`, changedImage = `sha256:${"b".repeat(64)}`;
const config = (): ImageProfileRegistryConfig => ({ runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: image }], dependencyLayers: { "git,python3": "owned-layer-v1" } });
const input = (): SubmitRunInput => ({ tenantId: "owned-a", skillId: "owned-skill", skillVersion: "1.0.0", bundleDigest: "c".repeat(64), input: { nested: { message: "approved" } }, idempotencyKey: "owned-key", runtime: "bun", systemDeps: ["python3", "git"], policy: { egress: "allowlist", egressAllowlist: ["owned.example.test"], networkByteCap: 128 } });

test("useful pinned runtime and exact prebuilt dependency layer selection", () => {
  const registry = createImageProfileRegistry(config());
  expect(canonicalSystemDepsKey(["python3", "git", "git"])).toBe("git,python3");
  expect(dependencyLayerRule("owned-layer-v1", ["python3", "git"])).toEqual({ canonicalKey: "git,python3", layerTag: "owned-layer-v1" });
  expect(resolveImageProfile(registry, { runtime: "bun", systemDeps: ["git", "python3"] })).toEqual({ runtime: "bun", runtimeImageDigest: image, dependencyLayerTag: "owned-layer-v1" });
  expect(resolveImageProfile(registry, { runtime: "bun", systemDeps: [] }).dependencyLayerTag).toBeNull();
});

test("registry captures caller configuration rather than retaining mutable runtime references", () => {
  const original = config(), registry = createImageProfileRegistry(original);
  original.runtimes[0]!.imageDigest = changedImage; original.runtimes[0]!.version = "changed";
  original.dependencyLayers["git,python3"] = "changed-layer";
  const resolved = registry.resolve("bun", ["git", "python3"]);
  expect(resolved.runtimeImageDigest).toBe(image);
  expect(resolved.runtime.version).toBe("1.3.14");
  expect(resolved.dependencyLayerTag).toBe("owned-layer-v1");
});

test("mutating a resolved profile cannot change a later resolution", () => {
  const registry = createImageProfileRegistry(config());
  const resolved = registry.resolve("bun", []);
  try { resolved.runtime.imageDigest = changedImage; } catch { /* A frozen projection is also safe. */ }
  expect(registry.resolve("bun", []).runtimeImageDigest).toBe(image);
});

test("an ambiguous single dependency cannot impersonate an allowlisted tuple", () => {
  const registry = createImageProfileRegistry(config());
  for (const deps of [["git,python3"], [""], ["git", ""], [",git"], ["git,"], ["git,,python3"]]) {
    expect(() => registry.resolve("bun", deps)).toThrow();
    expect(() => canonicalSystemDepsKey(deps)).toThrow();
    expect(() => dependencyLayerRule("owned-layer-v1", deps)).toThrow();
  }
});

test("missing digest and unknown dependencies refuse before admission storage", async () => {
  for (const [profiles, deps] of [[{ runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: null }], dependencyLayers: {} }, []], [config(), ["curl"]], [config(), ["git,python3"]]] as Array<[ImageProfileRegistryConfig, string[]]>) {
    const store = new MemoryRunExecutionStore(); let writes = 0;
    const admit = store.admit.bind(store); store.admit = async value => { writes++; return admit(value); };
    const service = createSubmitRunService({ store, imageProfiles: createImageProfileRegistry(profiles) });
    await expect(service.submit({ ...input(), systemDeps: deps })).rejects.toThrow();
    expect(writes).toBe(0); expect(await store.getRunByKey("owned-a", "owned-key")).toBeNull();
  }
});

test("durable admission retains exact approved runtime, input digest, policy and retry", async () => {
  const store = new SqliteRunExecutionStore(":memory:");
  try {
    const service = createSubmitRunService({ store, imageProfiles: createImageProfileRegistry(config()) });
    const approved = input(), expectedDigest = digestInput(approved.input);
    const result = await service.submit(approved);
    expect(result.created).toBe(true); expect(result.run.runtimeImageDigest).toBe(image); expect(result.run.dependencyLayerTag).toBe("owned-layer-v1"); expect(result.run.inputDigest).toBe(expectedDigest);
    approved.policy!.egressAllowlist!.push("changed.example.test"); result.run.policy.egressAllowlist.push("returned-object-change.example.test");
    const persisted = await store.getRun(result.run.runId);
    expect(persisted!.admission.policy.egressAllowlist).toEqual(["owned.example.test"]);
    const replay = await service.submit(input());
    expect(replay.created).toBe(false); expect(replay.run.runId).toBe(result.run.runId); expect(replay.run.inputDigest).toBe(expectedDigest);
  } finally { await store.close(); }
});

test("submission snapshots mutable inputs before its first asynchronous store lookup", async () => {
  const store = new SqliteRunExecutionStore(":memory:");
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  const lookup = store.getRunByKey.bind(store); store.getRunByKey = async (tenant, key) => { await paused; return lookup(tenant, key); };
  try {
    const approved = input(), expectedDigest = digestInput(approved.input);
    const service = createSubmitRunService({ store, imageProfiles: createImageProfileRegistry(config()) });
    const pending = service.submit(approved);
    (approved.input as { nested: { message: string } }).nested.message = "changed";
    approved.policy!.egressAllowlist!.push("changed.example.test"); approved.systemDeps!.splice(0);
    release(); const result = await pending;
    expect(result.run.inputDigest).toBe(expectedDigest);
    expect(result.run.policy.egressAllowlist).toEqual(["owned.example.test"]);
    expect(result.run.dependencyLayerTag).toBe("owned-layer-v1");
  } finally { release(); await store.close(); }
});

for (const [backend, makeStore] of [
  ["memory", () => new MemoryRunExecutionStore()], ["sqlite", () => new SqliteRunExecutionStore(":memory:")],
] as const) {
  for (const boundary of ["getRunByKey", "getRunByDigests"] as const) {
    test(`all submission fields are captured before ${boundary} yields (${backend})`, async () => {
      const store: RunExecutionStore = makeStore();
      let release!: () => void, entered!: () => void;
      const paused = new Promise<void>(resolve => { release = resolve; });
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      if (boundary === "getRunByKey") {
        const original = store.getRunByKey.bind(store);
        store.getRunByKey = async (tenant, key) => { entered(); await paused; return original(tenant, key); };
      } else {
        const original = store.getRunByDigests.bind(store);
        store.getRunByDigests = async value => { entered(); await paused; return original(value); };
      }
      try {
        const approved = { ...input(), limits: { maxDurationMs: 1234 } }, digest = digestInput(approved.input);
        const service = createSubmitRunService({ store, imageProfiles: createImageProfileRegistry(config()) });
        const pending = service.submit(approved); await waiting;
        approved.tenantId = "changed-tenant"; approved.skillId = "changed-skill"; approved.skillVersion = "9.0.0";
        approved.bundleDigest = "d".repeat(64); approved.idempotencyKey = "changed-key"; approved.runtime = "node";
        (approved.input as { nested: { message: string } }).nested.message = "changed";
        approved.systemDeps!.splice(0); approved.policy!.egress = "deny";
        approved.policy!.egressAllowlist!.push("changed.example.test"); approved.policy!.networkByteCap = 999;
        approved.limits.maxDurationMs = 9876;
        release(); const result = await pending;
        expect(result.run).toMatchObject({ tenantId: "owned-a", skillId: "owned-skill", skillVersion: "1.0.0", bundleDigest: "c".repeat(64),
          idempotencyKey: "owned-key", runtime: "bun", runtimeImageDigest: image, dependencyLayerTag: "owned-layer-v1", inputDigest: digest,
          policy: { egress: "allowlist", egressAllowlist: ["owned.example.test"], networkByteCap: 128 }, limits: { maxDurationMs: 1234 } });
        expect((await store.getRunByKey("owned-a", "owned-key"))?.admission).toEqual(result.run);
        expect(await store.getRunByKey("changed-tenant", "changed-key")).toBeNull();
      } finally { release(); await store.close?.(); }
    });
  }
  test(`new and both replay results cannot mutate store-owned admission (${backend})`, async () => {
    const store: RunExecutionStore = makeStore();
    try {
      const service = createSubmitRunService({ store, imageProfiles: createImageProfileRegistry(config()) });
      const first = await service.submit({ ...input(), limits: { maxDurationMs: 1234 } });
      const original = JSON.parse(JSON.stringify(first.run));
      for (const result of [first, await service.submit(input()), await service.submit({ ...input(), idempotencyKey: "same-digest-other-key" })]) {
        result.run.policy.egressAllowlist.push("returned-mutation.example.test"); result.run.policy.egress = "deny";
        result.run.limits.maxDurationMs = 9876; result.run.tenantId = "returned-mutation";
        expect((await store.getRun(first.run.runId))?.admission).toEqual(original);
      }
      const replay = await service.submit(input()); expect(replay.created).toBe(false); expect(replay.run).toEqual(original);
    } finally { await store.close?.(); }
  });
}
