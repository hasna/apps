import { describe, expect, test } from "bun:test";
import { conversationsRequest, resolveConversationsTransport } from "./conversations-transport.js";

const credentials = { apiKey: "conversation-test-key" };

describe("canonical Conversations notification transport", () => {
  test("hosted authority is credential-resolved, authenticated, and never doubles /v1", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const response = await conversationsRequest("/messages", { method: "POST" }, {
      env: { HASNA_CONVERSATIONS_API_URL: "https://api.hasna.com/conversations/v1" },
      credentials,
      fetch: (async (input, init) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers) });
        return Response.json({ ok: true });
      }) as typeof fetch,
    });
    expect(response.ok).toBe(true);
    expect(seen[0]?.url).toBe("https://api.hasna.com/conversations/v1/messages");
    expect(seen[0]?.url).not.toContain("/v1/v1/");
    expect(seen[0]?.headers.get("x-api-key")).toBe("conversation-test-key");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer conversation-test-key");
  });

  test("missing credentials refuse instead of inventing localhost", () => {
    expect(() => resolveConversationsTransport({ env: {} })).toThrow(/refusing localhost fallback/);
  });

  test("an explicitly configured loopback test/local authority remains available without ambient fleet credentials", () => {
    const resolved = resolveConversationsTransport({ env: { CONVERSATIONS_API_URL: "http://127.0.0.1:7020/v1" } });
    expect(resolved).toMatchObject({ baseUrl: "http://127.0.0.1:7020/v1", apiKey: null, localExplicit: true });
  });
});
