/**
 * Regression tests for the monitor-v2 Loops native adapter (MON-V2-12).
 *
 * Gate: tests use `LoopsClient.create`; duplicate loop registration is
 * prevented by effect identity; created loop pointer is recorded.
 *
 * The LoopsClient is the package-owned SDK surface (`@hasna/loops`), exercised
 * against an in-memory Store exactly as the loops SDK's own tests do — no
 * daemon, no HTTP, no invented fallback surface.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { LoopsClient, Store, type CreateLoopInput } from "@hasna/loops";
import {
  LoopsIntegration,
  loopIdentity,
  loopsEffectKey,
  type LoopsEffectContext,
  type LoopsIntegrationConfig,
} from "./loops.js";

const CONFIG: LoopsIntegrationConfig = { ownerScope: "station01" };

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

describe("loops native adapter (MON-V2-12)", () => {
  test("registers a recurring loop through LoopsClient.create and records the created pointer", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, CONFIG);

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.integration).toBe("loops");
    expect(result.operation).toBe("create");
    expect(result.state).toBe("confirmed");
    expect(result.deduplicated).toBe(false);
    // created loop pointer is recorded
    expect(result.pointer).toBeDefined();
    expect(result.pointer!.kind).toBe("loop");
    expect(result.pointer!.id).toBeTruthy();

    // the loop actually exists in the package-owned store under the derived identity
    const loops = await client.list();
    expect(loops.length).toBe(1);
    expect(loops[0]!.name).toBe(loopIdentity(CONFIG, ctx()));
    expect(loops[0]!.id).toBe(result.pointer!.id);
    expect(loops[0]!.labels).toContain(`monitor.effect.${loopsEffectKey(ctx()).slice(0, 32)}`);
  });

  test("duplicate registration with the same effect identity is prevented and returns the same pointer", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, CONFIG);
    const createSpy = spyOn(client, "create");

    const first = await adapter.register(ctx(), DEFINITION);
    const second = await adapter.register(ctx(), DEFINITION);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(second.state).toBe("confirmed");
    expect(second.deduplicated).toBe(true);
    expect(second.pointer!.id).toBe(first.pointer!.id);
    expect(second.pointer!.name).toBe(first.pointer!.name);
    expect((await client.list()).length).toBe(1);
  });

  test("dedupe survives a fresh adapter over the same store — identity is persisted, not in-memory", async () => {
    const store = new Store(":memory:");
    const adapter = new LoopsIntegration(makeClient(store), CONFIG);

    const first = await adapter.register(ctx(), DEFINITION);

    // a second adapter (and client) over the same store must still dedupe
    const adapter2 = new LoopsIntegration(makeClient(store), CONFIG);
    const again = await adapter2.register(ctx(), DEFINITION);

    expect(again.deduplicated).toBe(true);
    expect(again.pointer!.id).toBe(first.pointer!.id);
    expect((await makeClient(store).list()).length).toBe(1);
  });

  test("a different effect context registers a distinct loop", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, CONFIG);

    const first = await adapter.register(ctx(), DEFINITION);
    const second = await adapter.register(ctx({ runId: "run-0002" }), DEFINITION);

    expect(second.pointer!.id).not.toBe(first.pointer!.id);
    expect(second.deduplicated).toBe(false);
    expect((await client.list()).length).toBe(2);
  });

  test("non-required failure is non-fatal and classified", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, CONFIG);
    spyOn(client, "create").mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("failed");
    expect(result.errorClass).toBeDefined();
    expect(result.required).toBe(false);
    expect(result.pointer).toBeUndefined();
  });

  test("required failures are classified for the caller without throwing", async () => {
    const store = new Store(":memory:");
    const client = makeClient(store);
    const adapter = new LoopsIntegration(client, { ...CONFIG, required: true });
    spyOn(client, "create").mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await adapter.register(ctx(), DEFINITION);

    expect(result.state).toBe("failed");
    expect(result.required).toBe(true);
    // the adapter never throws — the caller decides whether a required
    // failure affects the run outcome
  });
});
