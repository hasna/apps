import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HostedLibrary, HostedRecordingsClient, type HostedTranscriptExport } from "../sdk/index.js";
import { runHostedCLI } from "../cli/hosted.js";
import { buildHostedServer } from "../mcp/hosted.js";
import { buildHostedFetch } from "../server/hosted.js";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture.js";

const apiBase = "https://fictional.example.test/prefix/api/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", at = "2026-01-02T03:04:05Z";
const text = "Fictional café 📝\r\nSecond line.\n\n";
const row = { id, title: "../Unsafe title\r\nX-Fictional: yes", transcript: text, durationMs: 1250,
  createdAt: at, updatedAt: at, futurePrivateField: "Unrelated private metadata" };
const exported: HostedTranscriptExport = { recordingId: id, fileName: id + ".txt", mediaType: "text/plain; charset=utf-8", text };
const fakeFetch = (body: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => body(String(url), init ?? {})) as typeof fetch;
function fixture(reply: () => Response = () => Response.json({ recording: row })) {
  let requests = 0, credentials = 0;
  const client = new HostedRecordingsClient({ apiBase,
    credentialProvider: () => { credentials++; return "fictional-export-session"; },
    fetch: fakeFetch((url, init) => {
      expect(url).toBe(apiBase + "recordings/" + id);
      expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
      expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fictional-export-session");
      requests++; return reply();
    }) });
  return { client, counts: () => ({ requests, credentials }) };
}
function home() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-")));
  chmodSync(path, 0o700); return path;
}
const connection = ["--api-base", apiBase, "--credential-env", "SELECTED_SESSION"];

test("SDK export preserves exact Unicode text and omits title and unknown upstream fields", async () => {
  const f = fixture(), library = new HostedLibrary(f.client);
  expect(await library.export(id)).toEqual(exported);
  expect(f.counts()).toEqual({ requests: 1, credentials: 1 });
  const ordinary = await library.get(id);
  expect(Object.hasOwn(ordinary.recording, "transcript")).toBe(false);
  expect(JSON.stringify(ordinary)).not.toContain(text);
});

test("SDK export rejects invalid IDs before credentials or transport", async () => {
  const f = fixture(), library = new HostedLibrary(f.client);
  for (const bad of ["../account", "", "../../output.txt", id + "?includeText=true"]) {
    await expect(library.export(bad)).rejects.toMatchObject({ code: "invalid_input" });
  }
  expect(f.counts()).toEqual({ requests: 0, credentials: 0 });
});

test("SDK export cancellation covers credential acquisition and response streaming", async () => {
  const credentialAbort = new AbortController();
  let network = 0;
  const credentials = new HostedLibrary(new HostedRecordingsClient({ apiBase,
    credentialProvider: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Fictional private credential failure")), { once: true });
      credentialAbort.abort();
    }), fetch: fakeFetch(() => { network++; return Response.json({ recording: row }); }) }));
  await expect(credentials.export(id, { signal: credentialAbort.signal })).rejects.toMatchObject({ code: "aborted" });
  expect(network).toBe(0);
  const bodyAbort = new AbortController(); let cancelled = false;
  const body = new HostedLibrary(new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional",
    fetch: fakeFetch(() => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode('{"recording":')); queueMicrotask(() => bodyAbort.abort()); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } })) }));
  await expect(body.export(id, { signal: bodyAbort.signal })).rejects.toMatchObject({ code: "aborted" });
  expect(cancelled).toBe(true);
});

test("CLI export writes exact bytes privately and emits only an export receipt", async () => {
  const directory = home(), output = join(directory, "transcript.txt"), f = fixture(), written: string[] = [];
  try {
    expect(await runHostedCLI([...connection, "export", id, "--output", output],
      { client: f.client, write: value => { written.push(value); } })).toBe(0);
    const bytes = Buffer.from(text, "utf8");
    expect(readFileSync(output)).toEqual(bytes);
    expect(lstatSync(output).mode & 0o777).toBe(0o600);
    expect(JSON.parse(written.join(""))).toEqual({ recordingId: id, format: "txt", byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), saved: true });
    expect(written.join("")).not.toContain("Fictional café");
    expect(written.join("")).not.toContain(directory);
    expect(readdirSync(directory)).toEqual(["transcript.txt"]);
    expect(f.counts()).toEqual({ requests: 1, credentials: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI export refuses existing files, dangling symlinks, directories and absent parents before fetching", async () => {
  const directory = home(), output = join(directory, "existing.txt"), link = join(directory, "link.txt"), f = fixture();
  try {
    writeFileSync(output, "Keep this file."); symlinkSync(join(directory, "absent.txt"), link);
    for (const destination of [output, link, directory, join(directory, "absent", "export.txt"), " "]) {
      expect(await runHostedCLI([...connection, "export", id, "--output", destination],
        { client: f.client, write: () => {} })).toBe(1);
    }
    expect(readFileSync(output, "utf8")).toBe("Keep this file.");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(directory, "absent.txt"))).toBe(false);
    expect(f.counts()).toEqual({ requests: 0, credentials: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI export cannot overwrite a destination created while the request was pending", async () => {
  const directory = home(), output = join(directory, "raced.txt"), written: string[] = [];
  const f = fixture(() => { writeFileSync(output, "Concurrent file.", { flag: "wx" }); return Response.json({ recording: row }); });
  try {
    expect(await runHostedCLI([...connection, "export", id, "--output", output],
      { client: f.client, write: value => { written.push(value); } })).toBe(1);
    expect(readFileSync(output, "utf8")).toBe("Concurrent file.");
    expect(readdirSync(directory)).toEqual(["raced.txt"]);
    expect(JSON.parse(written.join("")).error.code).toBe("invalid_input");
    expect(f.counts()).toEqual({ requests: 1, credentials: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI export leaves no output or staging file after an upstream failure", async () => {
  const directory = home(), output = join(directory, "transcript.txt"), written: string[] = [];
  const f = fixture(() => new Response("Fictional private failure", { status: 503 }));
  try {
    expect(await runHostedCLI([...connection, "export", id, "--output", output],
      { client: f.client, write: value => { written.push(value); } })).toBe(1);
    expect(readdirSync(directory)).toEqual([]);
    expect(written.join("")).not.toContain("Fictional private failure");
    expect(f.counts()).toEqual({ requests: 1, credentials: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("real CLI entry exports into its isolated destination without provider or native access", async () => {
  const directory = home(), output = join(directory, "transcript.txt");
  try {
    const result = await runStartupFixture(directory, [process.execPath, "--preload",
      join(import.meta.dir, "helpers/hosted-entry-preload.ts"), join(import.meta.dir, "../cli/index.ts"),
      "hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION",
      "export", id, "--output", output], startupFixtureEnv(directory, { SELECTED_SESSION: "fictional-entry-session" }));
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(readFileSync(output, "utf8")).toBe("Hidden fictional transcript.");
    expect(lstatSync(output).mode & 0o777).toBe(0o600);
    expect(JSON.parse(result.stdout)).toMatchObject({ recordingId: id, saved: true, format: "txt" });
    expect(result.stdout).not.toContain("Hidden fictional transcript.");
    expect(JSON.parse(readFileSync(join(directory, "boundary.json"), "utf8"))).toEqual({ denied: 0, requests: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("MCP explicitly exports text in read-only mode and rejects foreign arguments before fetch", async () => {
  const f = fixture(), server = buildHostedServer(f.client), client = new Client({ name: "fictional-export-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools.find(tool => tool.name === "recordings_hosted_export")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(f.counts().requests).toBe(0);
    const result = await client.callTool({ name: "recordings_hosted_export", arguments: { id } });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual(exported);
    expect(JSON.stringify(result)).not.toContain(row.futurePrivateField);
    for (const args of [{ id: "../account" }, { id, output: "/fictional/private.txt" }, { id, apiBase: "https://foreign.example.test/v1" }]) {
      const failure = await client.callTool({ name: "recordings_hosted_export", arguments: args });
      expect(failure.isError).toBe(true);
    }
    expect(f.counts()).toEqual({ requests: 1, credentials: 1 });
  } finally { await client.close(); await server.close(); }
});

test("HTTP export returns a no-store plain-text attachment from one authenticated recording GET", async () => {
  let requests = 0;
  const handle = buildHostedFetch({ apiBase, fetch: fakeFetch((url, init) => {
    expect(url).toBe(apiBase + "recordings/" + id); expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual"); expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fictional-request-session");
    requests++; return Response.json({ recording: row });
  }) });
  const reply = await handle(new Request("http://127.0.0.1/v1/recordings/" + id + "/export",
    { headers: { authorization: "Bearer fictional-request-session" } }));
  expect(reply.status).toBe(200);
  expect(reply.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(reply.headers.get("content-disposition")).toBe('attachment; filename="' + id + '.txt"');
  expect(reply.headers.get("content-length")).toBe(String(Buffer.byteLength(text)));
  expect(reply.headers.get("cache-control")).toBe("no-store");
  expect(reply.headers.get("x-content-type-options")).toBe("nosniff");
  expect(reply.headers.has("x-fictional")).toBe(false);
  expect(new Uint8Array(await reply.arrayBuffer())).toEqual(new Uint8Array(Buffer.from(text)));
  expect(requests).toBe(1);
});

test.each([false, true])("HTTP export refuses mutation dispatch and untrusted request options with allowWrites=%s", async allowWrites => {
  let requests = 0;
  const handle = buildHostedFetch({ apiBase, allowWrites, fetch: fakeFetch(() => { requests++; return Response.json({ recording: row }); }) });
  const url = "http://127.0.0.1/v1/recordings/" + id + "/export";
  for (const method of ["POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"]) {
    const reply = await handle(new Request(url, { method, headers: { authorization: "Bearer fictional" } }));
    expect(reply.status).toBe(405);
  }
  for (const headers of [{}, { authorization: "Bearer fictional", origin: "https://fictional.example.test" },
    { authorization: "Bearer fictional", cookie: "fictional=value" }]) {
    const reply = await handle(new Request(url, { headers }));
    expect([401, 403]).toContain(reply.status);
  }
  for (const path of [url + "?includeText=true", url + "?apiBase=https://foreign.example.test/v1",
    "http://127.0.0.1/v1/recordings/invalid/export"]) {
    const reply = await handle(new Request(path, { headers: { authorization: "Bearer fictional" } }));
    expect(reply.status).toBe(400);
  }
  expect(requests).toBe(0);
});


test("cancelling MCP export while credentials resolve prevents the recording read", async () => {
  let entered!: () => void, release!: () => void, completed!: () => void, cancellationSeen!: () => void;
  const credentialEntered = new Promise<void>(resolve => { entered = resolve; });
  const credentialHeld = new Promise<void>(resolve => { release = resolve; });
  const operationCompleted = new Promise<void>(resolve => { completed = resolve; });
  const cancellationHandled = new Promise<void>(resolve => { cancellationSeen = resolve; });
  let requests = 0, credentialSignal: AbortSignal | undefined;
  const hosted = new HostedRecordingsClient({ apiBase,
    credentialProvider: async ({ signal }) => { credentialSignal = signal; entered(); await credentialHeld; return "fictional"; },
    fetch: fakeFetch(() => { requests++; return Response.json({ recording: row }); }) });
  const get = hosted.getRecording.bind(hosted);
  hosted.getRecording = (...args) => get(...args).finally(completed);
  const server = buildHostedServer(hosted), client = new Client({ name: "fictional-cancelled-export", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const onMessage = b.onmessage!;
  b.onmessage = (message, extra) => {
    onMessage(message, extra);
    if ("method" in message && message.method === "notifications/cancelled") queueMicrotask(cancellationSeen);
  };
  const controller = new AbortController();
  try {
    const result = client.callTool({ name: "recordings_hosted_export", arguments: { id } }, undefined,
      { signal: controller.signal }).then(() => "completed", () => "cancelled");
    await credentialEntered; controller.abort(); await cancellationHandled;
    const credentialCancelled = credentialSignal?.aborted;
    release(); await operationCompleted;
    expect(await result).toBe("cancelled");
    expect({ credentialCancelled, requests }).toEqual({ credentialCancelled: true, requests: 0 });
  } finally { release(); await client.close(); await server.close(); }
});

test("SDK export keeps the existing response byte bound and refuses redirects without retry", async () => {
  for (const [reply, code] of [
    [() => Response.json({ recording: { ...row, transcript: "x".repeat(2048) } }), "response_too_large"],
    [() => new Response(null, { status: 307, headers: { location: "https://foreign.example.test/v1" } }), "redirect_refused"],
  ] as const) {
    let requests = 0;
    const library = new HostedLibrary(new HostedRecordingsClient({ apiBase, maxResponseBytes: 1024,
      credentialProvider: () => "fictional", fetch: fakeFetch(() => { requests++; return reply(); }) }));
    await expect(library.export(id)).rejects.toMatchObject({ code });
    expect(requests).toBe(1);
  }
});
