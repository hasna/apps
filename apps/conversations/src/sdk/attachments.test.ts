import { describe, expect, test } from "bun:test";
import { ConversationsClient } from "./index.js";

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
});
