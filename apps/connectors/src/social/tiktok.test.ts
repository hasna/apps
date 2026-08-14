import { describe, expect, test } from "bun:test";
import { TikTokAdapter } from "./tiktok";
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

const creds = { accessToken: "tok" };

describe("TikTokAdapter", () => {
  test("account.me hits user/info", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /user\/info/, json: { data: { user: { open_id: "oid", display_name: "Creator", profile_deep_link: "https://tt/@c" } } } }],
      calls,
    );
    const res = await new TikTokAdapter(creds, fetchImpl).accountMe();
    expect(res).toEqual({ id: "oid", username: "Creator", displayName: "Creator", url: "https://tt/@c" });
  });

  test("post.create without a video throws not-supported", async () => {
    const adapter = new TikTokAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "caption only" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("post.create with a video media id publishes", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /publish\/video\/init/, method: "POST", json: { data: { publish_id: "pub_1" } } }],
      calls,
    );
    const res = await new TikTokAdapter(creds, fetchImpl).postCreate({ text: "hi", mediaIds: ["vid_1"] });
    expect(res).toEqual({ id: "pub_1" });
    const body = JSON.parse(calls[0].body as string);
    expect(body.source_info.video_id).toBe("vid_1");
    expect(body.post_info.title).toBe("hi");
  });

  test("media.upload inits then PUTs the video bytes", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /inbox\/video\/init/, method: "POST", json: { data: { upload_url: "https://up.tt/put", publish_id: "pub_x" } } },
        { match: /up\.tt\/put/, method: "PUT", json: {} },
      ],
      calls,
    );
    const res = await new TikTokAdapter(creds, fetchImpl).mediaUpload({
      dataBase64: Buffer.from("video-bytes").toString("base64"),
      mimeType: "video/mp4",
    });
    expect(res).toEqual({ mediaId: "pub_x" });
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  test("post.delete is not supported", async () => {
    const adapter = new TikTokAdapter(creds, mockFetch([], []));
    await expect(adapter.postDelete({ id: "x" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("mentions.list is not supported", async () => {
    const adapter = new TikTokAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post is not supported", async () => {
    const adapter = new TikTokAdapter(creds, mockFetch([], []));
    await expect(adapter.analyticsPost({ id: "x" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("requires accessToken", () => {
    expect(() => new TikTokAdapter({ accessToken: "" })).toThrow();
  });
});
