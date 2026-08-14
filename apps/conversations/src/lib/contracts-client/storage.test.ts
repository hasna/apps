import { describe, expect, mock, test } from "bun:test";
import { createHasnaStorageClient, resolveStorageClient } from "./storage.js";
import { HasnaHttpError, type HasnaHttpTransport, type HasnaRequestOptions } from "./transport.js";

function createTransport(overrides: Record<string, unknown> = {}): HasnaHttpTransport {
  return {
    baseUrl: "https://conversations.example/v1",
    request: mock(async () => undefined),
    get: mock(async () => undefined),
    post: mock(async () => undefined),
    put: mock(async () => undefined),
    patch: mock(async () => undefined),
    del: mock(async () => undefined),
    ...overrides,
  } as HasnaHttpTransport;
}

describe("createHasnaStorageClient", () => {
  test("exposes transport metadata and normalizes list envelopes", async () => {
    const raw = { data: [{ id: "one" }], count: 4, next_cursor: "page-2" };
    const get = mock(async () => raw);
    const transport = createTransport({ get });
    const client = createHasnaStorageClient("conversations", transport);

    const result = await client.list<{ id: string }>("/messages/", {
      query: { limit: 1 },
      timeoutMs: 50,
    });

    expect(client.name).toBe("conversations");
    expect(client.baseUrl).toBe(transport.baseUrl);
    expect(client.transport).toBe(transport);
    expect(result).toEqual({ items: [{ id: "one" }], total: 4, cursor: "page-2", raw });
    expect(get).toHaveBeenCalledWith("/messages", { query: { limit: 1 }, timeoutMs: 50 });
  });

  test("returns empty list metadata for an unrecognized response and rejects an empty resource", async () => {
    const get = mock(async () => ({ message: "ok" }));
    const client = createHasnaStorageClient("conversations", createTransport({ get }));

    await expect(client.list("messages")).resolves.toEqual({
      items: [],
      total: null,
      cursor: null,
      raw: { message: "ok" },
    });
    await expect(client.list("///")).rejects.toThrow("resource must be a non-empty path segment");
  });

  test("gets an encoded entity and converts only 404 responses to null", async () => {
    const get = mock(async () => ({ id: "a/b" }));
    const client = createHasnaStorageClient("conversations", createTransport({ get }));

    await expect(client.get("messages", "a/b", { query: { expand: true } })).resolves.toEqual({ id: "a/b" });
    expect(get).toHaveBeenCalledWith("/messages/a%2Fb", { query: { expand: true } });

    get.mockImplementationOnce(async () => {
      throw new HasnaHttpError("GET", "/messages/missing", 404, { error: "missing" });
    });
    await expect(client.get("messages", "missing")).resolves.toBeNull();

    const denied = new HasnaHttpError("GET", "/messages/secret", 403, { error: "denied" });
    get.mockImplementationOnce(async () => {
      throw denied;
    });
    await expect(client.get("messages", "secret")).rejects.toBe(denied);
    await expect(client.get("messages", "")).rejects.toThrow("id must be a non-empty string");
  });

  test("creates with supplied and generated idempotency keys", async () => {
    const post = mock(async (_path: string, _body?: unknown, _options?: HasnaRequestOptions) => ({ id: "new" }));
    const client = createHasnaStorageClient("conversations", createTransport({ post }));

    await expect(
      client.create("messages", { body: "hello" }, { idempotencyKey: "stable-key", timeoutMs: 20 }),
    ).resolves.toEqual({ id: "new" });
    expect(post).toHaveBeenNthCalledWith(1, "/messages", { body: "hello" }, {
      idempotencyKey: "stable-key",
      timeoutMs: 20,
    });

    await client.create("messages", { body: "again" });
    const generatedOptions = post.mock.calls[1]?.[2];
    const generatedKey = generatedOptions?.idempotencyKey;
    expect(typeof generatedKey).toBe("string");
    expect(generatedKey?.length ?? 0).toBeGreaterThan(0);
  });

  test("uses PATCH by default and PUT when requested", async () => {
    const patchCall = mock(async () => ({ version: 2 }));
    const put = mock(async () => ({ version: 3 }));
    const client = createHasnaStorageClient("conversations", createTransport({ patch: patchCall, put }));

    await expect(client.update("messages", "one", { body: "patch" })).resolves.toEqual({ version: 2 });
    expect(patchCall).toHaveBeenCalledWith("/messages/one", { body: "patch" }, {});

    await expect(
      client.update("messages", "one", { body: "replace" }, { method: "PUT", idempotencyKey: "replace-one" }),
    ).resolves.toEqual({ version: 3 });
    expect(put).toHaveBeenCalledWith("/messages/one", { body: "replace" }, { idempotencyKey: "replace-one" });
  });

  test("deletes existing or absent entities but surfaces other failures", async () => {
    const del = mock(async () => undefined);
    const client = createHasnaStorageClient("conversations", createTransport({ del }));

    await expect(client.delete("messages", "one", { timeoutMs: 10 })).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith("/messages/one", undefined, { timeoutMs: 10 });

    del.mockImplementationOnce(async () => {
      throw new HasnaHttpError("DELETE", "/messages/missing", 404, null);
    });
    await expect(client.delete("messages", "missing")).resolves.toBeUndefined();

    const denied = new HasnaHttpError("DELETE", "/messages/locked", 403, { error: "denied" });
    del.mockImplementationOnce(async () => {
      throw denied;
    });
    await expect(client.delete("messages", "locked")).rejects.toBe(denied);
  });
});

describe("resolveStorageClient", () => {
  test("returns no client for local mode", () => {
    expect(resolveStorageClient("conversations", {})).toEqual({ transport: "local", client: null });
  });

  test("returns a ready client for valid cloud configuration", () => {
    const result = resolveStorageClient("conversations", {
      HASNA_CONVERSATIONS_STORAGE_MODE: "cloud",
      HASNA_CONVERSATIONS_API_URL: "https://api.example.test/root",
      HASNA_CONVERSATIONS_API_KEY: "secret",
    });

    expect(result.transport).toBe("cloud-http");
    if (result.transport === "cloud-http") {
      expect(result.client.name).toBe("conversations");
      expect(result.client.baseUrl).toBe("https://api.example.test/root/v1");
    }
  });

  test("throws instead of silently falling back when cloud auth is missing", () => {
    expect(() =>
      resolveStorageClient("conversations", { HASNA_CONVERSATIONS_STORAGE_MODE: "cloud" }),
    ).toThrow("no API key is set");
  });
});
