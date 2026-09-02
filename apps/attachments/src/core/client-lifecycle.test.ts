import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAttachmentsV1 } from "./cloud-v1";
import { AttachmentsApiClient } from "../../sdk/src/generated";

describe("live credential lifecycle", () => {
  test("revalidates the pair before every operation, including binary downloads", async () => {
    const env = { HASNA_ATTACHMENTS_API_URL: "https://example.test", HASNA_ATTACHMENTS_API_KEY: "first" };
    const keys: string[] = [];
    const client = resolveAttachmentsV1(env, { fetchImpl: (async (_url, init) => {
      keys.push(new Headers(init?.headers).get("authorization")!); return Response.json([]);
    }) as typeof fetch }).store;
    await client.list(); env.HASNA_ATTACHMENTS_API_KEY = "second"; await client.list();
    env.HASNA_ATTACHMENTS_API_URL = "https://other.example.test";
    await expect(client.list()).rejects.toThrow("authority");
    await expect(client.download("id", undefined)).rejects.toThrow("authority");
    expect(keys).toEqual(["Bearer first", "Bearer second"]);
    expect(JSON.stringify(client)).not.toContain("second");
  });
  test("late blank or conflicting aliases fail without a send", async () => {
    const env: NodeJS.ProcessEnv = { HASNA_ATTACHMENTS_API_URL: "https://example.test", HASNA_ATTACHMENTS_API_KEY: "first" };
    let calls = 0;
    const client = resolveAttachmentsV1(env, { fetchImpl: (async () => { calls++; return Response.json([]); }) as typeof fetch }).store;
    env.ATTACHMENTS_API_KEY = "conflicting";
    await expect(client.list()).rejects.toThrow("conflicting");
    delete env.ATTACHMENTS_API_KEY; env.HASNA_ATTACHMENTS_API_KEY = "";
    await expect(client.uploadBuffer("a", new Uint8Array())).rejects.toThrow();
    expect(calls).toBe(0);
  });
  for (const status of [401, 403, 500]) test("error status " + status + " never exposes response body", async () => {
    let reads = 0;
    const client = resolveAttachmentsV1({ HASNA_ATTACHMENTS_API_URL: "https://example.test", HASNA_ATTACHMENTS_API_KEY: "fixture-key" }, { fetchImpl: (async () => {
      const response = new Response("fixture-key", { status }); response.text = async () => { reads++; return "fixture-key"; }; return response;
    }) as typeof fetch }).store;
    const error = await client.list().catch(e => e); expect(String(error)).not.toContain("fixture-key"); expect(reads).toBe(0);
  });
});

describe("real-network redirect boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "attachments-redirects-"));
  let origin: ReturnType<typeof Bun.serve>, destination: ReturnType<typeof Bun.serve>, plain: ReturnType<typeof Bun.serve>;
  let status = 307, target = "", sends = 0, arrivals = 0;
  // Trust only this generated test certificate in the injected test fetch. Production TLS is unchanged.
  const testFetch = ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, { ...init, tls: { rejectUnauthorized: false } } as RequestInit)) as typeof fetch;
  beforeAll(() => {
    const cert = join(dir, "cert.pem"), key = join(dir, "key.pem");
    const result = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error("Unable to create isolated redirect-test certificate");
    const tls = { key: readFileSync(key), cert: readFileSync(cert) };
    destination = Bun.serve({ hostname: "127.0.0.1", port: 0, tls, fetch: () => { arrivals++; return Response.json([]); } });
    plain = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { arrivals++; return Response.json([]); } });
    origin = Bun.serve({ hostname: "127.0.0.1", port: 0, tls, fetch: request => {
      if (new URL(request.url).pathname === "/landing") { arrivals++; return Response.json([]); }
      sends++; return new Response(null, { status, headers: { location: target } });
    } });
  });
  afterAll(() => { origin?.stop(true); destination?.stop(true); plain?.stop(true); rmSync(dir, { recursive: true, force: true }); });
  for (const code of [301, 302, 303, 307, 308]) for (const scheme of ["same", "cross", "http"]) for (const operation of ["upload", "download", "sdk"]) {
    test(code + " " + scheme + " " + operation + ": one send, no replay", async () => {
      status = code; sends = arrivals = 0;
      const baseUrl = "https://127.0.0.1:" + origin.port;
      target = scheme === "same" ? baseUrl + "/landing" : scheme === "cross" ? "https://127.0.0.1:" + destination.port + "/landing" : "http://127.0.0.1:" + plain.port + "/landing";
      const store = resolveAttachmentsV1({ HASNA_ATTACHMENTS_API_URL: baseUrl, HASNA_ATTACHMENTS_API_KEY: "fixture-key" }, { fetchImpl: testFetch }).store;
      const sdk = new AttachmentsApiClient({ baseUrl, apiKey: "fixture-key", fetch: testFetch });
      const request = operation === "upload" ? store.uploadBuffer("a.txt", new Uint8Array([1])) : operation === "download" ? store.download("id", join(dir, "download")) : sdk.createAttachment({ filename: "a.txt", content_base64: "YQ==" });
      await expect(request).rejects.toThrow(); expect(sends).toBe(1); expect(arrivals).toBe(0);
    });
  }
});
