import { describe, expect, test } from "bun:test";
import { BlueskyAdapter, type BlueskyTransport } from "./bluesky";

function mockBsky(overrides: Partial<BlueskyTransport> = {}, calls?: Record<string, unknown[]>): BlueskyTransport {
  const record = (name: string, ...args: unknown[]) => {
    if (calls) (calls[name] ??= []).push(args);
  };
  return {
    async me() {
      record("me");
      return { did: "did:plc:alice", handle: "alice.bsky.social" };
    },
    async createPost(opts) {
      record("createPost", opts);
      return { uri: "at://did:plc:alice/app.bsky.feed.post/abc123", cid: "cid-new" };
    },
    async deletePost(uri) {
      record("deletePost", uri);
    },
    async uploadBlob(data, mime) {
      record("uploadBlob", data, mime);
      return { $type: "blob", ref: { $link: "blobcid" }, mimeType: mime, size: 7 };
    },
    async listNotifications() {
      record("listNotifications");
      return {
        notifications: [
          {
            uri: "at://did:plc:bob/app.bsky.feed.post/m1",
            reason: "mention",
            indexedAt: "2026-03-03",
            author: { did: "did:plc:bob", handle: "bob.bsky.social" },
            record: { text: "hi @alice", createdAt: "2026-03-03" },
          },
          { uri: "x", reason: "like" },
        ],
      };
    },
    async getPosts() {
      record("getPosts");
      return { posts: [{ uri: "at://did:plc:alice/app.bsky.feed.post/p1", likeCount: 4, repostCount: 1, replyCount: 2, quoteCount: 0 }] };
    },
    ...overrides,
  } as BlueskyTransport;
}

describe("BlueskyAdapter", () => {
  test("account.me returns did + handle", async () => {
    const adapter = new BlueskyAdapter(mockBsky());
    const res = await adapter.accountMe();
    expect(res).toEqual({
      id: "did:plc:alice",
      username: "alice.bsky.social",
      displayName: "alice.bsky.social",
      url: "https://bsky.app/profile/alice.bsky.social",
    });
  });

  test("post.create returns uri as id + a bsky.app url", async () => {
    const calls: Record<string, unknown[]> = {};
    const adapter = new BlueskyAdapter(mockBsky({}, calls));
    const res = await adapter.postCreate({ text: "hello world" });
    expect(res).toEqual({
      id: "at://did:plc:alice/app.bsky.feed.post/abc123",
      url: "https://bsky.app/profile/alice.bsky.social/post/abc123",
    });
    expect(calls.createPost[0]).toEqual([{ text: "hello world", replyToUri: undefined, embed: undefined }]);
  });

  test("post.create threads a reply via replyToUri", async () => {
    const calls: Record<string, unknown[]> = {};
    const adapter = new BlueskyAdapter(mockBsky({}, calls));
    await adapter.postCreate({ text: "reply!", replyToId: "at://did:plc:alice/app.bsky.feed.post/p1" });
    const arg = (calls.createPost[0] as [{ replyToUri?: string }])[0];
    expect(arg.replyToUri).toBe("at://did:plc:alice/app.bsky.feed.post/p1");
  });

  test("media.upload returns the blob ref encoded as mediaId", async () => {
    const adapter = new BlueskyAdapter(mockBsky());
    const dataBase64 = Buffer.from("IMG").toString("base64");
    const res = await adapter.mediaUpload({ dataBase64, mimeType: "image/jpeg" });
    expect(JSON.parse(res.mediaId)).toMatchObject({ $type: "blob" });
  });

  test("media.upload decodes base64 to a Buffer", async () => {
    const calls: Record<string, unknown[]> = {};
    const adapter = new BlueskyAdapter(mockBsky({}, calls));
    const dataBase64 = Buffer.from("IMG").toString("base64");
    await adapter.mediaUpload({ dataBase64, mimeType: "image/jpeg" });
    const [buf, mime] = calls.uploadBlob[0] as [Buffer, string];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("IMG");
    expect(mime).toBe("image/jpeg");
  });

  test("post.delete returns deleted true", async () => {
    const adapter = new BlueskyAdapter(mockBsky());
    expect(await adapter.postDelete({ id: "at://x/app.bsky.feed.post/z" })).toEqual({
      id: "at://x/app.bsky.feed.post/z",
      deleted: true,
    });
  });

  test("mentions.list filters mention/reply notifications", async () => {
    const adapter = new BlueskyAdapter(mockBsky());
    const res = await adapter.mentionsList();
    expect(res.items).toEqual([
      {
        id: "at://did:plc:bob/app.bsky.feed.post/m1",
        text: "hi @alice",
        authorId: "did:plc:bob",
        authorHandle: "bob.bsky.social",
        createdAt: "2026-03-03",
      },
    ]);
  });

  test("analytics.post returns aggregate metrics", async () => {
    const adapter = new BlueskyAdapter(mockBsky());
    const res = await adapter.analyticsPost({ id: "at://did:plc:alice/app.bsky.feed.post/p1" });
    expect(res).toEqual({ metrics: { likeCount: 4, repostCount: 1, replyCount: 2, quoteCount: 0 } });
  });

  test("fromCredentials requires identifier + appPassword", () => {
    expect(() => BlueskyAdapter.fromCredentials({ identifier: "", appPassword: "" } as never)).toThrow();
  });
});
