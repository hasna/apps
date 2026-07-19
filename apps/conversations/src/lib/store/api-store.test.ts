import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { ApiStore } from "./api-store.js";
import type { HasnaStorageClient } from "../contracts-client/storage.js";
import type { ChannelNotificationPage, MessageExportArtifact, MessagePreview, MessagePreviewPage } from "../../types.js";

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

function capturingClient(response: unknown): {
  client: HasnaStorageClient;
  calls: Array<{ resource: string; body: unknown; options: unknown }>;
} {
  const calls: Array<{ resource: string; body: unknown; options: unknown }> = [];
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    get: async (resource: string, options: unknown) => {
      calls.push({ resource, body: undefined, options });
      return response;
    },
    post: async (resource: string, body: unknown, options: unknown) => {
      calls.push({ resource, body, options });
      return response;
    },
    patch: async () => response,
    del: async () => undefined,
  } as unknown as HasnaStorageClient["transport"];
  const client = {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
    create: async (resource: string, body: unknown, options: unknown) => {
      calls.push({ resource, body, options });
      return response;
    },
  } as unknown as HasnaStorageClient;
  return { client, calls };
}

function previewPage(preview: Partial<MessagePreview> = {}): MessagePreviewPage {
  const message: MessagePreview = {
    id: 7,
    session_id: "session-1",
    from_agent: "alice",
    to_agent: "bob",
    channel: null,
    project_id: null,
    priority: "normal",
    working_dir: null,
    repository: null,
    branch: null,
    created_at: "2026-07-19T00:00:00.000Z",
    edited_at: null,
    pinned_at: null,
    unread: true,
    blocking: false,
    reply_to: null,
    attachment_count: 0,
    has_attachments: false,
    has_metadata: false,
    preview: "bounded preview",
    preview_bytes: 15,
    content_bytes: 15,
    truncated: false,
    redacted: false,
    ...preview,
  };
  return {
    messages: [message],
    count: 1,
    limit: 20,
    cursor: 0,
    next_cursor: null,
    has_more: false,
    skipped_count: 0,
    byte_length: 512,
    max_bytes: 65_536,
    timeout_ms: 3_000,
    compact: true,
    detail_path: "messages/{id}",
  };
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

describe("ApiStore message transport", () => {
  test("uses dedicated preview routes for mention identity and pin ordering", async () => {
    const mentions = capturingClient(previewPage({ mention_id: 41 }));
    const mentionRows = await new ApiStore(mentions.client).getMessagesForAgent("alice", {
      unread_only: true,
      limit: 5,
    });
    expect(mentions.calls[0].resource).toBe("/messages/for-agent");
    expect(mentions.calls[0].options).toMatchObject({
      query: { agent: "alice", unread_only: true, limit: 5 },
      retry: false,
    });
    expect(mentionRows[0].mention_id).toBe(41);

    const pinned = capturingClient(previewPage({ pinned_at: "2026-07-19T00:00:01.000Z" }));
    await new ApiStore(pinned.client).getPinnedMessages({ session_id: "session-1", offset: 2, limit: 3 });
    expect(pinned.calls[0].resource).toBe("/messages/pinned");
    expect(pinned.calls[0].options).toMatchObject({
      query: { session_id: "session-1", offset: 2, limit: 3 },
      retry: false,
    });
  });

  test("posts bounded artifact export options without requesting inline bodies", async () => {
    const artifact = {
      artifact_id: "00000000-0000-4000-8000-000000000001",
      filename: "message-export.json",
      path: null,
      download_path: "/v1/messages/exports/00000000-0000-4000-8000-000000000001",
      sha256: "a".repeat(64),
      format: "json",
      detail: "preview",
      count: 1,
      has_more: false,
      skipped_count: 0,
      byte_length: 512,
      max_bytes: 4096,
      timeout_ms: 1000,
      created_at: "2026-07-19T00:00:00.000Z",
    } satisfies MessageExportArtifact;
    const { client, calls } = capturingClient({ artifact });
    const result = await new ApiStore(client).exportMessages({
      channel: "engineering",
      detail: "preview",
      limit: 10,
      max_bytes: 4096,
      preview_bytes: 128,
      timeout_ms: 1000,
    });

    expect(calls).toEqual([{
      resource: "/messages/exports",
      body: {
        channel: "engineering",
        detail: "preview",
        limit: 10,
        max_bytes: 4096,
        preview_bytes: 128,
        timeout_ms: 1000,
      },
      options: undefined,
    }]);
    expect(result).toEqual(artifact);
  });

  test("forwards notification cursor, byte, preview, timeout, and mark options", async () => {
    const page = {
      notifications: [], count: 0, limit: 10, cursor: 20, next_cursor: null, has_more: false,
      skipped_count: 0, byte_length: 256, max_bytes: 4096, timeout_ms: 1000, marked_read: 0,
      compact: true, detail_path: "messages/{id}",
    } satisfies ChannelNotificationPage;
    const { client, calls } = capturingClient(page);
    const result = await new ApiStore(client).readChannelNotifications({
      agent: "alice",
      channel: "engineering",
      limit: 10,
      cursor: 20,
      max_bytes: 4096,
      preview_bytes: 128,
      timeout_ms: 1000,
      mark_read: true,
    });

    expect(result).toEqual(page);
    expect(calls[0].resource).toBe("/channel-notifications/inbox");
    expect(calls[0].options).toEqual({
      query: {
        agent: "alice",
        channel: "engineering",
        limit: 10,
        cursor: 20,
        max_bytes: 4096,
        preview_bytes: 128,
        timeout_ms: 1000,
        mark_read: true,
      },
      timeoutMs: 1000,
      retry: false,
    });
  });

  test("forwards reply correlation, metadata, and source context to cloud create", async () => {
    const { client, calls } = capturingClient({
      message: {
        id: 2,
        uuid: "reply-2",
        session_id: "channel:incidents",
        from_agent: "friday",
        to_agent: "incidents",
        channel: "incidents",
        project_id: "engineering",
        content: "projection display",
        priority: "high",
        blocking: true,
        reply_to: 1,
        metadata: JSON.stringify({ display: { severity: "sev1" } }),
      },
    });
    const store = new ApiStore(client);

    const message = await store.sendMessage({
      from: "friday",
      to: "incidents",
      channel: "incidents",
      project_id: "engineering",
      content: "projection display",
      priority: "high",
      blocking: true,
      reply_to: 1,
      metadata: { display: { severity: "sev1" } },
      working_dir: "/worktree",
      repository: "hasna/conversations",
      branch: "fix/incident-projection",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].resource).toBe("messages");
    expect(calls[0].body).toEqual({
      from: "friday",
      to: "incidents",
      content: "projection display",
      channel: "incidents",
      project_id: "engineering",
      session_id: undefined,
      priority: "high",
      blocking: true,
      reply_to: 1,
      metadata: { display: { severity: "sev1" } },
      working_dir: "/worktree",
      repository: "hasna/conversations",
      branch: "fix/incident-projection",
      attachments: undefined,
    });
    expect(message.reply_to).toBe(1);
    expect(message.metadata).toEqual({ display: { severity: "sev1" } });
  });

  test("posts the exact canonical Todos event only to the dedicated projector route", async () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../../fixtures/todos-incident-projection-v1.json", import.meta.url), "utf8"),
    );
    const { client, calls } = capturingClient({ projection: {
      event_id: fixture.event_id,
      projection_key: fixture.projection_key,
      authority_id: fixture.authority_id,
      incident_id: fixture.incident_id,
      transition_id: fixture.transition_id,
      incident_version: fixture.incident_version,
      message_id: 42,
      replayed: false,
    } });
    const store = new ApiStore(client);
    const projection = await store.appendIncidentProjection(fixture);
    expect(calls).toEqual([{ resource: "/incident-projections", body: fixture, options: undefined }]);
    expect(projection.event_id).toBe(fixture.event_id);
    expect(projection.message_id).toBe(42);
  });
});
