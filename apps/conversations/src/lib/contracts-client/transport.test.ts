import { describe, expect, mock, test } from "bun:test";
import {
  HasnaHttpError,
  appendQuery,
  clientTransportEnvKeys,
  createClientTransport,
  createHasnaHttpTransport,
  defaultCloudBaseUrl,
  resolveClientTransport,
  toV1BaseUrl,
} from "./transport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("transport configuration helpers", () => {
  test("builds the default cloud host without rewriting the app slug", () => {
    expect(defaultCloudBaseUrl("agent-tools")).toBe("https://agent-tools.hasna.xyz");
    expect(defaultCloudBaseUrl("")).toBe("https://.hasna.xyz");
  });

  test("builds env keys in precedence order from a normalized token", () => {
    expect(clientTransportEnvKeys("agent-tools")).toEqual({
      modeKeys: [
        "HASNA_AGENT_TOOLS_STORAGE_MODE",
        "HASNA_AGENT_TOOLS_MODE",
        "AGENT_TOOLS_STORAGE_MODE",
        "AGENT_TOOLS_MODE",
      ],
      apiUrlKeys: ["HASNA_AGENT_TOOLS_API_URL", "AGENT_TOOLS_API_URL"],
      apiKeyKeys: ["HASNA_AGENT_TOOLS_API_KEY", "AGENT_TOOLS_API_KEY"],
    });
  });

  test("normalizes HTTP URLs to a clean v1 base", () => {
    expect(toV1BaseUrl("https://api.example.test/root/v1/?query=ignored#fragment")).toBe(
      "https://api.example.test/root/v1",
    );
    expect(toV1BaseUrl("http://localhost:3000/")).toBe("http://localhost:3000/v1");
  });

  test("rejects malformed and non-HTTP API URLs", () => {
    expect(() => toV1BaseUrl("not a url")).toThrow();
    expect(() => toV1BaseUrl("ftp://api.example.test")).toThrow("API URL must use http or https");
  });
});

describe("resolveClientTransport", () => {
  test("defaults to local without configuration", () => {
    expect(resolveClientTransport("conversations", {})).toEqual({
      transport: "local",
      mode: "local",
      deprecatedAlias: null,
      modeSource: "default",
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: false,
      apiKeySource: null,
      misconfigured: false,
      warning: null,
    });
  });

  test("honors explicit local mode despite cloud credentials and key precedence", () => {
    const resolution = resolveClientTransport("conversations", {
      HASNA_CONVERSATIONS_STORAGE_MODE: "local",
      CONVERSATIONS_MODE: "cloud",
      HASNA_CONVERSATIONS_API_URL: "https://ignored.example.test",
      HASNA_CONVERSATIONS_API_KEY: "primary",
      CONVERSATIONS_API_KEY: "secondary",
    });

    expect(resolution.transport).toBe("local");
    expect(resolution.modeSource).toBe("HASNA_CONVERSATIONS_STORAGE_MODE");
    expect(resolution.apiKeyPresent).toBe(true);
    expect(resolution.apiKeySource).toBe("HASNA_CONVERSATIONS_API_KEY");
  });

  test("infers cloud from URL plus key and accepts deprecated aliases with warnings", () => {
    const inferred = resolveClientTransport("conversations", {
      CONVERSATIONS_API_URL: "https://api.example.test",
      CONVERSATIONS_API_KEY: "secret",
    });
    expect(inferred.transport).toBe("cloud-http");
    expect(inferred.modeSource).toBe("CONVERSATIONS_API_URL+CONVERSATIONS_API_KEY");
    expect(inferred.baseUrl).toBe("https://api.example.test/v1");

    const aliased = resolveClientTransport("conversations", {
      HASNA_CONVERSATIONS_MODE: "self-hosted",
      HASNA_CONVERSATIONS_API_KEY: "secret",
    });
    expect(aliased.transport).toBe("cloud-http");
    expect(aliased.deprecatedAlias).toBe("self_hosted");
    expect(aliased.baseUrl).toBe("https://conversations.hasna.xyz/v1");
    expect(aliased.warning).toContain("Deprecated mode 'self_hosted'");
  });

  test("refuses cloud mode with missing auth or an invalid API URL", () => {
    const missingKey = resolveClientTransport("conversations", {
      HASNA_CONVERSATIONS_STORAGE_MODE: "cloud",
    });
    expect(missingKey.transport).toBe("local");
    expect(missingKey.misconfigured).toBe(true);
    expect(missingKey.warning).toContain("no API key is set");

    const invalidUrl = resolveClientTransport("conversations", {
      HASNA_CONVERSATIONS_STORAGE_MODE: "cloud",
      HASNA_CONVERSATIONS_API_URL: "file:///tmp/data",
      HASNA_CONVERSATIONS_API_KEY: "secret",
    });
    expect(invalidUrl.transport).toBe("local");
    expect(invalidUrl.misconfigured).toBe(true);
    expect(invalidUrl.apiKeyPresent).toBe(true);
    expect(invalidUrl.warning).toContain("Invalid API URL");
    expect(invalidUrl.warning).not.toContain("secret");
  });

  test("rejects unknown storage modes", () => {
    expect(() =>
      resolveClientTransport("conversations", { HASNA_CONVERSATIONS_STORAGE_MODE: "sometimes" }),
    ).toThrow("Unknown storage mode");
  });
});

describe("HasnaHttpError", () => {
  test("preserves request and response context", () => {
    const error = new HasnaHttpError("GET", "/messages/one", 403, { error: "denied" });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HasnaHttpError");
    expect(error.message).toBe("Hasna cloud request failed: GET /messages/one -> 403");
    expect(error.status).toBe(403);
    expect(error.method).toBe("GET");
    expect(error.path).toBe("/messages/one");
    expect(error.body).toEqual({ error: "denied" });
  });
});

describe("appendQuery", () => {
  test("serializes scalar and repeated values while dropping nullish values", () => {
    expect(
      appendQuery("/messages?existing=yes", {
        limit: 5,
        unread: true,
        tag: ["one", "two"],
        cursor: null,
        missing: undefined,
      }),
    ).toBe("/messages?existing=yes&limit=5&unread=true&tag=one&tag=two");
  });

  test("preserves paths for missing or empty queries and accepts URLSearchParams", () => {
    expect(appendQuery("/messages")).toBe("/messages");
    expect(appendQuery("/messages", {})).toBe("/messages");
    expect(appendQuery("/messages", new URLSearchParams([["search", "hello world"]]))).toBe(
      "/messages?search=hello+world",
    );
  });
});

describe("createHasnaHttpTransport", () => {
  test("sends authenticated JSON requests through every verb helper", async () => {
    const fetchImpl = mock(async (input: string, init?: RequestInit) =>
      jsonResponse({ url: input, method: init?.method }),
    );
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1/",
      apiKey: "secret",
      headers: { "x-client": "transport" },
      fetchImpl,
      retry: false,
    });

    await expect(transport.get("messages", { query: { limit: 1 } })).resolves.toEqual({
      url: "https://api.example.test/v1/messages?limit=1",
      method: "GET",
    });
    await transport.post("/messages", { body: "post" }, { idempotencyKey: "create-one" });
    await transport.put("/messages/one", { body: "put" });
    await transport.patch("/messages/one", { body: "patch" });
    await transport.del("/messages/one");

    expect(transport.baseUrl).toBe("https://api.example.test/v1");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    const postInit = fetchImpl.mock.calls[1]?.[1];
    const postHeaders = new Headers(postInit?.headers);
    expect(postHeaders.get("x-api-key")).toBe("secret");
    expect(postHeaders.get("authorization")).toBe("Bearer secret");
    expect(postHeaders.get("content-type")).toBe("application/json");
    expect(postHeaders.get("idempotency-key")).toBe("create-one");
    expect(postInit?.body).toBe(JSON.stringify({ body: "post" }));
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });

  test("lets request headers override transport headers and parses text or empty bodies", async () => {
    let call = 0;
    const fetchImpl = mock(async (_input: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        expect(new Headers(init?.headers).get("x-client")).toBe("request");
        return new Response("plain text");
      }
      return new Response(null, { status: 204 });
    });
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      headers: { "x-client": "transport" },
      fetchImpl,
      retry: false,
    });

    await expect(transport.request("get", "health", undefined, { headers: { "x-client": "request" } })).resolves.toBe(
      "plain text",
    );
    await expect(transport.del("health")).resolves.toBeUndefined();
  });

  test("throws contextual HTTP errors without retrying permission refusals", async () => {
    const fetchImpl = mock(async () => new Response("denied", { status: 403 }));
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl,
    });

    try {
      await transport.get("messages/private");
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HasnaHttpError);
      expect((error as HasnaHttpError).status).toBe(403);
      expect((error as HasnaHttpError).body).toBe("denied");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("retries transient idempotent failures with bounded backoff", async () => {
    let attempt = 0;
    const fetchImpl = mock(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: "busy" }, 503) : jsonResponse({ ok: true });
    });
    const sleepImpl = mock(async (_milliseconds: number) => undefined);
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl,
      sleepImpl,
      retry: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(transport.get("messages")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(0);
  });

  test("does not retry unsafe requests without an idempotency key", async () => {
    const fetchImpl = mock(async () => jsonResponse({ error: "busy" }, 503));
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl,
      retry: { retries: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(transport.post("messages", { body: "unsafe" })).rejects.toBeInstanceOf(HasnaHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("aborts requests that exceed the configured timeout", async () => {
    const fetchImpl = mock(
      async (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error("timed out"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true });
        }),
    );
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl,
      timeoutMs: 1,
      retry: false,
    });

    await expect(transport.get("slow")).rejects.toThrow("timed out");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("retries network errors for retry-safe writes and stops on caller abort", async () => {
    let patchAttempt = 0;
    const fetchImpl = mock(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patchAttempt += 1;
        if (patchAttempt === 1) throw new Error("network down");
        return jsonResponse({ ok: true });
      }
      throw new Error("aborted");
    });
    const transport = createHasnaHttpTransport({
      name: "conversations",
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl,
      sleepImpl: async () => undefined,
      retry: { retries: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(transport.patch("messages/one", {}, { idempotencyKey: "patch-one" })).resolves.toEqual({ ok: true });
    const controller = new AbortController();
    controller.abort();
    await expect(transport.get("messages", { signal: controller.signal })).rejects.toThrow("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("createClientTransport", () => {
  test("returns a local result without constructing an HTTP client", () => {
    const result = createClientTransport("conversations", {});

    expect(result.transport).toBe("local");
    expect(result.client).toBeNull();
  });

  test("throws for requested cloud transport without auth", () => {
    expect(() =>
      createClientTransport("conversations", { HASNA_CONVERSATIONS_STORAGE_MODE: "cloud" }),
    ).toThrow("no API key is set");
  });

  test("constructs an authenticated cloud client with overrides", async () => {
    const fetchImpl = mock(async (_input: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    const result = createClientTransport(
      "conversations",
      {
        HASNA_CONVERSATIONS_STORAGE_MODE: "cloud",
        HASNA_CONVERSATIONS_API_URL: "https://api.example.test",
        HASNA_CONVERSATIONS_API_KEY: "secret",
      },
      { fetchImpl, retry: false, headers: { "x-client": "test" }, timeoutMs: 10 },
    );

    expect(result.transport).toBe("cloud-http");
    if (result.transport === "cloud-http") {
      await expect(result.client.get("health")).resolves.toEqual({ ok: true });
      expect(result.client.baseUrl).toBe("https://api.example.test/v1");
      const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
      expect(headers.get("x-api-key")).toBe("secret");
      expect(headers.get("x-client")).toBe("test");
    }
  });
});
