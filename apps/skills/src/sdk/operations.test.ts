import { describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { useDefaultTestTimeout } from "../test-preload.js";
import { createSkillOperationClient, SkillOperationClientError, SKILL_OPERATION_LIMITS, type SkillOperationRequest, type SkillOperationTransport } from "./operations.js";
useDefaultTestTimeout();
const id = "12345678-1234-4234-8234-123456789012";
const request = (input: Record<string, any> = { text: "hello" }, requestId = id): SkillOperationRequest => ({ contractVersion: 1, requestId, operation: "text.generate", input });
const result = (requestId = id, output: any = { text: "world" }) => ({ contractVersion: 1 as const, requestId, status: "succeeded" as const, output });
function fixture(invoke?: SkillOperationTransport["invoke"], get?: SkillOperationTransport["get"]) {
  const calls: SkillOperationRequest[] = [], reads: string[] = [];
  const client = createSkillOperationClient({ invoke: async (r, o) => { calls.push(r); return invoke ? invoke(r, o) : result(r.requestId); }, get: async (r, o) => { reads.push(r); return get ? get(r, o) : result(r); } }, { timeoutMs: 100 });
  return { client, calls, reads };
}
async function errorCode(promise: Promise<unknown>, code: string, outcome: string) {
  try { await promise; throw Error("expected refusal"); } catch (error) {
    expect(error).toBeInstanceOf(SkillOperationClientError);
    expect<string>((error as SkillOperationClientError).code).toBe(code);
    expect<string>((error as SkillOperationClientError).outcome).toBe(outcome);
    expect(String(error)).not.toContain("canary-secret");
  }
}
describe("injected operation client", () => {
  test("useful invocation and explicit status read preserve identity", async () => {
    const f = fixture(); expect(await f.client.invoke(request())).toEqual(result()); expect(await f.client.get(id)).toEqual(result());
    expect(f.calls).toHaveLength(1); expect(f.reads).toEqual([id]); expect(Object.isFrozen(f.calls[0])).toBe(true); expect(Object.isFrozen(f.calls[0]!.input)).toBe(true);
  });
  test("owns nested request before transport and returned result", async () => {
    let release!: (v: unknown) => void; const raw = result(id, { nested: ["approved"] });
    const f = fixture(() => new Promise(resolve => { release = resolve; })); const original = request({ nested: { text: "approved" }, files: ["a"] });
    const pending = f.client.invoke(original); (original.input as any).nested.text = "changed"; (original.input as any).files.push("b");
    expect(f.calls[0]!.input).toEqual({ nested: { text: "approved" }, files: ["a"] }); release(raw); const returned = await pending;
    raw.output.nested[0] = "changed"; expect(returned).toEqual(result(id, { nested: ["approved"] })); expect(Object.isFrozen((returned as any).output.nested)).toBe(true);
  });
  test("snapshots a resolved transport response before another awaiting continuation can mutate it", async () => {
    const raw = result(id, { text: "approved" });
    const client = createSkillOperationClient({ invoke: () => Promise.resolve(raw), get: () => Promise.resolve(raw) });
    const pending = client.invoke(request()); queueMicrotask(() => { raw.output.text = "changed"; });
    expect(await pending).toEqual(result(id, { text: "approved" }));
  });
  test("canonical duplicate identity supports explicit replay but rejects changed requests", async () => {
    const f = fixture(); await f.client.invoke(request({ b: 2, a: 1 })); await f.client.invoke(request({ a: 1, b: 2 }));
    await errorCode(f.client.invoke(request({ a: 2, b: 2 })), "REQUEST_CONFLICT", "not-invoked");
    await errorCode(f.client.invoke({ ...request({ a: 1, b: 2 }), operation: "image.generate" }), "REQUEST_CONFLICT", "not-invoked"); expect(f.calls).toHaveLength(2);
  });
  test("in-flight identity is remembered before an asynchronous response", async () => {
    let release!: (v: unknown) => void; const f = fixture(() => new Promise(resolve => { release = resolve; })); const pending = f.client.invoke(request());
    await errorCode(f.client.invoke(request({ text: "changed" })), "REQUEST_CONFLICT", "not-invoked"); release(result()); await pending; expect(f.calls).toHaveLength(1);
  });
  test("rejects unsupported JSON without invoking getters or toJSON", async () => {
    let accesses = 0; const getter = Object.defineProperty({}, "x", { enumerable: true, get() { accesses++; return 1; } }); const cycle: any = {}; cycle.x = cycle;
    const invalid = [undefined, () => 1, NaN, Infinity, 1n, new Date(), new Map(), cycle, getter, { toJSON() { accesses++; return {}; } }, { [Symbol("key")]: 1 }, Array(2), "\ud800"];
    const f = fixture(); for (const x of invalid) await errorCode(f.client.invoke(request({ x })), "INVALID_REQUEST", "not-invoked");
    for (const field of ["credentials", "tenantId", "url", "maxCredits"]) await errorCode(f.client.invoke({ ...request(), [field]: "canary-secret" } as any), "INVALID_REQUEST", "not-invoked");
    expect(accesses).toBe(0); expect(f.calls).toHaveLength(0);
  });
  test("bounds schemas, UTF-8, escaped bytes, depth and nodes before transport", async () => {
    const f = fixture(); let deep: any = {}; for (let i = 0; i < 33; i++) deep = { x: deep };
    const invalid = [{ ...request(), contractVersion: 2 }, { ...request(), requestId: "invalid" }, { ...request(), operation: "bad/path" }, { ...request(), operation: "x".repeat(129) }, { ...request(), input: [] }, request({ x: "é".repeat(33000) }), request({ x: "\0".repeat(12000) }), request({ deep }), request({ x: Array(16384).fill(null) })];
    for (const x of invalid) await errorCode(f.client.invoke(x as any), "INVALID_REQUEST", "not-invoked"); expect(f.calls).toHaveLength(0);
    await f.client.invoke(request({ x: "x".repeat(60000) })); expect(f.calls).toHaveLength(1);
  });
  test("never evicts identity when count or byte capacity is exhausted", async () => {
    const nextId = (i: number) => `12345678-1234-4234-8234-${String(i).padStart(12, "0")}`;
    const f = fixture(); for (let i = 0; i < SKILL_OPERATION_LIMITS.rememberedRequests; i++) await f.client.invoke(request({}, nextId(i)));
    await errorCode(f.client.invoke(request({}, nextId(256))), "REQUEST_CAPACITY", "not-invoked");
    await errorCode(f.client.invoke(request({ changed: true }, nextId(0))), "REQUEST_CONFLICT", "not-invoked"); expect(f.calls).toHaveLength(256);
    const bytes = fixture(); for (let i = 0; i < 17; i++) await bytes.client.invoke(request({ x: "x".repeat(60000) }, nextId(i)));
    await errorCode(bytes.client.invoke(request({ x: "x".repeat(60000) }, nextId(18))), "REQUEST_CAPACITY", "not-invoked"); expect(bytes.calls).toHaveLength(17);
  });
  test("accepts each exact authoritative result state and arbitrary bounded output data", async () => {
    for (const status of ["not-executed", "pending", "unknown", "succeeded", "refused"] as const) {
      const raw = { contractVersion: 1, requestId: id, status, ...(status === "succeeded" ? { output: { authority: "ordinary data", nested: [null, false, 1] } } : status === "refused" ? { code: "NOT_ALLOWED" } : {}) };
      const f = fixture(async () => raw, async () => raw); expect<unknown>(await f.client.invoke(request())).toEqual(raw); expect<unknown>(await f.client.get(id)).toEqual(raw);
    }
  });
  test("malformed results are unknown and never leak transport data", async () => {
    let accesses = 0; const getter = Object.defineProperty(result(), "output", { enumerable: true, get() { accesses++; return {}; } });
    const invalid = [null, { ...result(), requestId: "other" }, { ...result(), contractVersion: 2 }, { ...result(), credentials: "canary-secret" }, { contractVersion: 1, requestId: id, status: "succeeded" }, { contractVersion: 1, requestId: id, status: "refused", code: "canary-secret" }, { ...result(), status: "not-executed" }, result(id, "é".repeat(530000)), getter];
    for (const raw of invalid) { const f = fixture(async () => raw, async () => raw); await errorCode(f.client.invoke(request()), "INVALID_RESPONSE", "unknown"); await errorCode(f.client.get(id), "INVALID_RESPONSE", "unknown"); expect(f.calls).toHaveLength(1); expect(f.reads).toHaveLength(1); } expect(accesses).toBe(0);
  });
  test("lost transport response never retries or claims nonexecution; recovery reads same ID", async () => {
    const f = fixture(async () => { throw Error("canary-secret"); }); await errorCode(f.client.invoke(request()), "UNKNOWN_OUTCOME", "unknown"); expect(f.calls).toHaveLength(1); expect(f.reads).toHaveLength(0);
    await errorCode(f.client.invoke(request({ changed: true })), "REQUEST_CONFLICT", "not-invoked"); expect(await f.client.get(id)).toEqual(result()); expect(f.reads).toEqual([id]); expect(f.calls).toHaveLength(1);
  });
  test("pre-abort invokes nothing; in-flight abort and ignored cancellation remain unknown", async () => {
    let calls = 0; let captured!: AbortSignal; const controller = new AbortController(); controller.abort();
    const client = createSkillOperationClient({ invoke: async (_r, { signal }) => { calls++; captured = signal; return new Promise(() => {}); }, get: async () => { calls++; return result(); } }, { timeoutMs: 20 });
    await errorCode(client.invoke(request(), { signal: controller.signal }), "ABORTED", "not-invoked"); await errorCode(client.get(id, { signal: controller.signal }), "ABORTED", "not-invoked"); expect(calls).toBe(0);
    const live = new AbortController(); const pending = client.invoke(request(), { signal: live.signal }); live.abort(); await errorCode(pending, "UNKNOWN_OUTCOME", "unknown"); expect(captured.aborted).toBe(true); expect(getEventListeners(live.signal, "abort")).toHaveLength(0);
    await errorCode(client.invoke(request()), "UNKNOWN_OUTCOME", "unknown"); expect(calls).toBe(2);
  });
  test("synchronous abort plus throw is observed in an actual child without unhandled rejection", async () => {
    const moduleUrl = import.meta.resolve("./operations.js");
    const code = `import {createSkillOperationClient} from ${JSON.stringify(moduleUrl)};
      import {getEventListeners} from "node:events";
      const controller = new AbortController(), unhandled = [];
      process.on("unhandledRejection", error => unhandled.push(error?.code ?? "unexpected"));
      let calls = 0, caught = "";
      const client = createSkillOperationClient({invoke() { calls++; controller.abort(); throw Error("canary-secret"); }, async get() { return null; }});
      try { await client.invoke(${JSON.stringify(request())}, {signal:controller.signal}); } catch(error) { caught = error.code; }
      await new Promise(resolve => setTimeout(resolve, 25));
      console.log(JSON.stringify({caught,calls,unhandled,listeners:getEventListeners(controller.signal,"abort").length}));
      if(unhandled.length) process.exitCode = 1;`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 5_000);
    try {
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(status).toBe(0); expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ caught: "UNKNOWN_OUTCOME", calls: 1, unhandled: [], listeners: 0 });
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill(); await child.exited; } }
  });
  test("invalid configuration and status IDs refuse before transport", async () => {
    for (const timeoutMs of [0, -1, 60001, NaN, 1.5]) expect(() => createSkillOperationClient({ invoke: async () => result(), get: async () => result() }, { timeoutMs })).toThrow("INVALID_CONFIGURATION");
    const f = fixture(); await errorCode(f.client.get("invalid"), "INVALID_REQUEST", "not-invoked"); expect(f.reads).toHaveLength(0);
  });
});
