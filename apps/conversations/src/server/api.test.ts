import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startApiServer, type ApiServerDeps } from "./api.js";
import { mintApiKey } from "@hasna/contracts/auth";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

// In-memory query shim standing in for the vendored kit's TypedQueryClient.
// Exercises the router + auth without a live Postgres.
function makeFakeClient(initialProjects: Array<Record<string, any>> = [
  { id: "proj-valid", name: "Chief of Harness" },
]) {
  const channels: Record<string, any> = {};
  const channelMembers = new Set<string>();
  const messages: any[] = [];
  const messageMentions: any[] = [];
  const agentPresence = new Map<string, any>();
  const manyCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const projects: Record<string, any> = Object.fromEntries(
    initialProjects.map((project) => [project.id, { ...project }]),
  );
  let nextId = 1;
  const client = {
    async many(sql: string, _p: readonly unknown[] = []): Promise<any[]> {
      manyCalls.push({ sql, params: [..._p] });
      // Project list SQL contains a channel-count subquery, so identify the
      // outer projects query before the broader channel matcher below.
      if (/FROM projects/i.test(sql)) {
        let rows = Object.values(projects);
        if (/ORDER BY p\.name ASC/i.test(sql)) {
          rows = rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }

        const parameterValue = (keyword: "LIMIT" | "OFFSET"): number | undefined => {
          const match = sql.match(new RegExp(`${keyword}\\s+\\$(\\d+)`, "i"));
          if (!match) return undefined;
          const value = Number(_p[Number(match[1]) - 1]);
          return Number.isFinite(value) ? value : undefined;
        };
        const literalValue = (keyword: "LIMIT" | "OFFSET"): number | undefined => {
          const match = sql.match(new RegExp(`${keyword}\\s+(\\d+)`, "i"));
          return match ? Number(match[1]) : undefined;
        };
        const offset = parameterValue("OFFSET") ?? literalValue("OFFSET") ?? 0;
        const limit = parameterValue("LIMIT") ?? literalValue("LIMIT");
        return limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + limit);
      }
      if (/FROM channels/i.test(sql)) {
        return Object.values(channels).map((row) => ({
          ...row,
          member_count: [...channelMembers].filter((entry) => entry.startsWith(`${row.name}:`)).length,
          message_count: messages.filter((message) => message.channel === row.name).length,
        }));
      }
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
        const rows: any[] = [];
        for (let i = 0; i < numRows; i++) {
          const values = (p as any[]).slice(i * perRow, (i + 1) * perRow);
          const [
            uuid, session_id, from_agent, to_agent, channel, project_id,
            content, priority, working_dir, repository, branch, metadata,
            edited_at, pinned_at, blocking, attachments, reply_to,
            created_at, read_at,
          ] = values;
          if (!messages.find((m) => m.uuid === uuid)) {
            const row = {
              id: nextId++, uuid, session_id, from_agent, to_agent, channel,
              project_id, content, priority, working_dir, repository, branch,
              metadata, edited_at, pinned_at, blocking, attachments, reply_to,
              created_at: created_at ?? new Date().toISOString(), read_at,
            };
            messages.push(row);
            rows.push(row);
            inserted++;
          }
        }
        return { rows, rowCount: inserted };
      }
      if (/INSERT INTO message_mentions/i.test(sql)) {
        const [message_id, mentioned_agent, from_agent, channel] = p as any[];
        const row = { id: messageMentions.length + 1, message_id, mentioned_agent, from_agent, channel };
        messageMentions.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO messages/i.test(sql) && /priority, metadata/i.test(sql)) {
        const [uuid, session_id, from_agent, to_agent, content, metadata] = p as any[];
        const row = {
          id: nextId++, uuid, session_id, from_agent, to_agent, channel: null,
          project_id: null, content, priority: "normal", metadata,
          created_at: new Date().toISOString(),
        };
        messages.push(row);
        return { rows: [row], rowCount: 1 };
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
      if (/FROM agent_presence WHERE LOWER\(agent\) = \$1/i.test(sql)) {
        const row = agentPresence.get(String((p as any[])[0]).toLowerCase());
        return row ? { ...row, active: true, online: true } : null;
      }
      if (/UPDATE agent_presence/i.test(sql) && /RETURNING id, agent/i.test(sql)) {
        const [name, session_id, role, project_id] = p as any[];
        const key = String(name).toLowerCase();
        const row = agentPresence.get(key);
        if (!row) return null;
        Object.assign(row, {
          session_id,
          role,
          project_id,
          status: "online",
          last_seen_at: new Date().toISOString(),
          online: true,
        });
        return { ...row };
      }
      if (/INSERT INTO agent_presence/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        const [id, rawAgent, session_id, project_id, status, metadata] = p as any[];
        const agent = String(rawAgent).toLowerCase();
        const existing = agentPresence.get(agent);

        // Production also has idx_agent_presence_agent_unique. An upsert whose
        // arbiter is only the composite primary key does not handle that
        // independent unique-agent conflict, which is the shipped failure.
        if (existing && /ON CONFLICT \(agent, project_id\)/i.test(sql)) {
          throw new Error("duplicate key value violates unique constraint idx_agent_presence_agent_unique");
        }

        const row = existing ?? {
          id,
          agent,
          role: "agent",
          created_at: new Date().toISOString(),
        };
        Object.assign(row, {
          session_id: session_id ?? row.session_id ?? null,
          project_id,
          status,
          metadata,
          last_seen_at: new Date().toISOString(),
          online: true,
        });
        agentPresence.set(agent, row);
        return { ...row };
      }
      if (/INSERT INTO agent_presence/i.test(sql)) {
        const [id, rawAgent, session_id, role, project_id] = p as any[];
        const agent = String(rawAgent).toLowerCase();
        const row = {
          id,
          agent,
          session_id,
          role,
          project_id,
          status: "online",
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          metadata: null,
          online: true,
        };
        agentPresence.set(agent, row);
        return { ...row };
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
      if (/SELECT \* FROM messages WHERE id/i.test(sql)) {
        return messages.find((row) => row.id === (p as any[])[0]) ?? null;
      }
      if (/SELECT \* FROM messages WHERE uuid/i.test(sql)) {
        return messages.find((row) => row.uuid === (p as any[])[0]) ?? null;
      }
      if (/SELECT id, uuid, session_id, channel FROM messages WHERE uuid/i.test(sql)) {
        const found = messages.find((row) => row.uuid === (p as any[])[0]);
        return found
          ? { id: found.id, uuid: found.uuid, session_id: found.session_id, channel: found.channel }
          : null;
      }
      // Parent-existence probe for reply_to validation on POST /messages.
      if (/SELECT id FROM messages WHERE id/i.test(sql)) {
        const found = messages.find((row) => row.id === (p as any[])[0]);
        return found ? { id: found.id } : null;
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
        // Destructured positionally, so this must track the column list in the
        // INSERT. reply_to is last; a column missing from the statement is
        // exactly how thread linkage got dropped on the cloud path.
        const [uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, reply_to] = p as any[];
        const row = { id: nextId++, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, reply_to: reply_to ?? null, created_at: new Date().toISOString() };
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
    __debug: { messages, messageMentions, agentPresence, manyCalls, projects },
  };
  return client;
}

const SIGNING = "test-signing-secret-0123456789";
let activeFakeClient: ReturnType<typeof makeFakeClient> | null = null;

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "api_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function makeDeps(): ApiServerDeps {
  const client = makeFakeClient();
  activeFakeClient = client;
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
  test("GET /v1/projects pages three stable ids without overlap and reports continuation", async () => {
    const projectClient = makeFakeClient([
      { id: "project-alpha", name: "Alpha", created_at: "2026-08-07T00:00:00.000Z", status: "active" },
      { id: "project-bravo", name: "Bravo", created_at: "2026-08-07T00:00:01.000Z", status: "active" },
      { id: "project-charlie", name: "Charlie", created_at: "2026-08-07T00:00:02.000Z", status: "active" },
    ]);
    const projectKeys = new ApiKeyStore(projectClient as any);
    const projectVerifier = verifyApiKey({
      app: "conversations",
      signingSecret: SIGNING,
      isRevoked: async () => false,
    });
    const projectServer = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: { client: projectClient as any, keys: projectKeys, verifier: projectVerifier },
    });
    const projectBase = `http://127.0.0.1:${projectServer.port}`;
    const projectKey = mintApiKey({
      app: "conversations",
      agent: "project-reader",
      scopes: ["conversations:read"],
      signingSecret: SIGNING,
    }).token;
    const headers = { "x-api-key": projectKey };

    try {
      const firstResponse = await fetch(`${projectBase}/v1/projects?limit=2`, { headers });
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json() as any;
      expect(first.projects.map((project: any) => project.id)).toEqual(["project-alpha", "project-bravo"]);
      expect(first.has_more).toBe(true);
      expect(first.next_cursor).toBe(2);

      const secondResponse = await fetch(`${projectBase}/v1/projects?limit=2&cursor=${first.next_cursor}`, { headers });
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json() as any;
      expect(second.projects.map((project: any) => project.id)).toEqual(["project-charlie"]);
      expect(second.has_more).toBe(false);
      expect(second.next_cursor).toBeNull();

      const firstIds = first.projects.map((project: any) => project.id);
      const secondIds = second.projects.map((project: any) => project.id);
      expect(new Set([...firstIds, ...secondIds])).toEqual(
        new Set(["project-alpha", "project-bravo", "project-charlie"]),
      );
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    } finally {
      projectServer.stop(true);
    }
  });

  test("GET /v1/projects rejects malformed limit and cursor values", async () => {
    for (const query of ["limit=0", "limit=abc", "cursor=-1", "cursor=1.5"]) {
      const response = await fetch(`${base}/v1/projects?${query}`, {
        headers: { "x-api-key": roKey },
      });
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe("Validation failed");
    }
  });

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

  test("register takeover can heartbeat immediately without creating a second presence row", async () => {
    const name = "presence-takeover";
    const projectId = "proj-valid";
    const headers = { "x-api-key": rwKey, "content-type": "application/json" };

    const first = await fetch(`${base}/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, session_id: "session-old", project_id: projectId }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).result).toMatchObject({ created: true, took_over: false });

    const takeover = await fetch(`${base}/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, session_id: "session-new", project_id: projectId, force: true }),
    });
    expect(takeover.status).toBe(200);
    expect((await takeover.json()).result).toMatchObject({
      created: false,
      took_over: true,
      agent: { agent: name, session_id: "session-new", project_id: projectId },
    });

    const heartbeat = await fetch(`${base}/v1/agents/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agent: name,
        session_id: "session-new",
        project_id: projectId,
        status: "busy",
        metadata: { task: "f94cbd3d" },
      }),
    });

    expect(heartbeat.status).toBe(200);
    expect((await heartbeat.json()).agent).toMatchObject({
      agent: name,
      project_id: projectId,
      status: "busy",
    });
    expect(activeFakeClient!.__debug.agentPresence.size).toBe(1);
    expect(activeFakeClient!.__debug.agentPresence.get(name)).toMatchObject({
      session_id: "session-new",
      project_id: projectId,
      status: "busy",
    });
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

  // Regression cover for HC-00148, server layer. POST /v1/messages built its
  // INSERT without a reply_to column and never read reply_to off the body, so a
  // threaded reply came back 201 and stored as a top-level post. The local
  // SQLite path was always correct, which is why the suite stayed green.
  test("POST /v1/messages persists reply_to, and GET reads the parent link back", async () => {
    await fetch(`${base}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "threads", created_by: "test" }),
    });

    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "root post", channel: "threads" }),
    });
    expect(root.status).toBe(201);
    const rootBody = await root.json();
    const rootId = rootBody.message.id as number;
    // A root post must carry no parent — guards against "threads everything".
    expect(rootBody.message.reply_to ?? null).toBeNull();

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "b",
        to: "a",
        content: "threaded answer",
        channel: "threads",
        reply_to: rootId,
        reply_to_uuid: rootBody.message.uuid,
      }),
    });
    expect(reply.status).toBe(201);
    const replyId = (await reply.json()).message.id as number;

    // READ-BACK through GET (a different handler than the POST that wrote it).
    const got = await fetch(`${base}/v1/messages/${replyId}`, { headers: { "x-api-key": rwKey } });
    expect(got.status).toBe(200);
    const stored = (await got.json()).message;
    expect(stored.id).toBe(replyId);
    expect(stored.reply_to).toBe(rootId);
  });

  test("POST /v1/messages preserves a caller-bound UUID across mention fanout", async () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid,
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "immutable identity @bob",
      }),
    });
    expect(sent.status).toBe(201);
    const body = await sent.json();

    expect(body.message).toMatchObject({
      uuid,
      channel: "threads",
      content: "immutable identity @bob",
    });
    const readback = await fetch(`${base}/v1/messages/by-uuid/${uuid}`, {
      headers: { "x-api-key": rwKey },
    });
    expect(readback.status).toBe(200);
    expect((await readback.json()).message).toMatchObject({ id: body.message.id, uuid });
    const stored = activeFakeClient!.__debug.messages.find((message) => message.uuid === uuid);
    expect(stored?.channel).toBe("threads");
  });

  test("POST /v1/messages resolves reply_to_uuid and persists the exact numeric parent id", async () => {
    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "uuid parent",
      }),
    });
    const rootMessage = (await root.json()).message;

    const reply = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "uuid child",
        reply_to_uuid: rootMessage.uuid,
      }),
    });
    expect(reply.status).toBe(201);
    expect((await reply.json()).message.reply_to).toBe(rootMessage.id);
  });

  test("POST /v1/messages rejects numeric-only and mismatched reply identities before writing", async () => {
    const root = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "cccccccc-dddd-4eee-8fff-000000000000",
        from: "alice",
        to: "threads",
        channel: "threads",
        content: "strict parent",
      }),
    });
    const rootMessage = (await root.json()).message;
    const before = activeFakeClient!.__debug.messages.length;

    const numericOnly = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "numeric only",
        reply_to: rootMessage.id,
      }),
    });
    expect(numericOnly.status).toBe(400);

    const mismatched = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "bob",
        to: "threads",
        channel: "threads",
        content: "mismatched pair",
        reply_to: rootMessage.id + 1,
        reply_to_uuid: rootMessage.uuid,
      }),
    });
    expect(mismatched.status).toBe(409);
    expect(activeFakeClient!.__debug.messages).toHaveLength(before);
  });

  test("POST /v1/messages rejects a reply_to that names no existing message", async () => {
    // reply_to has no FK, so an unvalidated bogus parent would insert a dangling
    // pointer and read back as unthreaded — a success that lost the linkage.
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "b",
        content: "orphan",
        channel: "threads",
        reply_to_uuid: "dddddddd-eeee-4fff-8000-111111111111",
      }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("not found");
  });

  test("POST /v1/messages rejects a non-numeric reply_to", async () => {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "authorization": `Bearer ${rwKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "a",
        to: "b",
        content: "bad target",
        channel: "threads",
        reply_to: "not-a-number",
        reply_to_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("positive integer");
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

  test("bulk ingest blocks sensitive content generically without echo or insertion", async () => {
    const blocked = syntheticDatabaseUrl();
    const before = activeFakeClient!.__debug.messages.length;
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "bulk-sensitive-content", from: "a", to: "b", content: `blocked ${blocked}` }] }),
    });
    const text = await r.text();

    expect({
      status: r.status,
      generic: text.includes("sensitive content detected"),
      echoed: text.includes(blocked),
      inserted: activeFakeClient!.__debug.messages.length - before,
    }).toEqual({ status: 400, generic: true, echoed: false, inserted: 0 });
  });

  test("bulk ingest validates the same persisted string fields before writing", async () => {
    const blocked = syntheticDatabaseUrl();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["content", { content: `blocked ${blocked}` }],
      ["from", { from: blocked }],
      ["to", { to: blocked }],
      ["channel", { channel: blocked }],
      ["project", { project_id: blocked }],
      ["explicit-session", { session_id: blocked }],
    ];
    const outcomes: Array<Record<string, unknown>> = [];

    for (const [label, override] of cases) {
      const before = activeFakeClient!.__debug.messages.length;
      const r = await fetch(`${base}/v1/messages/bulk`, {
        method: "POST",
        headers: { "x-api-key": rwKey, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ uuid: `bulk-sensitive-${label}`, from: "source", to: "target", content: "safe", ...override }],
        }),
      });
      const text = await r.text();
      outcomes.push({
        label,
        status: r.status,
        generic: text.includes("sensitive content detected"),
        echoed: text.includes(blocked),
        inserted: activeFakeClient!.__debug.messages.length - before,
      });
    }

    const derived = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ uuid: "bulk-derived-session-safe", from: "source", to: "target", content: "safe" }] }),
    });
    expect(derived.status).toBe(200);
    expect(activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-derived-session-safe")?.session_id).toBe("api:source");
    expect(outcomes).toEqual(cases.map(([label]) => ({
      label, status: 400, generic: true, echoed: false, inserted: 0,
    })));
  });

  test("bulk ingest rejects a mixed safe and sensitive batch atomically", async () => {
    const blocked = syntheticDatabaseUrl();
    const before = activeFakeClient!.__debug.messages.length;
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { uuid: "bulk-atomic-safe", from: "a", to: "b", content: "safe" },
        { uuid: "bulk-atomic-sensitive", from: "a", to: "b", content: `blocked ${blocked}` },
      ] }),
    });
    const text = await r.text();

    expect({
      status: r.status,
      generic: text.includes("sensitive content detected"),
      echoed: text.includes(blocked),
      inserted: activeFakeClient!.__debug.messages.length - before,
    }).toEqual({ status: 400, generic: true, echoed: false, inserted: 0 });
  });

  test("bulk channel inserts create case-insensitive deduped mentions and notification DMs", async () => {
    const r = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "bulk-mentions-new",
        from: "Sender",
        to: "alerts",
        channel: "alerts",
        content: "Hello @Alpha, @alpha, @BETA, and @Sender",
      }] }),
    });
    const body = await r.json();
    const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-mentions-new");
    const mentions = activeFakeClient!.__debug.messageMentions
      .filter((m) => m.message_id === source?.id)
      .map((m) => m.mentioned_agent)
      .sort();
    const notificationRecipients = activeFakeClient!.__debug.messages
      .filter((m) => {
        try { return JSON.parse(m.metadata ?? "null")?.source_message_id === source?.id; } catch { return false; }
      })
      .map((m) => m.to_agent)
      .sort();

    expect(body.inserted).toBe(1);
    expect(mentions).toEqual(["alpha", "beta", "sender"]);
    expect(notificationRecipients).toEqual(["alpha", "beta"]);
  });

  test("bulk mention fanout processes only newly returned rows across idempotent reruns", async () => {
    const first = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        uuid: "bulk-mentions-idempotent",
        from: "sender",
        to: "alerts",
        channel: "alerts",
        content: "Hello @First",
      }] }),
    });
    const firstBody = await first.json();
    const source = activeFakeClient!.__debug.messages.find((m) => m.uuid === "bulk-mentions-idempotent");
    const afterFirst = activeFakeClient!.__debug.messages.length;

    const rerun = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        {
          uuid: "bulk-mentions-idempotent",
          from: "sender",
          to: "alerts",
          channel: "alerts",
          content: "Changed duplicate payload @Second",
        },
        {
          uuid: "bulk-mentions-new-on-rerun",
          from: "sender",
          to: "alerts",
          channel: "alerts",
          content: "Actually new @Third",
        },
      ] }),
    });
    const rerunBody = await rerun.json();
    const mentionAgents = activeFakeClient!.__debug.messageMentions.map((m) => m.mentioned_agent);
    const sourceMentions = activeFakeClient!.__debug.messageMentions.filter((m) => m.message_id === source?.id);
    const notifications = activeFakeClient!.__debug.messages.filter((m) => {
      try { return JSON.parse(m.metadata ?? "null")?.type === "mention_notification"; } catch { return false; }
    });

    expect(firstBody.inserted).toBe(1);
    expect(rerunBody).toMatchObject({ requested: 2, inserted: 1, skipped: 1 });
    expect(rerunBody.total - firstBody.total).toBe(2); // one source row + its one notification DM
    expect(activeFakeClient!.__debug.messages.length - afterFirst).toBe(2);
    expect(sourceMentions.map((m) => m.mentioned_agent)).toEqual(["first"]);
    expect(mentionAgents).toContain("third");
    expect(mentionAgents).not.toContain("second");
    expect(notifications.filter((m) => m.to_agent === "first")).toHaveLength(1);
    expect(notifications.filter((m) => m.to_agent === "third")).toHaveLength(1);
    expect(notifications.filter((m) => m.to_agent === "second")).toHaveLength(0);
  });

  test("bulk ingest preserves empty and maximum batch boundaries and counts", async () => {
    const before = activeFakeClient!.__debug.messages.length;
    const empty = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(await empty.json()).toEqual({ requested: 0, inserted: 0, skipped: 0, total: before });

    const maxBatch = Array.from({ length: 2000 }, (_, i) => ({
      uuid: `bulk-max-${i}`,
      from: "a",
      to: "b",
      content: `safe ${i}`,
    }));
    const max = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: maxBatch }),
    });
    const maxBody = await max.json();
    expect(max.status).toBe(200);
    expect(maxBody).toEqual({ requested: 2000, inserted: 2000, skipped: 0, total: before + 2000 });

    const over = await fetch(`${base}/v1/messages/bulk`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ messages: [...maxBatch, { uuid: "bulk-over", from: "a", to: "b", content: "safe" }] }),
    });
    expect(over.status).toBe(400);
    expect(activeFakeClient!.__debug.messages.length).toBe(before + 2000);
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

  test("HTTP search accepts an exact cutoff and rejects malformed timestamps", async () => {
    const valid = await fetch(`${base}/v1/messages?q=POLICY&since=2026-08-02T12%3A00%3A00.000Z`, {
      headers: { "x-api-key": rwKey },
    });
    expect(valid.status).toBe(200);
    const searchQuery = activeFakeClient!.__debug.manyCalls.at(-1)!;
    expect(searchQuery.sql).toContain("created_at >= $");
    expect(searchQuery.params).toContain("2026-08-02T12:00:00.000Z");

    const invalid = await fetch(`${base}/v1/messages?q=POLICY&since=yesterday`, {
      headers: { "x-api-key": rwKey },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("Invalid search since timestamp");
  });

  test("POST /v1/messages blocks sensitive content without echoing it", async () => {
    const blocked = syntheticDatabaseUrl();
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: `blocked ${blocked}` }),
    });
    const text = await r.text();

    expect(r.status).toBe(400);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
  });

  test("POST /v1/messages blocks sensitive persisted routing fields without echoing them", async () => {
    const blocked = syntheticDatabaseUrl();
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: blocked, content: "safe body" }),
    });
    const text = await r.text();

    expect(r.status).toBe(400);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
  });

  test("GET /v1/messages redacts sensitive legacy content", async () => {
    const blocked = syntheticDatabaseUrl();
    const sent = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": rwKey, "content-type": "application/json" },
      body: JSON.stringify({ from: "a", to: "b", content: "safe before legacy mutation" }),
    });
    const created = await sent.json() as any;
    // Mutate the fake backing store through the route's own insert path shape.
    await activeFakeClient!.get(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, priority, blocking)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      ["legacy", "legacy", "b", null, null, `legacy ${blocked}`, "normal", false],
    );

    const listText = await (await fetch(`${base}/v1/messages`, { headers: { "x-api-key": rwKey } })).text();
    const getText = await (await fetch(`${base}/v1/messages/${created.message.id}`, { headers: { "x-api-key": rwKey } })).text();

    expect(listText).toContain("[REDACTED:DATABASE_URL]");
    expect(listText).not.toContain(blocked);
    expect(getText).not.toContain(blocked);
  });

  test("GET /v1/openapi.json is served for SDK discovery", async () => {
    const b = await (await fetch(`${base}/v1/openapi.json`)).json();
    expect(b.openapi).toBeTruthy();
    expect(Object.keys(b.paths).length).toBeGreaterThan(5);

    // The typed SDK is generated from this schema. A server implementation
    // that accepts reply_to is not sufficient if the public contract omits it:
    // generated clients then cannot express a threaded send without escaping
    // their types, and the linkage is lost before the request is made.
    const sendProperties = b.paths["/v1/messages"].post.requestBody
      .content["application/json"].schema.properties;
    expect(sendProperties.uuid).toEqual({ type: "string" });
    expect(sendProperties.reply_to).toEqual({ type: "integer" });
    expect(sendProperties.reply_to_uuid).toEqual({ type: "string" });
    expect(b.paths["/v1/messages/by-uuid/{uuid}"].get.operationId).toBe("getMessageByUuid");
    expect(b.components.schemas.Message.properties.reply_to).toEqual({
      type: "integer",
      nullable: true,
    });
    expect(b.paths["/v1/projects"].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "limit", in: "query" }),
      expect.objectContaining({ name: "cursor", in: "query" }),
      expect.objectContaining({ name: "offset", in: "query" }),
    ]));
    expect(b.paths["/v1/channels"].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "project_id", in: "query" }),
    ]));
  });
});
