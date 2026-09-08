import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MementosClient, MementosError } from "./index.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function serve(reply?: (request: Request) => Response) {
  const calls: Array<{ path: string; key: string | null; authorization: string | null }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    calls.push({ path: new URL(request.url).pathname, key: request.headers.get("x-api-key"), authorization: request.headers.get("authorization") });
    return reply?.(request) ?? Response.json({ memories: [], count: 0 });
  } });
  cleanup.push(() => server.stop(true));
  return { calls, url: `${server.url.origin}/gateway/mementos` };
}
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "mementos-sdk-authority-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const env: Record<string, string | undefined> = { HOME: home, HASNA_STATION: crypto.randomUUID() };
  const file = join(home, ".hasna/mementos/config/credentials");
  mkdirSync(dirname(file), { recursive: true });
  const server = serve(); const key = crypto.randomUUID();
  const save = (value = key, url = server.url) => writeFileSync(file, `HASNA_MEMENTOS_API_URL=${url}\nHASNA_MEMENTOS_API_KEY=${value}\n`, { mode: 0o600 });
  save();
  const client = new MementosClient({ env, credentials: { keychain: { enabled: false } } });
  return { ...server, env, file, save, key, client };
}
test("saved key rotates at the same authority without a restart", async () => {
  const f = fixture(); await f.client.listMemories({ limit: 1 });
  const next = crypto.randomUUID(); f.save(next); await f.client.listMemories({ limit: 1 });
  expect(f.calls.length).toBe(2); expect(f.calls[0]?.key === f.key).toBe(true); expect(f.calls[1]?.key === next).toBe(true);
  expect(f.calls[1]?.authorization === `Bearer ${next}`).toBe(true);
  expect(f.calls.every(c => c.path === "/gateway/mementos/v1/memories")).toBe(true);
});
test("saved authority rotation refuses before either destination receives another request", async () => {
  const f = fixture(); await f.client.listMemories({ limit: 1 }); const other = serve();
  f.save(crypto.randomUUID(), other.url);
  await expect(f.client.listMemories({ limit: 1 })).rejects.toThrow();
  expect(f.calls.length).toBe(1); expect(other.calls.length).toBe(0);
});
test("apiUrl binds the authority and freshly normalized environment changes cannot replace it", async () => {
  const source = serve(); const other = serve();
  const env = { HASNA_MEMENTOS_API_URL: source.url, HASNA_MEMENTOS_API_KEY: crypto.randomUUID(), MEMENTOS_API_KEY: "" };
  const client = new MementosClient({ env, credentials: { keychain: { enabled: false } } });
  expect(client.apiUrl).toBe(`${source.url}/v1`);
  env.HASNA_MEMENTOS_API_KEY = crypto.randomUUID();
  await client.listMemories({ limit: 1 });
  expect(source.calls[0]?.key === env.HASNA_MEMENTOS_API_KEY).toBe(true);
  env.HASNA_MEMENTOS_API_URL = other.url;
  await expect(client.listMemories({ limit: 1 })).rejects.toThrow();
  expect(() => client.apiUrl).toThrow(); expect(source.calls.length).toBe(1); expect(other.calls.length).toBe(0);
});
for (const failure of ["removed", "blank", "malformed-url", "permissions"] as const) {
  test(`saved ${failure} credentials refuse without stale fallback`, async () => {
    const f = fixture(); await f.client.listMemories({ limit: 1 });
    if (failure === "removed") rmSync(f.file);
    if (failure === "blank") f.save(" ");
    if (failure === "malformed-url") f.save(f.key, "invalid-authority");
    if (failure === "permissions") chmodSync(f.file, 0o644);
    await expect(f.client.listMemories({ limit: 1 })).rejects.toThrow(); expect(f.calls.length).toBe(1);
  });
}
test("an authenticated client cannot switch to local serve after a selector change", async () => {
  const f = fixture(); let dispatches = 0;
  const client = new MementosClient({ env: f.env, apiKey: f.key, credentials: { keychain: { enabled: false } }, fetch: (async () => {
    dispatches++; return Response.json({ memories: [], count: 0 });
  }) as typeof fetch });
  await client.listMemories({ limit: 1 }); f.env.HASNA_MEMENTOS_DB_PATH = join(dirname(f.file), "sentinel.db");
  await expect(client.listMemories({ limit: 1 })).rejects.toThrow(); expect(dispatches).toBe(1);
});
test("redirects cannot forward credentials to another authority", async () => {
  const other = serve(); const source = serve(() => Response.redirect(`${other.url}/v1/memories`, 307));
  const client = new MementosClient({ baseUrl: source.url, apiKey: crypto.randomUUID() });
  await expect(client.listMemories({ limit: 1 })).rejects.toThrow(); expect(source.calls.length).toBe(1); expect(other.calls.length).toBe(0);
});
test("explicit anonymous authority never borrows ambient credentials", async () => {
  const server = serve(); const client = new MementosClient({ baseUrl: server.url, env: { HASNA_MEMENTOS_API_KEY: crypto.randomUUID() } });
  await client.listMemories({ limit: 1 }); expect(server.calls.length).toBe(1); expect(server.calls[0]?.key).toBeNull(); expect(server.calls[0]?.authorization).toBeNull();
});
test("explicit credentials cannot follow ambient authority changes and blank explicit keys refuse", async () => {
  const server = serve(); const other = serve(); const key = crypto.randomUUID();
  const env = { HASNA_MEMENTOS_API_URL: other.url, HASNA_MEMENTOS_API_KEY: crypto.randomUUID() };
  const client = new MementosClient({ baseUrl: server.url, apiKey: key, env });
  await client.listMemories({ limit: 1 }); env.HASNA_MEMENTOS_API_KEY = crypto.randomUUID();
  await client.listMemories({ limit: 1 });
  expect(server.calls.every(c => c.key === key)).toBe(true); expect(other.calls.length).toBe(0);
  for (const apiKey of ["", " "]) await expect(new MementosClient({ baseUrl: server.url, apiKey }).listMemories({ limit: 1 })).rejects.toThrow();
  expect(server.calls.length).toBe(2);
});
test("nested explicit credentials authenticate the chosen base and invalid values never become anonymous", async () => {
  const server = serve(); const nested = crypto.randomUUID(); const top = crypto.randomUUID();
  const client = new MementosClient({ baseUrl: server.url, credentials: { apiKey: nested }, env: {} });
  await client.listMemories({ limit: 1 });
  expect(server.calls[0]?.key === nested).toBe(true);
  const preferred = new MementosClient({ baseUrl: server.url, apiKey: top, credentials: { apiKey: nested }, env: {} });
  await preferred.listMemories({ limit: 1 }); expect(server.calls[1]?.key === top).toBe(true);
  for (const apiKey of ["", " "]) {
    await expect(new MementosClient({ baseUrl: server.url, credentials: { apiKey }, env: {} }).listMemories({ limit: 1 })).rejects.toThrow();
  }
  expect(server.calls.length).toBe(2);
});
test("blank explicit authority and escaping prefixes refuse without dispatch", async () => {
  for (const baseUrl of ["", "   "]) expect(() => new MementosClient({ baseUrl, apiKey: crypto.randomUUID() })).toThrow();
  const server = serve();
  for (const prefix of ["/../other", "//other.test", "/v1?ignored=", "/v1#fragment"]) {
    await expect(async () => new MementosClient({ baseUrl: server.url, prefix, apiKey: crypto.randomUUID() }).listMemories({ limit: 1 })).toThrow();
  }
  expect(server.calls.length).toBe(0);
});
test("HTTP error status/details and 204 response contracts survive shared transport", async () => {
  const server = serve(r => r.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ error: "fixture conflict", details: { revision: 2 } }, { status: 409 }));
  const client = new MementosClient({ baseUrl: server.url, apiKey: crypto.randomUUID() });
  try { await client.listMemories({ limit: 1 }); throw new Error("expected conflict"); } catch (e) {
    expect(e).toBeInstanceOf(MementosError); expect((e as MementosError).status).toBe(409); expect((e as MementosError).details).toEqual({ revision: 2 });
  }
  expect(await client.deleteWebhook("fixture")).toBeUndefined(); expect(server.calls.length).toBe(2);
});
