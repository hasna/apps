import { describe, expect, test } from "bun:test";
import { InstagramAdapter } from "./instagram";
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

const creds = { accessToken: "tok", igUserId: "ig123" };

describe("InstagramAdapter", () => {
  test("account.me reads id,username", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/ig123\?/, json: { id: "ig123", username: "ada" } }], calls);
    const adapter = new InstagramAdapter(creds, fetchImpl);
    const res = await adapter.accountMe();
    expect(res).toEqual({ id: "ig123", username: "ada", url: "https://www.instagram.com/ada/" });
  });

  test("post.create from imageUrl creates a container then publishes", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/ig123\/media$/, method: "POST", json: { id: "container-1" } },
        { match: /\/ig123\/media_publish$/, method: "POST", json: { id: "media-99" } },
      ],
      calls,
    );
    const adapter = new InstagramAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "a caption", imageUrl: "https://img.example/a.jpg" });
    expect(res).toEqual({ id: "media-99", url: "https://www.instagram.com/p/media-99/" });
    // container call carries image_url + caption
    const containerCall = calls.find((c) => /\/media$/.test(c.url))!;
    const cbody = new URLSearchParams(containerCall.body as string);
    expect(cbody.get("image_url")).toBe("https://img.example/a.jpg");
    expect(cbody.get("caption")).toBe("a caption");
    // publish call carries creation_id from the container
    const pubCall = calls.find((c) => /media_publish/.test(c.url))!;
    expect(new URLSearchParams(pubCall.body as string).get("creation_id")).toBe("container-1");
  });

  test("post.create with a prebuilt mediaIds container skips container creation", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /media_publish$/, method: "POST", json: { id: "media-7" } }],
      calls,
    );
    const adapter = new InstagramAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "x", mediaIds: ["prebuilt-c"] });
    expect(res.id).toBe("media-7");
    expect(calls.some((c) => /\/media$/.test(c.url))).toBe(false);
    expect(new URLSearchParams(calls[0].body as string).get("creation_id")).toBe("prebuilt-c");
  });

  test("post.create without any image is not supported (Instagram requires media)", async () => {
    const adapter = new InstagramAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "text only" })).rejects.toBeInstanceOf(
      ConnectorOperationNotSupported,
    );
    await expect(adapter.postCreate({ text: "text only" })).rejects.toThrow(/image or video/);
  });

  test("media.upload builds a container from a sourceUrl", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/ig123\/media$/, method: "POST", json: { id: "c-55" } }], calls);
    const adapter = new InstagramAdapter(creds, fetchImpl);
    const res = await adapter.mediaUpload({
      dataBase64: "",
      mimeType: "image/jpeg",
      sourceUrl: "https://img.example/b.jpg",
      caption: "cap",
    } as never);
    expect(res).toEqual({ mediaId: "c-55" });
  });

  test("media.upload without sourceUrl is not supported", async () => {
    const adapter = new InstagramAdapter(creds, mockFetch([], []));
    await expect(
      adapter.mediaUpload({ dataBase64: "abc", mimeType: "image/png" }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("post.delete is not supported", async () => {
    const adapter = new InstagramAdapter(creds, mockFetch([], []));
    await expect(adapter.postDelete({ id: "x" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("mentions.list is not supported", async () => {
    const adapter = new InstagramAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post reads insights metrics", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        {
          match: /\/media-99\/insights/,
          json: {
            data: [
              { name: "impressions", values: [{ value: 100 }] },
              { name: "reach", values: [{ value: 80 }] },
              { name: "likes", values: [{ value: 9 }] },
            ],
          },
        },
      ],
      calls,
    );
    const adapter = new InstagramAdapter(creds, fetchImpl);
    const res = await adapter.analyticsPost({ id: "media-99" });
    expect(res).toEqual({ metrics: { impressions: 100, reach: 80, likes: 9 } });
  });

  test("requires accessToken and igUserId", () => {
    expect(() => new InstagramAdapter({ accessToken: "", igUserId: "1" })).toThrow(/accessToken/);
    expect(() => new InstagramAdapter({ accessToken: "t", igUserId: "" })).toThrow(/igUserId/);
  });
});
