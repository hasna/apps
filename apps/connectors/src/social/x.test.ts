import { describe, expect, test } from "bun:test";
import { XAdapter, type XTransport } from "./x";
import { ConnectorOperationNotSupported } from "./errors";

function mockX(overrides: Partial<XTransport> = {}, calls?: Record<string, unknown[]>): XTransport {
  const record = (name: string, ...args: unknown[]) => {
    if (calls) (calls[name] ??= []).push(args);
  };
  return {
    users: {
      async me() {
        record("me");
        return { data: { id: "u1", username: "alice", name: "Alice" } };
      },
    },
    tweets: {
      async create(opts) {
        record("create", opts);
        return { data: { id: "t100", text: opts.text } };
      },
      async delete(id) {
        record("delete", id);
        return { data: { deleted: true } };
      },
      async get(id) {
        record("get", id);
        return { data: { id, public_metrics: { like_count: 5, retweet_count: 2 } } };
      },
      async getUserMentions(userId) {
        record("getUserMentions", userId);
        return {
          data: [{ id: "m1", text: "hey @alice", author_id: "b2", created_at: "2026-01-01" }],
          includes: { users: [{ id: "b2", username: "bob" }] },
        };
      },
    },
    media: {
      async uploadBuffer(data, mime, opts) {
        record("uploadBuffer", data, mime, opts);
        return { media_id_string: "media-42" };
      },
    },
    ...overrides,
  } as XTransport;
}

describe("XAdapter", () => {
  test("account.me returns normalized identity with url", async () => {
    const adapter = new XAdapter(mockX());
    const res = await adapter.accountMe();
    expect(res).toEqual({ id: "u1", username: "alice", displayName: "Alice", url: "https://x.com/alice" });
  });

  test("post.create maps replyToId -> replyToTweetId and builds status url", async () => {
    const calls: Record<string, unknown[]> = {};
    const adapter = new XAdapter(mockX({}, calls));
    const res = await adapter.postCreate({ text: "hello", replyToId: "t9", mediaIds: ["media-1"] });
    expect(res).toEqual({ id: "t100", url: "https://x.com/alice/status/t100" });
    expect(calls.create[0]).toEqual([{ text: "hello", replyToTweetId: "t9", mediaIds: ["media-1"] }]);
  });

  test("post.delete returns deleted flag", async () => {
    const adapter = new XAdapter(mockX());
    expect(await adapter.postDelete({ id: "t100" })).toEqual({ id: "t100", deleted: true });
  });

  test("media.upload decodes base64 to a Buffer and calls uploadBuffer", async () => {
    const calls: Record<string, unknown[]> = {};
    const adapter = new XAdapter(mockX({}, calls));
    const dataBase64 = Buffer.from("PNGDATA").toString("base64");
    const res = await adapter.mediaUpload({ dataBase64, mimeType: "image/png", altText: "alt" });
    expect(res).toEqual({ mediaId: "media-42" });
    const [buf, mime, opts] = calls.uploadBuffer[0] as [Buffer, string, { altText?: string }];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("PNGDATA");
    expect(mime).toBe("image/png");
    expect(opts).toEqual({ altText: "alt" });
  });

  test("media.upload throws ConnectorOperationNotSupported without OAuth1 media transport", async () => {
    const adapter = new XAdapter(mockX({ media: undefined }));
    await expect(
      adapter.mediaUpload({ dataBase64: Buffer.from("x").toString("base64"), mimeType: "image/png" }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("mentions.list resolves author handle from includes", async () => {
    const adapter = new XAdapter(mockX());
    const res = await adapter.mentionsList({ limit: 10 });
    expect(res.items).toEqual([
      { id: "m1", text: "hey @alice", authorId: "b2", authorHandle: "bob", createdAt: "2026-01-01" },
    ]);
  });

  test("analytics.post returns public_metrics", async () => {
    const adapter = new XAdapter(mockX());
    const res = await adapter.analyticsPost({ id: "t100" });
    expect(res).toEqual({ metrics: { like_count: 5, retweet_count: 2 } });
  });

  test("fromCredentials requires apiKey + apiSecret", () => {
    expect(() => XAdapter.fromCredentials({ apiKey: "", apiSecret: "" } as never)).toThrow();
  });
});
