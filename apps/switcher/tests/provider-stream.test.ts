import { expect, test } from "bun:test";
import { proxyProviderStream, terminalEventObserver } from "../src/provider-stream";

const bytes = (value: string) => new TextEncoder().encode(value);

test("SSE completion requires a whole terminal event across UTF-8 and CRLF chunks", () => {
  const terminal = terminalEventObserver("anthropic-messages", "Text/Event-Stream; charset=utf-8");
  const payload = bytes('data: {"type":"content_block_delta","delta":{"text":"é message_stop"}}\r\n\r\ndata: {"type":"message_stop"}\r\n\r\n');
  for (let i = 0; i < payload.length - 2; i++) expect(terminal(payload.subarray(i, i + 1))).toBe(false);
  expect(terminal(payload.subarray(payload.length - 2))).toBe(true);
});

test("terminal detection handles SSE multiline data, bare CR, and explicit response failures", () => {
  for (const type of ["response.completed", "response.failed", "response.incomplete"]) {
    const terminal = terminalEventObserver("openai-responses", "text/event-stream");
    expect(terminal(bytes(`data: {\rdata: "type":"${type}"}\r\r`))).toBe(true);
  }
  const chat = terminalEventObserver("openai-chat", "text/event-stream");
  expect(chat(bytes('data: {"choices":[{"delta":{"content":"[DONE]"},"finish_reason":"stop"}]}\n\n'))).toBe(false);
  expect(chat(bytes('data: {"choices":[],"usage":{"total_tokens":4}}\n\n'))).toBe(false);
  expect(chat(bytes("data: [DONE]\n\n"))).toBe(true);
});

test("non-SSE, other protocols, partial frames and oversized events cannot fake completion", () => {
  expect(terminalEventObserver("anthropic-messages", "application/json")(bytes('data: {"type":"message_stop"}\n\n'))).toBe(false);
  expect(terminalEventObserver("gemini-generate-content", "text/event-stream")(bytes('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'))).toBe(false);
  const terminal = terminalEventObserver("anthropic-messages", "text/event-stream");
  expect(terminal(bytes('data: {"type":"message_stop"}\n'))).toBe(false);
  const bounded = terminalEventObserver("openai-chat", "text/event-stream");
  expect(bounded(bytes('data: ' + 'x'.repeat(140000) + '\ndata: [DONE]\n\n'))).toBe(false);
  expect(bounded(bytes('data: [DONE]\n\n'))).toBe(true);
});

function fixture() {
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }), { headers: { "content-type": "text/event-stream" } });
  let released = 0, interrupted = 0, closing = false;
  const request = new AbortController(), abort = new AbortController();
  const proxy = proxyProviderStream({ response, protocol: "anthropic-messages", requestSignal: request.signal, abort,
    closing: () => closing, release: () => released++, interrupted: () => interrupted++ });
  return { ...proxy, upstream, request, abort, counters: () => ({released, interrupted}), close: () => { closing = true; } };
}

test("an incomplete upstream stream still errors, releases once, and does not reveal upstream diagnostics", async () => {
  const f = fixture(), reader = f.stream.getReader();
  f.upstream.enqueue(bytes('data: {"type":"content_block_delta"}\n\n'));
  expect((await reader.read()).done).toBe(false);
  const pending = reader.read();
  f.upstream.error(new Error("private upstream diagnostic"));
  await expect(pending).rejects.toThrow("Provider stream ended unexpectedly");
  expect(f.counters()).toEqual({ released: 1, interrupted: 1 });
  await f.cancel();
  expect(f.counters()).toEqual({ released: 1, interrupted: 1 });
});

for (const reason of ["client", "shutdown", "cancel"] as const) test(`${reason} cancellation of a pending read is not an upstream failure`, async () => {
  const f = fixture(), reader = f.stream.getReader(), pending = reader.read();
  if (reason === "client") { f.request.abort(); f.upstream.error(new Error("aborted")); }
  else if (reason === "shutdown") { f.close(); f.upstream.error(new Error("aborted")); }
  else await reader.cancel();
  expect((await pending).done).toBe(true);
  expect(f.counters()).toEqual({ released: 1, interrupted: 0 });
  await f.cancel();
  expect(f.counters()).toEqual({ released: 1, interrupted: 0 });
});

test("the completed response bytes arrive before upstream cancellation and cleanup stays idempotent", async () => {
  const f = fixture();
  const content = 'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\ndata: {"type":"message_stop"}\n\n';
  f.upstream.enqueue(bytes(content));
  expect(await new Response(f.stream).text()).toBe(content);
  expect(f.abort.signal.aborted).toBe(true);
  expect(f.counters()).toEqual({ released: 1, interrupted: 0 });
  await f.cancel(); await f.cancel();
  expect(f.counters()).toEqual({ released: 1, interrupted: 0 });
});
