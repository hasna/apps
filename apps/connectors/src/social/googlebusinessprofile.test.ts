import { describe, expect, test } from "bun:test";
import { GoogleBusinessProfileAdapter } from "./googlebusinessprofile";
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

describe("GoogleBusinessProfileAdapter", () => {
  test("account.me lists accounts", async () => {
    const fetchImpl = mockFetch(
      [{ match: /\/v1\/accounts$/, json: { accounts: [{ name: "accounts/123", accountName: "My Biz" }] } }],
      [],
    );
    const res = await new GoogleBusinessProfileAdapter(creds, fetchImpl).accountMe();
    expect(res).toMatchObject({ id: "123", username: "My Biz", displayName: "My Biz" });
  });

  test("post.create posts a localPost (ids from input)", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /localPosts$/, method: "POST", json: { name: "accounts/1/locations/2/localPosts/9", searchUrl: "https://g/x" } }],
      calls,
    );
    const res = await new GoogleBusinessProfileAdapter(creds, fetchImpl).postCreate({
      text: "Open house!",
      accountId: "1",
      locationId: "2",
      cta: { actionType: "LEARN_MORE", url: "https://site" },
    });
    expect(res).toEqual({ id: "accounts/1/locations/2/localPosts/9", url: "https://g/x" });
    const body = JSON.parse(calls[0].body as string);
    expect(body.summary).toBe("Open house!");
    expect(body.callToAction).toEqual({ actionType: "LEARN_MORE", url: "https://site" });
    expect(calls[0].url).toContain("accounts/1/locations/2/localPosts");
  });

  test("post.create uses ids from credentials", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /localPosts$/, method: "POST", json: { name: "n" } }], calls);
    await new GoogleBusinessProfileAdapter({ accessToken: "t", accountId: "aa", locationId: "bb" }, fetchImpl).postCreate({
      text: "hi",
    });
    expect(calls[0].url).toContain("accounts/aa/locations/bb/localPosts");
  });

  test("post.create requires accountId and locationId", async () => {
    const adapter = new GoogleBusinessProfileAdapter(creds, mockFetch([], []));
    await expect(adapter.postCreate({ text: "hi" })).rejects.toThrow(/accountId/);
    await expect(adapter.postCreate({ text: "hi", accountId: "1" })).rejects.toThrow(/locationId/);
  });

  test("post.delete deletes the localPost by resource name", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /localPosts\/9$/, method: "DELETE", json: {} }], calls);
    const res = await new GoogleBusinessProfileAdapter(creds, fetchImpl).postDelete({
      id: "accounts/1/locations/2/localPosts/9",
    });
    expect(res).toEqual({ id: "accounts/1/locations/2/localPosts/9", deleted: true });
    expect(calls[0].method).toBe("DELETE");
  });

  test("media.upload creates a media item from a sourceUrl", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /\/media$/, method: "POST", json: { name: "accounts/1/locations/2/media/m" } }], calls);
    const res = await new GoogleBusinessProfileAdapter({ accessToken: "t", accountId: "1", locationId: "2" }, fetchImpl).mediaUpload(
      { dataBase64: "", mimeType: "image/png", sourceUrl: "https://img/x.png" } as never,
    );
    expect(res).toEqual({ mediaId: "accounts/1/locations/2/media/m" });
  });

  test("media.upload without sourceUrl is not supported", async () => {
    const adapter = new GoogleBusinessProfileAdapter({ accessToken: "t", accountId: "1", locationId: "2" }, mockFetch([], []));
    await expect(adapter.mediaUpload({ dataBase64: "x", mimeType: "image/png" })).rejects.toBeInstanceOf(
      ConnectorOperationNotSupported,
    );
  });

  test("mentions.list is not supported", async () => {
    const adapter = new GoogleBusinessProfileAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post is not supported", async () => {
    const adapter = new GoogleBusinessProfileAdapter(creds, mockFetch([], []));
    await expect(adapter.analyticsPost({ id: "x" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("requires accessToken", () => {
    expect(() => new GoogleBusinessProfileAdapter({ accessToken: "" })).toThrow();
  });
});
