import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiStore } from "./api-store.js";
import { DEFAULT_READ_LIMIT } from "../message-window.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { MessagePreview } from "../../types.js";

// A minimal fake HasnaStorageClient whose transport returns whatever the test
// queues, so we can assert ApiStore normalizes raw API rows into the client
// contract without any network or sqlite.
function fakeClient(getBody: unknown): HasnaStorageClient {
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    // Only the verbs ApiStore's project methods touch are needed here.
    get: async () => getBody,
    post: async () => getBody,
    patch: async () => getBody,
    del: async () => undefined,
  } as unknown as HasnaStorageClient["transport"];
  return {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
}

/** A client whose transport rejects every read with a 404 HasnaHttpError. */
function throwing404Client(): HasnaStorageClient {
  const err = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
  const reject = async () => {
    throw err;
  };
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    get: reject,
    post: reject,
    patch: reject,
    del: reject,
  } as unknown as HasnaStorageClient["transport"];
  return {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
}

describe("ApiStore project normalization", () => {
  test("getProject coerces raw JSON-text tags into a string[] (regression: tags=null crash)", async () => {
    // Server returns a raw row: tags as null (the shape that crashed `project get`).
    const store = new ApiStore(fakeClient({ project: { id: "p1", name: "acme", tags: null, channel_count: 3 } }));
    const p = (await store.getProject("p1")) as unknown as { tags: string[]; channel_count: number };
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.tags.length).toBe(0);
    expect(p.channel_count).toBe(3);
    // The exact expression that used to throw must now be safe.
    expect(() => (p.tags.length > 0 ? p.tags.join(", ") : "")).not.toThrow();
  });

  test("getProject parses tags stored as a JSON string", async () => {
    const store = new ApiStore(fakeClient({ project: { id: "p2", name: "beta", tags: '["a","b"]' } }));
    const p = (await store.getProject("p2")) as unknown as { tags: string[]; channel_count: number };
    expect(p.tags).toEqual(["a", "b"]);
    expect(p.channel_count).toBe(0);
  });

  test("listProjects normalizes every row", async () => {
    const store = new ApiStore(
      fakeClient({ projects: [{ id: "p1", name: "a", tags: null }, { id: "p2", name: "b", tags: '["x"]', channel_count: 2 }] }),
    );
    const rows = (await store.listProjects()) as unknown as Array<{ tags: string[]; channel_count: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].tags).toEqual([]);
    expect(rows[1].tags).toEqual(["x"]);
    expect(rows[1].channel_count).toBe(2);
  });

  test("getProject returns null when the API has no project", async () => {
    const store = new ApiStore(fakeClient({ project: null }));
    expect(await store.getProject("missing")).toBeNull();
  });

  test("getProject returns null (not throw) when the server 404s the lookup", async () => {
    // The server 404s a missing project (GET /projects/:id). The LocalStore
    // contract is null, so ApiStore must translate the 404 rather than throw —
    // otherwise `project-panel`'s resolveProject() crashes instead of falling
    // through to getProjectByName().
    const store = new ApiStore(throwing404Client());
    expect(await store.getProject("nope")).toBeNull();
  });

  test("getChannel returns null (not throw) when the server 404s the lookup", async () => {
    // Same contract for channels: the server 404s a missing channel, the local
    // store returns null.
    const store = new ApiStore(throwing404Client());
    expect(await store.getChannel("nope")).toBeNull();
  });
});

describe("ApiStore bounded message reads", () => {
  const preview: MessagePreview = {
    id: 702001,
    uuid: "11111111-2222-4333-8444-555555555555",
    session_id: "session-digest-regression",
    from_agent: "sender",
    to_agent: "announcements",
    channel: "announcements",
    project_id: null,
    priority: "normal",
    working_dir: null,
    repository: null,
    branch: null,
    created_at: "2026-08-12T07:00:00.000Z",
    edited_at: null,
    pinned_at: null,
    unread: true,
    blocking: false,
    reply_to: null,
    attachment_count: 0,
    has_attachments: false,
    has_metadata: false,
    preview: "bounded announcement",
    preview_bytes: Buffer.byteLength("bounded announcement"),
    content_bytes: Buffer.byteLength("bounded announcement"),
    truncated: false,
    redacted: false,
  };

  test("readDigest converts bounded preview rows before building snippets", async () => {
    const calls: Array<{ path: string; query: unknown }> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string, options?: { query?: Record<string, unknown> }) => {
          calls.push({ path, query: options?.query ?? null });
          return options?.query && "count" in options.query
            ? { count: 1 }
            : { messages: [preview], has_more: false, next_cursor: null };
        },
      },
    } as unknown as HasnaStorageClient;

    const result = await new ApiStore(client).readDigest({
      channel: "announcements",
      since: "2026-08-05T00:00:00Z",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.snippet).toBe("bounded announcement");
    expect(calls.map((call) => call.path)).toEqual(["/messages", "/messages", "/messages"]);
  });

  // Regression cover for todos 5229dec2: the poll cursor seeds at 0, so
  // readDigest({ cursor: 0 }) must keep forwarding since_id=0 to the hosted API
  // (whose GET /v1/messages contract declares since_id minimum: 0) rather than
  // clamping it away or rejecting it client-side.
  test("readDigest forwards cursor 0 as since_id=0 without clamping", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (_path: string, options?: { query?: Record<string, unknown> }) => {
          queries.push(options?.query ?? {});
          return { messages: [], has_more: false, next_cursor: null };
        },
      },
    } as unknown as HasnaStorageClient;

    await new ApiStore(client).readDigest({ channel: "cursor-zero", cursor: 0 });

    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query.since_id).toBe(0);
  });

  test("readDigest preserves the hosted reserved-alias error instead of returning an empty digest", async () => {
    const aliasError = Object.assign(
      new Error("Channel #chief-research is a reserved historical alias for #agent-chief-research."),
      { name: "HasnaHttpError", status: 409 },
    );
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (_path: string, options?: { query?: Record<string, unknown> }) => {
          expect(options?.query?.channel).toBe("chief-research");
          throw aliasError;
        },
      },
    } as unknown as HasnaStorageClient;

    await expect(new ApiStore(client).readDigest({ channel: "chief-research" })).rejects.toThrow(aliasError.message);
  });

  test("getUnreadBlockers forwards the caller byline as the agent query even WITHOUT an explicit --from (regression: fleet-wide unscoped read)", async () => {
    // Before task 1871c67f the default identity was deliberately omitted from
    // the request (bug #160), so `blockers` without --from read fleet-wide at
    // rc=0 while every seat reported "ZERO blockers". The byline must be
    // forwarded unconditionally: the key authorizes, the byline scopes.
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string, options?: { query?: Record<string, unknown> }) => {
          expect(path).toBe("/messages/blockers");
          const query = options?.query ?? {};
          queries.push(query);
          return {
            messages: [preview],
            count: 1,
            limit: 20,
            cursor: 0,
            next_cursor: null,
            has_more: false,
            skipped_count: 0,
            byte_length: 0,
            max_bytes: 65_536,
            timeout_ms: 3_000,
            compact: true,
            detail_path: "messages/{id}",
          };
        },
      },
    } as unknown as HasnaStorageClient;

    const result = await new ApiStore(client).getUnreadBlockers("codewith-iapp-news");

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("bounded announcement");
    expect(queries).toEqual([{
      agent: "codewith-iapp-news",
      limit: 20,
      cursor: 0,
      max_bytes: 65_536,
      preview_bytes: 320,
      timeout_ms: 3_000,
      detail: "preview",
    }]);
  });

  test("getUnreadBlockers forwards an EXPLICIT --from agent so the server can enforce the identity match", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string, options?: { query?: Record<string, unknown> }) => {
          expect(path).toBe("/messages/blockers");
          const query = options?.query ?? {};
          queries.push(query);
          return {
            messages: [preview],
            count: 1,
            limit: 20,
            cursor: 0,
            next_cursor: null,
            has_more: false,
            skipped_count: 0,
            byte_length: 0,
            max_bytes: 65_536,
            timeout_ms: 3_000,
            compact: true,
            detail_path: "messages/{id}",
          };
        },
      },
    } as unknown as HasnaStorageClient;

    // Regression: the byline must reach the server as the scope for every
    // blockers read. The explicitFrom gate is retired (task 1871c67f) — the
    // byline is forwarded unconditionally, with no flag.
    const result = await new ApiStore(client).getUnreadBlockers("agent-chief-staff");

    expect(result).toHaveLength(1);
    expect(queries).toEqual([{
      agent: "agent-chief-staff",
      limit: 20,
      cursor: 0,
      max_bytes: 65_536,
      preview_bytes: 320,
      timeout_ms: 3_000,
      detail: "preview",
    }]);
  });

  test("readChannelNotifications forwards the byline as the agent query unconditionally", async () => {
    // The notification inbox requires the agent scope on the wire. The fleet
    // server accepts the caller-declared byline (task 1871c67f); this pins the
    // client half so the forwarding never regresses to an unscoped read.
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (_path: string, options?: { query?: Record<string, unknown> }) => {
          const query = options?.query ?? {};
          queries.push(query);
          return {
            notifications: [],
            count: 0,
            limit: 20,
            cursor: 0,
            next_cursor: null,
            has_more: false,
            skipped_count: 0,
            byte_length: 0,
            max_bytes: 65_536,
            timeout_ms: 3_000,
            marked_read: 0,
            compact: true,
            detail_path: "messages/{id}",
          };
        },
      },
    } as unknown as HasnaStorageClient;

    await new ApiStore(client).readChannelNotifications({ agent: "agent-chief-staff", unread_only: true });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ agent: "agent-chief-staff", unread_only: true });
  });
});

describe("ApiStore heartbeat partial updates", () => {
  test("omits undefined fields and preserves explicit empty replacements", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        post: async (path: string, body: unknown) => {
          posts.push({ path, body });
          return {};
        },
      },
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    await store.heartbeat("partial-agent", "busy");
    await store.heartbeat("partial-agent", "idle", {}, undefined, null);

    expect(Object.keys(posts[0].body as Record<string, unknown>).sort()).toEqual([
      "agent",
      "status",
    ]);
    expect(Object.keys(posts[1].body as Record<string, unknown>).sort()).toEqual([
      "agent",
      "metadata",
      "project_id",
      "status",
    ]);
    expect(posts).toEqual([
      {
        path: "/agents/heartbeat",
        body: { agent: "partial-agent", status: "busy" },
      },
      {
        path: "/agents/heartbeat",
        body: {
          agent: "partial-agent",
          status: "idle",
          metadata: {},
          project_id: null,
        },
      },
    ]);
  });
});

describe("ApiStore immutable message lookup compatibility", () => {
  test("falls back to the collection UUID filter when the dedicated route is absent", async () => {
    const uuid = "5307e936-efb7-4eeb-b7e2-0fe354b7ac35";
    const calls: Array<{ path: string; query: unknown }> = [];
    const notFound = Object.assign(new Error("Not Found"), {
      name: "HasnaHttpError",
      status: 404,
    });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string, options?: { query?: Record<string, unknown> }) => {
          calls.push({ path, query: options?.query ?? null });
          if (path.startsWith("/messages/by-uuid/")) throw notFound;
          if (path === "/messages") {
            return {
              messages: [{
                id: "695033",
                uuid,
                session_id: "channel:git-publishing",
                from_agent: "alice",
                to_agent: "git-publishing",
                channel: "git-publishing",
                content: "synthetic parent",
              }],
            };
          }
          return null;
        },
      },
    } as unknown as HasnaStorageClient;

    const message = await new ApiStore(client).getMessageByUuid(uuid);

    expect(message).toMatchObject({
      id: 695033,
      uuid,
      channel: "git-publishing",
    });
    expect(calls).toEqual([
      { path: `/messages/by-uuid/${uuid}`, query: null },
      {
        path: "/messages",
        query: { uuid, limit: 2, order: "asc" },
      },
    ]);
  });

  test("does not accept collection noise when an old server ignores the UUID filter", async () => {
    const requested = "5307e936-efb7-4eeb-b7e2-0fe354b7ac35";
    const notFound = Object.assign(new Error("Not Found"), {
      name: "HasnaHttpError",
      status: 404,
    });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string) => {
          if (path.startsWith("/messages/by-uuid/")) throw notFound;
          return {
            messages: [{
              id: 695033,
              uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
              session_id: "channel:mementos",
              from_agent: "other",
              to_agent: "mementos",
              channel: "mementos",
              content: "unrelated synthetic row",
            }],
          };
        },
      },
    } as unknown as HasnaStorageClient;

    expect(await new ApiStore(client).getMessageByUuid(requested)).toBeNull();
  });
});

describe("ApiStore channel notification cursor", () => {
  test("arm-time baseline uses the atomic remote endpoint for one identity", async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const transport = {
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async () => ({}),
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        return { marked: 7 };
      },
      patch: async () => ({}),
      del: async () => undefined,
    } as unknown as HasnaStorageClient["transport"];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport,
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    expect(await store.baselineChannelNotifications("watcher")).toBe(7);
    expect(posts).toEqual([
      {
        path: "/channel-notifications/baseline",
        body: { agent: "watcher" },
      },
    ]);
  });

  test("mark_read advances the remote notification inbox so consecutive watcher polls do not repeat ids", async () => {
    const notifications = [
      {
        message_id: 620874,
        channel: "announcements",
        from_agent: "agent-ceo",
        created_at: "2026-08-01T05:00:00.000Z",
        priority: "normal",
        preview: "first",
        unread: true,
        has_attachments: false,
      },
      {
        message_id: 620878,
        channel: "incidents",
        from_agent: "agent-chief-harness",
        created_at: "2026-08-01T05:01:00.000Z",
        priority: "high",
        preview: "second",
        unread: true,
        has_attachments: false,
      },
    ];
    const readIds = new Set<number>();
    const posts: Array<{ path: string; body: unknown }> = [];
    const transport = {
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async (path: string) => {
        expect(path).toBe("/channel-notifications/inbox");
        return { notifications: notifications.filter((row) => !readIds.has(row.message_id)) };
      },
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        for (const id of (body as { message_ids: number[] }).message_ids) readIds.add(id);
        return { marked: readIds.size };
      },
      patch: async () => ({}),
      del: async () => undefined,
    } as unknown as HasnaStorageClient["transport"];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport,
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const firstPoll = await store.readChannelNotifications({
      agent: "agent-chief-strategy",
      unread_only: true,
      mark_read: true,
    });
    const secondPoll = await store.readChannelNotifications({
      agent: "agent-chief-strategy",
      unread_only: true,
      mark_read: true,
    });

    expect(firstPoll.notifications.map((row) => row.message_id)).toEqual([620874, 620878]);
    expect(firstPoll.notifications.every((row) => row.unread === false)).toBe(true);
    expect(secondPoll.notifications).toEqual([]);
    expect(posts).toEqual([
      {
        path: "/channel-notifications/read",
        body: { agent: "agent-chief-strategy", message_ids: [620874, 620878] },
      },
    ]);
  });
});

// Regression cover for HC-00148, cloud-transport layer. ApiStore.sendMessage
// forwards an EXPLICIT field whitelist, and reply_to was not on it — so through
// the API the parent link was dropped before the request even
// left the machine, while the local SQLite path (and its tests) stayed correct.
// This asserts on the body that actually goes over the wire.
describe("ApiStore.sendMessage wire body", () => {
  test("uploads validated attachment bytes and parses returned metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversations-api-attachment-"));
    const source = join(root, "handoff.pdf");
    writeFileSync(source, "synthetic remote PDF\n");
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_resource: string, body: Record<string, unknown>) => {
        sent.push(body);
        return {
          message: {
            id: 701,
            uuid: body.uuid,
            session_id: "channel:handoffs",
            from_agent: body.from,
            to_agent: "handoffs",
            channel: "handoffs",
            content: body.content,
            attachments: [{
              name: "handoff.pdf",
              path: "/v1/messages/701/attachments/handoff.pdf",
              size: Buffer.byteLength("synthetic remote PDF\n"),
              mime_type: "application/pdf",
            }],
          },
        };
      },
    } as unknown as HasnaStorageClient;

    try {
      const message = await new ApiStore(client).sendMessage({
        from: "alice",
        to: "alice",
        channel: "handoffs",
        content: "remote attachment",
        attachments: [{ name: "handoff.pdf", source_path: source }],
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].attachments).toEqual([{
        name: "handoff.pdf",
        content_base64: Buffer.from("synthetic remote PDF\n").toString("base64"),
      }]);
      expect(message.attachments).toEqual([{
        name: "handoff.pdf",
        path: "/v1/messages/701/attachments/handoff.pdf",
        size: Buffer.byteLength("synthetic remote PDF\n"),
        mime_type: "application/pdf",
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects archive and compressed attachments before starting an HTTP write", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversations-api-attachment-opaque-"));
    const source = join(root, "handoff.bundle");
    writeFileSync(source, "synthetic opaque payload\n");
    let creates = 0;
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async () => {
        creates++;
        throw new Error("must not write");
      },
    } as unknown as HasnaStorageClient;

    try {
      await expect(new ApiStore(client).sendMessage({
        from: "alice",
        to: "bob",
        content: "must not send",
        attachments: [{ name: "handoff.bundle", source_path: source }],
      })).rejects.toThrow("Archive and compressed attachment types are not supported securely");
      expect(creates).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an unsupported attachment before starting an HTTP write", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversations-api-attachment-invalid-"));
    const source = join(root, "payload.exe");
    writeFileSync(source, "synthetic unsupported payload\n");
    let creates = 0;
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async () => {
        creates++;
        throw new Error("must not write");
      },
    } as unknown as HasnaStorageClient;

    try {
      await expect(new ApiStore(client).sendMessage({
        from: "alice",
        to: "bob",
        content: "must not send",
        attachments: [{ name: "payload.exe", source_path: source }],
      })).rejects.toThrow("Unsupported attachment type");
      expect(creates).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** A client that records every `create` body and echoes it back as the row. */
  function capturingClient(): { client: HasnaStorageClient; sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_resource: string, body: Record<string, unknown>) => {
        sent.push(body);
        // Echo the request back as the stored row, the way the real server does.
        return {
          message: {
            id: 1,
            ...body,
            from_agent: body.from,
            to_agent: body.to,
            metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          },
        };
      },
    } as unknown as HasnaStorageClient;
    return { client, sent };
  }

  test("forwards reply_to to the API so the reply is threaded server-side", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);
    const parentUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    await store.sendMessage({
      from: "bob",
      to: "incidents",
      content: "on it",
      channel: "incidents",
      reply_to: 602449,
      reply_to_uuid: parentUuid,
    });

    expect(sent).toHaveLength(1);
    // The exact assertion the defect failed: reply_to never reached the body.
    expect(sent[0]).toHaveProperty("reply_to", 602449);
    expect(sent[0]).toHaveProperty("reply_to_uuid", parentUuid);
  });

  test("forwards metadata for direct and channel sends and parses the stored value", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);
    const metadata = { goal_id: "goal-metadata-roundtrip", receipt: { kind: "coordination" } };

    const direct = await store.sendMessage({
      from: "alice",
      to: "bob",
      content: "direct metadata",
      metadata,
    });
    const channel = await store.sendMessage({
      from: "alice",
      to: "work-status",
      channel: "work-status",
      content: "channel metadata",
      metadata,
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]).toHaveProperty("metadata", metadata);
    expect(sent[1]).toHaveProperty("metadata", metadata);
    expect(direct.metadata).toEqual(metadata);
    expect(channel.metadata).toEqual(metadata);
  });

  test("forwards message context fields exactly and omits them when not supplied", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);
    const context = {
      working_dir: "/synthetic/context-positive",
      repository: "hasna/conversations-context-positive",
      branch: "fix/context-positive",
    };

    const positive = await store.sendMessage({
      from: "alice",
      to: "bob",
      content: "context positive",
      ...context,
    });
    const negative = await store.sendMessage({
      from: "alice",
      to: "bob",
      content: "context omitted",
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject(context);
    expect(positive).toMatchObject(context);
    expect({
      working_dir: sent[1].working_dir,
      repository: sent[1].repository,
      branch: sent[1].branch,
    }).toEqual({
      working_dir: undefined,
      repository: undefined,
      branch: undefined,
    });
    expect({
      working_dir: negative.working_dir ?? null,
      repository: negative.repository ?? null,
      branch: negative.branch ?? null,
    }).toEqual({
      working_dir: null,
      repository: null,
      branch: null,
    });
  });

  test("omits reply_to for a non-reply send (must not thread everything)", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);

    await store.sendMessage({ from: "bob", to: "incidents", content: "root post", channel: "incidents" });

    expect(sent).toHaveLength(1);
    expect(sent[0].reply_to).toBeUndefined();
  });

  test("the returned message carries reply_to back to the caller", async () => {
    // The CLI now fails closed when the stored row's reply_to does not match the
    // requested parent, so the parsed response must surface the field.
    const { client } = capturingClient();
    const store = new ApiStore(client);

    const msg = await store.sendMessage({
      from: "bob",
      to: "incidents",
      content: "on it",
      channel: "incidents",
      reply_to: 42,
      reply_to_uuid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    });
    expect(msg.reply_to).toBe(42);
  });

  test("refuses numeric-only reply identity before any request is sent", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);

    await expect(store.sendMessage({
      from: "bob",
      to: "incidents",
      content: "unsafe numeric only",
      channel: "incidents",
      reply_to: 42,
    })).rejects.toThrow("reply_to requires reply_to_uuid");
    expect(sent).toHaveLength(0);
  });

  test("reads back by caller-bound UUID when the create response names a different row", async () => {
    const exactUuid = "cccccccc-dddd-4eee-8fff-000000000000";
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async (path: string) => path === `/messages/by-uuid/${exactUuid}`
          ? {
              message: {
                id: 649560,
                uuid: exactUuid,
                session_id: "channel:git-publishing",
                from_agent: "agent-chief-finance",
                to_agent: "git-publishing",
                channel: "git-publishing",
                content: "exact row",
              },
            }
          : null,
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 649564,
          uuid: "dddddddd-eeee-4fff-8000-111111111111",
          session_id: "wrong-session",
          from_agent: "other",
          to_agent: "other",
          channel: null,
          content: "wrong row",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const message = await store.sendMessage({
      uuid: exactUuid,
      from: "agent-chief-finance",
      to: "git-publishing",
      channel: "git-publishing",
      content: "exact row",
    });

    expect(message).toMatchObject({ id: 649560, uuid: exactUuid, channel: "git-publishing" });
    // The by-uuid read-back is the AUTHORITATIVE path, so it must carry no
    // degradation marker. `toMatchObject` above is a subset match and would
    // silently accept a stray one, which would corrupt the exact signal the
    // field exists to provide — and `sendMessage` has two authoritative returns
    // (create-echo and this read-back), of which the other one was already
    // covered and this one was not.
    expect((message as unknown as { write_confirmation?: unknown }).write_confirmation).toBeUndefined();
  });

  // ── regression: rc=1 on a write that fully succeeded (todos d8f3f963) ────────
  //
  // MEASURED against the live deployed server, conversations.hasna.xyz, on
  // 2026-08-05. Both halves of the contract the caller-bound UUID check assumes
  // are absent there, and BOTH are needed to reproduce:
  //
  //   1. `POST /v1/messages` does not accept a caller `uuid`. Its published
  //      request schema lists exactly from,to,content,channel,project_id,
  //      session_id,priority,blocking — no uuid. The server drops ours, mints
  //      its own, stores THE CORRECT ROW, and returns it:
  //          sent     uuid=0c57bc9f-480f-4e74-b263-49c2e8850a0a
  //          returned uuid=d9ad71d6-1417-414b-b4d3-bc35b789f5a6   HTTP 201
  //          returned content/channel/from == exactly what was submitted
  //   2. `GET /v1/messages/by-uuid/{uuid}` does not exist. It falls through to
  //      the generic unknown-route handler, which is a 404 INDISTINGUISHABLE BY
  //      STATUS from a real row-miss:
  //          /v1/messages/by-uuid/<valid-uuid>  -> 404 {"error":"Not found"}
  //          /v1/definitely-not-a-route         -> 404 {"error":"Not found"}
  //          /v1/messages/999999999             -> 404 {"error":"Message not found"}
  //      (the third is the positive control: a route that DOES exist answers a
  //      miss with its own body, so the discriminator can fire both ways.)
  //
  // `getMessageByUuid` swallows any 404 as `null`, so a missing ROUTE became
  // "the row is not there", and sendMessage reported a successful write as a
  // failure. The exit code is not the harm: the caller's natural response to
  // "your write may not have landed" is to re-send, on a shared channel, where
  // the retry reports the same false failure.
  test("reports the row it wrote when the server drops the caller UUID and has no by-uuid route", async () => {
    const submittedUuid = "aaaaaaaa-1111-4222-8333-444444444444";
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        // The by-uuid route does not exist on this server: every read 404s.
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      // Server-minted UUID, but unmistakably the row we asked to be written.
      //
      // NOTE THE RECIPIENT. On a channel send the server rewrites `to_agent` to
      // the CHANNEL, discarding whatever the caller passed — measured:
      //     sent     to="silvanus" channel="scratch-d8f3f963"
      //     returned to_agent="scratch-d8f3f963"
      // and `src/cli/commands/messaging.ts` passes `to: to || from`, i.e. the
      // SENDER. An earlier draft of this fixture used to == channel, which made
      // it agree with a check that rejected every real channel send; the live
      // CLI caught it, this fixture did not. It now mirrors the real call.
      create: async () => ({
        message: {
          id: "668569",
          uuid: "bbbbbbbb-5555-4666-8777-888888888888",
          session_id: "channel:git-publishing",
          from_agent: "silvanus",
          to_agent: "git-publishing",
          channel: "git-publishing",
          content: "[PUBLISH INTENT] @hasna/conversations",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const message = await store.sendMessage({
      uuid: submittedUuid,
      from: "silvanus",
      to: "silvanus", // what the CLI actually sends for a channel post
      channel: "git-publishing",
      content: "[PUBLISH INTENT] @hasna/conversations",
    });

    // The caller must get a usable numeric id back — withholding it is what
    // breaks the citation convention that keeps corroboration from collapsing
    // to a single source.
    expect(message).toMatchObject({ id: 668569, channel: "git-publishing" });
  });

  // The other side of the same guarantee. A fix that merely stopped throwing
  // would pass the test above and destroy the property #77 bought, so this
  // pins the case that MUST still fail loudly: the response describes some
  // OTHER row (the mention-notification DM the UUID binding exists to catch),
  // and our row cannot be read back.
  test("still refuses when the response names a different row and the write cannot be confirmed", async () => {
    const submittedUuid = "cccccccc-9999-4aaa-8bbb-cccccccccccc";
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 999001,
          uuid: "dddddddd-eeee-4fff-8000-111111111111",
          session_id: "dm:someone-else",
          from_agent: "silvanus",
          to_agent: "someone-else",
          channel: null,
          content: "you were mentioned",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    await expect(store.sendMessage({
      uuid: submittedUuid,
      from: "silvanus",
      to: "silvanus",
      channel: "git-publishing",
      content: "[PUBLISH INTENT] @hasna/conversations",
    })).rejects.toThrow(/could not be read back/);
  });

  // The DM half of the same guard. With no channel to compare, the recipient is
  // the only thing separating our row from a notification DM fanned out to a
  // mentioned third party, so it must still be enforced there.
  test("still refuses a DM whose response names a different recipient and cannot be read back", async () => {
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 999002,
          uuid: "eeeeeeee-1111-4222-8333-444444444444",
          session_id: "dm:someone-else",
          from_agent: "silvanus",
          to_agent: "someone-else",
          channel: null,
          content: "you were mentioned",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    await expect(store.sendMessage({
      uuid: "ffffffff-1111-4222-8333-444444444444",
      from: "silvanus",
      to: "manius",
      content: "a direct message",
    })).rejects.toThrow(/could not be read back/);
  });

  // And the DM ACCEPT path, so the DM branch is exercised in both directions
  // rather than only proved capable of refusing.
  test("reports a DM the server echoed back under a server-minted UUID", async () => {
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 668600,
          uuid: "11111111-2222-4333-8444-555555555555",
          session_id: "dm:manius",
          from_agent: "silvanus",
          to_agent: "manius",
          channel: null,
          content: "a direct message",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const message = await store.sendMessage({
      uuid: "ffffffff-9999-4aaa-8bbb-cccccccccccc",
      from: "silvanus",
      to: "manius",
      content: "a direct message",
    });

    expect(message).toMatchObject({ id: 668600, to_agent: "manius" });
  });

  // Returning the id silently would leave a caller unable to tell an
  // authoritative UUID read-back from the weaker routing check, and would leave
  // nothing to mark this path dead once the server serves /messages/by-uuid.
  test("discloses that confirmation degraded to the routing echo", async () => {
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 668700,
          uuid: "22222222-3333-4444-8555-666666666666",
          session_id: "channel:git-publishing",
          from_agent: "silvanus",
          to_agent: "git-publishing",
          channel: "git-publishing",
          content: "degraded confirmation",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const message = (await store.sendMessage({
      uuid: "33333333-4444-4555-8666-777777777777",
      from: "silvanus",
      to: "silvanus",
      channel: "git-publishing",
      content: "degraded confirmation",
    })) as unknown as { id: number; write_confirmation?: { degraded: boolean; method: string } };

    expect(message.id).toBe(668700);
    expect(message.write_confirmation).toMatchObject({ degraded: true, method: "routing-echo" });
  });

  // The other side: an AUTHORITATIVE confirmation must carry no degradation
  // marker, or the flag means nothing and cannot signal the path is dead.
  test("does NOT mark confirmation degraded when the server honours the caller UUID", async () => {
    const boundUuid = "44444444-5555-4666-8777-888888888888";
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_r: string, body: Record<string, unknown>) => ({
        message: {
          id: 668701,
          uuid: body.uuid,
          session_id: "channel:git-publishing",
          from_agent: "silvanus",
          to_agent: "git-publishing",
          channel: "git-publishing",
          content: "authoritative",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    const message = (await store.sendMessage({
      uuid: boundUuid,
      from: "silvanus",
      to: "silvanus",
      channel: "git-publishing",
      content: "authoritative",
    })) as unknown as { id: number; write_confirmation?: unknown };

    expect(message.id).toBe(668701);
    expect(message.write_confirmation).toBeUndefined();
  });

  // A blank identity on either side must not satisfy an accept test. Without
  // the non-empty guard, `"" === ""` passes and the sender check asserts
  // nothing at all.
  test("refuses to accept an echo whose sender identity is blank on both sides", async () => {
    const notFound = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {
        get: async () => {
          throw notFound;
        },
      } as unknown as HasnaStorageClient["transport"],
      create: async () => ({
        message: {
          id: 668702,
          uuid: "55555555-6666-4777-8888-999999999999",
          session_id: "channel:git-publishing",
          from_agent: "",
          to_agent: "git-publishing",
          channel: "git-publishing",
          content: "blank sender",
        },
      }),
    } as unknown as HasnaStorageClient;
    const store = new ApiStore(client);

    await expect(store.sendMessage({
      uuid: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      from: "",
      to: "silvanus",
      channel: "git-publishing",
      content: "blank sender",
    })).rejects.toThrow(/could not be read back/);
  });

  // `messages.id`/`messages.reply_to` are Postgres BIGINT, and node-postgres
  // serializes int8 as a STRING. Measured against the live deployed server:
  // GET /v1/messages returns `"id": "603183"` — a string, not a number.
  //
  // The CLI's new fail-closed check compares STRICTLY (`msg.reply_to !== parentId`
  // in cli/commands/messaging.ts) against a `parseInt`-ed number, so it is only
  // correct because parseMessage coerces with `Number(row.reply_to)`
  // (lib/messages.ts:46). That coercion is now load-bearing for every cloud
  // reply: drop it and `"42" !== 42` makes the CLI reject its own successful
  // write on every threaded reply through the API.
  //
  // Nothing pinned that. Removing the coercion was measured to leave 178 tests
  // across messages/api-store/reply-threading/api green, because every fake
  // echoed reply_to as a number — unfaithful to the server in exactly the
  // dimension the new check depends on. This test closes that gap.
  test("coerces a bigint-string reply_to to a number (the live server sends a string)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_resource: string, body: Record<string, unknown>) => {
        sent.push(body);
        // Echo the row the way Postgres+node-postgres actually does: bigint
        // columns arrive as strings.
        return {
          message: {
            ...body,
            id: "603184",
            reply_to: String(body.reply_to),
            from_agent: body.from,
            to_agent: body.to,
          },
        };
      },
    } as unknown as HasnaStorageClient;

    const store = new ApiStore(client);
    const msg = await store.sendMessage({
      from: "bob",
      to: "incidents",
      content: "on it",
      channel: "incidents",
      reply_to: 602449,
      reply_to_uuid: "eeeeeeee-ffff-4000-8111-222222222222",
    });

    // Strictly a number, so the CLI's `!==` parent-link check passes.
    expect(msg.reply_to).toBe(602449);
    expect(typeof msg.reply_to).toBe("number");
    // The id travels the same bigint path and is compared numerically downstream.
    expect(msg.id).toBe(603184);
    expect(typeof msg.id).toBe("number");
  });
});

describe("ApiStore attachment retrieval", () => {
  const message = {
    id: 701,
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    session_id: "channel:handoffs",
    from_agent: "alice",
    to_agent: "handoffs",
    channel: "handoffs",
    project_id: null,
    content: "remote attachment",
    priority: "normal",
    working_dir: null,
    repository: null,
    branch: null,
    metadata: null,
    created_at: "2026-08-09T00:00:00.000Z",
    read_at: null,
    edited_at: null,
    pinned_at: null,
    blocking: false,
    attachments: [{
      name: "handoff.pdf",
      path: "/v1/messages/701/attachments/handoff.pdf",
      size: Buffer.byteLength("synthetic remote PDF\n"),
      mime_type: "application/pdf",
    }],
    reply_to: null,
  };

  test("decodes the app-owned base64 response into exact bytes", async () => {
    const requests: Array<{ path: string; query: unknown }> = [];
    const bytes = Buffer.from("synthetic remote PDF\n");
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async (resource: string, id: string) => {
        expect(resource).toBe("messages");
        expect(id).toBe("701");
        return { message };
      },
      transport: {
        baseUrl: "https://conversations.hasna.xyz/v1",
        get: async (path: string, options: { query?: unknown }) => {
          requests.push({ path, query: options.query });
          return {
            name: "handoff.pdf",
            mime_type: "application/pdf",
            size: bytes.length,
            content_base64: bytes.toString("base64"),
          };
        },
      },
    } as unknown as HasnaStorageClient;

    const result = await new ApiStore(client).getMessageAttachment(701, "handoff.pdf");

    expect(result).toMatchObject({
      message_id: 701,
      name: "handoff.pdf",
      mime_type: "application/pdf",
      size: bytes.length,
    });
    expect(Buffer.from(result.content)).toEqual(bytes);
    expect(requests).toEqual([{
      path: "/messages/701/attachments/handoff.pdf",
      query: { encoding: "base64" },
    }]);
  });

  test("maps a hosted permission denial to the actionable attachment error", async () => {
    const denied = Object.assign(new Error("Forbidden"), {
      name: "HasnaHttpError",
      status: 403,
    });
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async () => {
        throw denied;
      },
      transport: {} as unknown as HasnaStorageClient["transport"],
    } as unknown as HasnaStorageClient;

    await expect(
      new ApiStore(client).getMessageAttachment(701, "handoff.pdf"),
    ).rejects.toThrow(
      "Permission denied while reading attachment \"handoff.pdf\" from message #701. Check read permissions",
    );
  });
});

// Regression: ApiStore asked the server for `order=asc` whenever `latest` was
// unset, so `read --channel X --limit 40` against the hosted API selected the
// OLDEST 40 rows server-side. A client-side sort could never have fixed that —
// the newest rows never left the server. Measured on station01 against
// conversations.hasna.xyz with 0.5.9: `--limit 5` on #internal-ea returned ids
// 586455..586462 while `--since 6h` at the same moment reached id 607254.
describe("ApiStore.readMessages recency window", () => {
  /** A client that records the query of every GET and returns queued rows. */
  function queryCapturingClient(rows: Record<string, unknown>[]): {
    client: HasnaStorageClient;
    queries: Array<Record<string, unknown>>;
  } {
    const queries: Array<Record<string, unknown>> = [];
    const transport = {
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async (_path: string, opts?: { query?: Record<string, unknown> }) => {
        queries.push(opts?.query ?? {});
        return { messages: rows };
      },
      post: async () => ({}),
      patch: async () => ({}),
      del: async () => undefined,
    } as unknown as HasnaStorageClient["transport"];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport,
    } as unknown as HasnaStorageClient;
    return { client, queries };
  }

  function row(id: number, created_at: string) {
    return { id, from_agent: "a", to_agent: "internal-ea", channel: "internal-ea", content: `m${id}`, created_at };
  }

  test("a bare limit asks the server for order=desc (the newest N must leave the server)", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 40 });
    expect(queries).toHaveLength(1);
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(40);
  });

  test("newest-first server rows are handed back in chronological order", async () => {
    // The server answers order=desc, so rows arrive newest first.
    const { client } = queryCapturingClient([
      row(607254, "2026-07-30T12:03:00.000Z"),
      row(607250, "2026-07-30T12:02:00.000Z"),
      row(607248, "2026-07-30T12:01:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 3 });
    expect(msgs.map((m) => m.id)).toEqual([607248, 607250, 607254]);
  });

  test("explicit order=asc is still forwarded verbatim (forward paging preserved)", async () => {
    const { client, queries } = queryCapturingClient([row(1, "2026-07-30T10:00:00.000Z"), row(2, "2026-07-30T10:01:00.000Z")]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 2, order: "asc" });
    expect(queries[0].order).toBe("asc");
    expect(msgs.map((m) => m.id)).toEqual([1, 2]);
  });

  // `since` is a TIME FILTER, not a cursor, and it carried the same defect with
  // its cap defaulted rather than passed. Measured on #incidents at 0.5.11:
  // `--since 3h` returned the 20 OLDEST rows of a 110-row window (max id 607270)
  // while the true newest in that window was 608099.
  test("a since filter asks for order=desc — the newest of the window must leave the server", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "2026-07-30T06:00:00.000Z", limit: 40 });
    expect(queries[0].order).toBe("desc");
  });

  test("a since filter with no limit still asks for desc, at the shared default cap", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "3h" });
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(DEFAULT_READ_LIMIT);
  });

  // A since_id IS a cursor — "the next page after this exact id". A newest-N
  // window there would let a catch-up walk skip the middle of a backlog.
  test("a since_id cursor keeps order=asc so forward paging cannot skip a backlog", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since_id: 606944, limit: 40 });
    expect(queries[0].order).toBe("asc");
  });

  test("a relative since ('6h') is normalized before it reaches the server", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "6h", limit: 40 });
    expect(queries[0].order).toBe("desc");
    // The server receives an absolute timestamp, not the duration string.
    expect(String(queries[0].since)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── the server's 500-row ceiling, which is a SEPARATE defect from ordering ──
  //
  // `/messages` clamps a read at 500 rows (`clampLimit(raw, def, max = 500)` in
  // src/server/api.ts) and `--limit` cannot raise it: measured at 0.5.11,
  // `since 3h --limit 1000` and `--limit 5000` both returned exactly 500. That
  // ceiling is server-side and this client PR does not move it.
  //
  // What the ordering fix changes is WHICH 500. Asking `asc` meant "the oldest
  // 500 of the window", so a window over 500 could never reach the newest at any
  // limit — `since 3h --limit 5000` stopped at id 607592 while the true newest
  // was 608121. Asking `desc` means the clamped page is the NEWEST 500, so the
  // newest message is always in reach and the ceiling only bounds how far BACK
  // one page goes. These two tests pin that distinction.
  test("a limit above the server ceiling is still requested as desc, so the clamped page is the newest", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "incidents", since: "3h", limit: 5000 });
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(5000);
  });

  test("a server page clamped to its ceiling still carries the newest message", async () => {
    const CEILING = 500;
    // What the server sends back for order=desc when the window exceeds 500:
    // the newest CEILING rows, newest first.
    const newestFirst = Array.from({ length: CEILING }, (_, i) => row(608121 - i, new Date(Date.UTC(2026, 6, 30, 12, 0, 0) - i * 1000).toISOString()));
    const { client } = queryCapturingClient(newestFirst);
    const msgs = await new ApiStore(client).readMessages({ channel: "incidents", since: "3h", limit: 5000 });
    expect(msgs).toHaveLength(CEILING);
    // Chronological, and the newest id in the window is present — the exact
    // assertion that failed before the fix.
    expect(msgs[msgs.length - 1].id).toBe(608121);
    expect(msgs[0].id).toBe(608121 - (CEILING - 1));
  });

  test("newest-first server rows under a since filter come back chronologically", async () => {
    const { client } = queryCapturingClient([
      row(608099, "2026-07-30T12:05:00.000Z"),
      row(607270, "2026-07-30T12:02:00.000Z"),
      row(607110, "2026-07-30T12:01:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "incidents", since: "3h" });
    expect(msgs.map((m) => m.id)).toEqual([607110, 607270, 608099]);
  });

  test("latest:N still asks for desc and stays newest-first", async () => {
    const { client, queries } = queryCapturingClient([
      row(607254, "2026-07-30T12:03:00.000Z"),
      row(607250, "2026-07-30T12:02:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", latest: 2 });
    expect(queries[0].order).toBe("desc");
    expect(msgs.map((m) => m.id)).toEqual([607254, 607250]);
  });

  test("latest:N still overrides explicit order=asc on the wire", async () => {
    const { client, queries } = queryCapturingClient([
      row(607254, "2026-07-30T12:03:00.000Z"),
      row(607250, "2026-07-30T12:02:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", latest: 2, order: "asc" });
    expect(queries[0].order).toBe("desc");
    expect(msgs.map((m) => m.id)).toEqual([607254, 607250]);
  });
});

// `doctor` prints ApiStore.health()'s message to stdout, and `baseUrl` comes
// from `toV1BaseUrl`, which is a STRIP-LIST: it clears `search` and `hash` and
// re-emits everything else, so embedded basic-auth userinfo survives into it
// (measured — `https://u:pw@host` becomes `https://u:pw@host/v1`). The fix
// redacts at the output site with an allow-list. Values below are invented.
describe("ApiStore health does not print credentials embedded in the base URL", () => {
  const LEAKY_BASE = "https://SYNTHUSER:SYNTHPASS@conv.example.invalid:8443/v1";
  const MARKERS = ["SYNTHUSER", "SYNTHPASS"];

  function clientWithBase(baseUrl: string, reject: boolean): HasnaStorageClient {
    const err = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
    const respond = reject
      ? async () => {
          throw err;
        }
      : async () => ({ count: 1 });
    const transport = { baseUrl, get: respond, post: respond, patch: respond, del: respond } as unknown as HasnaStorageClient["transport"];
    return { name: "conversations", baseUrl, transport } as unknown as HasnaStorageClient;
  }

  test("the OK path names only scheme, host and port", async () => {
    // Positive control on the same predicate: the markers ARE in the base URL.
    expect(MARKERS.filter((m) => LEAKY_BASE.includes(m))).toEqual(MARKERS);

    const checks = await new ApiStore(clientWithBase(LEAKY_BASE, false)).health();
    const text = JSON.stringify(checks);
    expect(MARKERS.filter((m) => text.includes(m))).toEqual([]);
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain("https://conv.example.invalid:8443");
  });

  test("the failure path names only scheme, host and port", async () => {
    const checks = await new ApiStore(clientWithBase(LEAKY_BASE, true)).health();
    const text = JSON.stringify(checks);
    expect(MARKERS.filter((m) => text.includes(m))).toEqual([]);
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain("https://conv.example.invalid:8443");
  });

  test("a clean base URL is still reported, so the check stays useful", async () => {
    const checks = await new ApiStore(clientWithBase("https://conversations.hasna.xyz/v1", false)).health();
    expect(checks[0]?.message).toContain("https://conversations.hasna.xyz");
  });
});

/**
 * G2 — `prune()` must not turn a present-but-empty filter into an absent one.
 *
 * prune() dropped every `""`, which is indistinguishable from the caller never
 * having supplied the key. On a collection read that is a WIDENING: a caller
 * whose `channel` variable resolved to empty asked the remote API for one
 * channel and had the request rewritten into "every channel". The remote then
 * answers a broader question, correctly, for a request it never received.
 *
 * A blank filter is a caller bug, so it fails here — before the request leaves.
 */
describe("G2 ApiStore rejects present-but-empty collection filters", () => {
  function recordingClient(): { client: HasnaStorageClient; calls: Array<{ path: string; query: unknown }> } {
    const calls: Array<{ path: string; query: unknown }> = [];
    const record = async (path: string, opts?: { query?: unknown }) => {
      calls.push({ path, query: opts?.query });
      return { messages: [], count: 0, limit: 20, cursor: 0, next_cursor: null, has_more: false, skipped_count: 0, byte_length: 0, max_bytes: 16384, timeout_ms: 3000, notifications: [] };
    };
    const transport = {
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: record,
      post: record,
      patch: record,
      del: record,
    } as unknown as HasnaStorageClient["transport"];
    return {
      calls,
      client: {
        name: "conversations",
        baseUrl: "https://conversations.hasna.xyz/v1",
        transport,
      } as unknown as HasnaStorageClient,
    };
  }

  test("a blank channel filter fails before any request is issued", async () => {
    const { client, calls } = recordingClient();
    const store = new ApiStore(client);
    await expect(store.readMessages({ channel: "" } as never)).rejects.toThrow(/channel/);
    expect(calls).toHaveLength(0);
  });

  test("a blank notification channel filter fails before any request is issued", async () => {
    const { client, calls } = recordingClient();
    const store = new ApiStore(client);
    await expect(store.readChannelNotifications({ agent: "watcher", channel: "" } as never)).rejects.toThrow(/channel/);
    expect(calls).toHaveLength(0);
  });

  // The instrument can pass: absent stays absent, and a real value is sent.
  test("an absent filter is still simply omitted", async () => {
    const { client, calls } = recordingClient();
    const store = new ApiStore(client);
    await store.readChannelNotifications({ agent: "watcher" });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].query as Record<string, unknown>)).not.toContain("channel");
  });

  test("a supplied filter is forwarded", async () => {
    const { client, calls } = recordingClient();
    const store = new ApiStore(client);
    await store.readChannelNotifications({ agent: "watcher", channel: "ops" });
    expect((calls[0].query as Record<string, unknown>).channel).toBe("ops");
  });
});
