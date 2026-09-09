import { expect, test } from "bun:test";
import { isContextOverflow } from "../src/provider-error";

test("only recognized structured context errors are classified", async () => {
  for (const error of [
    { code: "context_length_exceeded" }, { type: "context_window_exceeded" }, { code: "prompt_too_long" },
    { message: "prompt is too long: 1000001 tokens > 1000000 maximum" },
    { message: "This model's maximum context length is 1048576 tokens. However, you requested more tokens." },
    { message: "This model's maximum context length is 1048576 tokens. However, you requested 1049086 tokens (1017086 in the messages, 32000 in the completion). Please reduce the length of the messages or completion.", type: "invalid_request_error", param: null, code: "invalid_request_error" },
    { message: "Input tokens exceed the maximum context length." },
  ]) expect(await isContextOverflow(Response.json({ error }, { status: 400 }))).toBe(true);
  for (const body of [
    { error: { message: "invalid tool payload: user text says prompt is too long" } },
    { error: { message: "The maximum output tokens parameter is invalid" } },
    { error: { message: "context_length_exceeded is not a valid parameter" } },
    { message: "prompt is too long" }, { error: "prompt is too long" },
    { error: [{ code: "context_length_exceeded" }] }, { error: { code: ["context_length_exceeded"] } },
  ]) expect(await isContextOverflow(Response.json(body, { status: 400 }))).toBe(false);
  expect(await isContextOverflow(new Response("prompt is too long", { status: 400 }))).toBe(false);
  expect(await isContextOverflow(Response.json({ error: { code: "context_length_exceeded" } }, { status: 401 }))).toBe(false);
});

test("oversized, incomplete and broken upstream errors remain unclassified", async () => {
  const oversized = Response.json({ error: { code: "context_length_exceeded", message: "x".repeat(16384) } }, { status: 400 });
  expect(await isContextOverflow(oversized)).toBe(false);
  let cancelled = false;
  const stalled = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"error":{"code":"context_length_exceeded"}')); },
    cancel() { cancelled = true; },
  }), { status: 400 });
  const started = Date.now();
  expect(await isContextOverflow(stalled)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2000);
  expect(cancelled).toBe(true);
  expect(await isContextOverflow(new Response(new ReadableStream({ start(controller) { controller.error(new Error("upstream secret")); } }), { status: 400 }))).toBe(false);
});

test("a provider that never acknowledges cancellation cannot hold error handling open", async () => {
  for (const status of [400, 401]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(16385)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }), { status });
    const started = Date.now();
    expect(await isContextOverflow(response)).toBe(false);
    expect(cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  }
});
