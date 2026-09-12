import { expect, spyOn, test } from "bun:test";
import { createInferenceGateway } from "../src/inference-gateway";
import { compileModelPolicy } from "../src/model-policy";
import { createHermesBridge } from "../src/hermes-backend";
import { geminiBridge } from "../src/gemini-bridge";
import { grokBridge } from "../src/harnesses";

const bytes = (text: string) => new TextEncoder().encode(text);
const models = [{ id: "main", name: "Main" }];
const gatewayInput = (baseUrl: string, events: any[]) => ({
  harness: "claude" as const, protocol: "anthropic-messages" as const,
  baseUrl, model: "main", models, stateDir: "/fixture", cwd: "/fixture",
  compiledPolicy: compileModelPolicy("main", models), catalogPath: "/fixture/catalog.json",
  onRoutingEvent: (event: any) => events.push(event),
});

test("provider keepalives allow a response to outlast several idle intervals", async () => {
  // Shorten the legacy total deadline as a regression control. New code uses
  // the injected idle interval, so the fixture need not run for four minutes.
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const deadline = spyOn(AbortSignal, "timeout").mockImplementation(ms => originalTimeout(ms === 240000 ? 80 : ms));
  let timer: ReturnType<typeof setInterval> | undefined;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      let count = 0;
      controller.enqueue(bytes(": keep-alive\n\n"));
      timer = setInterval(() => {
        if (++count < 12) controller.enqueue(bytes(": keep-alive\n\n"));
        else { clearInterval(timer); controller.enqueue(bytes('data: {"type":"message_stop"}\n\n')); controller.close(); }
      }, 20);
    }, cancel() { clearInterval(timer); } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const events: any[] = [];
  const gateway = createInferenceGateway(gatewayInput(upstream.url.origin + "/v1", events), { idleTimeoutMs: 80 });
  try {
    const response = await fetch(gateway.baseUrl + "/messages", { method: "POST", headers: { "x-api-key": gateway.token, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) });
    expect(await response.text()).toContain('"type":"message_stop"');
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBeUndefined();
  } finally { deadline.mockRestore(); clearInterval(timer); await gateway.cleanup(); await upstream.stop(true); }
});

test("headers that never arrive produce an explicit idle timeout without fallback or replay", async () => {
  let calls = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    calls++; await Bun.sleep(100); return Response.json({ model: "main" });
  } });
  const events: any[] = [];
  const gateway = createInferenceGateway(gatewayInput(upstream.url.origin + "/v1", events), { idleTimeoutMs: 30 });
  try {
    const response = await fetch(gateway.baseUrl + "/messages", { method: "POST", headers: { "x-api-key": gateway.token, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) });
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("provider_idle_timeout");
    expect(events.map(event => event.reason)).toEqual(["provider_idle_timeout"]);
    expect(calls).toBe(1);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});

test("a response that goes idle after headers records the distinct failure and is never replayed", async () => {
  let calls = 0, cancelled = false;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes(": first\n\n")); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const events: any[] = [];
  const gateway = createInferenceGateway(gatewayInput(upstream.url.origin + "/v1", events), { idleTimeoutMs: 30 });
  try {
    const response = await fetch(gateway.baseUrl + "/messages", { method: "POST", headers: { "x-api-key": gateway.token, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) });
    // Bun can deliver partial bytes followed by EOF for an errored HTTP body.
    // Routing metadata, rather than EOF alone, distinguishes this failure.
    await response.text().catch(() => undefined);
    expect(events.map(event => event.reason)).toEqual(["provider_idle_timeout"]);
    expect(calls).toBe(1);
    for (let i = 0; !cancelled && i < 30; i++) await Bun.sleep(5);
    expect(cancelled).toBe(true);
    await gateway.cleanup();
    expect(events).toHaveLength(1);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});

for (const kind of ["grok", "hermes", "gemini"] as const) test(`${kind} auth bridge uses the same activity budget across a long response`, async () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  const ending = kind === "gemini" ? 'data: {"candidates":[],"fixture_done":true}\n\n' : 'data: {"type":"message_stop"}\n\n';
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      let count = 0;
      controller.enqueue(bytes(": keep-alive\n\n"));
      timer = setInterval(() => {
        if (++count < 8) controller.enqueue(bytes(": keep-alive\n\n"));
        else { clearInterval(timer); controller.enqueue(bytes(ending)); controller.close(); }
      }, 15);
    }, cancel() { clearInterval(timer); } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const input = gatewayInput(upstream.url.origin + "/v1", []), timing = { idleTimeoutMs: 60 };
  const bridge = kind === "grok" ? grokBridge(input, timing) : kind === "hermes" ? createHermesBridge(input, timing) : geminiBridge({ ...input, protocol: "gemini-generate-content" }, timing);
  try {
    const headers = kind === "gemini" ? { "x-goog-api-key": bridge.token } : { "x-api-key": bridge.token };
    const path = kind === "gemini" ? "/models/main:streamGenerateContent?alt=sse" : "/messages";
    const response = await fetch(bridge.baseUrl + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toEndWith(ending);
  } finally { clearInterval(timer); await bridge.cleanup(); await upstream.stop(true); }
});

for (const kind of ["grok", "hermes", "gemini"] as const) test(`${kind} auth bridge bounds stalled headers with a safe timeout response`, async () => {
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { await Bun.sleep(100); return Response.json({ model: "main" }); } });
  const input = gatewayInput(upstream.url.origin + "/v1", []), timing = { idleTimeoutMs: 30 };
  const bridge = kind === "grok" ? grokBridge(input, timing) : kind === "hermes" ? createHermesBridge(input, timing) : geminiBridge({ ...input, protocol: "gemini-generate-content" }, timing);
  try {
    const headers = kind === "gemini" ? { "x-goog-api-key": bridge.token } : { "x-api-key": bridge.token };
    const path = kind === "gemini" ? "/models/main:streamGenerateContent?alt=sse" : "/messages";
    const response = await fetch(bridge.baseUrl + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) });
    expect(response.status).toBe(504);
    expect((await response.json()).error.message).toBe("Provider request timed out waiting for activity");
  } finally { await bridge.cleanup(); await upstream.stop(true); }
});

for (const kind of ["gateway", "grok", "hermes", "gemini"] as const) test(`${kind} cannot be held open by cancellation of an unsuccessful provider response`, async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0, cancelCalls = 0, releaseCancellation!: () => void;
  const cancellation = new Promise<void>(resolve => { releaseCancellation = resolve; });
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (!String(url).startsWith("https://provider.invalid/")) return nativeFetch(url, init);
    calls++;
    if (calls === 2) return Promise.resolve(Response.json({ model: "fallback" }));
    return Promise.resolve(new Response(new ReadableStream({ cancel() { cancelCalls++; return cancellation; } }), { status: kind === "gateway" ? 500 : 400 }));
  });
  const input = gatewayInput("https://provider.invalid/v1", []), timing = { idleTimeoutMs: 40 };
  const fallbackModels = [...models, { id: "fallback", name: "Fallback" }];
  const bridge = kind === "gateway" ? createInferenceGateway({ ...input, models: fallbackModels, compiledPolicy: compileModelPolicy("main", fallbackModels, { version: 1, allowedModels: ["fallback"], fallbacks: { main: ["fallback"] } }) }, timing)
    : kind === "grok" ? grokBridge(input, timing) : kind === "hermes" ? createHermesBridge(input, timing) : geminiBridge({ ...input, protocol: "gemini-generate-content" }, timing);
  let safety: ReturnType<typeof setTimeout> | undefined;
  try {
    const headers = kind === "gemini" ? { "x-goog-api-key": bridge.token } : { "x-api-key": bridge.token };
    const path = kind === "gemini" ? "/models/main:streamGenerateContent?alt=sse" : "/messages";
    const response = await Promise.race([
      nativeFetch(bridge.baseUrl + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [], stream: true }) }),
      new Promise<never>((_, reject) => { safety = setTimeout(() => reject(new Error("Provider cancellation blocked the response")), 250); }),
    ]);
    expect(response.status).toBe(kind === "gateway" ? 200 : 400);
    await response.text();
    expect(cancelCalls).toBe(1);
    expect(calls).toBe(kind === "gateway" ? 2 : 1);
    await bridge.cleanup();
  } finally { clearTimeout(safety); releaseCancellation(); fetchMock.mockRestore(); await bridge.cleanup(); }
});
