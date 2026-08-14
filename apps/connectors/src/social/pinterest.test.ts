import { describe, expect, test } from "bun:test";
import { PinterestAdapter } from "./pinterest";
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

describe("PinterestAdapter", () => {
  test("account.me hits /v5/user_account", async () => {
    const fetchImpl = mockFetch([{ match: /user_account/, json: { username: "pinner" } }], []);
    const res = await new PinterestAdapter(creds, fetchImpl).accountMe();
    expect(res).toEqual({
      id: "pinner",
      username: "pinner",
      displayName: "pinner",
      url: "https://www.pinterest.com/pinner/",
    });
  });

  test("post.create with mediaId creates a pin (boardId from input)", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/v5\/pins$/, method: "POST", json: { id: "pin1" } }], calls);
    const res = await new PinterestAdapter(creds, fetchImpl).postCreate({
      text: "a description",
      boardId: "board123",
      mediaIds: ["media9"],
    });
    expect(res).toEqual({ id: "pin1", url: "https://www.pinterest.com/pin/pin1/" });
    const body = JSON.parse(calls[0].body as string);
    expect(body.board_id).toBe("board123");
    expect(body.media_source).toEqual({ source_type: "image_upload", media_id: "media9" });
  });

  test("post.create with imageUrl uses image_url source", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/v5\/pins$/, method: "POST", json: { id: "pin2" } }], calls);
    await new PinterestAdapter({ accessToken: "t", boardId: "b" }, fetchImpl).postCreate({
      text: "d",
      imageUrl: "https://img/x.png",
    });
    const body = JSON.parse(calls[0].body as string);
    expect(body.media_source).toEqual({ source_type: "image_url", url: "https://img/x.png" });
    expect(body.board_id).toBe("b");
  });

  test("post.create requires a boardId", async () => {
    const adapter = new PinterestAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "d", imageUrl: "https://i/x" })).rejects.toThrow(/boardId/);
  });

  test("post.create requires an image", async () => {
    const adapter = new PinterestAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "d", boardId: "b" })).rejects.toThrow(/image/);
  });

  test("post.delete deletes the pin", async () => {
    const fetchImpl = mockFetch([{ match: /\/v5\/pins\/pin1$/, method: "DELETE", json: {} }], []);
    expect(await new PinterestAdapter(creds, fetchImpl).postDelete({ id: "pin1" })).toEqual({
      id: "pin1",
      deleted: true,
    });
  });

  test("media.upload registers then POSTs the file, returns media_id", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/v5\/media$/, method: "POST", json: { media_id: "m_42", upload_url: "https://s3/up", upload_parameters: { key: "k" } } },
        { match: /s3\/up/, method: "POST", json: {} },
      ],
      calls,
    );
    const res = await new PinterestAdapter(creds, fetchImpl).mediaUpload({
      dataBase64: Buffer.from("png").toString("base64"),
      mimeType: "image/png",
    });
    expect(res).toEqual({ mediaId: "m_42" });
  });

  test("mentions.list is not supported", async () => {
    const adapter = new PinterestAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post returns pin metrics", async () => {
    const fetchImpl = mockFetch(
      [{ match: /analytics/, json: { all: { DAILY: { summary_metrics: { IMPRESSION: 50, SAVE: 3 } } } } }],
      [],
    );
    const res = await new PinterestAdapter(creds, fetchImpl).analyticsPost({ id: "pin1" });
    expect(res.metrics).toEqual({ IMPRESSION: 50, SAVE: 3 });
  });

  test("requires accessToken", () => {
    expect(() => new PinterestAdapter({ accessToken: "" })).toThrow();
  });
});
