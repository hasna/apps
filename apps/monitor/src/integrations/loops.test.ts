/**
 * Regression tests for the monitor-v2 Loops native adapter (MON-V2-12).
 *
 * Gate: tests use `LoopsClient.create`; duplicate loop registration is
 * prevented by effect identity; created loop pointer is recorded. Every
 * invocation persists one effect record (receipt + failure classification)
 * under the stable effect key.
 *
 * The LoopsClient is the package-owned SDK surface (`@hasna/loops`), exercised
 * against an in-memory Store exactly as the loops SDK's own tests do — no
 * daemon, no HTTP, no invented fallback surface. The effect store is the
 * shared interim FileEffectStore over a temp dir.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import { LoopsClient, Store, type CreateLoopInput } from "@hasna/loops";
import {
  LoopsIntegration,
  classifyLoopsError,
  loopIdentity,
  loopRequestDigest,
  loopsEffectKey,
  type LoopsEffectContext,
  type LoopsIntegrationConfig,
} from "./loops.js";
import { digestOf, effectKey, FileEffectStore } from "./effects.js";

function makeConfig(): LoopsIntegrationConfig {
  return { ownerScope: "station01", store: new FileEffectStore(mkdtempSync(join(tmpdir(), "monitor-loops-")) ) };
}

function ctx(overrides: Partial<LoopsEffectContext> = {}): LoopsEffectContext {
  return {
    slug: "web-health",
    runId: "run-0001",
    actionIndex: 0,
    target: "web-health-check",
    ...overrides,
  };
}

function makeClient(store: Store): LoopsClient {
  return new LoopsClient({ store, runnerId: "monitor-test" });
}

const DEFINITION: Omit<CreateLoopInput, "name"> = {
  description: "monitor-v2 recurring loop for a slug check",
  schedule: { type: "cron", expression: "*/5 * * * *" },
  target: { type: "command", command: "monitor", args: ["status", "--json"] },
};

const CHANGED_DEFINITION: Omit<CreateLoopInput, "name"> = {
  ...DEFINITION,
  schedule: { type: "cron", expression: "*/1 * * * *" },
};

describe("loops native adapter (MON-V2-12)", () => {
  test("registers a recurring loop through LoopsClient.create and records the created pointer", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.integration).toBe("loops");
    expect(result.operation).toBe("create");
    expect(result.state).toBe("confirmed");
    expect(result.deduplicated).toBe(false);
    // created loop pointer is recorded
    expect(result.pointer).toBeDefined();
    expect(result.pointer!.kind).toBe("loop");
    expect(result.pointer!.id).toBeTruthy();
    // shared persisted vocabulary is carried on the result
    expect(result.target).toBe(ctx().target);
    expect(result.requestDigest).toBe(loopRequestDigest(DEFINITION));
    expect(result.externalId).toBe(result.pointer!.id);
    expect(result.resultPointer).toBe(digestOf(result.pointer));
    expect(result.lastErrorClass).toBeNull();
    expect(result.errorDetail).toBeUndefined();

    // the loop actually exists in the package-owned store under the derived identity
    const loops = await client.list();
    expect(loops.length).toBe(1);
    expect(loops[0]!.name).toBe(loopIdentity(config, ctx()));
    expect(loops[0]!.id).toBe(result.pointer!.id);
    // the effect label is derived from the shared five-component key
    expect(loops[0]!.labels).toContain(`monitor.effect.${loopsEffectKey(ctx()).slice(0, 32)}`);

    // one effect record is persisted under the stable effect key
    const record = await config.store.get(loopsEffectKey(ctx()));
    expect(record).not.toBeNull();
    expect(record!.integration).toBe("loops");
    expect(record!.operation).toBe("create");
    expect(record!.target).toBe(ctx().target);
    expect(record!.state).toBe("confirmed");
    expect(record!.requestDigest).toBe(loopRequestDigest(DEFINITION));
    expect(record!.externalId).toBe(result.pointer!.id);
    expect(record!.lastErrorClass).toBeNull();
  });

  test("the stable effect key uses the shared five-component key ending in the operation 'create'", () => {
    // hash(slug, run_id, action_index, target, operation) — operation is
    // "create", never "loops.create" (the contract component, not the surface)
    const shared = effectKey({
      slug: ctx().slug,
      runId: ctx().runId,
      actionIndex: ctx().actionIndex,
      target: ctx().target,
      operation: "create",
    });
    expect(loopsEffectKey(ctx())).toBe(shared);
    expect(loopsEffectKey(ctx())).not.toBe(
      effectKey({
        slug: ctx().slug,
        runId: ctx().runId,
        actionIndex: ctx().actionIndex,
        target: ctx().target,
        operation: "loops.create",
      }),
    );
  });

  test("duplicate registration with the same effect identity is prevented and returns the same pointer", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);
    const createSpy = spyOn(client, "create");

    const first = await adapter.register(ctx(), DEFINITION);
    const second = await adapter.register(ctx(), DEFINITION);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(second.state).toBe("confirmed");
    expect(second.deduplicated).toBe(true);
    expect(second.pointer!.id).toBe(first.pointer!.id);
    expect(second.pointer!.name).toBe(first.pointer!.name);
    expect(second.requestDigest).toBe(first.requestDigest);
    expect((await client.list()).length).toBe(1);
    // the persisted record still points at the one loop
    const record = await config.store.get(loopsEffectKey(ctx()));
    expect(record!.externalId).toBe(first.pointer!.id);
  });

  test("dedupe survives a fresh adapter over the same stores — identity is persisted, not in-memory", async () => {
    const store = new Store(":memory:");
    const config = makeConfig();
    const adapter = new LoopsIntegration(makeClient(store), config);

    const first = await adapter.register(ctx(), DEFINITION);

    // a second adapter (and client) over the same loops store and effect store
    // must still dedupe
    const adapter2 = new LoopsIntegration(makeClient(store), config);
    const again = await adapter2.register(ctx(), DEFINITION);

    expect(again.deduplicated).toBe(true);
    expect(again.pointer!.id).toBe(first.pointer!.id);
    expect((await makeClient(store).list()).length).toBe(1);
  });

  test("a different effect context registers a distinct loop", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, makeConfig());

    const first = await adapter.register(ctx(), DEFINITION);
    const second = await adapter.register(ctx({ runId: "run-0002" }), DEFINITION);

    expect(second.pointer!.id).not.toBe(first.pointer!.id);
    expect(second.deduplicated).toBe(false);
    expect((await client.list()).length).toBe(2);
  });

  test("a changed definition with the same effect context is detected and never silently confirmed", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);
    const createSpy = spyOn(client, "create");

    // five-minute definition first
    const first = await adapter.register(ctx(), DEFINITION);
    expect(first.pointer!.id).toBeTruthy();

    // changed one-minute definition, same context: the old loop must NOT be
    // confirmed as-is — a fresh loop carrying the new cadence is created
    const second = await adapter.register(ctx(), CHANGED_DEFINITION);

    expect(second.state).toBe("confirmed");
    expect(second.deduplicated).toBe(false);
    expect(second.requestDigest).toBe(loopRequestDigest(CHANGED_DEFINITION));
    expect(second.requestDigest).not.toBe(first.requestDigest);
    expect(second.pointer!.id).not.toBe(first.pointer!.id);
    expect(createSpy).toHaveBeenCalledTimes(2);

    // the stale loop was archived — it no longer runs the old cadence
    const stale = await client.get(first.pointer!.id);
    expect(stale.archivedAt).toBeTruthy();
    // the live loop carries the new cadence
    const live = await client.get(second.pointer!.id);
    expect(live.archivedAt).toBeFalsy();
    expect(live.schedule).toEqual({ type: "cron", expression: "*/1 * * * *" });

    // the persisted record now points at the new loop and digest
    const record = await config.store.get(loopsEffectKey(ctx()));
    expect(record!.requestDigest).toBe(loopRequestDigest(CHANGED_DEFINITION));
    expect(record!.externalId).toBe(second.pointer!.id);
  });

  test("Error failures are classified as execution_error with the shared vocabulary", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);
    spyOn(client, "create").mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("failed");
    expect(result.lastErrorClass).toBe("execution_error");
    expect(result.errorDetail).toBe("boom");
    expect(result.required).toBe(false);
    expect(result.pointer).toBeUndefined();
    expect(result.externalId).toBeNull();
    expect(result.resultPointer).toBeNull();
    // the classified failure is persisted
    const record = await config.store.get(loopsEffectKey(ctx()));
    expect(record!.state).toBe("failed");
    expect(record!.lastErrorClass).toBe("execution_error");
  });

  test("non-Error throws are classified as unknown, not 'UnknownError'", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, makeConfig());
    spyOn(client, "create").mockImplementation(async () => {
      throw "boom-string";
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("unknown");
    expect(result.lastErrorClass).toBe("unknown");
    expect(result.pointer).toBeUndefined();
  });

  test("timeouts are classified as unknown/timeout — the ambiguous outcome", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, makeConfig());
    spyOn(client, "create").mockImplementation(async () => {
      const timeout = new Error("operation timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("unknown");
    expect(result.lastErrorClass).toBe("timeout");
  });

  test("classifyLoopsError emits only the shared failure vocabulary", () => {
    const err = new Error("boom");
    expect(classifyLoopsError(err).lastErrorClass).toBe("execution_error");
    expect(classifyLoopsError("boom-string").lastErrorClass).toBe("unknown");
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(classifyLoopsError(timeout).lastErrorClass!).toBe("timeout");
    expect(classifyLoopsError(new Error("no loop found")).lastErrorClass!).toBe("not_found");
    expect(classifyLoopsError(new Error("invalid schedule")).lastErrorClass!).toBe("invalid_input");
    const allowed = ["not_found", "timeout", "execution_error", "invalid_input", "unknown"];
    for (const outcome of [classifyLoopsError(err), classifyLoopsError("x"), classifyLoopsError(timeout)]) {
      expect(allowed).toContain(outcome.lastErrorClass!);
    }
  });

  test("required failures are classified for the caller without throwing", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = { ...makeConfig(), required: true };
    const adapter = new LoopsIntegration(client, config);
    spyOn(client, "create").mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("failed");
    expect(result.lastErrorClass).toBe("execution_error");
    expect(result.required).toBe(true);
    // the adapter never throws — the caller decides whether a required
    // failure affects the run outcome
  });

  test("concurrent duplicate registration of one effect shares a single create", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, makeConfig());
    const createSpy = spyOn(client, "create");

    const [first, second] = await Promise.all([
      adapter.register(ctx(), DEFINITION),
      adapter.register(ctx(), DEFINITION),
    ]);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(first.state).toBe("confirmed");
    expect(second.state).toBe("confirmed");
    // both callers resolve the same in-flight registration outcome
    expect(second.pointer!.id).toBe(first.pointer!.id);
    expect((await client.list()).length).toBe(1);
  });

  test("a held cross-process effect fence fails closed instead of racing the holder", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);

    // another process holds the fence for this effect key
    const held = await config.store.claim(loopsEffectKey(ctx()), 60_000);
    expect(held).not.toBeNull();

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("failed");
    expect(result.lastErrorClass).toBe("execution_error");
    expect(result.pointer).toBeUndefined();
    // nothing was created while the fence is held
    expect((await client.list()).length).toBe(0);
    await config.store.release(loopsEffectKey(ctx()), held!.token);
  });

  test("concurrent different definitions are not coalesced — the second request lands", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapterA = new LoopsIntegration(client, config);
    const adapterB = new LoopsIntegration(client, config);

    const [first, second] = await Promise.all([
      adapterA.register(ctx(), DEFINITION),
      adapterB.register(ctx(), CHANGED_DEFINITION),
    ]);

    // each caller receives the outcome of its own request, never the other's
    expect(first.requestDigest).toBe(loopRequestDigest(DEFINITION));
    expect(second.requestDigest).toBe(loopRequestDigest(CHANGED_DEFINITION));
    expect(second.state).toBe("confirmed");
    // final state: one live loop carrying the changed cadence; the stale
    // loop retired after the replacement was proven
    const loops = await client.list({ includeArchived: true });
    const active = loops.filter((loop) => !loop.archivedAt);
    expect(active.length).toBe(1);
    expect(active[0]!.schedule).toEqual({ type: "cron", expression: "*/1 * * * *" });
    expect(loops.length).toBe(2);
  });

  test("a timed-out create that committed is adopted on retry — never duplicated", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);

    // the hosted create COMMITS the loop, then the response times out
    const createSpy = spyOn(client, "create").mockImplementation(async (input) => {
      const committed = await new LoopsClient({ store, runnerId: "monitor-test" }).create(input);
      void committed;
      const timeout = new Error("operation timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    });

    const first = await adapter.register(ctx(), DEFINITION);
    expect(first.state).toBe("unknown");
    expect(first.lastErrorClass).toBe("timeout");
    expect(first.externalId).toBeNull();

    // retry with the same definition: reconcile by label, do not create again
    const retry = await adapter.register(ctx(), DEFINITION);
    expect(retry.state).toBe("confirmed");
    expect(retry.deduplicated).toBe(true);
    expect(retry.pointer).toBeDefined();
    expect((await client.list()).length).toBe(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    // the persisted record now carries the adopted loop id
    const record = await config.store.get(loopsEffectKey(ctx()));
    expect(record!.externalId).toBe(retry.pointer!.id);
  });

  test("a failed replacement never archives the working loop — prove before replace", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);

    const first = await adapter.register(ctx(), DEFINITION);
    expect(first.state).toBe("confirmed");

    const createSpy = spyOn(client, "create").mockImplementation(async () => {
      const err = new Error("invalid schedule");
      err.name = "ValidationError";
      throw err;
    });
    const replaced = await adapter.register(ctx(), CHANGED_DEFINITION);
    expect(replaced.state).toBe("failed");
    expect(replaced.lastErrorClass).toBe("invalid_input");

    // the original loop is still live with its original cadence
    const still = await client.get(first.pointer!.id);
    expect(still.archivedAt).toBeUndefined();
    expect(still.schedule).toEqual({ type: "cron", expression: "*/5 * * * *" });

    // retry with create restored: the stale loop is archived only after the
    // new loop exists
    createSpy.mockRestore();
    const retried = await adapter.register(ctx(), CHANGED_DEFINITION);
    expect(retried.state).toBe("confirmed");
    expect(retried.pointer!.id).not.toBe(first.pointer!.id);
    const stale = await client.get(first.pointer!.id);
    expect(stale.archivedAt).toBeTruthy();
    const live = await client.get(retried.pointer!.id);
    expect(live.archivedAt).toBeFalsy();
    expect(live.schedule).toEqual({ type: "cron", expression: "*/1 * * * *" });
  });

  test("timeout reconcile never adopts a live loop carrying a different definition", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const config = makeConfig();
    const adapter = new LoopsIntegration(client, config);

    // confirmed five-minute loop
    const first = await adapter.register(ctx(), DEFINITION);
    expect(first.state).toBe("confirmed");

    // changed one-minute request times out WITHOUT committing
    const createSpy = spyOn(client, "create").mockImplementation(async () => {
      const timeout = new Error("operation timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    });
    const attempted = await adapter.register(ctx(), CHANGED_DEFINITION);
    expect(attempted.state).toBe("unknown");
    expect(attempted.lastErrorClass).toBe("timeout");

    createSpy.mockRestore();
    // retry of the changed request: the old loop carries the OLD definition,
    // so it must NOT be adopted as the new effect — a fresh loop is proven,
    // then the stale one is retired
    const retried = await adapter.register(ctx(), CHANGED_DEFINITION);
    expect(retried.state).toBe("confirmed");
    expect(retried.pointer!.id).not.toBe(first.pointer!.id);
    const stale = await client.get(first.pointer!.id);
    expect(stale.archivedAt).toBeTruthy();
    const live = await client.get(retried.pointer!.id);
    expect(live.archivedAt).toBeFalsy();
    expect(live.schedule).toEqual({ type: "cron", expression: "*/1 * * * *" });
    expect((await client.list({ includeArchived: true })).length).toBe(2);
  });
});
