import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runHook, type HookInput, type RunHookOptions, type RunHookResult } from "@hasna/hooks";
import { createHooksAdapter, type RunHookFn } from "./hooks.js";
import { FileEffectStore } from "./effects.js";
import { digestOf, effectKey } from "./effects.js";
import type { EffectOutcome, EffectRequest } from "./adapter.js";
import type { EffectStore } from "./effects.js";

const REQ: EffectRequest = {
  slug: "deploy-check",
  runId: "run-abc",
  actionIndex: 1,
  target: "gitguard",
  operation: "invoke",
};

function tempStore() {
  return new FileEffectStore(mkdtempSync(join(tmpdir(), "monitor-hooks-")));
}

/** A fake runner shaped exactly like the SDK's runHook signature. */
function fakeRunner(impl: (name: string, input: HookInput, options?: RunHookOptions) => Promise<RunHookResult> | RunHookResult): { runner: RunHookFn; calls: { name: string; input: HookInput; options?: RunHookOptions }[] } {
  const calls: { name: string; input: HookInput; options?: RunHookOptions }[] = [];
  const runner = (async (name: string, input: HookInput, options?: RunHookOptions) => {
    calls.push({ name, input, options });
    return impl(name, input, options);
  }) as RunHookFn;
  return { runner, calls };
}

describe("hooks adapter uses the exact runHook SDK surface", () => {
  it("resolves runHook as a callable export of @hasna/hooks", () => {
    expect(typeof runHook).toBe("function");
  });

  it("passes the configured hook id, HookInput payload, and timeout through to runHook", async () => {
    const store = tempStore();
    const { runner, calls } = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store, runner, timeoutMs: 1500 });

    const payload: Record<string, unknown> = {
      hook_event_name: "Notification",
      session_id: "sess-1",
      cwd: "/tmp",
      subject: "monitor deploy-check failed",
    };
    await adapter.invoke(REQ, { hookId: "gitguard" }, payload);

    expect(calls.length).toBe(1);
    expect(calls[0]!.name).toBe("gitguard");
    expect(calls[0]!.input).toEqual(payload satisfies HookInput);
    expect(calls[0]!.options).toEqual({ timeout: 1500 } satisfies RunHookOptions);
  });

  it("invokes the runner exactly once per invoke — no other external call path", async () => {
    const store = tempStore();
    const { runner, calls } = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store, runner });
    await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    expect(calls.length).toBe(2);
  });
});

describe("hooks adapter outcome classification", () => {
  it("classifies a zero exit as confirmed and persists the event receipt", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => ({ output: { decision: "approve" }, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store, runner });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, { hook_event_name: "PreToolUse" });

    expect(outcome.state).toBe("confirmed");
    expect(outcome.lastErrorClass).toBeNull();
    expect(outcome.externalId).toBeNull();
    // receipt persisted under the stable effect key
    const key = effectKey(REQ);
    const record = await store.get(key);
    expect(record).not.toBeNull();
    expect(record!.state).toBe("confirmed");
    expect(record!.integration).toBe("hooks");
    expect(record!.target).toBe("gitguard");
    // result pointer is the digest of the bounded result, never raw content
    expect(record!.resultPointer).toBe(digestOf({ output: { decision: "approve" }, stderr: "", exitCode: 0 }));
    expect(record!.resultPointer).toMatch(/^[0-9a-f]{64}$/);
    expect(record!.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies a non-zero exit as failed with execution_error and a bounded stderr excerpt", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => ({ output: {}, stderr: "boom\n".repeat(500), exitCode: 3 }));
    const adapter = createHooksAdapter({ store, runner });

    const outcome: EffectOutcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});

    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("execution_error");
    const record = await store.get(effectKey(REQ));
    expect(record!.state).toBe("failed");
    expect(record!.lastErrorClass).toBe("execution_error");
    // stderr excerpt is bounded and never stored in full
    expect(outcome.errorDetail!.length).toBeLessThanOrEqual(512);
  });

  it("classifies a not-found hook as failed with not_found", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => {
      throw new Error("Hook 'nope' not found");
    });
    const adapter = createHooksAdapter({ store, runner });

    // the effect identity must name the hook actually configured and executed
    const req = { ...REQ, target: "nope" };
    const outcome = await adapter.invoke(req, { hookId: "nope" }, {});
    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("not_found");
    expect((await store.get(effectKey(req)))!.lastErrorClass).toBe("not_found");
  });

  it("classifies a trust-check rejection as failed with invalid_input", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => {
      throw new Error("Hook 'gitguard' script changed since it was trusted (sha256 a != b). Run 'hooks trust gitguard' to trust the new content.");
    });
    const adapter = createHooksAdapter({ store, runner });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("invalid_input");
  });

  it("classifies a timeout as unknown with timeout — the effect may or may not have landed", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => {
      const err = new Error("Hook timed out after 1000ms (process group killed)");
      err.name = "HookTimeoutError";
      throw err;
    });
    const adapter = createHooksAdapter({ store, runner, timeoutMs: 1000 });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    expect(outcome.state).toBe("unknown");
    expect(outcome.lastErrorClass).toBe("timeout");
    expect((await store.get(effectKey(REQ)))!.state).toBe("unknown");
  });

  it("classifies any other thrown error as unknown with unknown", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => {
      throw new Error("unexpected wiring failure");
    });
    const adapter = createHooksAdapter({ store, runner });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    expect(outcome.state).toBe("unknown");
    expect(outcome.lastErrorClass).toBe("unknown");
    expect(outcome.errorDetail).toContain("unexpected wiring failure");
  });

  it("records a failed effect even when the failure is non-fatal to the run", async () => {
    const store = tempStore();
    const { runner } = fakeRunner(async () => ({ output: {}, stderr: "nope", exitCode: 1 }));
    const adapter = createHooksAdapter({ store, runner });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    // the adapter returns the classified outcome; required-ness is applied by the
    // action caller — a non-required failure never throws out of the adapter
    expect(outcome.state).toBe("failed");
    expect(await store.get(effectKey(REQ))).not.toBeNull();
  });

  it("classifies a receipt persistence failure as unknown — the hook may have landed without a receipt", async () => {
    const failingStore: EffectStore = {
      record: async () => {
        throw new Error("EACCES: permission denied, open '/var/monitor-effects/abc.json.tmp'");
      },
      get: async () => null,
    };
    const { runner } = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store: failingStore, runner });

    const outcome = await adapter.invoke(REQ, { hookId: "gitguard" }, {});
    // a storage failure must not reject with a raw error: the hook has already
    // run, so the outcome is ambiguous and the caller must reconcile, not retry
    expect(outcome.state).toBe("unknown");
    expect(outcome.lastErrorClass).toBe("unknown");
    expect(outcome.errorDetail).toContain("EACCES");
    expect(outcome.errorDetail!.length).toBeLessThanOrEqual(512);
  });
});

describe("hooks adapter effect identity validation", () => {
  it("refuses an effect whose target does not match the configured hookId — no execution, no receipt", async () => {
    const store = tempStore();
    const { runner, calls } = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store, runner });

    const mismatched = { ...REQ, target: "claimed-hook" };
    const outcome = await adapter.invoke(mismatched, { hookId: "actual-hook" }, {});

    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("invalid_input");
    // the claimed hook must never be executed under a different identity
    expect(calls.length).toBe(0);
    expect(await store.get(effectKey(mismatched))).toBeNull();
  });

  it("refuses an effect whose operation is not invoke", async () => {
    const store = tempStore();
    const { runner, calls } = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapter = createHooksAdapter({ store, runner });

    const mismatched = { ...REQ, operation: "emit" };
    const outcome = await adapter.invoke(mismatched, { hookId: "gitguard" }, {});

    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("invalid_input");
    expect(calls.length).toBe(0);
    expect(await store.get(effectKey(mismatched))).toBeNull();
  });
});

describe("hooks adapter idempotent effect persistence", () => {
  it("re-running the same effect key updates the single persisted record", async () => {
    const store = tempStore();
    const key = effectKey(REQ);
    const first = fakeRunner(async () => ({ output: {}, stderr: "", exitCode: 0 }));
    const adapterA = createHooksAdapter({ store, runner: first.runner });
    await adapterA.invoke(REQ, { hookId: "gitguard" }, {});

    const second = fakeRunner(async () => {
      throw new Error("Hook 'gitguard' not found");
    });
    const adapterB = createHooksAdapter({ store, runner: second.runner });
    const outcome = await adapterB.invoke(REQ, { hookId: "gitguard" }, {});

    expect(outcome.state).toBe("failed");
    expect(outcome.lastErrorClass).toBe("not_found");
    const record = await store.get(key);
    expect(record!.state).toBe("failed");
    expect(record!.lastErrorClass).toBe("not_found");
  });
});
