import { describe, test, expect } from "bun:test";
import { jsonRequest, resolveFetch, type FetchLike } from "./http.js";

/** Deterministic in-test fetch double recording the exact call it received. */
function fakeFetch(
  handler: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    ok: boolean;
    status: number;
    statusText?: string;
    text: string;
  },
): { fetch: FetchLike; calls: { input: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }[] } {
  const calls: { input: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({ input, init });
    const r = handler(input, init);
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      text: () => Promise.resolve(r.text),
    });
  };
  return { fetch, calls };
}

describe("resolveFetch", () => {
  test("returns the injected implementation when provided", () => {
    const impl: FetchLike = () => Promise.reject(new Error("unused"));
    expect(resolveFetch(impl)).toBe(impl);
  });

  test("falls back to globalThis.fetch when not injected", () => {
    expect(typeof resolveFetch(undefined)).toBe("function");
  });
});

describe("jsonRequest — query building", () => {
  test("drops undefined, null and empty-string query values", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1", {
      query: { a: 1, b: "x", c: undefined, d: null, e: "", f: false },
    });
    expect(calls[0].input).toBe("https://api.example.test/v1?a=1&b=x&f=false");
  });

  test("stringifies numbers and booleans", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1", { query: { limit: 25, page: 0 } });
    expect(calls[0].input).toContain("limit=25");
    expect(calls[0].input).toContain("page=0");
  });

  test("joins with & when the URL already has a query", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1?existing=1", { query: { a: "b" } });
    expect(calls[0].input).toBe("https://api.example.test/v1?existing=1&a=b");
  });
});

describe("jsonRequest — method, headers, body serialization", () => {
  test("GET sends no body and sets Accept", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.headers).toEqual({ Accept: "application/json" });
  });

  test("POST serializes object bodies as JSON and sets Content-Type", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1", { method: "POST", body: { a: 1 } });
    expect(calls[0].init?.body).toBe('{"a":1}');
    expect(calls[0].init?.headers?.["Content-Type"]).toBe("application/json");
  });

  test("an explicit Content-Type is preserved and not overwritten", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    await jsonRequest(fetch, "https://api.example.test/v1", {
      method: "POST",
      headers: { "Content-Type": "application/vnd.test+json" },
      body: { a: 1 },
    });
    expect(calls[0].init?.headers?.["Content-Type"]).toBe("application/vnd.test+json");
  });

  test("string bodies pass through without JSON re-encoding", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "{}" }));
    const raw = '{"already":"raw"}';
    await jsonRequest(fetch, "https://api.example.test/v1", { method: "PUT", body: raw });
    expect(calls[0].init?.body).toBe(raw);
  });

  test("HEAD never serializes a body even when one is supplied", async () => {
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 204, text: "" }));
    await jsonRequest(fetch, "https://api.example.test/v1", { method: "HEAD", body: { a: 1 } });
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe("jsonRequest — response parsing", () => {
  test("2xx parses JSON", async () => {
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, text: '{"name":"stripe"}' }));
    const data = await jsonRequest<{ name: string }>(fetch, "https://api.example.test/v1");
    expect(data.name).toBe("stripe");
  });

  test("204 empty body resolves to an empty object", async () => {
    const { fetch } = fakeFetch(() => ({ ok: true, status: 204, text: "" }));
    expect(await jsonRequest(fetch, "https://api.example.test/v1")).toEqual({});
  });

  test("malformed JSON body resolves to a { raw } wrapper instead of throwing", async () => {
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, text: "<html>not json</html>" }));
    const data = await jsonRequest<{ raw: string }>(fetch, "https://api.example.test/v1");
    expect(data.raw).toBe("<html>not json</html>");
  });
});

describe("jsonRequest — non-2xx error normalization", () => {
  test("extracts error_description with priority", async () => {
    const { fetch } = fakeFetch(() => ({
      ok: false,
      status: 400,
      text: JSON.stringify({ error_description: "invalid_grant", error: "bad" }),
    }));
    await expect(jsonRequest(fetch, "https://api.example.test/v1")).rejects.toThrow(
      "request 400: invalid_grant",
    );
  });

  test("falls back to string error, then message", async () => {
    const { fetch } = fakeFetch(() => ({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: "unauthorized" }),
    }));
    await expect(jsonRequest(fetch, "https://api.example.test/v1")).rejects.toThrow("request 401: unauthorized");

    const { fetch: fetch2 } = fakeFetch(() => ({
      ok: false,
      status: 403,
      text: JSON.stringify({ message: "forbidden" }),
    }));
    await expect(jsonRequest(fetch2, "https://api.example.test/v1")).rejects.toThrow("request 403: forbidden");
  });

  test("reads nested google-style error.message", async () => {
    const { fetch } = fakeFetch(() => ({
      ok: false,
      status: 404,
      text: JSON.stringify({ error: { message: "not found" } }),
    }));
    await expect(jsonRequest(fetch, "https://api.example.test/v1")).rejects.toThrow("request 404: not found");
  });

  test("falls back to statusText when the body carries no message", async () => {
    const { fetch } = fakeFetch(() => ({ ok: false, status: 500, statusText: "Internal Server Error", text: "{}" }));
    await expect(jsonRequest(fetch, "https://api.example.test/v1")).rejects.toThrow(
      "request 500: Internal Server Error",
    );
  });

  test("non-object body falls back to statusText, never throws a parser error", async () => {
    const { fetch } = fakeFetch(() => ({ ok: false, status: 502, statusText: "Bad Gateway", text: "oops" }));
    await expect(jsonRequest(fetch, "https://api.example.test/v1")).rejects.toThrow("request 502: Bad Gateway");
  });

  test("custom errorLabel replaces the default label", async () => {
    const { fetch } = fakeFetch(() => ({ ok: false, status: 429, text: JSON.stringify({ message: "slow down" }) }));
    await expect(
      jsonRequest(fetch, "https://api.example.test/v1", { errorLabel: "media.upload" }),
    ).rejects.toThrow("media.upload 429: slow down");
  });
});
