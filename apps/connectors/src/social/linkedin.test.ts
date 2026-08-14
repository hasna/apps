import { describe, expect, test } from "bun:test";
import { LinkedInAdapter } from "./linkedin";
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

describe("LinkedInAdapter", () => {
  test("account.me hits /v2/me and builds urn", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [{ match: /\/v2\/me$/, json: { id: "abc", localizedFirstName: "Ada", localizedLastName: "Lovelace", vanityName: "ada" } }],
      calls,
    );
    const adapter = new LinkedInAdapter(creds, fetchImpl);
    const res = await adapter.accountMe();
    expect(res).toEqual({
      id: "abc",
      username: "ada",
      displayName: "Ada Lovelace",
      url: "https://www.linkedin.com/in/ada",
    });
  });

  test("post.create posts a UGC share with commentary=text", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/v2\/me$/, json: { id: "abc" } },
        { match: /\/v2\/ugcPosts$/, method: "POST", json: { id: "urn:li:share:123" } },
      ],
      calls,
    );
    const adapter = new LinkedInAdapter(creds, fetchImpl);
    const res = await adapter.postCreate({ text: "hello world" });
    expect(res.id).toBe("urn:li:share:123");
    const ugcCall = calls.find((c) => /ugcPosts/.test(c.url))!;
    const body = JSON.parse(ugcCall.body as string);
    expect(body.author).toBe("urn:li:person:abc");
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text).toBe("hello world");
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE");
  });

  test("post.create uses provided authorUrn without calling /me", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /ugcPosts/, method: "POST", json: { id: "urn:li:share:9" } }], calls);
    const adapter = new LinkedInAdapter({ accessToken: "t", authorUrn: "urn:li:person:zzz" }, fetchImpl);
    await adapter.postCreate({ text: "hi" });
    expect(calls.some((c) => /\/v2\/me$/.test(c.url))).toBe(false);
    const body = JSON.parse(calls[0].body as string);
    expect(body.author).toBe("urn:li:person:zzz");
  });

  test("post.delete issues DELETE on ugcPosts", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch([{ match: /ugcPosts/, method: "DELETE", json: {} }], calls);
    const adapter = new LinkedInAdapter(creds, fetchImpl);
    expect(await adapter.postDelete({ id: "urn:li:share:1" })).toEqual({ id: "urn:li:share:1", deleted: true });
    expect(calls[0].method).toBe("DELETE");
  });

  test("media.upload registers then PUTs the binary, returns asset urn", async () => {
    const calls: MockCall[] = [];
    const fetchImpl = mockFetch(
      [
        { match: /\/v2\/me$/, json: { id: "abc" } },
        {
          match: /registerUpload/,
          method: "POST",
          json: {
            value: {
              asset: "urn:li:digitalmediaAsset:xyz",
              uploadMechanism: {
                "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://up.example/put" },
              },
            },
          },
        },
        { match: /up\.example\/put/, method: "PUT", json: {} },
      ],
      calls,
    );
    const adapter = new LinkedInAdapter(creds, fetchImpl);
    const res = await adapter.mediaUpload({ dataBase64: Buffer.from("img").toString("base64"), mimeType: "image/png" });
    expect(res).toEqual({ mediaId: "urn:li:digitalmediaAsset:xyz" });
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  test("mentions.list is not supported", async () => {
    const adapter = new LinkedInAdapter(creds, mockFetch([], []));
    await expect(adapter.mentionsList()).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("analytics.post is not supported", async () => {
    const adapter = new LinkedInAdapter(creds, mockFetch([], []));
    await expect(adapter.analyticsPost({ id: "x" })).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("requires accessToken", () => {
    expect(() => new LinkedInAdapter({ accessToken: "" })).toThrow();
  });
});
