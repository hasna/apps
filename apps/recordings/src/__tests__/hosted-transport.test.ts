import { expect, test } from "bun:test";
import { HostedRecordingsClient } from "../hosted/index.js";

const base = "https://fictional.example.test/internal/recordings/v1/";
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init);
const fakeFetch = (body: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch => (async (url, init) => body(String(url), init)) as typeof fetch;

test("invalid complete bases fail before any credential or transport access", () => {
  for (const apiBase of ["http://example.test/api/v1", "https://user:fiction@example.test/api/v1", "https://example.test/api/v1?token=fictional", "https://example.test", "https://example.test/api/v2", "https://example.test/api/v1#fragment"]) {
    expect(() => new HostedRecordingsClient({ apiBase })).toThrow("Choose a complete HTTPS v1 API base");
  }
  expect(new HostedRecordingsClient({ apiBase: "https://EXAMPLE.test:443/internal/recordings/v1/" }).apiBase).toBe("https://example.test/internal/recordings/v1");
});

test("actual redirect response cannot forward credentials to another loopback origin", async () => {
  let destinationCalls = 0, authorization: string | null = null;
  const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { destinationCalls++; return json({ status: "ok" }); } });
  const source = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { authorization = request.headers.get("authorization"); return Response.redirect(`http://127.0.0.1:${target.port}/api/v1/account`, 307); } });
  try {
    const client = new HostedRecordingsClient({ apiBase: `http://127.0.0.1:${source.port}/api/v1/`, credentialProvider: () => "fictional-access" });
    await expect(client.account()).rejects.toMatchObject({ code: "redirect_refused" });
    expect(String(authorization)).toBe("Bearer fictional-access"); expect(destinationCalls).toBe(0);
  } finally { await source.stop(true); await target.stop(true); }
});

test("transport uses bearer only and preserves additive version metadata", async () => {
  let calls = 0;
  const client = new HostedRecordingsClient({ apiBase: base, credentialProvider: () => "fictional-access", fetch: fakeFetch((url, init) => {
    calls++; expect(url).toBe(base.slice(0, -1) + "/account");
    expect(init?.redirect).toBe("manual"); expect(init?.credentials).toBe("omit");
    const headers = new Headers(init?.headers); expect(headers.get("authorization")).toBe("Bearer fictional-access"); expect(headers.has("x-api-key")).toBe(false);
    return json({ account: { id: "10000000-0000-4000-8000-000000000001", displayName: "Fiction", email: "f@example.test", createdAt: "2026-09-07T10:00:00Z", extension: true }, wireVersion: "1.1", capabilities: ["version-negotiation", "pcm-s16le-24000-mono", "audio-ack", "session-authorize", "future-capability"], future: { number: 2 } });
  }) });
  expect(await client.account()).toMatchObject({ account: { extension: true }, future: { number: 2 } }); expect(calls).toBe(1);
});

test("malformed payloads and fetch exceptions do not disclose bodies or causes", async () => {
  for (const response of [json({ status: "FICTIONAL_PRIVATE_CANARY" }), new Response("FICTIONAL_PRIVATE_CANARY", { headers: { "content-type": "application/json" } }), json({ status: "ok" }, { status: 500 })]) {
    const client = new HostedRecordingsClient({ apiBase: base, fetch: fakeFetch(() => response) });
    let error: unknown; try { await client.health(); } catch (caught) { error = caught; }
    expect(error).toBeDefined(); expect(String(error)).not.toContain("FICTIONAL_PRIVATE_CANARY"); expect(JSON.stringify(error)).not.toContain("FICTIONAL_PRIVATE_CANARY");
  }
  await expect(new HostedRecordingsClient({ apiBase: base, fetch: fakeFetch(() => { throw Error("FICTIONAL_PRIVATE_CANARY"); }) }).health()).rejects.toMatchObject({ code: "network_error", message: "The hosted API could not be reached." });
});

test("response bounds handle oversized chunks, dishonest length and truncated JSON", async () => {
  for (const response of [
    new Response(" ".repeat(2048), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "2048" } }),
  ]) await expect(new HostedRecordingsClient({ apiBase: base, maxResponseBytes: 1024, fetch: fakeFetch(() => response) }).health()).rejects.toMatchObject({ code: "response_too_large" });
  for (const response of [new Response('{"status":', { headers: { "content-type": "application/json" } }),
    new Response('{"status":"ok"}', { headers: { "content-type": "application/json", "content-length": "20" } })]) {
    await expect(new HostedRecordingsClient({ apiBase: base, fetch: fakeFetch(() => response) }).health()).rejects.toMatchObject({ code: "invalid_response" });
  }
});

test("deadline and cancellation include credential wait and response body consumption", async () => {
  let calls = 0;
  const never = new Promise<string>(() => {});
  const credentialClient = new HostedRecordingsClient({ apiBase: base, timeoutMs: 20, credentialProvider: () => never, fetch: fakeFetch(() => { calls++; return json({}); }) });
  await expect(credentialClient.account()).rejects.toMatchObject({ code: "timeout" }); expect(calls).toBe(0);
  let cancelled = 0;
  const stalled = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"status":')); }, cancel() { cancelled++; } }), { headers: { "content-type": "application/json" } });
  await expect(new HostedRecordingsClient({ apiBase: base, timeoutMs: 20, fetch: fakeFetch(stalled) }).health()).rejects.toMatchObject({ code: "timeout" });
  const abort = new AbortController();
  const request = new HostedRecordingsClient({ apiBase: base, fetch: fakeFetch(stalled) }).health({ signal: abort.signal });
  setTimeout(() => abort.abort(), 10); await expect(request).rejects.toMatchObject({ code: "aborted" }); expect(cancelled).toBe(2);
  const stopped = new AbortController(); stopped.abort();
  await expect(credentialClient.account({ signal: stopped.signal })).rejects.toMatchObject({ code: "aborted" }); expect(calls).toBe(0);
});

test("actual compressed HTTP JSON is bounded after fetch decoding without comparing compressed length", async () => {
  const compressed = Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ status: "ok" })));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(compressed, { headers: {
    "content-type": "application/json", "content-encoding": "gzip", "content-length": String(compressed.byteLength),
  } }); } });
  try {
    expect(await new HostedRecordingsClient({ apiBase: `http://127.0.0.1:${server.port}/api/v1/` }).health()).toEqual({ status: "ok" });
  } finally { await server.stop(true); }
});

test("actual HTTP body deadline aborts a service response after headers", async () => {
  const timers: Array<ReturnType<typeof setTimeout>> = []; let receivedHeaders = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"status":'));
      timers.push(setTimeout(() => { try { controller.enqueue(new TextEncoder().encode('"ok"}')); controller.close(); } catch {} }, 2_000));
    },
  }), { headers: { "content-type": "application/json" } }); } });
  try {
    const client = new HostedRecordingsClient({ apiBase: `http://127.0.0.1:${server.port}/api/v1/`, timeoutMs: 500,
      fetch: fakeFetch(async (url, init) => { const response = await fetch(url, init); receivedHeaders = true; return response; }) });
    await expect(client.health()).rejects.toMatchObject({ code: "timeout" });
    expect(receivedHeaders).toBe(true);
  } finally { for (const timer of timers) clearTimeout(timer); await server.stop(true); }
});
