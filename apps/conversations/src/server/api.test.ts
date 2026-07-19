import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import { readFileSync } from "node:fs";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../test/hermetic.js";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient(incidentProjectionCount = 0) {
  const channels: Record<string, any> = {};
  const messages: any[] = [];
  const queries: string[] = [];
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  let nextId = 1;
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      queries.push(sql);
      queryCalls.push({ sql, params: _p });
      if (/FROM channels/i.test(sql)) return Object.values(channels);
      if (/FROM messages/i.test(sql)) {
        const rows = messages.slice().reverse();
        if (/channel_subscriptions s/i.test(sql) && /read_message_id/i.test(sql)) {
          return rows.map((message) => ({
            message_id: message.id,
            channel: message.channel,
            from_agent: message.from_agent,
            created_at: message.created_at,
            priority: message.priority,
            preview_source: String(message.content ?? "").slice(0, 4096),
            attachment_count: Array.isArray(message.attachments) ? message.attachments.length : 0,
            preview_chars: 140,
            read_message_id: null,
          }));
        }
        if (/preview_source/i.test(sql)) {
          return rows.map((message) => {
            const scope = [message.channel, message.to_agent, message.session_id].join(" ").toLowerCase();
            const restricted = scope.includes("incident") || scope.includes("security");
            return {
              id: message.id,
              uuid: message.uuid,
              session_id: message.session_id,
              from_agent: message.from_agent,
              to_agent: message.to_agent,
              channel: message.channel,
              project_id: message.project_id,
              priority: message.priority,
              blocking: message.blocking,
              reply_to: message.reply_to,
              working_dir: message.working_dir,
              repository: message.repository,
              branch: message.branch,
              created_at: message.created_at,
              read_at: message.read_at ?? null,
              edited_at: message.edited_at ?? null,
              pinned_at: message.pinned_at ?? null,
              has_metadata: Boolean(message.metadata),
              attachment_count: Array.isArray(message.attachments) ? message.attachments.length : 0,
              preview_source: restricted ? "" : String(message.content ?? "").slice(0, 4096),
              content_bytes: Buffer.byteLength(String(message.content ?? "")),
            };
          });
        }
        return rows;
      }
      if (/revoked_at IS NOT NULL/i.test(sql)) return [];
      return [];
    },
    async query(sql: string, p: readonly unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
      queries.push(sql);
      queryCalls.push({ sql, params: p });
      if (/INSERT INTO channel_notification_reads/i.test(sql)) {
        const ids = Array.isArray((p as any[])[1]) ? (p as any[])[1] : [];
        return { rows: [], rowCount: ids.length };
      }
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
      queries.push(sql);
      queryCalls.push({ sql, params: p });
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
      if (/SELECT \* FROM messages WHERE id/i.test(sql)) {
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
          read_at: null,
        };
        messages.push(row);
        return row;
      }
      return null;
    },
    async execute(sql: string, _p: readonly unknown[] = []): Promise<void> {
      queries.push(sql);
      queryCalls.push({ sql, params: _p });
    },
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn(client);
    },
    queries,
    queryCalls,
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
let restoreEnv: () => void;
let restoreNetwork: () => void;
const API_EXPORT_STORE = createDisposableStore("cloud-api-exports");

beforeAll(() => {
  restoreEnv = enterHermeticTestEnv({ CONVERSATIONS_EXPORT_DIR: `${API_EXPORT_STORE.dbPath}.artifacts` });
  restoreNetwork = installNetworkGuard({ allowLoopback: true });
  server = startApiServer({ port: 0, host: "127.0.0.1", deps: makeDeps() });
  base = `http://127.0.0.1:${server.port}`;
  rwKey = mintApiKey({ app: "conversations", agent: "test", scopes: ["conversations:read", "conversations:write"], signingSecret: SIGNING }).token;
  roKey = mintApiKey({ app: "conversations", agent: "ro", scopes: ["conversations:read"], signingSecret: SIGNING }).token;
  projectorKey = mintApiKey({ app: "conversations", agent: "todos-projector", scopes: ["conversations:incident-project"], signingSecret: SIGNING }).token;
});

afterAll(() => {
  server.stop(true);
  restoreNetwork();
  restoreEnv();
  API_EXPORT_STORE.cleanup();
});

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

  test("incident projector GET awaits and sanitizes rejected storage handlers without leaking logs", async () => {
    const deps = makeDeps();
    (deps.client as any).get = async (sql: string) => {
      if (/FROM incident_projections WHERE tenant_id/i.test(sql)) {
        throw new Error("SENTINEL_DB_PASSWORD_HOST_INTERNAL");
      }
      return null;
    };
    const logs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    try {
      const response = await fetch(
        `http://127.0.0.1:${isolated.port}/v1/incident-projections/iev_0123456789abcdef0123456789abcdef`,
        { headers: { "x-api-key": roKey } },
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      const rawBody = await response.text();
      expect(JSON.parse(rawBody)).toEqual({
        error: "Incident projection service is temporarily unavailable",
        code: "INCIDENT_PROJECTION_UNAVAILABLE",
      });
      expect(rawBody).not.toContain("SENTINEL");
      expect(logs.join("\n")).not.toContain("SENTINEL");
      expect(logs.join("\n")).not.toContain("PASSWORD");
      expect(logs.join("\n")).not.toContain("HOST_INTERNAL");
    } finally {
      isolated.stop(true);
      console.error = originalConsoleError;
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
    expect(list.messages[0].content).toBeUndefined();
  });

  test("collection reads project, redact, cap, and reserve full content for exact IDs", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    try {
      const token = ["Bearer", `fixture-${"x".repeat(30)}`].join(" ");
      const normalBody = `coordination update ${token}`;
      const restrictedBody = "incident detail must remain exact-only";
      const normalResponse = await fetch(`${isolatedBase}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ from: "a", to: "audit", channel: "audit", content: normalBody, metadata: { internal: "hidden" } }),
      });
      const restrictedResponse = await fetch(`${isolatedBase}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ from: "a", to: "incidents", channel: "incidents", content: restrictedBody }),
      });
      const normal = (await normalResponse.json()).message;
      expect(restrictedResponse.status).toBe(201);

      const listResponse = await fetch(`${isolatedBase}/v1/messages?limit=9999&max_bytes=4096`, {
        headers: { "x-api-key": rwKey },
      });
      expect(listResponse.status).toBe(200);
      const page = await listResponse.json();
      expect(page.compact).toBe(true);
      expect(page.limit).toBe(100);
      expect(page.byte_length).toBeLessThanOrEqual(4096);
      expect(page.messages.every((message: any) => message.content === undefined && message.metadata === undefined && message.attachments === undefined)).toBe(true);
      const normalPreview = page.messages.find((message: any) => message.id === normal.id);
      expect(normalPreview.preview).toContain("[REDACTED:BEARER_TOKEN]");
      expect(normalPreview.preview).not.toContain(token);
      const restrictedPreview = page.messages.find((message: any) => message.channel === "incidents");
      expect(restrictedPreview.preview).toBe("[REDACTED:RESTRICTED_CHANNEL_BODY]");
      expect(JSON.stringify(restrictedPreview)).not.toContain(restrictedBody);

      const projectedQuery = (deps.client as any).queries.find((sql: string) => /preview_source/i.test(sql) && /ORDER BY created_at/i.test(sql));
      expect(projectedQuery).toBeTruthy();
      expect(projectedQuery).not.toMatch(/SELECT\s+(?:m\.)?\*/i);

      const broadFull = await fetch(`${isolatedBase}/v1/messages?detail=full`, { headers: { "x-api-key": rwKey } });
      expect(broadFull.status).toBe(400);
      expect((await broadFull.json()).error).toContain("exact message");

      const exact = await fetch(`${isolatedBase}/v1/messages/${normal.id}`, { headers: { "x-api-key": rwKey } });
      expect(exact.status).toBe(200);
      expect((await exact.json()).message.content).toBe(normalBody);

      const malformed = await fetch(`${isolatedBase}/v1/messages?max_bytes=not-a-number`, { headers: { "x-api-key": rwKey } });
      expect(malformed.status).toBe(400);
    } finally {
      isolated.stop(true);
    }
  });

  test("malformed typed collection filters return 400 before any widened query", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    try {
      for (const query of [
        "id=not-an-id",
        "id=0",
        "reply_to=-1",
        "reply_to=1.5",
        "since_id=-1",
        "since_id=1.5",
        "since=not-a-date",
        "since=1",
        "session=fixture&session_id=",
        "session=one&session_id=two",
        "unread_only=perhaps",
        "order=relevance",
        "q=%20%20",
      ]) {
        const before = (deps.client as any).queryCalls.length;
        const response = await fetch(`${isolatedBase}/v1/messages?${query}`, { headers: { "x-api-key": rwKey } });
        expect(response.status).toBe(400);
        expect((deps.client as any).queryCalls.length).toBe(before);
      }
      const validZeroCursor = await fetch(`${isolatedBase}/v1/messages?since_id=0`, { headers: { "x-api-key": rwKey } });
      expect(validZeroCursor.status).toBe(200);
    } finally {
      isolated.stop(true);
    }
  });

  test("dedicated broad routes reject empty or malformed values before widening", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    const headers = { "x-api-key": rwKey };
    try {
      const cases: Array<{ path: string; init?: RequestInit }> = [
        { path: "/v1/messages?limit=" },
        { path: "/v1/messages?cursor=" },
        { path: "/v1/messages?unread_only=yes" },
        { path: "/v1/messages/pinned?channel=" },
        { path: "/v1/messages/pinned?session_id=" },
        { path: "/v1/messages/pinned?session=fixture&session_id=" },
        { path: "/v1/messages/pinned?max_bytes=" },
        { path: "/v1/messages/blockers?agent=" },
        { path: "/v1/messages/blockers?cursor=" },
        { path: "/v1/messages/for-agent?agent=" },
        { path: "/v1/messages/for-agent?agent=test&channel=" },
        { path: "/v1/messages/for-agent?agent=test&unread_only=yes" },
        { path: "/v1/messages/for-agent?agent=test&timeout_ms=" },
        { path: "/v1/messages/export?limit=" },
        { path: "/v1/messages/export?since=not-a-date" },
        { path: "/v1/messages/export?since=1" },
        { path: "/v1/messages/export?session=fixture&session_id=" },
        { path: "/v1/channel-notifications/inbox?channel=" },
        { path: "/v1/channel-notifications/inbox?since=not-a-date" },
        { path: "/v1/channel-notifications/inbox?mark_read=yes" },
        { path: "/v1/channel-notifications/inbox?preview_bytes=" },
      ];

      for (const item of cases) {
        const before = (deps.client as any).queryCalls.length;
        const response = await fetch(`${isolatedBase}${item.path}`, { headers, ...item.init });
        expect(response.status, item.path).toBe(400);
        expect((deps.client as any).queryCalls.length, item.path).toBe(before);
      }

      for (const body of [
        { limit: "" },
        { max_bytes: "" },
        { since: "not-a-date" },
        { format: "xml" },
      ]) {
        const before = (deps.client as any).queryCalls.length;
        const response = await fetch(`${isolatedBase}/v1/messages/exports`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect((deps.client as any).queryCalls.length, JSON.stringify(body)).toBe(before);
      }
    } finally {
      isolated.stop(true);
    }
  });

  test("an explicitly empty mention id set is an exact no-op, not a widened acknowledgement", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    try {
      const before = (deps.client as any).queryCalls.length;
      const response = await fetch(`${isolatedBase}/v1/messages/read`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ mentions_only: true, mention_ids: [] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ marked: 0 });
      expect((deps.client as any).queryCalls.length).toBe(before);
    } finally {
      isolated.stop(true);
    }
  });

  test("notification pages bind to the authenticated principal and mark only returned ids", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    try {
      for (const content of ["first", "second", "third"]) {
        const sent = await fetch(`${isolatedBase}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": rwKey, "content-type": "application/json" },
          body: JSON.stringify({ from: "alice", to: "ops", channel: "ops", content }),
        });
        expect(sent.status).toBe(201);
      }

      const spoofed = await fetch(`${isolatedBase}/v1/channel-notifications/inbox?agent=other`, {
        headers: { "x-api-key": rwKey },
      });
      expect(spoofed.status).toBe(403);

      const pageResponse = await fetch(
        `${isolatedBase}/v1/channel-notifications/inbox?agent=test&limit=2&cursor=0&max_bytes=4096&preview_bytes=80&timeout_ms=1000&mark_read=true`,
        { headers: { "x-api-key": rwKey } },
      );
      expect(pageResponse.status).toBe(200);
      const page = await pageResponse.json();
      expect(page.notifications).toHaveLength(2);
      expect(page.notifications.every((notification: any) => notification.unread === false)).toBe(true);
      expect(page.marked_read).toBe(2);
      expect(page.has_more).toBe(true);
      expect(page.next_cursor).toBe(2);
      expect(page.byte_length).toBeLessThanOrEqual(page.max_bytes);
      const markCall = (deps.client as any).queryCalls.findLast((call: any) => /INSERT INTO channel_notification_reads/i.test(call.sql));
      expect(markCall.params[1]).toEqual(page.notifications.map((notification: any) => notification.message_id));
    } finally {
      isolated.stop(true);
    }
  });

  test("exports are bounded artifacts and full detail is principal-bound", async () => {
    const deps = makeDeps();
    const isolated = startApiServer({ port: 0, host: "127.0.0.1", deps });
    const isolatedBase = `http://127.0.0.1:${isolated.port}`;
    const rawBody = "principal-bound full export body";
    try {
      await fetch(`${isolatedBase}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ from: "test", to: "security-audit", channel: "security-audit", content: rawBody, metadata: { raw: "hidden" } }),
      });

      const previewResponse = await fetch(`${isolatedBase}/v1/messages/exports`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ channel: "security-audit", max_bytes: 4096, limit: 10 }),
      });
      expect(previewResponse.status).toBe(201);
      const previewArtifact = (await previewResponse.json()).artifact;
      expect(previewArtifact.path).toBeNull();
      expect(previewArtifact.detail).toBe("preview");
      expect(previewArtifact.byte_length).toBeLessThanOrEqual(4096);
      const previewDownload = await fetch(`${isolatedBase}${previewArtifact.download_path}`, { headers: { "x-api-key": rwKey } });
      expect(previewDownload.status).toBe(200);
      const previewPayload = await previewDownload.text();
      expect(previewPayload).not.toContain(rawBody);
      expect(previewPayload).not.toContain('"content"');
      expect(previewDownload.headers.get("x-content-sha256")).toBe(previewArtifact.sha256);

      const otherPrincipalDownload = await fetch(`${isolatedBase}${previewArtifact.download_path}`, { headers: { "x-api-key": roKey } });
      expect(otherPrincipalDownload.status).toBe(404);

      const missingAuthorization = await fetch(`${isolatedBase}/v1/messages/exports`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({ detail: "full" }),
      });
      expect(missingAuthorization.status).toBe(400);
      const spoofedAuthorization = await fetch(`${isolatedBase}/v1/messages/exports`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({
          detail: "full",
          authorization: { principal: "other", reason: "not authorized", acknowledged: true },
        }),
      });
      expect(spoofedAuthorization.status).toBe(403);

      const fullResponse = await fetch(`${isolatedBase}/v1/messages/exports`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({
          channel: "security-audit",
          detail: "full",
          max_bytes: 4096,
          authorization: { principal: "test", reason: "audited incident handoff", acknowledged: true },
        }),
      });
      expect(fullResponse.status).toBe(201);
      const fullArtifact = (await fullResponse.json()).artifact;
      const fullDownload = await fetch(`${isolatedBase}${fullArtifact.download_path}`, { headers: { "x-api-key": rwKey } });
      expect(fullDownload.status).toBe(200);
      expect(await fullDownload.text()).toContain(rawBody);
    } finally {
      isolated.stop(true);
    }
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
