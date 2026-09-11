import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createClientTransport, createHasnaHttpTransport } from "./transport.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

function server(respond: (request: Request) => Response | Promise<Response>) {
  const instance = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: respond });
  cleanup.push(() => instance.stop(true));
  return instance;
}

function savedClient() {
  const calls: Array<{ key: string | null; path: string }> = [];
  const instance = server(request => {
    calls.push({ key: request.headers.get("x-api-key"), path: new URL(request.url).pathname });
    return Response.json({ ok: true });
  });
  const home = mkdtempSync(join(tmpdir(), "contracts-raw-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const file = join(home, ".hasna/todos/config/credentials");
  mkdirSync(dirname(file), { recursive: true });
  const authority = new URL("gateway/todos", instance.url).href;
  const save = (key: string, url = authority) => writeFileSync(file,
    `HASNA_TODOS_API_URL=${url}\nHASNA_TODOS_API_KEY=${key}\n`, { mode: 0o600 });
  save("fixture-before");
  const { client } = createClientTransport("todos", { HOME: home }, {
    credentials: { keychain: { enabled: false } },
  });
  return { client, calls, save, file, authority };
}

describe("raw authenticated transport", () => {
  test("saved credential rotation stays paired with the original authority", async () => {
    const fixture = savedClient();
    await (await fixture.client.fetch(`${fixture.authority}/api/tasks`)).body?.cancel();
    fixture.save("fixture-after");
    await (await fixture.client.fetch(`${fixture.authority}/v1/tasks`)).body?.cancel();
    expect(fixture.calls.map(call => call.key)).toEqual(["fixture-before", "fixture-after"]);
    const otherCalls: string[] = [];
    const other = server(request => { otherCalls.push(request.url); return Response.json({ ok: true }); });
    fixture.save("fixture-other", other.url.origin);
    await expect(fixture.client.fetch(`${fixture.authority}/api/tasks`)).rejects.toThrow(/authority changed/);
    expect(fixture.calls).toHaveLength(2);
    expect(otherCalls).toHaveLength(0);
  });

  for (const change of ["removed", "invalid"] as const) {
    test(`${change} credentials cause no dispatch or stale fallback`, async () => {
      const fixture = savedClient();
      if (change === "removed") rmSync(fixture.file);
      else fixture.save(" ");
      await expect(fixture.client.fetch(`${fixture.authority}/api/tasks`)).rejects.toThrow();
      expect(fixture.calls).toHaveLength(0);
    });
  }

  test("Request and init preserve method, exact binary body and effective headers", async () => {
    const observed: Array<{ method: string; body: number[]; marker: string | null; auth: string | null }> = [];
    const instance = server(async request => {
      observed.push({ method: request.method, body: [...new Uint8Array(await request.arrayBuffer())],
        marker: request.headers.get("x-marker"), auth: request.headers.get("x-api-key") });
      return new Response("accepted", { status: 201, headers: { "X-Receipt": "fixture" } });
    });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin, apiKey: "fixture-bound" });
    const request = new Request(new URL("api/tasks", instance.url), {
      method: "POST", body: new Uint8Array([0, 255, 128, 10]), headers: { "X-Marker": "original" },
    });
    const response = await client.fetch(request, { method: "PUT", headers: { "X-Marker": "override" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Receipt")).toBe("fixture");
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("accepted");
    expect(observed).toEqual([{ method: "PUT", body: [0, 255, 128, 10], marker: "override", auth: "fixture-bound" }]);
  });

  test("FormData keeps its normalized multipart boundary and values", async () => {
    const instance = server(async request => {
      const form = await request.formData();
      return Response.json({ name: form.get("name"), contentType: request.headers.get("content-type") });
    });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin, apiKey: "fixture" });
    const body = new FormData(); body.set("name", "fixture-value");
    const response = await client.fetch(new URL("api/upload", instance.url), { method: "POST", body });
    expect(await response.json()).toMatchObject({ name: "fixture-value", contentType: expect.stringContaining("multipart/form-data; boundary=") });
  });

  test("returns the actual unread error Response and never retries or parses it", async () => {
    let calls = 0;
    const response = new Response("unparsed fixture", { status: 503, headers: { "Retry-After": "2" } });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture",
      retry: { retries: 3 }, fetchImpl: async () => { calls++; return response; } });
    const actual = await client.fetch("https://fixture.example/app/api/tasks");
    expect(actual).toBe(response);
    expect(actual.bodyUsed).toBe(false);
    expect(actual.headers.get("Retry-After")).toBe("2");
    expect(calls).toBe(1);
    await actual.body?.cancel();
  });

  test("raw auth failures retain status without reading the response", async () => {
    const response = new Response("unread authentication diagnostic", { status: 401 });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture",
      fetchImpl: async () => response });
    expect(await client.fetch("https://fixture.example/app/api/tasks")).toBe(response);
    expect(response.bodyUsed).toBe(false);
    await response.body?.cancel();
  });

  test("streaming headers return without draining the body and caller abort remains effective", async () => {
    const instance = server(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: first\n\n")); },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    const controller = new AbortController();
    const request = new Request(new URL("api/tasks/stream", instance.url), { signal: controller.signal });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin, apiKey: "fixture", timeoutMs: 500 });
    const response = await client.fetch(request);
    expect(response.bodyUsed).toBe(false);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
  });

  test("an already-aborted Request does not dispatch", async () => {
    let calls = 0;
    const controller = new AbortController(); controller.abort();
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture",
      fetchImpl: async () => { calls++; return Response.json({}); } });
    await expect(client.fetch(new Request("https://fixture.example/app/api/tasks", { signal: controller.signal }))).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test("the header deadline aborts the real request without retrying", async () => {
    let calls = 0;
    const instance = server(async () => {
      calls++;
      await Bun.sleep(80);
      return Response.json({});
    });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin,
      apiKey: "fixture", timeoutMs: 20, retry: { retries: 3 } });
    await expect(client.fetch(new URL("api/tasks", instance.url))).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("GET and HEAD keep their methods and no body", async () => {
    const seen: string[] = [];
    const instance = server(request => { seen.push(request.method); return new Response(null, { status: 204 }); });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin, apiKey: "fixture" });
    await client.fetch(instance.url);
    await client.fetch(instance.url, { method: "HEAD" });
    expect(seen).toEqual(["GET", "HEAD"]);
  });

  test("init signal overrides a Request signal according to fetch semantics", async () => {
    const cancelled = new AbortController(); cancelled.abort();
    const valid = new AbortController();
    let calls = 0;
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture",
      fetchImpl: async (_url, init) => { calls++; expect(init?.signal?.aborted).toBe(false); return new Response(null, { status: 204 }); } });
    await client.fetch(new Request("https://fixture.example/app/api/tasks", { signal: cancelled.signal }), { signal: valid.signal });
    expect(calls).toBe(1);
  });

  test("redirects return unchanged without following or retrying", async () => {
    let otherCalls = 0;
    const other = server(() => { otherCalls++; return Response.json({}); });
    let calls = 0;
    const instance = server(() => { calls++; return new Response(null, { status: 307, headers: { Location: other.url.href } }); });
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: instance.url.origin, apiKey: "fixture", retry: { retries: 2 } });
    const response = await client.fetch(instance.url, { method: "POST", body: "fixture", redirect: "follow" });
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(other.url.href);
    expect(calls).toBe(1);
    expect(otherCalls).toBe(0);
  });

  test("canonical origin and exact app path boundaries are enforced before dispatch", async () => {
    const seen: string[] = [];
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/gateway/todos", apiKey: "fixture",
      fetchImpl: async url => { seen.push(url); return new Response(null, { status: 204 }); } });
    await client.fetch("https://FIXTURE.EXAMPLE:443/gateway/todos/api/tasks?limit=1");
    expect(seen).toEqual(["https://fixture.example/gateway/todos/api/tasks?limit=1"]);
    for (const url of [
      "https://other.example/gateway/todos/api/tasks", "http://fixture.example/gateway/todos/api/tasks",
      "https://fixture.example/gateway/todos-extra/api/tasks", "https://fixture.example/gateway/todos/../other",
      "https://fixture.example/gateway/todos/%2e%2e/other", "https://fixture.example/gateway/todos/%2e%2e%2fother",
      "https://fixture.example/gateway/todos/%252e%252e/other", "https://fixture.example/gateway/todos/api/tasks#fragment",
    ]) await expect(client.fetch(url)).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  test("invalid Request diagnostics never include caller credential-like URL contents", async () => {
    let calls = 0;
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture",
      fetchImpl: async () => { calls++; return new Response(null, { status: 204 }); } });
    const marker = "fixture-password-not-for-errors";
    for (const url of [`https://user:${marker}@fixture.example/app/api/tasks`, marker]) {
      let failure: unknown;
      try { await client.fetch(url); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(marker);
    }
    expect(calls).toBe(0);
  });

  test("authority headers are refused and both auth headers stay bound", async () => {
    let calls = 0;
    const client = createHasnaHttpTransport({ name: "todos", baseUrl: "https://fixture.example/app", apiKey: "fixture-bound",
      fetchImpl: async (_url, init) => {
        calls++; const headers = new Headers(init?.headers);
        expect(headers.get("x-api-key")).toBe("fixture-bound");
        expect(headers.get("Authorization")).toBe("Bearer fixture-bound");
        return new Response(null, { status: 204 });
      } });
    await client.fetch("https://fixture.example/app/api/tasks", { headers: { "X-Marker": "ordinary" } });
    await expect(client.fetch("https://fixture.example/app/api/tasks", { headers: { Authorization: "untrusted" } })).rejects.toThrow();
    await expect(client.fetch("https://fixture.example/app/api/tasks", { headers: { "X-API-Key": "untrusted" } })).rejects.toThrow();
    await expect(client.fetch("https://fixture.example/app/api/tasks", { headers: { Host: "other.example" } })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
