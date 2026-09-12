import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HostedLibrary, HostedRecordingsClient, RecordingsV1Client } from "../sdk/index.js";
import { runHostedCLI } from "../cli/hosted.js";
import { buildHostedServer } from "../mcp/hosted.js";
import { buildHostedFetch } from "../server/hosted.js";
import { hostedProcessClient, parseHostedProcessOptions } from "../hosted/process-options.js";

const apiBase = "https://fictional.example.test/prefix/api/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", at = "2026-01-02T03:04:05Z";
const row = { id, title: "Fictional meeting", transcript: "Private fictional transcript.", durationMs: 1250,
  createdAt: at, updatedAt: at, futurePrivateField: "Do not project this field" };
const expected = { id, title: row.title, durationMs: row.durationMs, createdAt: at };
const fakeFetch = (body: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => body(String(url), init ?? {})) as typeof fetch;
function fixture() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  let credentials = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => { credentials++; return "fictional-session"; },
    fetch: fakeFetch((url, init) => {
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
      calls.push({ url, headers: new Headers(init.headers) });
      return Response.json(new URL(url).pathname.endsWith("/" + id) ? { recording: row } : { recordings: [row] });
    }) });
  return { client, calls, credentialCount: () => credentials };
}

test("SDK list/get project metadata, preserve typed cursors and explicitly include text", async () => {
  const f = fixture(), library = new HostedLibrary(f.client);
  expect(typeof RecordingsV1Client).toBe("function"); // Legacy export remains.
  const first = await library.list({ limit: 1 });
  expect(first).toEqual({ recordings: [expected], nextCursor: { before: at, beforeId: id } });
  const second = await library.list({ limit: 2, ...first.nextCursor!, includeText: true });
  expect(second).toEqual({ recordings: [{ ...expected, transcript: row.transcript }], nextCursor: null });
  expect(new URL(f.calls[1]!.url).searchParams.get("beforeId")).toBe(id);
  expect(new URL(f.calls[1]!.url).searchParams.has("offset")).toBe(false);
  expect(await library.get(id)).toEqual({ recording: expected });
  expect(await library.get(id, { includeText: true })).toEqual({ recording: { ...expected, transcript: row.transcript } });
  expect(f.calls).toHaveLength(4); expect(f.credentialCount()).toBe(4);
  expect(JSON.stringify(first)).not.toContain(row.transcript);
  expect(JSON.stringify(second)).not.toContain(row.futurePrivateField);
});

test("invalid Library inputs fail before credential or transport access", async () => {
  const f = fixture(), library = new HostedLibrary(f.client);
  for (const bad of [{ limit: 500 }, { limit: 0 }, { limit: null }, { before: at }, { beforeId: id },
    { includeText: "true" }, { offset: 1 }, { apiBase: "https://foreign.example.test/v1" }]) {
    await expect(library.list(bad as never)).rejects.toMatchObject({ code: "invalid_input" });
  }
  await expect(library.get("../account")).rejects.toMatchObject({ code: "invalid_input" });
  await expect(library.get(id, { includeText: "true" } as never)).rejects.toMatchObject({ code: "invalid_input" });
  expect(f.credentialCount()).toBe(0); expect(f.calls).toHaveLength(0);
});

test("named environment credential is refreshed and never falls through to provider or legacy credentials", async () => {
  const env: Record<string, string> = { SELECTED_SESSION: "fictional-first",
    HASNA_RECORDINGS_API_KEY: "fictional-legacy", OPENAI_API_KEY: "fictional-provider" };
  const seen: string[] = [];
  const client = hostedProcessClient({ apiBase, credentialEnv: "SELECTED_SESSION" }, env,
    fakeFetch((_url, init) => { seen.push(new Headers(init.headers).get("authorization")!); return Response.json({ recordings: [] }); }));
  await new HostedLibrary(client).list();
  env.SELECTED_SESSION = "fictional-second"; await new HostedLibrary(client).list();
  delete env.SELECTED_SESSION;
  await expect(new HostedLibrary(client).list()).rejects.toMatchObject({ code: "credential_unavailable" });
  expect(seen).toEqual(["Bearer fictional-first", "Bearer fictional-second"]);
  expect(() => hostedProcessClient({ apiBase, credentialEnv: "../secret" }, env)).toThrow();
});

test("real CLI parser uses shared list/get, help and fixed failures", async () => {
  const f = fixture(), written: string[] = [];
  const options = { client: f.client, write: (value: string) => { written.push(value); } };
  const connection = ["--api-base", apiBase, "--credential-env", "SELECTED_SESSION"];
  expect(await runHostedCLI([...connection, "list", "--limit", "1"], options)).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({ recordings: [expected], nextCursor: { before: at, beforeId: id } });
  expect(await runHostedCLI([...connection, "get", id, "--include-text"], options)).toBe(0);
  expect(JSON.parse(written.pop()!).recording.transcript).toBe(row.transcript);
  expect(await runHostedCLI(["--help"], options)).toBe(0);
  expect(written.join("")).toContain("--credential-env"); written.length = 0;
  expect(await runHostedCLI([...connection, "list", "--token", "fictional-do-not-echo"], options)).toBe(1);
  expect(written.join("")).not.toContain("fictional-do-not-echo");
  expect(f.calls).toHaveLength(2);
});

test("actual MCP discovery and dispatch expose the read-only hosted operations", async () => {
  const f = fixture(), server = buildHostedServer(f.client);
  const client = new Client({ name: "fictional-library-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(["recordings_hosted_delete", "recordings_hosted_get", "recordings_hosted_list", "recordings_hosted_paste_history", "recordings_hosted_providers", "recordings_hosted_rename"]);
    const reads = tools.filter(tool => !["recordings_hosted_rename", "recordings_hosted_delete"].includes(tool.name));
    expect(reads.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false)).toBe(true);
    const result = await client.callTool({ name: "recordings_hosted_list", arguments: { limit: 1 } });
    expect(result.structuredContent).toEqual({ recordings: [expected], nextCursor: { before: at, beforeId: id } });
    expect(JSON.stringify(result)).not.toContain(row.transcript);
    const detail = await client.callTool({ name: "recordings_hosted_get", arguments: { id, includeText: true } });
    expect(detail.structuredContent).toEqual({ recording: { ...expected, transcript: row.transcript } });
    const refused = await client.callTool({ name: "recordings_hosted_list", arguments: { before: at } });
    expect(refused.isError).toBe(true); expect(f.calls).toHaveLength(2);
  } finally { await client.close(); await server.close(); }
});

test("serve handler reuses Library projection and isolates simultaneous caller credentials", async () => {
  const seen: string[] = [];
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch(async (url, init) => {
    const bearer = new Headers(init.headers).get("authorization")!;
    seen.push(bearer); await Promise.resolve();
    expect(url).toBe(apiBase.slice(0, -1) + "/recordings?limit=1");
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    return Response.json({ recordings: [{ ...row, title: bearer === "Bearer fictional-A" ? "Account A" : "Account B" }] });
  }) });
  const replies = await Promise.all(["A", "B"].map(name => handle(new Request("http://127.0.0.1/v1/recordings?limit=1",
    { headers: { authorization: "Bearer fictional-" + name } }))));
  const bodies = await Promise.all(replies.map(reply => reply.json()));
  expect(bodies.map(body => body.recordings[0].title)).toEqual(["Account A", "Account B"]);
  expect(seen).toEqual(["Bearer fictional-A", "Bearer fictional-B"]);
  expect(replies.every(reply => reply.headers.get("cache-control") === "no-store")).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain(row.transcript);
  expect((await handle(new Request("http://127.0.0.1/v1/recordings"))).status).toBe(401);
  expect(seen).toHaveLength(2);
});

test("serve refuses mutations, authority overrides, cookies, origins and malformed cursors before upstream", async () => {
  let calls = 0;
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch(() => { calls++; return Response.json({ recordings: [] }); }) });
  for (const [suffix, init, status] of [
    ["", { method: "POST" }, 405],
    ["?apiBase=https://foreign.example.test/v1", {}, 400],
    ["?limit=1&limit=2", {}, 400],
    ["?includeText=1", {}, 400],
    ["?before=" + at, {}, 400],
    ["", { headers: { cookie: "fictional=value" } }, 403],
    ["", { headers: { origin: "https://fictional.example.test" } }, 403],
  ] as const) {
    const headers = new Headers("headers" in init ? init.headers : {});
    headers.set("authorization", "Bearer fictional-A");
    const response = await handle(new Request("http://127.0.0.1/v1/recordings" + suffix, { ...init, headers }));
    expect(response.status).toBe(status);
  }
  expect(calls).toBe(0);
  const unavailable = buildHostedFetch({ apiBase, fetch: fakeFetch(() => { throw new Error("private upstream detail"); }) });
  const failed = await unavailable(new Request("http://127.0.0.1/v1/recordings", { headers: { authorization: "Bearer fictional-A" } }));
  expect(failed.status).toBe(502); expect(await failed.text()).not.toContain("private upstream detail");
});

test("process configuration requires explicit authority and keeps hosted MCP stdio and serve loopback only", () => {
  const common = ["--hosted", "--api-base", apiBase];
  expect(parseHostedProcessOptions([...common, "--stdio", "--credential-env", "SELECTED_SESSION"], "mcp").apiBase).toBe(apiBase.slice(0, -1));
  expect(parseHostedProcessOptions(common, "serve")).toEqual({ apiBase: apiBase.slice(0, -1), host: "127.0.0.1", port: 8874 });
  for (const args of [[...common, "--http"], [...common, "--stdio"], [...common, "--stdio", "--credential-env", "../secret"]]) {
    expect(() => parseHostedProcessOptions(args, "mcp")).toThrow();
  }
  for (const args of [[...common, "--host", "0.0.0.0"], [...common, "--credential-env", "SELECTED_SESSION"],
    [...common, "migrate"], ["--hosted", "--api-base", "http://example.test/v1"],
    [...common, "--api-base", "https://foreign.example.test/v1"]]) {
    expect(() => parseHostedProcessOptions(args, "serve")).toThrow();
  }
});

function mutationFixture(status = 200) {
  const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
  let credentials = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => { credentials++; return "fictional-session"; },
    fetch: fakeFetch((url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
      if (status === 401) return Response.json({ privateDetail: row.transcript }, { status });
      if (init.method === "DELETE") return status === 204 ? new Response(null, { status })
        : Response.json({ audioCleanup: { state: "pending" } }, { status: 202 });
      return Response.json({ recording: { ...row, title: "Renamed" } });
    }) });
  return { client, calls, credentialCount: () => credentials };
}

test("hosted Library mutations reuse validated SDK calls and omit transcript text", async () => {
  const f = mutationFixture(), library = new HostedLibrary(f.client);
  expect(await library.rename(id, " Renamed ")).toEqual({ recording: { ...expected, title: "Renamed" } });
  expect(await library.delete(id)).toEqual({ state: "pending" });
  expect(f.calls).toEqual([
    { url: apiBase.slice(0, -1) + "/recordings/" + id, method: "PATCH", body: JSON.stringify({ title: "Renamed" }) },
    { url: apiBase.slice(0, -1) + "/recordings/" + id, method: "DELETE", body: undefined },
  ]);
  for (const bad of ["", " ", "x".repeat(201)]) await expect(library.rename(id, bad)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(library.rename("../account", "Renamed")).rejects.toMatchObject({ code: "invalid_input" });
  await expect(library.delete("../account")).rejects.toMatchObject({ code: "invalid_input" });
  expect(f.calls).toHaveLength(2); expect(f.credentialCount()).toBe(2);
  expect(await new HostedLibrary(mutationFixture(204).client).delete(id)).toEqual({ state: "removed" });
});

test("hosted CLI exposes rename and delete without implicit retries or private output", async () => {
  const f = mutationFixture(), written: string[] = [];
  const connection = ["--api-base", apiBase, "--credential-env", "SELECTED_SESSION"];
  const options = { client: f.client, write: (value: string) => { written.push(value); } };
  expect(await runHostedCLI([...connection, "rename", id, " Renamed "], options)).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({ recording: { ...expected, title: "Renamed" } });
  expect(await runHostedCLI([...connection, "delete", id], options)).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({ state: "pending" });
  for (const args of [["rename", id, " "], ["rename", "../account", "Renamed"], ["delete", "../account"]]) {
    expect(await runHostedCLI([...connection, ...args], options)).toBe(1);
    expect(JSON.parse(written.pop()!).error.code).toBe("invalid_input");
  }
  expect(f.calls).toHaveLength(2);
  const denied = mutationFixture(401);
  expect(await runHostedCLI([...connection, "delete", id], { ...options, client: denied.client })).toBe(1);
  expect(JSON.parse(written.pop()!).error.code).toBe("unauthorized");
  expect(denied.calls).toHaveLength(1); expect(written.join("")).not.toContain(row.transcript);
});

test("hosted MCP mutations have truthful annotations and preserve pending deletion", async () => {
  const f = mutationFixture(), server = buildHostedServer(f.client);
  const client = new Client({ name: "fictional-mutation-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  try {
    const { tools } = await client.listTools();
    expect(tools.find(tool => tool.name === "recordings_hosted_rename")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(tools.find(tool => tool.name === "recordings_hosted_delete")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    const renamed = await client.callTool({ name: "recordings_hosted_rename", arguments: { id, title: " Renamed " } });
    expect(renamed.structuredContent).toEqual({ recording: { ...expected, title: "Renamed" } });
    const deleted = await client.callTool({ name: "recordings_hosted_delete", arguments: { id } });
    expect(deleted.structuredContent).toEqual({ state: "pending" });
    for (const [name, args] of [["recordings_hosted_rename", { id, title: " " }], ["recordings_hosted_delete", { id: "../account" }]] as const) {
      const invalid = await client.callTool({ name, arguments: args });
      expect(invalid.isError).toBe(true);
    }
    expect(f.calls).toHaveLength(2);
  } finally { await client.close(); await server.close(); }
});

test("hosted HTTP mutations project rename metadata and preserve 202 versus 204", async () => {
  const calls: string[] = [];
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch((url, init) => {
    calls.push(url); expect(new Headers(init.headers).get("authorization")).toBe("Bearer fictional-A");
    expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
    if (init.method === "PATCH") {
      expect(JSON.parse(String(init.body))).toEqual({ title: "Renamed" });
      return Response.json({ recording: { ...row, title: "Renamed" } });
    }
    expect(init.method).toBe("DELETE");
    return calls.length === 2 ? Response.json({ audioCleanup: { state: "pending" } }, { status: 202 }) : new Response(null, { status: 204 });
  }) });
  const request = (method: string, body?: string) => new Request("http://127.0.0.1/v1/recordings/" + id,
    { method, headers: { authorization: "Bearer fictional-A", "content-type": "application/json" }, body });
  const renamed = await handle(request("PATCH", JSON.stringify({ title: " Renamed " })));
  expect(renamed.status).toBe(200); expect(await renamed.json()).toEqual({ recording: { ...expected, title: "Renamed" } });
  const pending = await handle(request("DELETE"));
  expect(pending.status).toBe(202); expect(await pending.json()).toEqual({ audioCleanup: { state: "pending" } });
  const removed = await handle(request("DELETE"));
  expect(removed.status).toBe(204); expect(await removed.text()).toBe("");
  expect(calls).toEqual(Array(3).fill(apiBase.slice(0, -1) + "/recordings/" + id));
});

test("hosted HTTP rejects invalid mutations and never retries authorization failures", async () => {
  let calls = 0;
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch(() => { calls++; return Response.json({ privateDetail: row.transcript }, { status: 401 }); }) });
  const base = "http://127.0.0.1/v1/recordings/" + id;
  const headers = { authorization: "Bearer fictional-A", "content-type": "application/json" };
  for (const [url, init] of [
    [base, { method: "PATCH", body: JSON.stringify({ title: " " }) }],
    [base, { method: "PATCH", body: JSON.stringify({ title: "Renamed", apiBase }) }],
    [base, { method: "PATCH", body: "{" }],
    [base, { method: "PATCH", body: JSON.stringify({ title: "x".repeat(9000) }) }],
    [base + "?includeText=true", { method: "PATCH", body: JSON.stringify({ title: "Renamed" }) }],
    [base + "?apiBase=https://foreign.example.test/v1", { method: "DELETE" }],
    ["http://127.0.0.1/v1/recordings/not-a-uuid", { method: "DELETE" }],
  ] as const) expect((await handle(new Request(url, { headers, ...init }))).status).toBe(400);
  expect((await handle(new Request(base, { method: "DELETE" }))).status).toBe(401);
  expect((await handle(new Request(base, { method: "DELETE", headers: { ...headers, origin: "https://foreign.example.test" } }))).status).toBe(403);
  expect((await handle(new Request(base, { method: "DELETE", headers: { ...headers, cookie: "fictional=1" } }))).status).toBe(403);
  expect((await handle(new Request(base, { method: "DELETE", headers, body: "{}" }))).status).toBe(400);
  expect(calls).toBe(0);
  const denied = await handle(new Request(base, { method: "DELETE", headers }));
  expect(denied.status).toBe(401); expect(calls).toBe(1); expect(await denied.text()).not.toContain(row.transcript);
});

test("hosted HTTP bounds streamed rename bodies and cancels a stalled upload before upstream", async () => {
  let calls = 0, cancelled = 0;
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch(() => { calls++; throw Error("unexpected upstream"); }) });
  const url = "http://127.0.0.1/v1/recordings/" + id;
  const headers = { authorization: "Bearer fictional-A", "content-type": "application/json" };
  const oversized = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4096)); }, cancel() { cancelled++; } });
  expect((await handle(new Request(url, { method: "PATCH", headers, body: oversized }))).status).toBe(400);
  const controller = new AbortController();
  const pending = handle(new Request(url, { method: "PATCH", headers, signal: controller.signal,
    body: new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }) }));
  controller.abort();
  const result = await pending;
  expect((await result.json()).error.code).toBe("aborted");
  expect(cancelled).toBe(2); expect(calls).toBe(0);
});

test("hosted mutation transport failures neither retry nor fall back to another surface", async () => {
  let calls = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional-session",
    fetch: fakeFetch(() => { calls++; throw Error("private transport diagnostic"); }) });
  const library = new HostedLibrary(client);
  await expect(library.rename(id, "Renamed")).rejects.toMatchObject({ code: "network_error" });
  expect(calls).toBe(1);
  await expect(library.delete(id)).rejects.toMatchObject({ code: "network_error" });
  expect(calls).toBe(2);
  const redirected = new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional-session",
    fetch: fakeFetch(() => { calls++; return new Response(null, { status: 307, headers: { location: "https://foreign.example.test/v1" } }); }) });
  await expect(new HostedLibrary(redirected).delete(id)).rejects.toMatchObject({ code: "redirect_refused" });
  expect(calls).toBe(3);
});

test("hosted MCP unauthorized mutation returns one fixed failure without a retry", async () => {
  const f = mutationFixture(401), server = buildHostedServer(f.client);
  const client = new Client({ name: "fictional-denied-mutation", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  try {
    const result = await client.callTool({ name: "recordings_hosted_delete", arguments: { id } });
    expect(result.isError).toBe(true); expect(result.structuredContent).toMatchObject({ error: { code: "unauthorized" } });
    expect(JSON.stringify(result)).not.toContain(row.transcript); expect(f.calls).toHaveLength(1);
  } finally { await client.close(); await server.close(); }
});

test("hosted HTTP simultaneous mutations use only each caller's bearer", async () => {
  const seen: string[] = [];
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch(async (url, init) => {
    const bearer = new Headers(init.headers).get("authorization")!; seen.push(bearer);
    expect(url).toBe(apiBase.slice(0, -1) + "/recordings/" + id); expect(init.method).toBe("DELETE");
    await Promise.resolve();
    return bearer === "Bearer fictional-A" ? new Response(null, { status: 204 })
      : Response.json({ audioCleanup: { state: "pending" } }, { status: 202 });
  }) });
  const replies = await Promise.all(["A", "B"].map(name => handle(new Request("http://127.0.0.1/v1/recordings/" + id,
    { method: "DELETE", headers: { authorization: "Bearer fictional-" + name } }))));
  expect(replies.map(reply => reply.status)).toEqual([204, 202]);
  expect(seen).toEqual(["Bearer fictional-A", "Bearer fictional-B"]);
});

test("cancelling a real MCP mutation before credentials resolve prevents upstream dispatch", async () => {
  for (const name of ["recordings_hosted_rename", "recordings_hosted_delete"]) {
    let entered!: () => void, release!: () => void, completed!: () => void, cancellationSeen!: () => void;
    const credentialEntered = new Promise<void>(resolve => { entered = resolve; });
    const credentialHeld = new Promise<void>(resolve => { release = resolve; });
    const operationCompleted = new Promise<void>(resolve => { completed = resolve; });
    const cancellationHandled = new Promise<void>(resolve => { cancellationSeen = resolve; });
    let calls = 0, credentialSignal: AbortSignal | undefined;
    const hosted = new HostedRecordingsClient({ apiBase,
      credentialProvider: async ({ signal }) => { credentialSignal = signal; entered(); await credentialHeld; return "fictional-session"; },
      fetch: fakeFetch((_url, init) => { calls++; return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ recording: row }); }) });
    const rename = hosted.renameRecording.bind(hosted), remove = hosted.deleteRecording.bind(hosted);
    hosted.renameRecording = (...args) => rename(...args).finally(completed);
    hosted.deleteRecording = (...args) => remove(...args).finally(completed);
    const server = buildHostedServer(hosted), client = new Client({ name: "fictional-cancelled-mutation", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
    const onMessage = b.onmessage!;
    b.onmessage = (message, extra) => {
      onMessage(message, extra);
      // The SDK queues its cancellation handler first; release credentials only afterward.
      if ("method" in message && message.method === "notifications/cancelled") queueMicrotask(cancellationSeen);
    };
    const controller = new AbortController();
    try {
      const result = client.callTool({ name, arguments: name.endsWith("rename") ? { id, title: "Renamed" } : { id } },
        undefined, { signal: controller.signal }).then(() => "completed", () => "cancelled");
      await credentialEntered; controller.abort(); await cancellationHandled;
      const credentialCancelled = credentialSignal?.aborted;
      release(); await operationCompleted;
      expect(await result).toBe("cancelled");
      expect({ credentialCancelled, calls }).toEqual({ credentialCancelled: true, calls: 0 });
    } finally { release(); await client.close(); await server.close(); }
  }
});
