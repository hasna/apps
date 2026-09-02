import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { AccessClient, CORE_ROUTES, httpsBaseUrl } from "../src/client/index.js";

const configuration = () => ({ HASNA_ACCESS_API_URL: "https://access.example.test/prefix", HASNA_ACCESS_API_KEY: ["unit", "test", "credential"].join("-") });

describe("canonical core client", () => {
  test("production core CLI, SDK, and serve dependency graphs exclude SQLite", async () => {
    for (const entrypoint of ["src/client/index.ts", "src/cli/index.tsx", "src/server/index.ts"]) {
      const build = await Bun.build({ entrypoints: [entrypoint], target: "bun", external: ["hono", "pg"] });
      expect(build.success).toBe(true);
      const source = await build.outputs[0]!.text();
      expect(source).not.toContain("bun:sqlite");
      expect(source).not.toContain("function openDatabase(");
    }
  });
  test("all 43 existing operations retain their exact method and route", () => {
    const dir = new URL("../src/server/routes/", import.meta.url);
    const found = readdirSync(dir).flatMap(name => [...readFileSync(new URL(name, dir), "utf8").matchAll(/app\.(get|post|patch|delete)\("([^"]+)"[^\n]+?op: "([^"]+)"/g)].map(m => [m[3]!, [m[1]!.toUpperCase(), m[2]!.replace("/v1", "")]]));
    expect(found).toHaveLength(43);
    expect(CORE_ROUTES).toEqual(Object.fromEntries(found));
  });

  test("positive transport, captured authority/key, prefix, method/body and redirect refusal", async () => {
    const env = configuration();
    const requests: Array<[string, RequestInit]> = [];
    const client = new AccessClient(env, (async (url, init) => {
      requests.push([String(url), init!]);
      return Response.json({ id: "test-id" });
    }) as typeof fetch);
    env.HASNA_ACCESS_API_URL = "https://other.example.test";
    env.HASNA_ACCESS_API_KEY = "changed";
    expect(await client.runOperation("identity.create", { name: "test" })).toEqual({ id: "test-id" });
    expect(requests[0]![0]).toBe("https://access.example.test/prefix/v1/identities");
    expect(requests[0]![1].redirect).toBe("error");
    expect(requests[0]![1].method).toBe("POST");
    expect(requests[0]![1].body).toBe('{"name":"test"}');
    expect(new Headers(requests[0]![1].headers).get("Authorization")).toBe(`Bearer ${configuration().HASNA_ACCESS_API_KEY}`);
    expect(JSON.stringify(client)).not.toContain(configuration().HASNA_ACCESS_API_KEY);
  });

  for (const field of ["HASNA_ACCESS_API_URL", "HASNA_ACCESS_API_KEY"]) {
    for (const value of [undefined, "", " ", "\t", "\n"]) test(`fails closed for ${field} = ${JSON.stringify(value)}`, () => {
      expect(() => new AccessClient({ ...configuration(), [field]: value })).toThrow();
    });
  }
  for (const [key, value] of Object.entries({ ACCESS_API_URL: "https://other.example.test", ACCESS_API_KEY: "other", HASNA_ACCESS_STORAGE_MODE: "local", ACCESS_BACKEND: "cloud", HASNA_ACCESS_DATABASE_URL: "", ACCESS_DATABASE_URL_FILE: "/not-read", HASNA_ACCESS_DB_PATH: ":memory:" })) {
    test(`rejects conflicting or retired input ${key}`, () => expect(() => new AccessClient({ ...configuration(), [key]: value })).toThrow());
  }
  for (const url of ["http://localhost", "https://user:pass@example.test", "https://example.test?x=1", "https://example.test#x", "https://example.test/../admin", "https://example.test/%2e%2e", "https://example.test//v1", "https://127.1", "https://0x7f000001", "https://example.test:0443", "https://example.test.", "https://xn--example.test", "https://example.test\\@other.test", "https://example.test\n"]) {
    test(`rejects noncanonical authority/path ${JSON.stringify(url)}`, () => expect(() => httpsBaseUrl(url)).toThrow());
  }
  test("every operation reaches HTTPS with no local store", async () => {
    let calls = 0;
    const client = new AccessClient(configuration(), (async () => { calls++; return Response.json({ ok: true }); }) as typeof fetch);
    for (const op of Object.keys(CORE_ROUTES) as Array<keyof typeof CORE_ROUTES>) await client.runOperation(op, { id: "safe-id" });
    expect(calls).toBe(43);
  });
  test("network and server failures never expose response or credential values", async () => {
    const key = configuration().HASNA_ACCESS_API_KEY;
    for (const fetcher of [async () => { throw new Error(key); }, async () => new Response(key, { status: 401 })]) {
      const client = new AccessClient(configuration(), fetcher as typeof fetch);
      try { await client.runOperation("identity.list"); throw new Error("expected rejection"); } catch (error) {
        expect(String(error)).not.toContain(key);
        expect(String(error)).toContain("HTTPS request failed");
      }
    }
  });
});
