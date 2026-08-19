// Sol-guided coverage — Priority 2: transport client contract.
//
// Every test injects a fake fetch that records the Request it was handed, so no
// test can touch a real network. Each assertion is two-sided: the positive arm
// pins what the client MUST send, the negative arm pins what it MUST NOT.
import { describe, expect, test } from "bun:test";
import { createFeedbackClient, type FetchLike } from "./client.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: { url: string; init: RequestInit }, index: number) => Response | Promise<Response>): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return respond({ url, init: init ?? {} }, calls.length - 1);
  };
  return { fetch, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const INPUT = {
  appId: "app-a",
  message: "Export button throws on large orgs",
  kind: "bug" as const,
};

describe("FeedbackClient transport", () => {
  test("sends Authorization Bearer when a token is configured, and NEVER sends it without one", async () => {
    const withToken = fakeFetch(() => jsonResponse(201, { id: "fb-1" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", token: "tok-123", fetch: withToken.fetch });
    await client.submit(INPUT);
    expect(withToken.calls).toHaveLength(1);
    expect(withToken.calls[0]!.init.headers).toBeDefined();
    const headersWith = new Headers(withToken.calls[0]!.init.headers);
    expect(headersWith.get("authorization")).toBe("Bearer tok-123");

    const withoutToken = fakeFetch(() => jsonResponse(201, { id: "fb-2" }));
    const anonymous = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: withoutToken.fetch });
    await anonymous.submit(INPUT);
    const headersWithout = new Headers(withoutToken.calls[0]!.init.headers);
    expect(headersWithout.get("authorization")).toBeNull();
  });

  test("sets content-type application/json only when a body is present", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, []));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await client.list();
    expect(new Headers(recorder.calls[0]!.init.headers).get("content-type")).toBeNull();

    await client.submit(INPUT);
    expect(new Headers(recorder.calls[1]!.init.headers).get("content-type")).toBe("application/json");
  });

  test("surfaces the error field of a JSON error body", async () => {
    const recorder = fakeFetch(() => jsonResponse(400, { error: "appId: must not be blank" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await expect(client.submit(INPUT)).rejects.toThrow("appId: must not be blank");
  });

  test("falls back to statusText for a JSON body that carries no error field", async () => {
    const recorder = fakeFetch(() => new Response(JSON.stringify({ detail: "no error field" }), { status: 502, statusText: "Bad Gateway" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await expect(client.submit(INPUT)).rejects.toThrow("Bad Gateway");
  });

  test("a non-JSON error body on the JSON verbs rejects with a parse error — the statusText fallback is exportJsonl-only (measured contract)", async () => {
    const recorder = fakeFetch(() => new Response("<html>gateway error</html>", { status: 502 }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await expect(client.submit(INPUT)).rejects.toThrow();
  });

  test("exportJsonl returns the raw text on success and a JSON error message on failure", async () => {
    const ok = fakeFetch(() => new Response('{"id":"fb-1"}\n{"id":"fb-2"}\n', { status: 200 }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: ok.fetch });
    expect(await client.exportJsonl()).toBe('{"id":"fb-1"}\n{"id":"fb-2"}\n');

    const err = fakeFetch(() => jsonResponse(403, { error: "read access is disabled" }));
    const failing = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: err.fetch });
    await expect(failing.exportJsonl()).rejects.toThrow("read access is disabled");
  });

  test("exportJsonl falls back to statusText when a failing body is not JSON (the SyntaxError trap)", async () => {
    const recorder = fakeFetch(() => new Response("definitely not json", { status: 500, statusText: "Internal Server Error" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await expect(client.exportJsonl()).rejects.toThrow("Internal Server Error");
  });

  test("list serializes every query filter into the URL, and only the ones set", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, []));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com/", fetch: recorder.fetch });
    await client.list({ appId: "app-a", status: "triaged", tag: "export", search: "button", since: "2026-01-01", until: "2026-02-01", limit: 25 });
    const url = new URL(recorder.calls[0]!.url);
    expect(url.pathname).toBe("/v1/feedback");
    expect(url.searchParams.get("appId")).toBe("app-a");
    expect(url.searchParams.get("status")).toBe("triaged");
    expect(url.searchParams.get("tag")).toBe("export");
    expect(url.searchParams.get("search")).toBe("button");
    expect(url.searchParams.get("since")).toBe("2026-01-01");
    expect(url.searchParams.get("until")).toBe("2026-02-01");
    expect(url.searchParams.get("limit")).toBe("25");

    await client.list({});
    expect(new URL(recorder.calls[1]!.url).searchParams.size).toBe(0);
  });

  test("normalizes a trailing slash on the base URL so paths do not double-slash", async () => {
    const recorder = fakeFetch(() => jsonResponse(201, { id: "fb-1" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com/", fetch: recorder.fetch });
    await client.submit(INPUT);
    expect(recorder.calls[0]!.url).toBe("https://api.example.com/v1/feedback");
  });

  test("supports relative base URLs without a scheme (browser-relative routing)", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, []));
    const client = createFeedbackClient({ baseUrl: "/feedback", fetch: recorder.fetch });
    await client.list({ appId: "app-a" });
    expect(recorder.calls[0]!.url).toBe("/feedback/v1/feedback?appId=app-a");
  });

  test("PATCH updateStatus sends exactly {status} with a JSON content type", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, { id: "fb-1", status: "triaged" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await client.updateStatus("fb-1", "triaged");
    expect(recorder.calls[0]!.init.method).toBe("PATCH");
    expect(recorder.calls[0]!.init.body).toBe(JSON.stringify({ status: "triaged" }));
    expect(recorder.calls[0]!.url).toBe("https://api.example.com/v1/feedback/fb-1");
  });

  test("markShipped sends the full {status: shipped, changelogRef} receipt", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, { id: "fb-1", status: "shipped", changelogRef: "CH-42" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await client.markShipped("fb-1", "CH-42");
    expect(recorder.calls[0]!.init.method).toBe("PATCH");
    expect(recorder.calls[0]!.init.body).toBe(JSON.stringify({ status: "shipped", changelogRef: "CH-42" }));
  });

  test("an empty 204 body resolves to null rather than a parse error", async () => {
    const recorder = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    expect(await client.get("missing")).toBeNull();
  });

  test("URL-encodes the feedback id in the path", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, { id: "a/b" }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await client.get("a/b");
    expect(recorder.calls[0]!.url).toBe("https://api.example.com/v1/feedback/a%2Fb");
  });

  test("the injected fetch is the ONLY network surface — a failing fake proves no real request is attempted", async () => {
    const recorder = fakeFetch(() => {
      throw new Error("fake-fetch-invoked");
    });
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await expect(client.stats()).rejects.toThrow("fake-fetch-invoked");
    expect(recorder.calls).toHaveLength(1);
  });

  test("get by id and stats hit the exact paths", async () => {
    const recorder = fakeFetch(() => jsonResponse(200, { total: 0 }));
    const client = createFeedbackClient({ baseUrl: "https://api.example.com", fetch: recorder.fetch });
    await client.get("fb-1");
    expect(recorder.calls[0]!.url).toBe("https://api.example.com/v1/feedback/fb-1");
    await client.stats();
    expect(recorder.calls[1]!.url).toBe("https://api.example.com/v1/stats");
  });
});
