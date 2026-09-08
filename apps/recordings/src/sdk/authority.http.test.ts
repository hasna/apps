import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecordingsV1Client } from "./resolve.js";
import { ApiError } from "./v1.generated.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "recordings-sdk-authority-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const received: Array<{ headers: Headers; method: string; path: string; body: string }> = [];
  let redirect: string | undefined;
  let responseStatus = 200;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push({ headers: new Headers(request.headers), method: request.method, path: new URL(request.url).pathname, body: await request.text() });
    return redirect ? Response.redirect(redirect, 307) : Response.json({ agents: [], count: 0 }, { status: responseStatus });
  }});
  cleanups.push(() => server.stop(true));
  const url = `http://127.0.0.1:${server.port}`;
  const key = crypto.randomUUID();
  const env: Record<string, string | undefined> = { HOME: home, HASNA_STATION: crypto.randomUUID(),
    HASNA_RECORDINGS_API_URL: url, HASNA_RECORDINGS_API_KEY: key,
    // This OpenAI setting forces the package normalizer to copy its input.
    RECORDINGS_API_KEY: crypto.randomUUID() };
  const options = { env, credentials: { keychain: { enabled: false } } };
  return { home, received, url, key, env, options, redirect(to: string) { redirect = to; }, status(value: number) { responseStatus = value; } };
}

test("same-authority rotation stays fresh even when OpenAI normalization copies env", async () => {
  const f = fixture(); const client = createRecordingsV1Client(f.options);
  await client.listAgents();
  const rotated = crypto.randomUUID(); f.env.HASNA_RECORDINGS_API_KEY = rotated;
  await client.listAgents();
  expect(f.received.length).toBe(2);
  expect(f.received[0]!.headers.get("x-api-key") === f.key).toBe(true);
  expect(f.received[1]!.headers.get("x-api-key") === rotated).toBe(true);
});

test("URL and key rotation refuse before contacting either authority", async () => {
  const a = fixture(); const b = fixture(); const client = createRecordingsV1Client(a.options);
  await client.listAgents();
  a.env.HASNA_RECORDINGS_API_URL = b.url; a.env.HASNA_RECORDINGS_API_KEY = b.key;
  await expect(client.listAgents()).rejects.toThrow();
  expect(a.received.length).toBe(1); expect(b.received.length).toBe(0);
});

test("removed or invalid credential and authority never reuse the startup key", async () => {
  for (const kind of ["key-missing", "key-invalid", "url-missing", "url-invalid"] as const) {
    const f = fixture(); const client = createRecordingsV1Client(f.options);
    await client.listAgents();
    if (kind === "key-missing") delete f.env.HASNA_RECORDINGS_API_KEY;
    if (kind === "key-invalid") f.env.HASNA_RECORDINGS_API_KEY = "invalid\rvalue";
    if (kind === "url-missing") delete f.env.HASNA_RECORDINGS_API_URL;
    if (kind === "url-invalid") f.env.HASNA_RECORDINGS_API_URL = "not-a-url";
    await expect(client.listAgents()).rejects.toThrow();
    expect(f.received.length).toBe(1);
  }
});

test("saved URL/key replacement and unreadable credential fail closed", async () => {
  const a = fixture(); const b = fixture();
  delete a.env.HASNA_RECORDINGS_API_URL; delete a.env.HASNA_RECORDINGS_API_KEY;
  const directory = join(a.home, ".hasna", "recordings", "config");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "credentials");
  const save = (url: string, key: string) => { writeFileSync(path, `HASNA_RECORDINGS_API_URL=${url}\nHASNA_RECORDINGS_API_KEY=${key}\n`, { mode: 0o600 }); chmodSync(path, 0o600); };
  save(a.url, a.key); const client = createRecordingsV1Client(a.options); await client.listAgents();
  const rotated = crypto.randomUUID(); save(a.url, rotated); await client.listAgents();
  expect(a.received[1]!.headers.get("x-api-key") === rotated).toBe(true);
  save(b.url, b.key); await expect(client.listAgents()).rejects.toThrow();
  expect(a.received.length).toBe(2); expect(b.received.length).toBe(0);
  save(a.url, a.key); chmodSync(path, 0o644);
  await expect(client.listAgents()).rejects.toThrow(); expect(a.received.length).toBe(2);
});

test("caller auth headers refuse before I/O while ordinary headers survive", async () => {
  const f = fixture(); const explicit = crypto.randomUUID();
  for (const headers of [{ "X-API-Key": crypto.randomUUID() }, { Authorization: "Bearer " + crypto.randomUUID() }]) {
    const client = createRecordingsV1Client({ ...f.options, baseUrl: f.url, apiKey: explicit, headers });
    await expect(client.listAgents()).rejects.toThrow();
    const perRequest = createRecordingsV1Client({ ...f.options, baseUrl: f.url, apiKey: explicit });
    await expect(perRequest.listAgents({ headers })).rejects.toThrow();
  }
  expect(f.received.length).toBe(0);
  const client = createRecordingsV1Client({ ...f.options, baseUrl: f.url, apiKey: explicit, headers: { "X-Trace": "fixture" } });
  await client.listAgents();
  expect(f.received.length).toBe(1);
  expect(f.received[0]!.headers.get("x-api-key") === explicit).toBe(true);
  expect(f.received[0]!.headers.get("authorization") === "Bearer " + explicit).toBe(true);
  expect(f.received[0]!.headers.get("x-trace")).toBe("fixture");
});

test("redirects never carry credentials or requests into another authority", async () => {
  const a = fixture(); const b = fixture(); a.redirect(b.url + "/v1/agents");
  const client = createRecordingsV1Client(a.options);
  await expect(client.listAgents()).rejects.toThrow();
  expect(a.received.length).toBe(1); expect(b.received.length).toBe(0);
});

test("explicit authority without key and local opt-in remain refused", () => {
  const f = fixture();
  expect(() => createRecordingsV1Client({ ...f.options, baseUrl: f.url })).toThrow();
  expect(() => createRecordingsV1Client({ env: { HOME: f.home, HASNA_RECORDINGS_LOCAL: "1" }, notice: () => {} })).toThrow();
  expect(f.received.length).toBe(0);
});

test("generated POST payload and ApiError response contract survive shared transport", async () => {
  const f = fixture(); const client = createRecordingsV1Client(f.options);
  await client.registerAgent({ name: "fixture-agent" });
  expect(f.received[0]!.method).toBe("POST");
  expect(f.received[0]!.path).toBe("/v1/agents");
  expect(JSON.parse(f.received[0]!.body)).toEqual({ name: "fixture-agent" });
  expect(f.received[0]!.headers.get("content-type")).toBe("application/json");
  f.status(409);
  let error: unknown;
  try { await client.registerAgent({ name: "fixture-agent" }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).body).toEqual({ agents: [], count: 0 });
  expect(f.received.length).toBe(2);
});

test("blank explicit authority never becomes an authenticated default-gateway request", () => {
  const f = fixture(); let dispatches = 0;
  const noNetwork = (async () => { dispatches++; throw new Error("Unexpected fixture dispatch"); }) as typeof fetch;
  for (const baseUrl of ["", "   "]) {
    expect(() => createRecordingsV1Client({ ...f.options, baseUrl, apiKey: crypto.randomUUID(), fetch: noNetwork })).toThrow();
  }
  expect(dispatches).toBe(0); expect(f.received.length).toBe(0);
});
