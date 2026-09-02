import { expect, test } from "bun:test";
import { createHttpTransport, resolveStorageClient } from "./http-storage.js";
import { getStore, resetStoreCache } from "./index.js";
import { createStorageClient } from "./http-storage.js";
import { ApiStore } from "./api.js";

const valid = { HASNA_CALENDAR_API_URL: "https://calendar.example.test", HASNA_CALENDAR_API_KEY: "fixture-key" };
test("domain clients fail closed for absent, blank, conflicting and retired configuration", () => {
  for (const env of [{}, { ...valid, HASNA_CALENDAR_API_KEY: " " }, { ...valid, CALENDAR_API_KEY: "other" },
    { ...valid, CALENDAR_API_URL: "https://other.example.test" }, { ...valid, HASNA_CALENDAR_MODE: "local" },
    { ...valid, HASNA_CALENDAR_API_URL: "http://localhost" }, { ...valid, HASNA_CALENDAR_API_URL: "https://user:pass@example.test" }]) {
    expect(() => resolveStorageClient("calendar", env)).toThrow();
  }
});

test("read retries retain authority and write failures never retry", async () => {
  let calls = 0;
  const options = { name: "calendar", baseUrl: valid.HASNA_CALENDAR_API_URL, apiKey: "fixture-key", retries: 2,
    fetchImpl: async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toBe("https://calendar.example.test/v1/orgs");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-key");
      options.baseUrl = "https://other.example.test"; options.apiKey = "changed";
      return Response.json(calls === 1 ? {} : { orgs: [] }, { status: calls === 1 ? 503 : 200 });
    } };
  const transport = createHttpTransport(options);
  expect(await transport.get("/orgs")).toEqual({ orgs: [] });
  expect(calls).toBe(2);
  let writes = 0;
  const writer = createHttpTransport({ name: "calendar", baseUrl: valid.HASNA_CALENDAR_API_URL, apiKey: "fixture-key", fetchImpl: async () => { writes++; return new Response(null, { status: 503 }); } });
  await expect(writer.post("/orgs", { name: "fixture" }, { idempotencyKey: "fixture-operation" })).rejects.toThrow();
  expect(writes).toBe(1);
});

test("malformed envelopes never masquerade as empty or successful operations", async () => {
  const store = new ApiStore(createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: valid.HASNA_CALENDAR_API_URL, apiKey: "fixture-key", fetchImpl: async () => Response.json({}) })));
  await expect(store.listOrgs()).rejects.toThrow("invalid response envelope");
  await expect(store.createOrg({ name: "fixture" })).rejects.toThrow("invalid response envelope");
  await expect(store.deleteOrg("missing")).rejects.toThrow("invalid response envelope");
});
test("cached store cannot bypass validation", () => {
  resetStoreCache();
  expect(getStore(valid).transport).toBe("api");
  expect(() => getStore({})).toThrow();
  resetStoreCache();
});
test("transport snapshots authority and blocks redirect/header/path overrides", async () => {
  const calls: RequestInit[] = [];
  const options = { name: "calendar", baseUrl: valid.HASNA_CALENDAR_API_URL, apiKey: "fixture-key", retries: 0,
    fetchImpl: async (_url: string, init?: RequestInit) => { calls.push(init!); return Response.json({ orgs: [] }); } };
  const client = createHttpTransport(options);
  options.apiKey = "changed";
  await client.get("/orgs");
  expect(new Headers(calls[0]!.headers).get("x-api-key")).toBe("fixture-key");
  expect(calls[0]!.redirect).toBe("error");
  await expect(client.get("/orgs", { headers: { Authorization: "other" } })).rejects.toThrow();
  await expect(client.get("/../outside")).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
