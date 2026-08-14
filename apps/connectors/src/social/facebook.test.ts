import { describe, expect, test } from "bun:test";
import { FacebookAdapter } from "./facebook";
import { ConnectorOperationNotSupported } from "./errors";
import type { FetchLike } from "./http";

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
}

function mockFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown; ok?: boolean }>,
  calls: MockCall[],
): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    const status = route?.status ?? 200;
    const ok = route?.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      statusText: "",
      async text() {
        return route?.json !== undefined ? JSON.stringify(route.json) : "";
      },
    };
  };
}

const creds = { accessToken: "page-tok", pageId: "9988" };

describe("FacebookAdapter", () => {
  test("account.me reads id,name,link", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/9988\?/, json: { id: "9988", name: "My Page", link: "https://facebook.com/mypage" } }],
      calls,
    );
    const adapter = new FacebookAdapter(creds, fetchImpl);
    const res = await adapter.accountMe();
    expect(res).toEqual({ id: "9988", displayName: "My Page", url: "https://facebook.com/mypage" });
    expect(calls[0].url).toContain("fields=id%2Cname%2Clink");
    expect(calls[0].url).toContain("access_token=page-tok");
  });

  test("post.create posts to the page feed with message and returns a facebook url", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/9988\/feed$/, method: "POST", json: { id: "9988_777" } }],
      calls,
    );
    const adapter = new FacebookAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "hello fb" });
    expect(res).toEqual({ id: "9988_777", url: "https://facebook.com/9988_777" });
    const params = new URLSearchParams(calls[0].body as string);
    expect(params.get("message")).toBe("hello fb");
    expect(params.get("access_token")).toBe("page-tok");
  });

  test("post.create attaches a link when provided", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /feed$/, method: "POST", json: { id: "p1" } }], calls);
    const adapter = new FacebookAdapter(creds, fetchImpl);
    await adapter.postCreate({ text: "with link", link: "https://example.com/article" });
    const params = new URLSearchParams(calls[0].body as string);
    expect(params.get("link")).toBe("https://example.com/article");
  });

  test("post.create attaches uploaded media via attached_media", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /feed$/, method: "POST", json: { id: "p2" } }], calls);
    const adapter = new FacebookAdapter(creds, fetchImpl);
    await adapter.postCreate({ text: "photo post", mediaIds: ["111", "222"] });
    const params = new URLSearchParams(calls[0].body as string);
    expect(JSON.parse(params.get("attached_media")!)).toEqual([
      { media_fbid: "111" },
      { media_fbid: "222" },
    ]);
  });

  test("post.create prefers post_id over id when present", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /feed$/, method: "POST", json: { id: "X", post_id: "9988_555" } }], calls);
    const adapter = new FacebookAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "hi" });
    expect(res.id).toBe("9988_555");
  });

  test("post.delete issues DELETE on the object id", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/9988_777/, method: "DELETE", json: { success: true } }], calls);
    const adapter = new FacebookAdapter(creds, fetchImpl);
    expect(await adapter.postDelete({ id: "9988_777" })).toEqual({ id: "9988_777", deleted: true });
    expect(calls[0].method).toBe("DELETE");
  });

  test("media.upload posts an unpublished photo and returns the photo id", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/9988\/photos$/, method: "POST", json: { id: "photo-42" } }], calls);
    const adapter = new FacebookAdapter(creds, fetchImpl);
    const res = await adapter.mediaUpload({
      dataBase64: Buffer.from("img").toString("base64"),
      mimeType: "image/png",
    });
    expect(res).toEqual({ mediaId: "photo-42" });
    expect(calls[0].body).toBeInstanceOf(FormData);
    expect((calls[0].body as FormData).get("published")).toBe("false");
  });

  test("analytics.post returns likes/comments/shares counts", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/9988_777\?/,
          json: {
            likes: { summary: { total_count: 12 } },
            comments: { summary: { total_count: 3 } },
            shares: { count: 5 },
          },
        },
      ],
      calls,
    );
    const adapter = new FacebookAdapter(creds, fetchImpl);
    const res = await adapter.analyticsPost({ id: "9988_777" });
    expect(res).toEqual({ metrics: { likes: 12, comments: 3, shares: 5 } });
  });

  test("mentions.list is not supported", async () => {
    const adapter = new FacebookAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("requires accessToken and pageId", () => {
    expect(() => new FacebookAdapter({ accessToken: "", pageId: "1" })).toThrow(/accessToken/);
    expect(() => new FacebookAdapter({ accessToken: "t", pageId: "" })).toThrow(/pageId/);
  });
});
