import { describe, expect, test } from "bun:test";
import {
  ConversationsClient,
  type MessagePreviewPage,
  type MessageResponse,
} from "./index";

const previewPage = {
  messages: [{
    id: 41,
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
});
