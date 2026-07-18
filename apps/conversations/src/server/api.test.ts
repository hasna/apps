import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import { readFileSync } from "node:fs";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient(incidentProjectionCount = 0) {
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
      return { rows: [], rowCount: 0 };
    },
    async get(sql: string, p: readonly unknown[] = []): Promise<any> {
      if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
      if (/count\(\*\).*incident_projections/is.test(sql)) return { n: incidentProjectionCount };
      if (/count\(\*\)/i.test(sql)) return { n: messages.length };
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
      if (/SELECT id, session_id, channel, project_id FROM messages WHERE id/i.test(sql)) {
        return messages.find((m) => m.id === Number((p as any[])[0])) ?? null;
      }
      if (/INSERT INTO messages/i.test(sql)) {
        const [
          session_id, from_agent, to_agent, channel, project_id, content, priority, blocking,
          reply_to, metadata, working_dir, repository, branch, attachments,
        ] = p as any[];
        const row = {
          id: nextId++, uuid: `u${nextId}`, session_id, from_agent, to_agent, channel, project_id,
          content, priority, blocking, reply_to, metadata, working_dir, repository, branch, attachments,
          created_at: new Date().toISOString(),
        };
        messages.push(row);
        return row;
      }
      return null;
    },
    async execute(_sql: string, _p: readonly unknown[] = []): Promise<void> {},
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };
  return client;
}

const SIGNING = "test-signing-secret-0123456789";

function makeDeps(options: { incidentProjectionCount?: number } = {}): ApiServerDeps {
  const client = makeFakeClient(options.incidentProjectionCount ?? 0);
  const keys = new ApiKeyStore(client as any);
  const verifier = verifyApiKey({ app: "conversations", signingSecret: SIGNING, isRevoked: async () => false });
  return {
    client: client as any,
    keys,
    verifier,
    incidentProjector: {
      tenant_id: "tenant-a",
      authority_id: "todos.hasna.xyz:v1",
      routing: { channel: "incidents", project_id: "engineering" },
    },
  };
}

let server: ReturnType<typeof startApiServer>;
let base: string;
let rwKey: string;
let roKey: string;
let projectorKey: string;

beforeAll(() => {
  server = startApiServer({ port: 0, host: "127.0.0.1", deps: makeDeps() });
  base = `http://127.0.0.1:${server.port}`;
  rwKey = mintApiKey({ app: "conversations", agent: "test", scopes: ["conversations:read", "conversations:write"], signingSecret: SIGNING }).token;
  roKey = mintApiKey({ app: "conversations", agent: "ro", scopes: ["conversations:read"], signingSecret: SIGNING }).token;
  projectorKey = mintApiKey({ app: "conversations", agent: "todos-projector", scopes: ["conversations:incident-project"], signingSecret: SIGNING }).token;
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

  test("dedicated incident projector route requires its narrow scope", async () => {
    const denied = await fetch(`${base}/v1/incident-projections`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(denied.status).toBe(403);
    const admitted = await fetch(`${base}/v1/incident-projections`, {
      method: "POST",
      headers: { "x-api-key": projectorKey, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(admitted.status).toBe(400);
    expect((await admitted.json()).code).toBe("INVALID_INCIDENT_PROJECTION");
  });

  test("incident projector maps unexpected storage failures to a sanitized retryable 503", async () => {
    const deps = makeDeps();
    deps.client.transaction = async () => {
      throw new Error("postgres password=must-not-leak host=internal");
    };
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    try {
      const fixture = JSON.parse(readFileSync(
        new URL("../../fixtures/todos-incident-projection-v1.json", import.meta.url),
        "utf8",
      ));
      const response = await fetch(`http://127.0.0.1:${isolated.port}/v1/incident-projections`, {
        method: "POST",
        headers: { "x-api-key": projectorKey, "content-type": "application/json" },
        body: JSON.stringify(fixture),
      });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toEqual({
        error: "Incident projection service is temporarily unavailable",
        code: "INCIDENT_PROJECTION_UNAVAILABLE",
      });
      expect(JSON.stringify(body)).not.toContain("password");
      expect(JSON.stringify(body)).not.toContain("internal");
    } finally {
      isolated.stop(true);
    }
  });

  test("blocker reads and acknowledgements cannot impersonate another agent", async () => {
    const blockers = await fetch(`${base}/v1/messages/blockers?agent=other`, {
      headers: { "x-api-key": rwKey },
    });
    expect(blockers.status).toBe(403);
    const spoofed = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ ids: [999], reader: "other" }),
    });
    expect(spoofed.status).toBe(403);
    const spoofedReceipt = await fetch(`${base}/v1/messages/999/receipts`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ agent: "other" }),
    });
    expect(spoofedReceipt.status).toBe(403);
    const matching = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ ids: [999], reader: "test" }),
    });
    expect(matching.status).toBe(200);
    const omitted = await fetch(`${base}/v1/messages/read`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ ids: [998] }),
    });
    expect(omitted.status).toBe(200);
  });

  test("cloud blocker route preserves legacy-only installs without projector config", async () => {
    const deps = makeDeps();
    deps.incidentProjector = null;
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    try {
      const response = await fetch(`http://127.0.0.1:${isolated.port}/v1/messages/blockers?agent=test`, {
        headers: { "x-api-key": rwKey },
      });
      expect(response.status).toBe(200);
    } finally {
      isolated.stop(true);
    }
  });

  test("cloud blocker route fails closed when canonical rows exist but projector binding is absent", async () => {
    const deps = makeDeps({ incidentProjectionCount: 1 });
    deps.incidentProjector = null;
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    try {
      const response = await fetch(`http://127.0.0.1:${isolated.port}/v1/messages/blockers?agent=test`, {
        headers: { "x-api-key": rwKey },
      });
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("INCIDENT_PROJECTOR_CONFIGURATION_ERROR");
    } finally {
      isolated.stop(true);
    }
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

  test("generic single and bulk ingress reject object or serialized projection metadata", async () => {
    for (const metadata of [
      { canonical_incident_projection: { event_id: "iev_fake" } },
      JSON.stringify({ event_id: "iev_fake" }),
    ]) {
      const response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ from: "attacker", to: "incidents", content: "spoof", metadata }),
      });
      expect(response.status).toBe(409);
    }
    const bulk = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "spoof-bulk",
        from: "attacker",
        to: "incidents",
        content: "spoof",
        metadata: JSON.stringify({ projection_key: "todos:incident:fake" }),
      }] }),
    });
    expect(bulk.status).toBe(409);
  });

  test("POST /v1/messages preserves ordinary metadata and same-scope reply correlation", async () => {
    const parent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "incidents",
        content: "parent",
        channel: "incidents",
        project_id: "engineering",
      }),
    });
    expect(parent.status).toBe(201);
    const parentMessage = (await parent.json()).message;

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "b",
        to: "incidents",
        content: "reply",
        channel: "incidents",
        project_id: "engineering",
        reply_to: parentMessage.id,
        metadata: { display: { severity: "sev2" } },
        working_dir: "/worktree",
        repository: "hasna/conversations",
        branch: "fix/reply",
      }),
    });
    expect(reply.status).toBe(201);
    const message = (await reply.json()).message;
    expect(message.reply_to).toBe(parentMessage.id);
    expect(message.metadata).toEqual({ display: { severity: "sev2" } });
    expect(message.working_dir).toBe("/worktree");
    expect(message.repository).toBe("hasna/conversations");
    expect(message.branch).toBe("fix/reply");
  });

  test("POST /v1/messages rejects reply parents from a different channel or project", async () => {
    const parent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "ops", content: "ops root", channel: "ops", project_id: "p1" }),
    });
    const parentId = (await parent.json()).message.id;

    const crossed = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: "b",
        to: "incidents",
        content: "must not cross scope",
        channel: "incidents",
        project_id: "p2",
        reply_to: parentId,
      }),
    });
    expect(crossed.status).toBe(409);
  });

  test("POST /v1/messages atomically inherits a DM reply parent session", async () => {
    const parent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "test", to: "alice", content: "dm root" }),
    });
    expect(parent.status).toBe(201);
    const parentMessage = (await parent.json()).message;
    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "test", to: "alice", content: "dm reply", reply_to: parentMessage.id }),
    });
    expect(reply.status).toBe(201);
    const replyMessage = (await reply.json()).message;
    expect(replyMessage.reply_to).toBe(parentMessage.id);
    expect(replyMessage.session_id).toBe(parentMessage.session_id);
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
