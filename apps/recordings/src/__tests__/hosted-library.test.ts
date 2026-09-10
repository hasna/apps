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

test("actual MCP discovery and dispatch expose only the two read-only hosted operations", async () => {
  const f = fixture(), server = buildHostedServer(f.client);
  const client = new Client({ name: "fictional-library-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(["recordings_hosted_get", "recordings_hosted_list"]);
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false)).toBe(true);
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
