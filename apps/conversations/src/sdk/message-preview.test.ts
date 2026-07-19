import { describe, expect, test } from "bun:test";
import {
  ConversationsClient,
  type ChannelNotificationPage,
  type Message,
  type MessageExportArtifactResponse,
  type MessagePreview,
  type MessagePreviewPage,
  type MessageResponse,
} from "./index";
import { openapiSpec } from "../server/openapi";

const previewPage = {
  messages: [{
    id: 41,
    mention_id: 7,
    session_id: "channel:engineering",
    from_agent: "alice",
    to_agent: "engineering",
    channel: "engineering",
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
    preview: "bounded coordination update",
    preview_bytes: 27,
    content_bytes: 27,
    truncated: false,
    redacted: false,
  }],
  count: 1,
  limit: 20,
  cursor: 0,
  next_cursor: null,
  has_more: false,
  skipped_count: 0,
  byte_length: 512,
  max_bytes: 4096,
  timeout_ms: 1000,
  compact: true,
  detail_path: "messages/{id}",
} satisfies MessagePreviewPage;

describe("generated safe message-read client", () => {
  test("models mention identity on previews, not exact full messages", () => {
    expect(openapiSpec.components.schemas.MessagePreview.properties).toHaveProperty("mention_id");
    expect(openapiSpec.components.schemas.Message.properties).not.toHaveProperty("mention_id");
    expect(previewPage.messages[0].mention_id).toBe(7);
  });

  test("types list/blocker reads as preview pages and keeps exact get typed separately", async () => {
    const requests: string[] = [];
    const exact: MessageResponse = { message: { id: 41, content: "exact coordination update" } };
    const client = new ConversationsClient({
      baseUrl: "https://conversations.invalid",
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        const body = url.endsWith("/v1/messages/41") ? exact : previewPage;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    const listed: MessagePreviewPage = await client.listMessages({
      limit: 10,
      max_bytes: 4096,
      preview_bytes: 128,
      timeout_ms: 1000,
    });
    const blockers: MessagePreviewPage = await client.listUnreadBlockers({ agent: "alice", limit: 5 });
    const detail: MessageResponse = await client.getMessage(41);

    expect(listed.messages[0].preview).toContain("bounded");
    expect("content" in listed.messages[0]).toBe(false);
    expect(blockers.compact).toBe(true);
    expect(detail.message.content).toBe("exact coordination update");
    expect(requests[0]).toContain("max_bytes=4096");
    expect(requests[0]).toContain("preview_bytes=128");
    expect(requests[2]).toEndWith("/v1/messages/41");
  });

  test("types notification pages and artifact-only exports with caps", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const notifications: ChannelNotificationPage = {
      notifications: [{
        message_id: 41,
        channel: "engineering",
        from_agent: "alice",
        created_at: "2026-07-19T00:00:00.000Z",
        priority: "normal",
        preview: "bounded coordination update",
        unread: false,
        has_attachments: false,
      }],
      count: 1,
      limit: 10,
      cursor: 0,
      next_cursor: null,
      has_more: false,
      skipped_count: 0,
      byte_length: 512,
      max_bytes: 4096,
      timeout_ms: 1000,
      marked_read: 1,
      compact: true,
      detail_path: "messages/{id}",
    };
    const exported: MessageExportArtifactResponse = {
      artifact: {
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
      },
    };
    const client = new ConversationsClient({
      baseUrl: "https://conversations.invalid",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        const body = url.includes("channel-notifications") ? notifications : exported;
        return new Response(JSON.stringify(body), { status: url.includes("exports") ? 201 : 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });

    const page: ChannelNotificationPage = await client.readChannelNotifications({
      limit: 10,
      cursor: 0,
      max_bytes: 4096,
      preview_bytes: 128,
      timeout_ms: 1000,
      mark_read: true,
    });
    const artifact: MessageExportArtifactResponse = await client.createMessageExport({
      detail: "preview",
      limit: 10,
      max_bytes: 4096,
      preview_bytes: 128,
      timeout_ms: 1000,
    });

    expect(page.marked_read).toBe(1);
    expect(requests[0].url).toContain("cursor=0");
    expect(artifact.artifact.path).toBeNull();
    expect(requests[1].init?.method).toBe("POST");
    expect(String(requests[1].init?.body)).toContain('"detail":"preview"');
  });

  test("downloadMessageExport returns parsed JSON records or CSV text with matching types", async () => {
    const responses = [
      new Response(JSON.stringify(previewPage.messages), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("id,preview\n41,bounded coordination update", {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    ];
    const client = new ConversationsClient({
      baseUrl: "https://conversations.invalid",
      fetch: (async () => responses.shift()!) as unknown as typeof fetch,
    });

    const jsonArtifact: Array<MessagePreview | Message> | string = await client.downloadMessageExport(
      "00000000-0000-4000-8000-000000000001",
    );
    const csvArtifact: Array<MessagePreview | Message> | string = await client.downloadMessageExport(
      "00000000-0000-4000-8000-000000000002",
    );

    expect(Array.isArray(jsonArtifact)).toBe(true);
    expect((jsonArtifact as MessagePreview[])[0].preview).toContain("bounded");
    expect(csvArtifact).toBe("id,preview\n41,bounded coordination update");
  });
});
