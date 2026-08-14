import { describe, expect, test } from "bun:test";
import { YouTubeAdapter } from "./youtube";
import { ConnectorOperationNotSupported } from "./errors";
import type { FetchLike } from "./http";

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
}

function mockFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown; headers?: Record<string, string> }>,
  calls: MockCall[],
): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    const status = route?.status ?? 200;
    const hdrs = route?.headers ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      headers: { get: (n: string) => hdrs[n.toLowerCase()] ?? hdrs[n] ?? null },
      async text() {
        return route?.json !== undefined ? JSON.stringify(route.json) : "";
      },
    };
  };
}

const creds = { accessToken: "tok" };

describe("YouTubeAdapter", () => {
  test("account.me reads the authenticated channel", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/channels/, json: { items: [{ id: "ch1", snippet: { title: "My Channel", customUrl: "@mine" } }] } }],
      calls,
    );
    const res = await new YouTubeAdapter(creds, fetchImpl).accountMe();
    expect(res).toEqual({
      id: "ch1",
      username: "@mine",
      displayName: "My Channel",
      url: "https://www.youtube.com/channel/ch1",
    });
  });

  test("post.create without a video throws not-supported", async () => {
    const adapter = new YouTubeAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "no video" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("post.create updates title/description on an uploaded video", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/videos/, method: "PUT", json: {} }], calls);
    const res = await new YouTubeAdapter(creds, fetchImpl).postCreate({
      text: "My Vid",
      mediaIds: ["vid42"],
    });
    expect(res).toEqual({ id: "vid42", url: "https://www.youtube.com/watch?v=vid42" });
    const body = JSON.parse(calls[0].body as string);
    expect(body.id).toBe("vid42");
    expect(body.snippet.title).toBe("My Vid");
  });

  test("media.upload does resumable init + PUT, returns video id", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /upload\/youtube\/v3\/videos/, method: "POST", headers: { location: "https://up.yt/session" }, json: {} },
        { match: /up\.yt\/session/, method: "PUT", json: { id: "vidNew" } },
      ],
      calls,
    );
    const res = await new YouTubeAdapter(creds, fetchImpl).mediaUpload({
      dataBase64: Buffer.from("mp4").toString("base64"),
      mimeType: "video/mp4",
    });
    expect(res).toEqual({ mediaId: "vidNew" });
  });

  test("post.delete deletes the video", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/videos/, method: "DELETE", json: {} }], calls);
    expect(await new YouTubeAdapter(creds, fetchImpl).postDelete({ id: "v1" })).toEqual({ id: "v1", deleted: true });
  });

  test("analytics.post returns video statistics", async () => {
    const fetchImpl = mockFetch(
      [{ match: /\/videos/, json: { items: [{ statistics: { viewCount: "100", likeCount: "9", commentCount: "2", favoriteCount: "0" } }] } }],
      [],
    );
    const res = await new YouTubeAdapter(creds, fetchImpl).analyticsPost({ id: "v1" });
    expect(res.metrics).toEqual({ viewCount: 100, likeCount: 9, commentCount: 2, favoriteCount: 0 });
  });

  test("mentions.list is not supported", async () => {
    const adapter = new YouTubeAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("requires accessToken", () => {
    expect(() => new YouTubeAdapter({ accessToken: "" })).toThrow();
  });
});
