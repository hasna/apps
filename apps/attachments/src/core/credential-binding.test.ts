import { afterEach, expect, test } from "bun:test";
import { resolveAttachmentsV1 } from "./cloud-v1";
import { withServiceAuth } from "./todos";

const originalEnv = process.env;
afterEach(() => { process.env = originalEnv; });
const base = "https://attachments.example.test";

for (const operation of ["list", "download"] as const) {
  test(`${operation}: reentrant authority change cannot dispatch the new key to the old URL`, async () => {
    let armed = false;
    let calls = 0;
    const env: NodeJS.ProcessEnv = { HASNA_ATTACHMENTS_API_URL: base };
    Object.defineProperty(env, "HASNA_ATTACHMENTS_API_KEY", { get() {
      if (armed) { env.HASNA_ATTACHMENTS_API_URL = "https://other.example.test"; return "other-key"; }
      return "initial-key";
    } });
    const { store } = resolveAttachmentsV1(env, { fetchImpl: async () => { calls++; return new Response(null, { status: 503 }); } });
    armed = true;
    await expect(operation === "list" ? store.list() : store.download("id", undefined)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test(`${operation}: a key changing during resolution cannot dispatch`, async () => {
    let armed = false;
    let reads = 0;
    let calls = 0;
    const env: NodeJS.ProcessEnv = { HASNA_ATTACHMENTS_API_URL: base };
    Object.defineProperty(env, "HASNA_ATTACHMENTS_API_KEY", { get() { return armed ? `key-${++reads}` : "initial-key"; } });
    const { store } = resolveAttachmentsV1(env, { fetchImpl: async () => { calls++; return new Response(null, { status: 503 }); } });
    armed = true;
    await expect(operation === "list" ? store.list() : store.download("id", undefined)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test(`${operation}: stable ordinary between-call key rotation remains supported`, async () => {
    const env = { HASNA_ATTACHMENTS_API_URL: base, HASNA_ATTACHMENTS_API_KEY: "first-key" };
    const received: string[] = [];
    const { store } = resolveAttachmentsV1(env, { fetchImpl: async (_url, init) => {
      received.push(new Headers(init?.headers).get("x-api-key")!);
      return operation === "list" ? Response.json({ items: [] }) : new Response(null, { status: 503 });
    } });
    const invoke = () => operation === "list" ? store.list() : store.download("id", undefined).catch(() => {});
    await invoke();
    env.HASNA_ATTACHMENTS_API_KEY = "second-key";
    await invoke();
    expect(received).toEqual(["first-key", "second-key"]);
  });
}

for (const service of ["TODOS", "SESSIONS"] as const) {
  test(`${service}: reentrant configuration is refused before fetch`, () => {
    const env: NodeJS.ProcessEnv = { [`HASNA_${service}_API_URL`]: base };
    Object.defineProperty(env, `HASNA_${service}_API_KEY`, { get() { env[`HASNA_${service}_API_URL`] = "https://other.example.test"; return "other-key"; } });
    process.env = env;
    let calls = 0;
    const dispatch = (_url: string, _init: RequestInit) => { calls++; };
    expect(() => dispatch(`${base}/api/items`, withServiceAuth(service, `${base}/api/items`))).toThrow();
    expect(calls).toBe(0);
  });
  test(`${service}: stable same-authority rotation retains the API route and auth`, () => {
    process.env = { [`HASNA_${service}_API_URL`]: base, [`HASNA_${service}_API_KEY`]: "first-key" };
    expect(new Headers(withServiceAuth(service, `${base}/api/items`).headers).get("x-api-key")).toBe("first-key");
    process.env[`HASNA_${service}_API_KEY`] = "second-key";
    const init = withServiceAuth(service, `${base}/api/items`);
    expect(new Headers(init.headers).get("x-api-key")).toBe("second-key");
    expect(init.redirect).toBe("error");
  });
}
