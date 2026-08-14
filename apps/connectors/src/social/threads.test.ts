import { describe, expect, test } from "bun:test";
import { ThreadsAdapter } from "./threads";
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

const creds = { accessToken: "tok", userId: "u1" };

describe("ThreadsAdapter", () => {
  test("account.me reads id,username", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/u1\?/, json: { id: "u1", username: "ada" } }], calls);
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.accountMe();
    expect(res).toEqual({ id: "u1", username: "ada", url: "https://www.threads.net/@ada" });
  });

  test("post.create builds a TEXT container then publishes", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/u1\/threads$/, method: "POST", json: { id: "c-1" } },
        { match: /\/u1\/threads_publish$/, method: "POST", json: { id: "t-100" } },
      ],
      calls,
    );
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "hello threads" });
    expect(res.id).toBe("t-100");
    const containerCall = calls.find((c) => /\/threads$/.test(c.url))!;
    const cbody = new URLSearchParams(containerCall.body as string);
    expect(cbody.get("media_type")).toBe("TEXT");
    expect(cbody.get("text")).toBe("hello threads");
    expect(cbody.get("reply_to_id")).toBeNull();
    const pubCall = calls.find((c) => /threads_publish/.test(c.url))!;
    expect(new URLSearchParams(pubCall.body as string).get("creation_id")).toBe("c-1");
  });

  test("post.create with replyToId sets reply_to_id (reply chaining)", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/threads$/, method: "POST", json: { id: "c-2" } },
        { match: /threads_publish$/, method: "POST", json: { id: "t-200" } },
      ],
      calls,
    );
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "a reply", replyToId: "t-100" });
    expect(res.id).toBe("t-200");
    const containerCall = calls.find((c) => /\/threads$/.test(c.url))!;
    expect(new URLSearchParams(containerCall.body as string).get("reply_to_id")).toBe("t-100");
  });

  test("post.create builds url from username when account.me was called", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/u1\?/, json: { id: "u1", username: "ada" } },
        { match: /\/threads$/, method: "POST", json: { id: "c-3" } },
        { match: /threads_publish$/, method: "POST", json: { id: "t-300" } },
      ],
      calls,
    );
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    await adapter.accountMe();
    const res = await adapter.postCreate({ text: "hi" });
    expect(res.url).toBe("https://www.threads.net/@ada/post/t-300");
  });

  test("post.delete issues DELETE on the thread id", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/t-100/, method: "DELETE", json: { success: true } }], calls);
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    expect(await adapter.postDelete({ id: "t-100" })).toEqual({ id: "t-100", deleted: true });
    expect(calls[0].method).toBe("DELETE");
  });

  test("media.upload builds an IMAGE container from sourceUrl", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/u1\/threads$/, method: "POST", json: { id: "c-img" } }], calls);
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.mediaUpload({
      dataBase64: "",
      mimeType: "image/png",
      sourceUrl: "https://img.example/a.png",
    } as never);
    expect(res).toEqual({ mediaId: "c-img" });
    expect(new URLSearchParams(calls[0].body as string).get("media_type")).toBe("IMAGE");
  });

  test("media.upload without a url is not supported", async () => {
    const adapter = new ThreadsAdapter(creds, mockFetch([], []));
    await expect(
      adapter.mediaUpload({ dataBase64: "abc", mimeType: "image/png" }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("mentions.list maps the mentions edge", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/u1\/mentions/,
          json: { data: [{ id: "m1", text: "hey @ada", username: "bob", timestamp: "2026-01-01T00:00:00Z" }] },
        },
      ],
      calls,
    );
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.mentionsList();
    expect(res.items).toEqual([
      { id: "m1", text: "hey @ada", authorHandle: "bob", createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  test("mentions.list throws not-supported when the edge errors", async () => {
    const fetchImpl = mockFetch([{ match: /mentions/, status: 400, json: { error: { message: "nope" } } }], []);
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post reads insights metrics", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/t-100\/insights/,
          json: {
            data: [
              { name: "views", values: [{ value: 500 }] },
              { name: "likes", values: [{ value: 20 }] },
            ],
          },
        },
      ],
      calls,
    );
    const adapter = new ThreadsAdapter(creds, fetchImpl);
    const res = await adapter.analyticsPost({ id: "t-100" });
    expect(res).toEqual({ metrics: { views: 500, likes: 20 } });
  });

  test("requires accessToken and userId", () => {
    expect(() => new ThreadsAdapter({ accessToken: "", userId: "1" })).toThrow(/accessToken/);
    expect(() => new ThreadsAdapter({ accessToken: "t", userId: "" })).toThrow(/userId/);
  });
});
