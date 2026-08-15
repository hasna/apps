import { describe, expect, test } from "bun:test";
import { RedditAdapter } from "./reddit";
import { ConnectorOperationNotSupported } from "./errors";
import type { FetchLike } from "./http";

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
}

function mockFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown }>,
  calls: MockCall[],
): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    const status = route?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      async text() {
        return route?.json !== undefined ? JSON.stringify(route.json) : "";
      },
    };
  };
}

const creds = { accessToken: "tok" };

describe("RedditAdapter", () => {
  test("account.me hits /api/v1/me", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/api\/v1\/me$/, json: { id: "u1", name: "spez" } }], calls);
    const res = await new RedditAdapter(creds, fetchImpl).accountMe();
    expect(res).toEqual({
      id: "u1",
      username: "spez",
      displayName: "spez",
      url: "https://www.reddit.com/user/spez",
    });
  });

  test("post.create submits with title + subreddit (self)", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/api\/submit$/, method: "POST", json: { json: { errors: [], data: { id: "abc", name: "t3_abc", url: "https://reddit.com/x" } } } }],
      calls,
    );
    const res = await new RedditAdapter(creds, fetchImpl).postCreate({
      text: "body text",
      title: "My Title",
      subreddit: "test",
    });
    expect(res).toEqual({ id: "abc", url: "https://reddit.com/x" });
    const body = new URLSearchParams(calls[0].body as string);
    expect(body.get("sr")).toBe("test");
    expect(body.get("title")).toBe("My Title");
    expect(body.get("kind")).toBe("self");
    expect(body.get("text")).toBe("body text");
  });

  test("post.create requires title", async () => {
    const adapter = new RedditAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "t", subreddit: "test" } as never)).rejects.toThrow(/title/);
  });

  test("post.create requires subreddit", async () => {
    const adapter = new RedditAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "t", title: "T" } as never)).rejects.toThrow(/subreddit/);
  });

  test("post.create kind=link requires url", async () => {
    const adapter = new RedditAdapter(creds, mockFetch([], []));
    await expect(
      adapter.postCreate({ text: "", title: "T", subreddit: "s", kind: "link" } as never),
    ).rejects.toThrow(/url/);
  });

  test("post.create surfaces api errors", async () => {
    const fetchImpl = mockFetch(
      [{ match: /\/api\/submit$/, method: "POST", json: { json: { errors: [["RATELIMIT", "slow down"]] } } }],
      [],
    );
    const adapter = new RedditAdapter(creds, fetchImpl);
    await expect(adapter.postCreate({ text: "t", title: "T", subreddit: "s" })).rejects.toThrow(/submit failed/);
  });

  test("post.delete posts fullname to /api/del", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/api\/del$/, method: "POST", json: {} }], calls);
    expect(await new RedditAdapter(creds, fetchImpl).postDelete({ id: "abc" })).toEqual({ id: "abc", deleted: true });
    expect(new URLSearchParams(calls[0].body as string).get("id")).toBe("t3_abc");
  });

  test("media.upload is not supported", async () => {
    const adapter = new RedditAdapter(creds, mockFetch([], []));
    await expect(adapter.mediaUpload({ dataBase64: "x", mimeType: "image/png" })).rejects.toBeInstanceOf(
      ConnectorOperationNotSupported,
    );
  });

  test("mentions.list reads the inbox", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/message\/inbox/,
          json: {
            data: {
              children: [
                { data: { id: "c1", name: "t1_c1", body: "hey @me", author: "bob", author_fullname: "t2_bob", created_utc: 1700000000 } },
              ],
            },
          },
        },
      ],
      calls,
    );
    const res = await new RedditAdapter(creds, fetchImpl).mentionsList({ limit: 10 });
    expect(res.items[0]).toMatchObject({ id: "t1_c1", text: "hey @me", authorHandle: "bob", authorId: "t2_bob" });
  });

  test("analytics.post returns post metrics", async () => {
    const fetchImpl = mockFetch(
      [{ match: /\/api\/info/, json: { data: { children: [{ data: { ups: 10, downs: 2, score: 8, num_comments: 3, upvote_ratio: 0.83 } }] } } }],
      [],
    );
    const res = await new RedditAdapter(creds, fetchImpl).analyticsPost({ id: "abc" });
    expect(res.metrics).toEqual({ ups: 10, downs: 2, score: 8, numComments: 3, upvoteRatio: 0.83 });
  });

  test("requires accessToken", () => {
    expect(() => new RedditAdapter({ accessToken: "" })).toThrow();
  });
});
