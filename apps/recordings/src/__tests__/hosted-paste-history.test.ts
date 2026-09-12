import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HostedPasteHistory, HostedRecordingsClient } from "../sdk/index.js";
import { runHostedCLI } from "../cli/hosted.js";
import { buildHostedServer } from "../mcp/hosted.js";
import { buildHostedFetch } from "../server/hosted.js";

const base = "https://fictional.example.test/prefix/api/v1/";
const at = "2026-01-02T03:04:05Z";
const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
const rows = (["attempted", "confirmed", "failed"] as const).map((status, index) => ({
  id: ids[index]!, recordingId: index ? ids[0]! : null, text: index ? "Private fictional paste" : "",
  destinationAppId: "test.fictional.editor", destinationAppName: "Fictional editor", status,
  occurredAt: at, createdAt: at, updatedAt: at, evidenceSource: "client_reported" as const,
  privateFutureField: "Do not include this field",
}));
const projected = rows.map(({ text, createdAt, updatedAt, privateFutureField, ...row }) => row);
const fakeFetch = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => handler(new URL(String(url)), init ?? {})) as typeof fetch;
function fixture(apiBase = base) {
  const requests: URL[] = []; let credentials = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => { credentials++; return "fictional-session"; },
    fetch: fakeFetch((url, init) => {
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fictional-session");
      requests.push(url); const before = url.searchParams.get("beforeId");
      const offset = before ? rows.findIndex(row => row.id === before) + 1 : 0;
      return Response.json({ receipts: rows.slice(offset, offset + Number(url.searchParams.get("limit") ?? 25)) });
    }) });
  return { client, requests, credentials: () => credentials };
}

test("SDK paste projection retains destination and reported evidence, not private text or unknown fields", async () => {
  const f = fixture(), history = new HostedPasteHistory(f.client);
  expect(await history.list()).toEqual({ receipts: projected, nextCursor: null });
  const explicit = await history.list({ includeText: true });
  expect(explicit.receipts.map(row => row.text)).toEqual(rows.map(row => row.text));
  expect(explicit.receipts.map(row => row.status)).toEqual(["attempted", "confirmed", "failed"]);
  expect(explicit.receipts.every(row => row.evidenceSource === "client_reported")).toBe(true);
  expect(JSON.stringify(explicit)).not.toContain("privateFutureField");
  expect(JSON.stringify(explicit)).not.toContain("updatedAt");
  expect(f.requests).toHaveLength(2); expect(f.credentials()).toBe(2);
});

test("receipt cursors use occurredAt plus ID and retain same-time rows on two explicit API authorities", async () => {
  for (const apiBase of [base, "https://fictional-second.example.test/other/v1/"]) {
    const f = fixture(apiBase), history = new HostedPasteHistory(f.client);
    const first = await history.list({ limit: 2 });
    expect(first).toEqual({ receipts: projected.slice(0, 2), nextCursor: { before: at, beforeId: ids[1] } });
    const second = await history.list({ limit: 2, ...first.nextCursor! });
    expect(second).toEqual({ receipts: projected.slice(2), nextCursor: null });
    expect(f.requests.map(url => url.origin + url.pathname)).toEqual([apiBase + "paste-history", apiBase + "paste-history"]);
    expect(f.requests[1]!.searchParams.get("before")).toBe(at);
    expect(f.requests[1]!.searchParams.get("beforeId")).toBe(ids[1]!);
    expect(f.requests[1]!.searchParams.has("offset")).toBe(false);
  }
});

test("invalid paste pagination and text options refuse before credentials or transport", async () => {
  const f = fixture(), history = new HostedPasteHistory(f.client);
  for (const bad of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: null },
    { before: at }, { beforeId: ids[0] }, { before: at, beforeId: "invalid" }, { includeText: "true" },
    { offset: 1 }, { apiBase: base }]) {
    await expect(history.list(bad as never)).rejects.toMatchObject({ code: "invalid_input" });
  }
  expect(f.requests).toHaveLength(0); expect(f.credentials()).toBe(0);
});

test("real CLI parser emits the same paste page and requires explicit text inclusion", async () => {
  const f = fixture(), written: string[] = [];
  const options = { client: f.client, write: (value: string) => { written.push(value); } };
  const connection = ["--api-base", base, "--credential-env", "SELECTED_SESSION", "paste-history"];
  expect(await runHostedCLI([...connection, "--limit", "2"], options)).toBe(0);
  expect(JSON.parse(written.pop()!)).toEqual({ receipts: projected.slice(0, 2), nextCursor: { before: at, beforeId: ids[1] } });
  expect(await runHostedCLI([...connection, "--include-text"], options)).toBe(0);
  expect(JSON.parse(written.pop()!).receipts.map((row: { text: string }) => row.text)).toEqual(rows.map(row => row.text));
  expect(await runHostedCLI([...connection, "--before", at], options)).toBe(1);
  expect(JSON.parse(written.pop()!).error.code).toBe("invalid_input");
  expect(f.requests).toHaveLength(2);
});

test("actual MCP discovery is inert and paste-history dispatch retains client-reported evidence", async () => {
  const f = fixture(), server = buildHostedServer(f.client);
  const client = new Client({ name: "fictional-paste-history", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(["recordings_hosted_delete", "recordings_hosted_get", "recordings_hosted_list", "recordings_hosted_paste_history", "recordings_hosted_providers", "recordings_hosted_rename"]);
    const tool = tools.find(tool => tool.name === "recordings_hosted_paste_history")!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(f.credentials()).toBe(0); expect(f.requests).toHaveLength(0);
    const page = await client.callTool({ name: tool.name, arguments: {} });
    expect(page.structuredContent).toEqual({ receipts: projected, nextCursor: null });
    expect(JSON.stringify(page)).not.toContain("Private fictional paste");
    const explicit = await client.callTool({ name: tool.name, arguments: { includeText: true } });
    expect((explicit.structuredContent as { receipts: unknown[] }).receipts).toHaveLength(3);
    expect(JSON.stringify(explicit)).toContain("Private fictional paste");
    const invalid = await client.callTool({ name: tool.name, arguments: { before: at } });
    expect(invalid.isError).toBe(true); expect(f.requests).toHaveLength(2);
  } finally { await client.close(); await server.close(); }
});

test("actual HTTP paste reads isolate simultaneous credentials and omit text and unknown upstream fields", async () => {
  const seen: string[] = [];
  const handler = buildHostedFetch({ apiBase: base, fetch: fakeFetch(async (url, init) => {
    const bearer = new Headers(init.headers).get("authorization")!; seen.push(bearer); await Promise.resolve();
    expect(url.pathname).toBe("/prefix/api/v1/paste-history");
    return Response.json({ receipts: [{ ...rows[1], destinationAppName: bearer === "Bearer fictional-A" ? "Editor A" : "Editor B" }] });
  }) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  try {
    const replies = await Promise.all(["A", "B"].map(name => fetch(`http://127.0.0.1:${server.port}/v1/paste-history`,
      { headers: { authorization: "Bearer fictional-" + name } })));
    const bodies = await Promise.all(replies.map(reply => reply.json()));
    expect(bodies.map(body => body.receipts[0].destinationAppName)).toEqual(["Editor A", "Editor B"]);
    expect(bodies.every(body => body.receipts[0].status === "confirmed" && body.receipts[0].evidenceSource === "client_reported")).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain("Private fictional paste"); expect(JSON.stringify(bodies)).not.toContain("privateFutureField");
    expect(replies.every(reply => reply.headers.get("cache-control") === "no-store")).toBe(true);
    expect([...seen].sort()).toEqual(["Bearer fictional-A", "Bearer fictional-B"]);
  } finally { await server.stop(true); }
});

test("HTTP paste route rejects mutation, identity overrides, browser credentials and malformed cursors before upstream", async () => {
  let calls = 0;
  const handler = buildHostedFetch({ apiBase: base, fetch: fakeFetch(() => { calls++; return Response.json({ receipts: [] }); }) });
  for (const [suffix, init, status] of [
    ["", { method: "POST" }, 405], ["", { method: "DELETE" }, 405], ["/" + ids[0], {}, 404],
    ["?apiBase=" + base, {}, 400], ["?limit=1&limit=2", {}, 400], ["?includeText=1", {}, 400], ["?before=" + at, {}, 400],
    ["", { headers: { cookie: "fictional=value" } }, 403], ["", { headers: { origin: "https://fictional.example.test" } }, 403],
  ] as const) {
    const headers = new Headers("headers" in init ? init.headers : {}); headers.set("authorization", "Bearer fictional-A");
    expect((await handler(new Request("http://127.0.0.1/v1/paste-history" + suffix, { ...init, headers }))).status).toBe(status);
  }
  expect((await handler(new Request("http://127.0.0.1/v1/paste-history"))).status).toBe(401);
  expect(calls).toBe(0);
});

test("paste projection rejects unsupported delivery evidence and retains absent destination fields", async () => {
  let response: object = { ...rows[0], destinationAppId: undefined, destinationAppName: undefined }, requests = 0;
  const history = new HostedPasteHistory(new HostedRecordingsClient({ apiBase: base, credentialProvider: () => "fictional-session",
    fetch: fakeFetch(() => { requests++; return Response.json({ receipts: [response] }); }) }));
  const page = await history.list();
  expect(page.receipts[0]).toEqual({ id: ids[0], recordingId: null, occurredAt: at, status: "attempted", evidenceSource: "client_reported" });
  for (const malformed of [{ ...rows[1], status: "delivered" }, { ...rows[1], evidenceSource: "server_observed" }]) {
    response = malformed;
    await expect(history.list()).rejects.toMatchObject({ code: "invalid_response" });
  }
  expect(requests).toBe(3);
});
