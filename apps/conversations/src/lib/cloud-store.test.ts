import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  conversationsCloudEnv,
  deleteMessage,
  getMessageById,
  isCloudMode,
  resolveConversationsCloud,
  sendMessage,
} from "./cloud-store.js";

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("conversationsCloudEnv", () => {
  test("implies self_hosted when API url + key present and no mode", () => {
    expect(conversationsCloudEnv({ ...CLOUD_ENV }).HASNA_CONVERSATIONS_STORAGE_MODE).toBe("self_hosted");
  });
  test("respects explicit local mode", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV, HASNA_CONVERSATIONS_STORAGE_MODE: "local" });
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBe("local");
  });
  test("no-op without url/key", () => {
    expect(conversationsCloudEnv({}).HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
  });
});

describe("resolveConversationsCloud", () => {
  test("cloud client when url + key set", () => {
    const client = resolveConversationsCloud({ ...CLOUD_ENV });
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://conversations.hasna.xyz/v1");
    expect(isCloudMode({ ...CLOUD_ENV })).toBe(true);
  });
  test("null (local) when unset", () => {
    expect(resolveConversationsCloud({})).toBeNull();
    expect(isCloudMode({})).toBe(false);
  });
  test("null (local) when mode explicitly local", () => {
    expect(resolveConversationsCloud({ ...CLOUD_ENV, HASNA_CONVERSATIONS_STORAGE_MODE: "local" })).toBeNull();
  });
});

describe("routed message CRUD hits the cloud API when self_hosted", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ method: string; url: string; body: string | null; auth: string | null }>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) ?? "GET";
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const body = init?.body ? String(init.body) : null;
      calls.push({ method, url, body, auth: headers.get("authorization") });
      const msg = { id: 42, from_agent: "alice", to_agent: "bob", content: "hi", created_at: "2026-07-07T00:00:00Z" };
      if (method === "POST" && url.endsWith("/v1/messages")) {
        return new Response(JSON.stringify({ message: msg }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (method === "GET" && url.endsWith("/v1/messages/42")) {
        return new Response(JSON.stringify({ message: msg }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "GET" && url.endsWith("/v1/messages/999")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      if (method === "DELETE" && url.includes("/v1/messages/42")) {
        return new Response(JSON.stringify({ id: 42, deleted: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "DELETE" && url.includes("/v1/messages/7")) {
        return new Response(JSON.stringify({ error: "not yours" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("send -> POST /v1/messages with bearer key, unwraps { message }", async () => {
    const msg = await sendMessage({ from: "alice", to: "bob", content: "hi" }, { ...CLOUD_ENV });
    expect(msg.id).toBe(42);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("https://conversations.hasna.xyz/v1/messages");
    expect(post?.auth).toBe(`Bearer ${CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY}`);
    expect(JSON.parse(post!.body!)).toMatchObject({ from: "alice", to: "bob", content: "hi" });
  });

  test("getMessageById -> GET /v1/messages/:id, 404 -> null", async () => {
    expect((await getMessageById(42, { ...CLOUD_ENV }))?.id).toBe(42);
    expect(await getMessageById(999, { ...CLOUD_ENV })).toBeNull();
  });

  test("deleteMessage -> DELETE with from query; true on ok, false on 404", async () => {
    expect(await deleteMessage(42, "alice", { ...CLOUD_ENV })).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("from=alice"))).toBe(true);
    expect(await deleteMessage(7, "mallory", { ...CLOUD_ENV })).toBe(false);
  });
});
