import { describe, expect, test } from "bun:test";
import { ConversationsClient, ApiError } from "./index.js";

describe("ConversationsClient attachment downloads", () => {
  test("returns exact binary response bytes without JSON decoding", async () => {
    const expected = new TextEncoder().encode("synthetic attachment bytes\n");
    const client = new ConversationsClient({
      baseUrl: "https://example.invalid",
      fetch: (async () => new Response(expected, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })) as unknown as typeof fetch,
    });

    const downloaded = await client.downloadMessageAttachment(42, "evidence.txt");

    expect(downloaded).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(downloaded)).toEqual(expected);
  });

  test("returns the typed JSON envelope when base64 encoding is requested", async () => {
    const envelope = {
      name: "evidence.txt",
      mime_type: "text/plain",
      size: 3,
      content_base64: "YWJj",
    };
    const client = new ConversationsClient({
      baseUrl: "https://example.invalid",
      fetch: (async () => Response.json(envelope)) as unknown as typeof fetch,
    });

    const downloaded = await client.downloadMessageAttachment(
      42,
      "evidence.txt",
      { encoding: "base64" },
    );

    expect(downloaded).toEqual(envelope);
  });
});

/**
 * Agent-authored (SOL consult refused; spec from independent analysis of the
 * generated request() discriminator in src/sdk/index.ts). The happy paths are
 * covered above; the boundary edges a weak test misses: error responses must
 * surface as typed ApiError (never raw bytes), the arrayBuffer responseType
 * discriminator must key on the content-type header, and the error body must
 * survive on the ApiError.
 */
describe("ConversationsClient attachment download error and discriminator edges", () => {
  function clientWith(fetchImpl: typeof fetch): ConversationsClient {
    return new ConversationsClient({
      baseUrl: "https://example.invalid",
      fetch: fetchImpl as unknown as typeof fetch,
    });
  }

  test("a 404 JSON error surfaces as a typed ApiError carrying the server body", async () => {
    const client = clientWith((async () => Response.json({
      error: "Requested attachment not found on message #42",
      code: "ATTACHMENT_NOT_FOUND",
      hint: "List available names with conversations show 42 --json.",
    }, { status: 404 })) as unknown as typeof fetch);

    const error = await client.downloadMessageAttachment(42, "absent.txt").then(
      () => { throw new Error("expected ApiError"); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toContain("Requested attachment not found on message #42");
    expect((error as ApiError).body).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  test("a non-2xx response with a non-JSON body throws ApiError, never raw bytes", async () => {
    const client = clientWith((async () => new Response("gateway exploded", {
      status: 502,
      headers: { "content-type": "text/plain" },
    })) as unknown as typeof fetch);

    const error = await client.downloadMessageAttachment(42, "x.bin").then(
      () => { throw new Error("expected ApiError"); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).body).toBe("gateway exploded");
  });

  test("a 2xx JSON envelope is NOT misrouted to ArrayBuffer by the arrayBuffer responseType", async () => {
    const envelope = {
      name: "evidence.txt",
      mime_type: "text/plain",
      size: 3,
      content_base64: "YWJj",
    };
    const client = clientWith((async () => Response.json(envelope, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    const downloaded = await client.downloadMessageAttachment(42, "evidence.txt", { encoding: "base64" });
    expect(downloaded).toEqual(envelope);
    expect(downloaded).not.toBeInstanceOf(ArrayBuffer);
  });

  test("a 2xx response with NO content-type header takes the ArrayBuffer path", async () => {
    const bytes = new TextEncoder().encode("no content-type bytes\n");
    const client = clientWith((async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch);

    const downloaded = await client.downloadMessageAttachment(42, "raw.bin");
    expect(downloaded).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(downloaded as ArrayBuffer)).toEqual(bytes);
  });
});
