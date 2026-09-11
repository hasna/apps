import { afterEach, expect, test } from "bun:test";
import { RemoteQuoteUnavailableError, RemoteRequestError, RemoteRouteUnsupportedError, RemoteSkillsClient } from "./remote-client.js";
import { quoteUnavailableMessages } from "./remote-quote-errors.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const client = () => new RemoteSkillsClient("owned-quote-credential", "https://skills.example.test");
let calls: Array<{ method: string; path: string }> = [];
function reply(response: () => Response) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", path: new URL(input instanceof Request ? input.url : input).pathname });
    return response();
  }) as typeof fetch;
}
async function failure(action = () => client().quoteRun("blog-article")) {
  const error = await action().then(() => null, value => value);
  expect(error).toBeInstanceOf(RemoteRequestError);
  expect(calls).toEqual([{ method: "POST", path: "/api/v1/skills/blog-article/quote" }]);
  expect(String(error)).not.toContain("owned-quote-credential");
  expect(String(error)).not.toContain("\u001b");
  return error;
}
async function generic() {
  const error = await failure();
  expect(error).not.toBeInstanceOf(RemoteQuoteUnavailableError);
  expect(error.message).toBe("Remote request to /api/v1/skills/blog-article/quote failed: HTTP 503");
}

const expectedFailures = [
  ["HOSTED_PROVIDER_UNAVAILABLE", "Hosted execution is temporarily unavailable on this Skills instance."],
  ["HOSTED_CONNECTORS_UNAVAILABLE", "Hosted connector execution is unavailable on this Skills instance."],
  ["SKILL_IMPLEMENTATION_UNAVAILABLE", "This skill has no hosted execution implementation."],
  ["HOSTED_PRICING_UNAVAILABLE", "Hosted execution is unavailable while this skill's pricing is reviewed."],
  ["RUNTIME_ALLOWLIST_REQUIRED", "Hosted execution is unavailable until this Skills instance enables its skill catalog."],
  ["RUNTIME_SKILL_NOT_ALLOWED", "This skill is not enabled for hosted execution on this Skills instance."],
] as const;
test("the quote error vocabulary is the six reviewed availability refusals", () => {
  expect(Object.keys(quoteUnavailableMessages).sort()).toEqual(expectedFailures.map(([code]) => code).sort());
});
for (const [code, message] of expectedFailures) {
  test(`quote preserves ${code} using client-owned text only`, async () => {
    reply(() => Response.json({ code, error: "owned-quote-credential\u001b[31m", details: ["unsafe server instructions"],
      availability: { status: "unavailable", code, message: "untrusted provider detail" } }, { status: 503, statusText: "owned-quote-credential" }));
    const error = await failure();
    expect(error).toBeInstanceOf(RemoteQuoteUnavailableError);
    expect(error).toMatchObject({ name: "RemoteQuoteUnavailableError", code, status: 503, message, path: "/api/v1/skills/blog-article/quote" });
    expect(JSON.stringify(error)).not.toContain("unsafe server instructions");
    expect(JSON.stringify(error)).not.toContain("untrusted provider detail");
  });
}

test("quote does not promote unknown codes, nested codes, arrays or malformed JSON", async () => {
  for (const body of ["null", "[]", '{"code":"toString"}', '{"code":"UNKNOWN"}', '{"error":{"code":"RUNTIME_SKILL_NOT_ALLOWED"}}',
    '{"code":3}', '{"code":"RUNTIME_SKILL_NOT_ALLOWED\\u001b[31m"}', '{"code":']) {
    reply(() => new Response(body, { status: 503, headers: { "content-type": "application/json" } }));
    await generic();
  }
});

test("quote refuses malformed UTF-8 instead of replacing unsafe bytes", async () => {
  const prefix = new TextEncoder().encode('{"code":"RUNTIME_SKILL_NOT_ALLOWED","error":"');
  const suffix = new TextEncoder().encode('"}');
  reply(() => new Response(new Uint8Array([...prefix, 0xff, ...suffix]), { status: 503, headers: { "content-type": "application/json" } }));
  await generic();
});

test("known codes on another status or route retain existing error semantics", async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 429, 500]) {
    reply(() => Response.json({ code: "RUNTIME_SKILL_NOT_ALLOWED" }, { status }));
    const error = await client().quoteRun("blog-article").then(() => null, value => value);
    expect(error).toBeInstanceOf([404, 405].includes(status) ? RemoteRouteUnsupportedError : RemoteRequestError);
    expect(error).not.toBeInstanceOf(RemoteQuoteUnavailableError);
    expect(error.status).toBe(status);
    expect(calls).toEqual([{ method: "POST", path: "/api/v1/skills/blog-article/quote" }]);
  }
  reply(() => Response.json({ code: "RUNTIME_SKILL_NOT_ALLOWED" }, { status: 503 }));
  const error = await client().getCapabilities().then(() => null, value => value);
  expect(error).toBeInstanceOf(RemoteRequestError);
  expect(error).not.toBeInstanceOf(RemoteQuoteUnavailableError);
  expect(calls).toEqual([{ method: "GET", path: "/api/v1/capabilities" }]);
});

test("oversized and invalid declared lengths cancel the actual stream", async () => {
  for (const length of ["16385", "no-size"]) {
    let cancelled = false;
    reply(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
      { status: 503, headers: { "content-type": "application/json", "content-length": length } }));
    await generic(); expect(cancelled).toBe(true);
  }
  let cancelled = false;
  reply(() => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } }),
    { status: 503, headers: { "content-type": "application/json" } }));
  await generic(); expect(cancelled).toBe(true);
});

test("the exact byte ceiling accepts complete JSON but never a stalled valid prefix", async () => {
  const body = JSON.stringify({ code: "RUNTIME_SKILL_NOT_ALLOWED" }).padEnd(16384, " ");
  reply(() => new Response(body, { status: 503, headers: { "content-type": "application/json", "content-length": "16384" } }));
  expect(await failure()).toBeInstanceOf(RemoteQuoteUnavailableError);
  let cancelled = false;
  reply(() => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"code":"RUNTIME_SKILL_NOT_ALLOWED"}')); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { status: 503, headers: { "content-type": "application/json" } }));
  const started = performance.now(); await generic();
  expect(cancelled).toBe(true); expect(performance.now() - started).toBeLessThan(4000);
}, 5000);

test("stream errors and non-JSON bodies stay generic", async () => {
  reply(() => new Response(new ReadableStream({ start(c) { c.error(new Error("owned-quote-credential")); } }),
    { status: 503, headers: { "content-type": "application/json" } }));
  await generic();
  reply(() => new Response('{"code":"RUNTIME_SKILL_NOT_ALLOWED"}', { status: 503, headers: { "content-type": "text/plain" } }));
  await generic();
});
