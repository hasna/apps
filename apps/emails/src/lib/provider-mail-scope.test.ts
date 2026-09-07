import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { SelfHostedMailDataSource } from "./self-hosted-mail-data-source.js";
import { resolveMailDataSource } from "./mail-data-source.js";
let stub: V1Stub;
beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset(); stub.applyEnv();
  await stub.seed({ messages: Array.from({ length: 505 }, (_, i) => ({
    id: `scope-${i}`, direction: "inbound", from_addr: "sender@example.test",
    to_addrs: ["inbox@example.test"], subject: `Message ${i}`, received_at: "2026-01-01T00:00:00Z",
    provider_id: i < 503 ? "alpha" : "beta", labels: [], read: false, starred: false,
  })) });
});
afterEach(() => stub.clearEnv());
it("keeps provider lists, searches and count caches separate across API pages", async () => {
  const ds = resolveMailDataSource();
  expect(await ds.listMailbox("inbox", { source: { providerId: "beta" } })).toHaveLength(2);
  expect((await ds.mailboxCounts({ source: { providerId: "alpha" } })).inbox).toBe(503);
  expect((await ds.mailboxCounts({ source: { providerId: "beta" } })).inbox).toBe(2);
  expect(await ds.listMailbox("inbox", { search: "Message 504", source: { providerId: "alpha" } })).toHaveLength(0);
});
it("clears only the selected provider and leaves other registered mail intact", async () => {
  const ds = resolveMailDataSource();
  expect(await ds.clear({ providerId: "beta" })).toEqual({ cleared: 2 });
  expect((await ds.mailboxCounts({ source: { providerId: "alpha" } })).inbox).toBe(503);
  expect(await ds.listMailbox("inbox", { source: { providerId: "beta" } })).toHaveLength(0);
});
it("does not read or delete messages when an older API cannot honor provider selection", async () => {
  const paths: string[] = [];
  const ds = new SelfHostedMailDataSource({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture", fetchImpl: async (input) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    return Response.json(path.endsWith("openapi.json") ? { openapi: "3.0.3", info: { title: "Older API", version: "1" }, security: [], components: {}, paths: {} } : { items: [] });
  } });
  await expect(ds.clear({ providerId: "beta" })).rejects.toThrow("API needs an update");
  expect(paths.some((p) => p === "/v1/messages")).toBe(false);
});
