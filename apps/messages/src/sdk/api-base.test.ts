/**
 * Base-URL resolution for the messages SDK (hasna/apps#1601, #1588).
 *
 * The old in-package resolver is gone: `resolveMessagesApiBase` is a thin
 * wrapper over the shared `@hasna/contracts` normaliser (`toV1BaseUrl`), the
 * same one every hosted Hasna client uses (hasna/apps#1720). The station
 * wrappers configure the gateway form `https://api.hasna.com/messages` (no
 * `/v1`), the deploy descriptors use the legacy origin, and some operators
 * paste the already-resolved `/v1` root — all three must reach the same
 * routes, and the printed authority must always be the resolved `/v1` root.
 */
import { describe, expect, test } from "bun:test";
import { MessagesClient, resolveMessagesApiBase } from "./index";

describe("resolveMessagesApiBase (#1601) — the shared contracts normaliser", () => {
  test("keeps the gateway path prefix and appends /v1 exactly once", () => {
    expect(resolveMessagesApiBase("https://api.hasna.com/messages")).toEqual({
      baseUrl: "https://api.hasna.com/messages",
      apiUrl: "https://api.hasna.com/messages/v1",
    });
    expect(resolveMessagesApiBase("https://api.hasna.com/messages/")).toEqual({
      baseUrl: "https://api.hasna.com/messages",
      apiUrl: "https://api.hasna.com/messages/v1",
    });
    // Already resolved: the prefix must not be doubled into /v1/v1.
    expect(resolveMessagesApiBase("https://api.hasna.com/messages/v1")).toEqual({
      baseUrl: "https://api.hasna.com/messages",
      apiUrl: "https://api.hasna.com/messages/v1",
    });
  });

  test("handles bare origins and the legacy per-app host", () => {
    expect(resolveMessagesApiBase("https://messages.hasna.xyz")).toEqual({
      baseUrl: "https://messages.hasna.xyz",
      apiUrl: "https://messages.hasna.xyz/v1",
    });
    expect(resolveMessagesApiBase("https://messages.hasna.xyz/v1")).toEqual({
      baseUrl: "https://messages.hasna.xyz",
      apiUrl: "https://messages.hasna.xyz/v1",
    });
    // Plain HTTP is restricted to exact loopback authorities.
    expect(resolveMessagesApiBase("http://127.0.0.1:8080")).toEqual({
      baseUrl: "http://127.0.0.1:8080",
      apiUrl: "http://127.0.0.1:8080/v1",
    });
  });

  test("refuses a base carrying userinfo, a query or a fragment", () => {
    expect(() => resolveMessagesApiBase("https://user:pass@api.hasna.com/messages")).toThrow(
      /authority must be canonical ASCII without credentials/,
    );
    for (const raw of ["https://api.hasna.com/messages?token=abc", "https://api.hasna.com/messages#frag"]) {
      expect(() => resolveMessagesApiBase(raw)).toThrow(/must not include a query string or fragment/);
    }
  });

  test("refuses a non-http(s) or unparseable base", () => {
    expect(() => resolveMessagesApiBase("ftp://api.hasna.com/messages")).toThrow(/http or https/);
    expect(() => resolveMessagesApiBase("not a url")).toThrow(/absolute/);
    expect(() => resolveMessagesApiBase("")).toThrow(/absolute/);
  });
});

describe("MessagesClient base handling (#1601, #1588)", () => {
  function recordingClient(baseUrl: string): { client: MessagesClient; urls: string[] } {
    const urls: string[] = [];
    const client = new MessagesClient({
      baseUrl,
      apiKey: "fixture-key",
      fetch: (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    return { client, urls };
  }

  test("requests keep the gateway prefix and carry a single /v1", async () => {
    const bare = recordingClient("https://api.hasna.com/messages");
    await bare.client.listAgents();
    expect(bare.urls).toEqual(["https://api.hasna.com/messages/v1/agents"]);

    const resolved = recordingClient("https://api.hasna.com/messages/v1");
    await resolved.client.listAgents();
    expect(resolved.urls).toEqual(["https://api.hasna.com/messages/v1/agents"]);

    const legacy = recordingClient("https://messages.hasna.xyz/");
    await legacy.client.listAgents();
    expect(legacy.urls).toEqual(["https://messages.hasna.xyz/v1/agents"]);
  });

  test("apiUrl reports the resolved /v1 authority, never a bare origin", () => {
    expect(recordingClient("https://api.hasna.com/messages").client.apiUrl)
      .toBe("https://api.hasna.com/messages/v1");
    expect(recordingClient("https://api.hasna.com/messages/v1").client.apiUrl)
      .toBe("https://api.hasna.com/messages/v1");
    expect(recordingClient("https://messages.hasna.xyz").client.apiUrl)
      .toBe("https://messages.hasna.xyz/v1");
  });
});