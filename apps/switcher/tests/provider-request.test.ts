import { expect, test } from "bun:test";
import { createProviderRequest } from "../src/provider-request";
import { proxyProviderStream } from "../src/provider-stream";

const bytes = (text: string) => new TextEncoder().encode(text);
const terminal = 'data: {"type":"message_stop"}\n\n';
const never = () => new Promise<never>(() => {});

test("an idle operation settles even when its underlying promise ignores abort", async () => {
  const caller = new AbortController(), owner = new AbortController();
  const activity = createProviderRequest(caller.signal, owner.signal, { idleTimeoutMs: 30 });
  await expect(activity.run(never)).rejects.toThrow("Provider response idle timeout");
  expect(activity.timedOut()).toBe(true);
  expect(activity.fetchOptions.timeout).toBe(false);
  expect(caller.signal.aborted).toBe(false);
  expect(owner.signal.aborted).toBe(false);
  activity.finish();
});

for (const kind of ["caller", "owner"] as const) test(`${kind} abort releases an idle operation without recording a timeout`, async () => {
  const caller = new AbortController(), owner = new AbortController();
  const activity = createProviderRequest(caller.signal, owner.signal, { idleTimeoutMs: 25 });
  const pending = activity.run(never);
  (kind === "caller" ? caller : owner).abort(new Error("cancelled fixture request"));
  await expect(pending).rejects.toThrow("cancelled fixture request");
  await Bun.sleep(40);
  expect(activity.timedOut()).toBe(false);
  activity.finish();
});

function fixture(cancel: () => unknown = () => {}) {
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; }, cancel }), { headers: { "content-type": "text/event-stream" } });
  const caller = new AbortController(), owner = new AbortController();
  const activity = createProviderRequest(caller.signal, owner.signal, { idleTimeoutMs: 30 });
  const reasons: string[] = [];
  let released = 0;
  const proxy = proxyProviderStream({ response, protocol: "anthropic-messages", requestSignal: caller.signal, abort: owner, activity,
    closing: () => false, release: () => released++, interrupted: reason => reasons.push(reason) });
  return { ...proxy, upstream, caller, owner, activity, reasons, released: () => released };
}

test("a stalled response reports an idle timeout, and stalled provider cancellation cannot delay cleanup", async () => {
  const f = fixture(never);
  const reader = f.stream.getReader();
  const pending = reader.read();
  await expect(pending).rejects.toThrow("Provider stream timed out waiting for activity");
  expect(f.reasons).toEqual(["provider_idle_timeout"]);
  expect(f.released()).toBe(1);
  await f.cancel();
  expect(f.released()).toBe(1);
});

test("downstream backpressure does not consume the provider idle budget or read ahead without a bound", async () => {
  const f = fixture();
  f.upstream.enqueue(bytes(": first\n\n"));
  f.upstream.enqueue(bytes(": buffered\n\n"));
  const reader = f.stream.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(": first\n\n");
  await Bun.sleep(100);
  expect(f.activity.timedOut()).toBe(false);
  expect(f.owner.signal.aborted).toBe(false);
  expect(f.released()).toBe(0);
  f.upstream.enqueue(bytes(terminal));
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(": buffered\n\n");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(terminal);
  expect((await reader.read()).done).toBe(true);
  expect(f.reasons).toEqual([]);
  expect(f.released()).toBe(1);
  await f.cancel();
});

test("caller cancellation during a pending read remains quiet and clears the idle timer", async () => {
  const f = fixture();
  const pending = f.stream.getReader().read();
  f.caller.abort();
  expect((await pending).done).toBe(true);
  await Bun.sleep(50);
  expect(f.activity.timedOut()).toBe(false);
  expect(f.reasons).toEqual([]);
  expect(f.released()).toBe(1);
});

test("real upstream failures retain their distinct safe classification", async () => {
  const f = fixture();
  const pending = f.stream.getReader().read();
  f.upstream.error(new Error("private upstream detail"));
  await expect(pending).rejects.toThrow("Provider stream ended unexpectedly");
  expect(f.reasons).toEqual(["stream_interrupted"]);
  expect(f.activity.timedOut()).toBe(false);
  expect(f.released()).toBe(1);
});

test("terminal completion clears the watchdog without a late timeout", async () => {
  const f = fixture();
  f.upstream.enqueue(bytes(terminal));
  expect(await new Response(f.stream).text()).toBe(terminal);
  await Bun.sleep(50);
  expect(f.activity.timedOut()).toBe(false);
  expect(f.reasons).toEqual([]);
  expect(f.released()).toBe(1);
});
