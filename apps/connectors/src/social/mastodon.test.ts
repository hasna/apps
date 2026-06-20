import { describe, expect, test } from "bun:test";
import { MastodonAdapter, type FetchLike } from "./mastodon";

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
}

function mockFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; json: unknown }>,
  calls: MockCall[],
): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    const status = route?.status ?? 200;
    const json = route ? route.json : {};
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      async text() {
        return JSON.stringify(json);
      },
    };
  };
}

const creds = { accessToken: "tok", baseUrl: "https://mastodon.social/" };

describe("MastodonAdapter", () => {
  test("account.me hits verify_credentials", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /verify_credentials/, json: { id: "1", username: "alice", display_name: "Alice", url: "https://m/@alice" } }],
      calls,
    );
    const adapter = new MastodonAdapter(creds, fetchImpl);
    const res = await adapter.accountMe();
    expect(res).toEqual({ id: "1", username: "alice", displayName: "Alice", url: "https://m/@alice" });
    expect(calls[0].url).toBe("https://mastodon.social/api/v1/accounts/verify_credentials");
  });

  test("post.create maps replyToId -> in_reply_to_id and mediaIds -> media_ids", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/api\/v1\/statuses$/, method: "POST", json: { id: "s1", url: "https://m/@alice/s1" } }],
      calls,
    );
    const adapter = new MastodonAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "hi", replyToId: "s0", mediaIds: ["m1", "m2"] });
    expect(res).toEqual({ id: "s1", url: "https://m/@alice/s1" });
    expect(JSON.parse(calls[0].body as string)).toEqual({
      status: "hi",
      in_reply_to_id: "s0",
      media_ids: ["m1", "m2"],
    });
  });

  test("post.delete issues DELETE", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/statuses\/s1$/, method: "DELETE", json: {} }], calls);
    const adapter = new MastodonAdapter(creds, fetchImpl);
    expect(await adapter.postDelete({ id: "s1" })).toEqual({ id: "s1", deleted: true });
    expect(calls[0].method).toBe("DELETE");
  });

  test("mentions.list filters mention notifications and strips html", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/notifications/,
          json: [
            {
              type: "mention",
              status: {
                id: "s2",
                content: "<p>hello &amp; <a>@alice</a></p>",
                created_at: "2026-02-02",
                account: { id: "a9", acct: "bob@m.social" },
              },
            },
            { type: "favourite" },
          ],
        },
      ],
      calls,
    );
    const adapter = new MastodonAdapter(creds, fetchImpl);
    const res = await adapter.mentionsList({ limit: 5 });
    expect(res.items).toEqual([
      { id: "s2", text: "hello & @alice", authorId: "a9", authorHandle: "bob@m.social", createdAt: "2026-02-02" },
    ]);
  });

  test("analytics.post returns engagement counts", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/statuses\/s1$/, json: { reblogs_count: 3, favourites_count: 7, replies_count: 1 } }],
      calls,
    );
    const adapter = new MastodonAdapter(creds, fetchImpl);
    const res = await adapter.analyticsPost({ id: "s1" });
    expect(res).toEqual({ metrics: { reblogsCount: 3, favouritesCount: 7, repliesCount: 1 } });
  });

  test("requires accessToken and baseUrl", () => {
    expect(() => new MastodonAdapter({ accessToken: "", baseUrl: "" })).toThrow();
  });
});
