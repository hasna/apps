import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient() {
  const channels: Record<string, any> = {};
  const channelMembers = new Set<string>();
  const messages: any[] = [];
  const projects: Record<string, any> = {
    "proj-valid": { id: "proj-valid", name: "Chief of Harness" },
  };
  let nextId = 1;
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      if (/FROM channels/i.test(sql)) {
        return Object.values(channels).map((row) => ({
          ...row,
          member_count: [...channelMembers].filter((entry) => entry.startsWith(`${row.name}:`)).length,
          message_count: messages.filter((message) => message.channel === row.name).length,
        }));
      }
      if (/FROM messages/i.test(sql)) return messages.slice().reverse();
      if (/FROM projects/i.test(sql)) return Object.values(projects);
      if (/revoked_at IS NOT NULL/i.test(sql)) return [];
      return [];
    },
    async query(sql: string, p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
      if (/INSERT INTO messages/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        // One COALESCE(...) is emitted per row (for created_at) → row count.
        const numRows = (sql.match(/COALESCE\(/g) || []).length || 1;
        const perRow = p.length / numRows;
        let inserted = 0;
        for (let i = 0; i < numRows; i++) {
          const uuid = (p as any[])[i * perRow]; // uuid is the first column
          const to_agent = (p as any[])[i * perRow + 3];
          const channel = (p as any[])[i * perRow + 4];
          const content = (p as any[])[i * perRow + 6];
          if (!messages.find((m) => m.uuid === uuid)) {
            messages.push({ id: nextId++, uuid, to_agent, channel, content });
            inserted++;
          }
        }
        return { rows: [], rowCount: inserted };
      }
      if (/INSERT INTO channel_members/i.test(sql)) {
        const [channel, agent] = p as any[];
        channelMembers.add(`${channel}:${agent}`);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async get(sql: string, p: readonly unknown[] = []): Promise<any> {
      if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
      if (/SELECT id FROM projects WHERE id/i.test(sql)) {
        return projects[(p as any[])[0]] ?? null;
      }
      // Match only the standalone message-count query, not channel/project
      // GETs that carry COUNT(*) subqueries for member_count/message_count.
      if (/count\(\*\)::bigint\s+as\s+n/i.test(sql)) return { n: messages.length };
      if (/INSERT INTO channels/i.test(sql)) {
        const [name, description, topic, project_id, created_by, metadata, tags] = p as any[];
        const row = {
          name,
          description,
          topic,
          project_id,
          created_by,
          metadata,
          tags,
          archived_at: null,
          created_at: new Date().toISOString(),
        };
        channels[name] = row;
        return row;
      }
      if (/SELECT name FROM channels WHERE name/i.test(sql)) {
        return channels[(p as any[])[0]] ? { name: (p as any[])[0] } : null;
      }
      if (/FROM channels c WHERE c\.name/i.test(sql) || /SELECT \* FROM channels WHERE name/i.test(sql) || /SELECT name, description/i.test(sql)) {
        const row = channels[(p as any[])[0]];
        return row
          ? {
              ...row,
              member_count: [...channelMembers].filter((entry) => entry.startsWith(`${row.name}:`)).length,
              message_count: messages.filter((message) => message.channel === row.name).length,
            }
          : null;
      }
      if (/INSERT INTO messages/i.test(sql)) {
        const [session_id, from_agent, to_agent, channel, project_id, content, priority, blocking] = p as any[];
        const row = { id: nextId++, uuid: `u${nextId}`, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, created_at: new Date().toISOString() };
        messages.push(row);
        return row;
      }
      if (/INSERT INTO projects/i.test(sql)) {
        const [id, name, description, path, repository, created_by] = p as any[];
        const row = { id, name, description, path, repository, created_by, status: "active", created_at: new Date().toISOString() };
        projects[id] = row;
        return row;
      }
      return null;
    },
    async execute(sql: string, p: readonly unknown[] = []): Promise<void> {
      if (/INSERT INTO channel_members/i.test(sql)) {
        const [channel, agent] = p as any[];
        channelMembers.add(`${channel}:${agent}`);
      }
    },
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

  test("POST /v1/channels links a valid project id", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "internal-chief-of-harness",
        created_by: "test",
        project_id: "proj-valid",
      }),
    });

    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.channel.project_id).toBe("proj-valid");
  });

  test("POST /v1/channels preserves metadata/tags, normalizes name, and auto-joins creator", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "#Internal Chief Harness Class!",
        created_by: "creator-agent",
        project_id: "proj-valid",
        metadata: { channel_schema: { class: "loop-lane" }, owner: "harness" },
        tags: ["team:harness", "project"],
      }),
    });

    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.channel).toMatchObject({
      name: "internal-chief-harness-class",
      project_id: "proj-valid",
      metadata: { channel_schema: { class: "loop-lane" }, owner: "harness" },
      tags: ["team:harness", "project"],
      member_count: 1,
    });

    const got = await fetch(`${base}/v1/channels/%23Internal%20Chief%20Harness%20Class!`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);
    const fetched = await got.json();
    expect(fetched.channel.metadata.channel_schema.class).toBe("loop-lane");
    expect(fetched.channel.member_count).toBe(1);
  });

  test("POST /v1/channels reports rejected project_id with field and reason", async () => {
    const created = await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        name: "internal-chief-of-harness-rejected",
        created_by: "test",
        project_id: "wks_xMeijBDhYFBzxXtPlttyw",
      }),
    });

    expect(created.status).toBe(400);
    const body = await created.json();
    expect(body).toMatchObject({
      error: "Validation failed",
      code: "invalid_project_id",
      field: "project_id",
      value: "wks_xMeijBDhYFBzxXtPlttyw",
    });
    expect(body.reason).toContain("No conversations project exists");
    expect(body.hint).toContain("/v1/projects");
  });

  test("POST /v1/messages validates required fields", async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a" }),
    });
    expect(r.status).toBe(400);
  });

  test("POST /v1/messages/bulk is idempotent (ON CONFLICT by uuid)", async () => {
    const batch = {
      messages: [
        { uuid: "bulk-1", from: "a", to: "b", content: "one", channel: "backfill", created_at: "2026-01-01T00:00:00.000Z" },
        { uuid: "bulk-2", from: "a", to: "b", content: "two", channel: "backfill", created_at: "2026-01-02T00:00:00.000Z" },
      ],
    };
    const first = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1.requested).toBe(2);
    expect(b1.inserted).toBe(2);
    expect(b1.skipped).toBe(0);

    // Re-run the same batch → nothing new inserted, no duplicates.
    const second = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    const b2 = await second.json();
    expect(b2.inserted).toBe(0);
    expect(b2.skipped).toBe(2);
    expect(b2.total).toBe(b1.total); // count unchanged on re-run
  });

  test("bulk ingest requires the write scope (read-only key -> 403)", async () => {
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": roKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "ro-1", from: "a", to: "b", content: "x" }] }),
    });
    expect(r.status).toBe(403);
  });

  test("bulk ingest rejects a non-array body and missing fields", async () => {
    const bad = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: "nope" }),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ from: "a", to: "b" }] }),
    });
    expect(missing.status).toBe(400);
  });

  test("GET /v1/messages?count=1 returns a numeric count", async () => {
    const b = await (await fetch(`${base}/v1/messages?count=1`, { headers: { "x-api-key": rwKey } })).json();
    expect(typeof b.count).toBe("number");
  });

  test("GET /v1/openapi.json is served for SDK discovery", async () => {
    const b = await (await fetch(`${base}/v1/openapi.json`)).json();
    expect(b.openapi).toBeTruthy();
    expect(Object.keys(b.paths).length).toBeGreaterThan(5);
  });
});
