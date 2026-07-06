import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient() {
  const channels: Record<string, any> = {};
  const messages: any[] = [];
  let nextId = 1;
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      if (/FROM channels/i.test(sql)) return Object.values(channels);
      if (/FROM messages/i.test(sql)) return messages.slice().reverse();
      if (/revoked_at IS NOT NULL/i.test(sql)) return [];
      return [];
    },
    async get(sql: string, p: readonly unknown[] = []): Promise<any> {
      if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
      if (/INSERT INTO channels/i.test(sql)) {
        const [name, description, topic, project_id, created_by] = p as any[];
        const row = { name, description, topic, project_id, created_by, created_at: new Date().toISOString() };
        channels[name] = row;
        return row;
      }
      if (/SELECT name FROM channels WHERE name/i.test(sql)) {
        return channels[(p as any[])[0]] ? { name: (p as any[])[0] } : null;
      }
      if (/SELECT \* FROM channels WHERE name/i.test(sql) || /SELECT name, description/i.test(sql)) {
        return channels[(p as any[])[0]] ?? null;
      }
      if (/INSERT INTO messages/i.test(sql)) {
        const [session_id, from_agent, to_agent, channel, project_id, content, priority, blocking] = p as any[];
        const row = { id: nextId++, uuid: `u${nextId}`, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, created_at: new Date().toISOString() };
        messages.push(row);
        return row;
      }
      return null;
    },
    async execute(_sql: string, _p: readonly unknown[] = []): Promise<void> {},
  };
  return client;
}

const SIGNING = "test-signing-secret-0123456789";

function makeDeps(): ApiServerDeps {
  const client = makeFakeClient();
  const keys = new ApiKeyStore(client as any);
  const verifier = verifyApiKey({ app: "conversations", signingSecret: SIGNING, isRevoked: async () => false });
  return { client: client as any, keys, verifier };
}

let server: ReturnType<typeof startApiServer>;
let base: string;
let rwKey: string;
let roKey: string;

beforeAll(() => {
  server = startApiServer({ port: 0, host: "127.0.0.1", deps: makeDeps() });
  base = `http://127.0.0.1:${server.port}`;
  rwKey = mintApiKey({ app: "conversations", agent: "test", scopes: ["conversations:read", "conversations:write"], signingSecret: SIGNING }).token;
  roKey = mintApiKey({ app: "conversations", agent: "ro", scopes: ["conversations:read"], signingSecret: SIGNING }).token;
});

afterAll(() => { server.stop(true); });

describe("conversations-serve", () => {
  test("GET /health is unauthenticated and returns status+version+mode", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe("ok");
    expect(b.mode).toBe("cloud");
    expect(typeof b.version).toBe("string");
  });

  test("GET /ready pings the store", async () => {
    const b = await (await fetch(`${base}/ready`)).json();
    expect(b.status).toBe("ok");
  });

  test("GET /version returns mode+version", async () => {
    const b = await (await fetch(`${base}/version`)).json();
    expect(b.mode).toBe("cloud");
    expect(b.version).toBeTruthy();
  });

  test("/v1 requires an API key (401 without one)", async () => {
    const r = await fetch(`${base}/v1/channels`);
    expect(r.status).toBe(401);
  });

  test("/v1 rejects an invalid key", async () => {
    const r = await fetch(`${base}/v1/channels`, { headers: { "x-api-key": "hasna_conversations_bogus" } });
    expect(r.status).toBe(401);
  });

  test("read-only key can GET but not POST (scope enforcement)", async () => {
    const get = await fetch(`${base}/v1/channels`, { headers: { "x-api-key": roKey } });
    expect(get.status).toBe(200);
    const post = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": roKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "x", created_by: "ro" }),
    });
    expect(post.status).toBe(403);
  });

  test("read-write key completes a channel + message roundtrip", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "deploys", created_by: "test", description: "d" }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).channel.name).toBe("deploys");

    const got = await fetch(`${base}/v1/channels/deploys`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);

    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "hi", channel: "deploys" }),
    });
    expect(sent.status).toBe(201);
    expect((await sent.json()).message.content).toBe("hi");

    const list = await (await fetch(`${base}/v1/messages?channel=deploys`, { headers: { "x-api-key": rwKey } })).json();
    expect(list.messages.length).toBeGreaterThan(0);
  });

  test("POST /v1/messages validates required fields", async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a" }),
    });
    expect(r.status).toBe(400);
  });

  test("GET /v1/openapi.json is served for SDK discovery", async () => {
    const b = await (await fetch(`${base}/v1/openapi.json`)).json();
    expect(b.openapi).toBeTruthy();
    expect(Object.keys(b.paths).length).toBeGreaterThan(5);
  });
});
