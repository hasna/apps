import { afterEach, describe, expect, test } from "bun:test";
import { Bluesky, parseAtUri } from "./index";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    recorded.push({ url, method: init?.method ?? "GET", body: init?.body });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Bluesky AT Protocol transport", () => {
  test("parseAtUri splits repo/collection/rkey", () => {
    expect(parseAtUri("at://did:plc:abc/app.bsky.feed.post/xyz")).toEqual({
      repo: "did:plc:abc",
      collection: "app.bsky.feed.post",
      rkey: "xyz",
    });
  });

  test("me() creates a session via com.atproto.server.createSession", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("createSession")) return { accessJwt: "a", refreshJwt: "r", did: "did:plc:me", handle: "me.bsky.social" };
      return {};
    });
    const bsky = new Bluesky({ identifier: "me.bsky.social", appPassword: "pw" });
    const session = await bsky.me();
    expect(session.did).toBe("did:plc:me");
    expect(recorded[0].url).toContain("/xrpc/com.atproto.server.createSession");
    expect(recorded[0].method).toBe("POST");
  });

  test("createPost (top-level) calls createRecord with app.bsky.feed.post", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("createSession")) return { accessJwt: "a", refreshJwt: "r", did: "did:plc:me", handle: "me.bsky.social" };
      if (url.includes("createRecord")) return { uri: "at://did:plc:me/app.bsky.feed.post/new", cid: "cidnew" };
      return {};
    });
    const bsky = new Bluesky({ identifier: "me.bsky.social", appPassword: "pw" });
    const res = await bsky.createPost({ text: "hello", createdAt: "2026-01-01T00:00:00Z" });
    expect(res).toEqual({ uri: "at://did:plc:me/app.bsky.feed.post/new", cid: "cidnew" });
    const createCall = recorded.find((r) => r.url.includes("createRecord"))!;
    const body = JSON.parse(createCall.body as string);
    expect(body.collection).toBe("app.bsky.feed.post");
    expect(body.repo).toBe("did:plc:me");
    expect(body.record.text).toBe("hello");
    expect(body.record.reply).toBeUndefined();
  });

  test("createPost reply chains parent + thread root strong-refs", async () => {
    const parentUri = "at://did:plc:other/app.bsky.feed.post/parent";
    const rootRef = { uri: "at://did:plc:other/app.bsky.feed.post/root", cid: "rootcid" };
    const recorded = installFetch((url) => {
      if (url.includes("createSession")) return { accessJwt: "a", refreshJwt: "r", did: "did:plc:me", handle: "me.bsky.social" };
      if (url.includes("getPosts")) {
        return { posts: [{ uri: parentUri, cid: "parentcid", record: { reply: { root: rootRef } } }] };
      }
      if (url.includes("createRecord")) return { uri: "at://did:plc:me/app.bsky.feed.post/reply", cid: "replycid" };
      return {};
    });
    const bsky = new Bluesky({ identifier: "me.bsky.social", appPassword: "pw" });
    await bsky.createPost({ text: "reply", replyToUri: parentUri });

    const createCall = recorded.find((r) => r.url.includes("createRecord"))!;
    const body = JSON.parse(createCall.body as string);
    expect(body.record.reply.parent).toEqual({ uri: parentUri, cid: "parentcid" });
    expect(body.record.reply.root).toEqual(rootRef);
  });

  test("createPost reply uses parent as root for a top-level parent", async () => {
    const parentUri = "at://did:plc:other/app.bsky.feed.post/top";
    const recorded = installFetch((url) => {
      if (url.includes("createSession")) return { accessJwt: "a", refreshJwt: "r", did: "did:plc:me", handle: "me.bsky.social" };
      if (url.includes("getPosts")) return { posts: [{ uri: parentUri, cid: "topcid" }] };
      if (url.includes("createRecord")) return { uri: "at://did:plc:me/app.bsky.feed.post/reply", cid: "rc" };
      return {};
    });
    const bsky = new Bluesky({ identifier: "me.bsky.social", appPassword: "pw" });
    await bsky.createPost({ text: "reply", replyToUri: parentUri });
    const body = JSON.parse(recorded.find((r) => r.url.includes("createRecord"))!.body as string);
    expect(body.record.reply.parent).toEqual({ uri: parentUri, cid: "topcid" });
    expect(body.record.reply.root).toEqual({ uri: parentUri, cid: "topcid" });
  });

  test("deletePost parses the uri and calls deleteRecord", async () => {
    const recorded = installFetch((url) => {
      if (url.includes("createSession")) return { accessJwt: "a", refreshJwt: "r", did: "did:plc:me", handle: "me.bsky.social" };
      return {};
    });
    const bsky = new Bluesky({ identifier: "me.bsky.social", appPassword: "pw" });
    await bsky.deletePost("at://did:plc:me/app.bsky.feed.post/gone");
    const del = recorded.find((r) => r.url.includes("deleteRecord"))!;
    const body = JSON.parse(del.body as string);
    expect(body).toEqual({ repo: "did:plc:me", collection: "app.bsky.feed.post", rkey: "gone" });
  });

  test("requires identifier + appPassword", () => {
    expect(() => new Bluesky({ identifier: "", appPassword: "" })).toThrow();
  });
});
