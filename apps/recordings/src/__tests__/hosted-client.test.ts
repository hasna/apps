import { expect, test } from "bun:test";
import { HostedRecordingsClient, RecordingsSDKError, recordingCursor, pasteCursor, type PageOptions } from "../hosted/index.js";
import { REQUIRED_CAPABILITIES } from "../contracts/stream-v1.js";

const apiBase = "https://fictional.example.test/prefix/api/v1/";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const at = "2026-01-02T03:04:05Z";
const recording = { id, title: "Fictional", transcript: "Fictional text", durationMs: 1, createdAt: at, updatedAt: at };
const receipt = { id, recordingId: id, text: "", status: "attempted" as const, evidenceSource: "client_reported" as const,
  occurredAt: at, createdAt: "2026-01-03T03:04:05Z", updatedAt: at };
const account = { id, displayName: "Fictional", email: "fiction@example.test", createdAt: at };
const metadata = { wireVersion: "1.1", capabilities: [...REQUIRED_CAPABILITIES, "future-capability"] };
const fakeFetch = (body: (url: string, init: RequestInit) => Response): typeof fetch =>
  (async (url, init) => body(String(url), init ?? {})) as typeof fetch;

test("all hosted operations retain prefix, status and body semantics in one request each", async () => {
  let calls = 0, credentials = 0;
  const input = { id, title: "Fictional", transcript: "Fictional text", durationMs: 1 };
  const paste = { id, recordingId: id, text: "", status: "attempted" as const };
  const rows: Array<{ method: string; path: string; status: number; body?: unknown; response?: unknown; public?: boolean;
    run: (client: HostedRecordingsClient) => Promise<unknown>; result?: unknown }> = [
    { method: "GET", path: "/health", status: 200, response: { status: "ok" }, public: true, run: c => c.health() },
    { method: "GET", path: "/version", status: 200, response: { name: "recordings", version: "1", apiVersion: "v1", ...metadata }, public: true, run: c => c.version() },
    { method: "GET", path: "/ready", status: 200, response: { status: "ready" }, run: c => c.ready() },
    { method: "GET", path: "/account", status: 200, response: { account, ...metadata }, run: c => c.account() },
    { method: "POST", path: "/account/bootstrap", status: 200, body: {}, response: { account, ...metadata }, run: c => c.bootstrap() },
    { method: "POST", path: "/auth/logout", status: 204, run: c => c.logout() },
    { method: "GET", path: "/recordings?limit=2&before=2026-01-02T03%3A04%3A05Z&beforeId=" + id, status: 200,
      response: { recordings: [recording] }, run: c => c.listRecordings({ limit: 2, ...recordingCursor(recording) }) },
    { method: "GET", path: "/recordings/" + id, status: 200, response: { recording }, run: c => c.getRecording(id) },
    { method: "POST", path: "/recordings", status: 201, body: input, response: { recording }, run: c => c.saveRecording(input) },
    { method: "PATCH", path: "/recordings/" + id, status: 200, body: { title: "Renamed" }, response: { recording: { ...recording, title: "Renamed" } }, run: c => c.renameRecording(id, " Renamed ") },
    { method: "DELETE", path: "/recordings/" + id, status: 202, response: { audioCleanup: { state: "pending" } }, result: { state: "pending" }, run: c => c.deleteRecording(id) },
    { method: "DELETE", path: "/recordings/" + id, status: 204, result: { state: "removed" }, run: c => c.deleteRecording(id) },
    { method: "GET", path: "/paste-history?before=2026-01-02T03%3A04%3A05Z&beforeId=" + id, status: 200,
      response: { receipts: [receipt] }, run: c => c.listPasteReceipts(pasteCursor(receipt)) },
    { method: "POST", path: "/paste-history", status: 201, body: paste, response: { receipt }, run: c => c.savePasteReceipt(paste) },
    { method: "DELETE", path: "/paste-history/" + id, status: 204, run: c => c.deletePasteReceipt(id) },
    { method: "DELETE", path: "/paste-history", status: 204, run: c => c.clearPasteHistory() },
  ];
  let current = rows[0]!;
  const client = new HostedRecordingsClient({ apiBase,
    credentialProvider: context => {
      expect(context.apiBase).toBe(apiBase.slice(0, -1)); expect(Object.isFrozen(context)).toBe(true);
      expect(context.signal.aborted).toBe(false); credentials++; return "fictional-access-" + credentials;
    },
    fetch: fakeFetch((url, init) => {
      calls++; expect(url).toBe(apiBase.slice(0, -1) + current.path); expect(init.method).toBe(current.method);
      expect(init.body).toBe(current.body === undefined ? undefined : JSON.stringify(current.body));
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(current.public ? null : "Bearer fictional-access-" + credentials);
      expect(headers.has("x-api-key")).toBe(false); expect(init.cache).toBe("no-store");
      return current.status === 204 ? new Response(null, { status: 204 }) : Response.json(current.response, { status: current.status });
    }),
  });
  for (const row of rows) {
    current = row; const before = calls;
    expect(await row.run(client)).toEqual(row.result ?? row.response); expect(calls).toBe(before + 1);
  }
  expect(calls).toBe(16); expect(credentials).toBe(14);
});

test("invalid hosted values stop before credentials or fetch", async () => {
  let credentials = 0, calls = 0;
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => { credentials++; return "fictional"; },
    fetch: fakeFetch(() => { calls++; return Response.json({}); }),
  });
  const lists = [(page: PageOptions) => client.listRecordings(page), (page: PageOptions) => client.listPasteReceipts(page)];
  for (const list of lists) for (const page of [{ before: at }, { beforeId: id }, { limit: 101 }])
    await expect(list(page)).rejects.toMatchObject({ code: "invalid_input" });
  for (const call of [() => client.getRecording("../account"), () => client.renameRecording(id, " "),
    () => client.saveRecording({ ...recording, accountId: id } as never),
    () => client.savePasteReceipt({ id, text: "", status: "confirmed", occurredAt: "2026-01-02T03:04:05+00:00" })])
    await expect(call()).rejects.toMatchObject({ code: "invalid_input" });
  expect(credentials).toBe(0); expect(calls).toBe(0);
});

test("advertised metadata must be complete; legacy absence and compatible additions remain accepted", async () => {
  let response: unknown = { account };
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional", fetch: fakeFetch(() => Response.json(response)) });
  expect(await client.account()).toEqual({ account });
  const compatible = { account, ...metadata, future: { field: true } };
  response = compatible;
  expect(await client.account()).toEqual(compatible);
  for (const advertisement of [{ wireVersion: "1.0" }, { capabilities: [...REQUIRED_CAPABILITIES] },
    { wireVersion: "1.1", capabilities: [] }, { wireVersion: "2.0", capabilities: [...REQUIRED_CAPABILITIES] },
    { wireVersion: "1.0", capabilities: [...REQUIRED_CAPABILITIES, REQUIRED_CAPABILITIES[0]] }]) {
    response = { account, ...advertisement };
    await expect(client.account()).rejects.toMatchObject({ code: "invalid_response" });
    response = { name: "recordings", version: "1", apiVersion: "v1", ...advertisement };
    await expect(client.version()).rejects.toMatchObject({ code: "invalid_response" });
  }
});

test("failure statuses are mapped without retries or reading untrusted error bodies", async () => {
  const statuses = [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [410, "recording_deleted"],
    [409, "conflict"], [429, "rate_limited"], [503, "http_error"]] as const;
  for (const [status, code] of statuses) {
    let calls = 0, cancels = 0;
    const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional-access",
      fetch: fakeFetch(() => { calls++; return new Response(new ReadableStream({ cancel() { cancels++; } }),
        { status, headers: { "x-request-id": id } }); }),
    });
    let error: unknown; try { await client.deleteRecording(id); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RecordingsSDKError); expect(error).toMatchObject({ code, status, requestId: id });
    expect(error).not.toHaveProperty("body"); expect(error).not.toHaveProperty("cause");
    expect(calls).toBe(1); expect(cancels).toBe(1);
  }
});

test("invalid successful deletion and non-JSON or invalid UTF-8 responses refuse success", async () => {
  let response = Response.json({ audioCleanup: { state: "removed" } }, { status: 202 });
  const client = new HostedRecordingsClient({ apiBase, credentialProvider: () => "fictional", fetch: fakeFetch(() => response) });
  await expect(client.deleteRecording(id)).rejects.toMatchObject({ code: "invalid_response" });
  for (const value of [new Response("{}"), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })]) {
    response = value; await expect(client.health()).rejects.toMatchObject({ code: "invalid_response" });
  }
});
