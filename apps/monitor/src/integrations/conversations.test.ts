/**
 * Regression tests for the native conversations adapter (MON-V2-07).
 *
 * Gate: tests use ConversationsClient.sendMessage; a successful post records
 * the returned message pointer; an unknown outcome reconciles by stable effect
 * key before retrying.
 *
 * The tests exercise the REAL published SDK client (@hasna/conversations/sdk
 * 0.5.44) with an injected fetch that simulates the /v1 API, so the adapter is
 * proven against the actual ConversationsClient.sendMessage /
 * getMessageByUuid request path rather than a reimplementation of it.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { ConversationsClient } from "@hasna/conversations/sdk";
import type { ConversationsIntegrationConfig } from "./index.js";
import {
  createConversationsClient,
  postMessageToSpace,
  resetEffectLedgerForTests,
  sendConversationMessage,
} from "./conversations.js";

// ── fake /v1 server ─────────────────────────────────────────────────────────

type PostBehavior =
  | { kind: "ok"; id: number }
  | { kind: "error"; status: number; error: string }
  | { kind: "network-error"; message: string };

type GetBehavior =
  | { kind: "found"; id: number }
  | { kind: "not-found" }
  | { kind: "route-missing" }
  | { kind: "network-error"; message: string };

interface FakeServer {
  postCount: number;
  getCount: number;
  postedBodies: Array<Record<string, unknown>>;
  queriedUuids: string[];
  postBehavior: PostBehavior;
  getBehavior: GetBehavior;
  lastApiKeyHeader: string | null;
  lastRequestUrl: string | null;
}

function makeFakeServer(): FakeServer {
  const server: FakeServer = {
    postCount: 0,
    getCount: 0,
    postedBodies: [],
    queriedUuids: [],
    postBehavior: { kind: "ok", id: 42 },
    getBehavior: { kind: "not-found" },
    lastApiKeyHeader: null,
    lastRequestUrl: null,
  };

  return server;
}

/** Build a fetch implementation bound to the fake server state. */
function fakeFetch(server: FakeServer): typeof fetch {
  return (async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    server.lastRequestUrl = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const apiKey = (init?.headers as Record<string, string> | undefined)?.["x-api-key"] ?? null;
    if (apiKey !== null) server.lastApiKeyHeader = apiKey;

    if (method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST" && url.pathname === "/v1/messages") {
      server.postCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      server.postedBodies.push(body);
      const b = server.postBehavior;
      if (b.kind === "network-error") {
        throw new TypeError(b.message);
      }
      if (b.kind === "error") {
        return new Response(JSON.stringify({ error: b.error }), {
          status: b.status,
          headers: { "content-type": "application/json" },
        });
      }
      const uuid = typeof body.uuid === "string" ? body.uuid : "generated-uuid";
      return new Response(
        JSON.stringify({
          message: {
            id: b.id,
            uuid,
            channel: body.channel ?? null,
            content: body.content,
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }

    const byUuid = url.pathname.match(/^\/v1\/messages\/by-uuid\/([^/]+)$/);
    if (method === "GET" && byUuid) {
      server.getCount += 1;
      server.queriedUuids.push(decodeURIComponent(byUuid[1] ?? ""));
      const b = server.getBehavior;
      if (b.kind === "network-error") {
        throw new TypeError(b.message);
      }
      if (b.kind === "not-found") {
        // The by-uuid route EXISTS and answered: a real row-miss.
        return new Response(JSON.stringify({ error: "Message not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (b.kind === "route-missing") {
        // The hosted shape: no by-uuid route exists, so every probe answers
        // with the generic unknown-route 404.
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          message: {
            id: b.id,
            uuid: decodeURIComponent(byUuid[1] ?? ""),
            channel: "ops",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function makeClient(server: FakeServer): ConversationsClient {
  return new ConversationsClient({
    baseUrl: "http://monitor.test",
    fetch: fakeFetch(server),
  });
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── tests ────────────────────────────────────────────────────────────────────

const CONFIG: ConversationsIntegrationConfig = {
  enabled: true,
  space_id: "ops",
  base_url: "http://monitor.test",
};

afterEach(() => {
  delete process.env.HASNA_MONITOR_CONVERSATIONS_API_KEY;
  delete process.env.HASNA_MONITOR_CONVERSATIONS_API_URL;
  delete process.env.HASNA_MONITOR_CONVERSATIONS_FROM;
  delete process.env.HASNA_CONVERSATIONS_API_KEY;
  delete process.env.HASNA_CONVERSATIONS_API_URL;
  // The effect ledger is module state shared across tests; each test starts clean.
  resetEffectLedgerForTests();
});

describe("sendConversationMessage", () => {
  it("posts via ConversationsClient.sendMessage and records the returned message pointer", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "ok", id: 101 };
    const result = await sendConversationMessage("alert: disk full", { channelId: "ops",
      client: makeClient(server),
    });

    expect(server.postCount).toBe(1);
    expect(result.status).toBe("delivered");
    if (result.status === "delivered") {
      expect(result.messageId).toBe(101);
      expect(result.messageUuid).toMatch(CANONICAL_UUID);
      expect(result.reconciled).toBe(false);
      expect(result.attempts).toBe(1);
    }

    // The SDK body must carry the effect key as the caller-bound uuid, plus
    // channel and content — the server preserves a caller-bound UUID, which is
    // what makes reconcile-by-effect-key sound.
    const sent = server.postedBodies[0] as Record<string, unknown>;
    expect(sent["channel"]).toBe("ops");
    expect(sent["content"]).toBe("alert: disk full");
    expect(sent["uuid"]).toMatch(CANONICAL_UUID);
    if (result.status === "delivered") {
      expect(result.messageUuid).toBe(String(sent["uuid"]));
    }
  });

  it("resolves a repeated identical effect from the ledger WITHOUT a second POST, and posts distinct content", async () => {
    const server = makeFakeServer();
    const client = makeClient(server);

    const first = await sendConversationMessage("same message", { channelId: "ops", client });
    const second = await sendConversationMessage("same message", { channelId: "ops", client });
    const other = await sendConversationMessage("different message", { channelId: "ops", client });

    // The effect key is stable per (channel, from, content): the second
    // identical send resolves against the ledger — no second POST, no second
    // message. Distinct content is a distinct effect and POSTs.
    expect(server.postCount).toBe(2);
    expect(first.status).toBe("delivered");
    if (first.status === "delivered") {
      expect(first.messageUuid).toMatch(CANONICAL_UUID);
    }
    expect(second.status).toBe("reconciled");
    if (second.status === "reconciled") {
      expect(second.attempts).toBe(0); // resolved from the ledger, nothing sent
      expect(second.messageId).toBe(first.status === "delivered" ? first.messageId : 0);
      expect(second.messageUuid).toBe(first.status === "delivered" ? first.messageUuid : "");
    }
    expect(other.status).toBe("delivered");

    // The single wire uuid for "same message" is the derived effect key, and
    // "different message" carries a distinct one.
    const u1 = server.postedBodies[0]?.["uuid"];
    const u2 = server.postedBodies[1]?.["uuid"];
    expect(u1).toMatch(CANONICAL_UUID);
    expect(u1).not.toBe(u2);
  });

  it("records a caller-supplied effect key verbatim", async () => {
    const server = makeFakeServer();
    const effectKey = "0f0a1b2c-3d4e-5f6a-8b9c-0d1e2f3a4b5c";
    const result = await sendConversationMessage("msg", { channelId: "ops",
      client: makeClient(server),
      effectKey,
    });
    expect(server.postedBodies[0]?.["uuid"]).toBe(effectKey);
    expect(result.status).toBe("delivered");
    if (result.status === "delivered") {
      expect(result.messageUuid).toBe(effectKey);
    }
  });

  it("always sends a resolved sender: option, then env, then the default", async () => {
    const server = makeFakeServer();
    const client = makeClient(server);
    await sendConversationMessage("msg", { channelId: "ops", client });
    expect(server.postedBodies[0]?.["from"]).toBe("monitor");

    process.env.HASNA_MONITOR_CONVERSATIONS_FROM = "env-monitor";
    const server2 = makeFakeServer();
    await sendConversationMessage("msg", { channelId: "ops", client: makeClient(server2) });
    expect(server2.postedBodies[0]?.["from"]).toBe("env-monitor");

    const server3 = makeFakeServer();
    await sendConversationMessage("msg", {
      channelId: "ops",
      from: "explicit-sender",
      client: makeClient(server3),
    });
    expect(server3.postedBodies[0]?.["from"]).toBe("explicit-sender");
  });

  it("hosted shape: server mints its own uuid and has no by-uuid route — repeated identical sends still create ONE message", async () => {
    // The hosted service drops caller UUIDs, mints its own, and answers every
    // by-uuid probe with a generic 404 (apps/conversations CHANGELOG 0.5.25).
    // The effect ledger must prevent the second POST regardless.
    const server = makeFakeServer();
    let postCount = 0;
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (init?.method === "POST" && url.pathname === "/v1/messages") {
        postCount += 1;
        server.postCount += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        server.postedBodies.push(body);
        return new Response(
          // The server IGNORES the caller uuid and mints its own.
          JSON.stringify({
            message: { id: postCount, uuid: `server-minted-${postCount}`, channel: "ops" },
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
      const byUuid = url.pathname.match(/^\/v1\/messages\/by-uuid\/([^/]+)$/);
      if (init?.method === "GET" && byUuid) {
        // Hosted shape: the route does not exist; generic 404.
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }) as typeof fetch;
    const client = new ConversationsClient({ baseUrl: "http://monitor.test", fetch: fetchImpl });

    const first = await sendConversationMessage("alert: disk full", { channelId: "ops", client });
    const second = await sendConversationMessage("alert: disk full", { channelId: "ops", client });

    expect(postCount).toBe(1); // the ledger prevented a duplicate hosted write
    expect(first.status).toBe("delivered");
    if (first.status === "delivered") {
      expect(first.messageUuid).toBe("server-minted-1");
    }
    expect(second.status).toBe("reconciled");
    if (second.status === "reconciled") {
      expect(second.messageId).toBe(first.status === "delivered" ? first.messageId : 0);
      expect(second.reconciled).toBe(true);
      expect(second.attempts).toBe(0);
    }
  });

  it("evicts the oldest effect from the bounded ledger, allowing a later re-send of the same effect", async () => {
    const server = makeFakeServer();
    const client = makeClient(server);
    const first = await sendConversationMessage("evicted-message", { channelId: "ops", client });
    expect(first.status).toBe("delivered");
    // Fill the ledger past its cap with distinct effects, evicting the first.
    for (let i = 0; i < 256; i += 1) {
      const result = await sendConversationMessage(`fill-${i}`, { channelId: "ops", client });
      expect(result.status).toBe("delivered");
    }
    const again = await sendConversationMessage("evicted-message", { channelId: "ops", client });
    // The first entry was evicted: this identical send POSTs again.
    expect(again.status).toBe("delivered");
    expect(server.postCount).toBe(258);
  });

  it("reconciles an unknown outcome by effect key before retrying: found message is recorded, no resend", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "network-error", message: "fetch failed" };
    server.getBehavior = { kind: "found", id: 77 };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    // The send failed with an ambiguous transport error; the adapter must NOT
    // blindly resend — it reconciles by the stable effect key, finds the
    // message already landed, and records the pointer.
    expect(server.postCount).toBe(1); // no resend
    expect(server.getCount).toBe(1);
    expect(result.status).toBe("reconciled");
    if (result.status === "reconciled") {
      expect(result.messageId).toBe(77);
      expect(result.reconciled).toBe(true);
      expect(result.attempts).toBe(1);
    }
    const effectKey = String(server.postedBodies[0]?.["uuid"] ?? "");
    expect(server.queriedUuids).toEqual([effectKey]);
  });

  it("retries after an unknown outcome only when reconcile proves the message absent, using the same effect key", async () => {
    const server = makeFakeServer();
    // First send: ambiguous transport failure. Reconcile: not found. Second
    // send: lands.
    let postCall = 0;
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (init?.method === "POST" && url.pathname === "/v1/messages") {
        postCall += 1;
        server.postCount += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        server.postedBodies.push(body);
        if (postCall === 1) throw new TypeError("fetch failed: connection reset");
        return new Response(
          JSON.stringify({
            message: { id: 202, uuid: body["uuid"], channel: "ops" },
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
      const byUuid = url.pathname.match(/^\/v1\/messages\/by-uuid\/([^/]+)$/);
      if (init?.method === "GET" && byUuid) {
        server.getCount += 1;
        server.queriedUuids.push(decodeURIComponent(byUuid[1] ?? ""));
        return new Response(JSON.stringify({ error: "Message not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }) as typeof fetch;
    const client = new ConversationsClient({ baseUrl: "http://monitor.test", fetch: fetchImpl });

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    expect(result.status).toBe("delivered");
    expect(server.postCount).toBe(2);
    expect(server.getCount).toBe(1);
    if (result.status === "delivered") {
      expect(result.messageId).toBe(202);
      expect(result.attempts).toBe(2);
    }
    // The retry carried the SAME stable effect key.
    const firstKey = String(server.postedBodies[0]?.["uuid"] ?? "");
    const secondKey = String(server.postedBodies[1]?.["uuid"] ?? "");
    expect(firstKey).toBe(secondKey);
    expect(server.queriedUuids).toEqual([firstKey]);
  });

  it("treats a confirmed server error as a failed outcome when the effect key is not found", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "error", status: 400, error: "bad request" };
    server.getBehavior = { kind: "not-found" };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("400");
      expect(result.attempts).toBe(1);
    }
    expect(server.postCount).toBe(1);
    // The server answered — a confirmed failure, not an unknown outcome — but
    // the effect key is still looked up before declaring it, so a duplicate
    // post of an already-landed message is never reported as a failure.
    expect(server.getCount).toBe(1);
  });

  it("treats a duplicate-post ApiError as an idempotent success when the effect key already landed", async () => {
    const server = makeFakeServer();
    // The server refused the repeated POST (unique-uuid insert conflict) but
    // the message landed on an earlier attempt — reconcile must find it.
    server.postBehavior = {
      kind: "error",
      status: 400,
      error: 'duplicate key value violates unique constraint "idx_messages_uuid"',
    };
    server.getBehavior = { kind: "found", id: 77 };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    expect(result.status).toBe("reconciled");
    if (result.status === "reconciled") {
      expect(result.messageId).toBe(77);
      expect(result.reconciled).toBe(true);
      expect(result.attempts).toBe(1);
    }
    expect(server.postCount).toBe(1); // never resent
    expect(server.getCount).toBe(1); // the existing message was looked up
    const effectKey = String(server.postedBodies[0]?.["uuid"] ?? "");
    expect(server.queriedUuids).toEqual([effectKey]);
  });

  it("exhausts the attempt bound when reconcile keeps proving absence, and reports the last failure", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "network-error", message: "fetch failed" };
    server.getBehavior = { kind: "not-found" };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops",
      client,
      maxAttempts: 3,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.attempts).toBe(3);
    }
    expect(server.postCount).toBe(3);
    expect(server.getCount).toBe(3);
    // every retry used the same effect key
    const keys = new Set(server.postedBodies.map((b) => b["uuid"]));
    expect(keys.size).toBe(1);
  });

  it("fails closed when the reconcile probe itself is ambiguous (no blind retry)", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "network-error", message: "fetch failed" };
    server.getBehavior = { kind: "network-error", message: "fetch failed" };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    // The send outcome is unknown AND the reconcile probe is unknown: retrying
    // could duplicate a landed message, so the adapter must stop.
    expect(result.status).toBe("failed");
    expect(server.postCount).toBe(1);
    expect(server.getCount).toBe(1);
  });

  it("fails closed when the reconcile 404 is a missing route, not a row-miss (hosted shape)", async () => {
    const server = makeFakeServer();
    // Transport error on the POST — the message may have landed. The hosted
    // service has no /v1/messages/by-uuid route, so the probe answers with the
    // generic unknown-route 404, indistinguishable by status from a row-miss.
    server.postBehavior = { kind: "network-error", message: "fetch failed" };
    server.getBehavior = { kind: "route-missing" };
    const client = makeClient(server);

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    // A generic 404 does NOT prove absence: the adapter must not resend a
    // possibly-landed message. No second POST may follow.
    expect(result.status).toBe("failed");
    expect(server.postCount).toBe(1);
    expect(server.getCount).toBe(1);
  });

  it("resolves the client from the package-contract env when the app namespace is absent", async () => {
    process.env.HASNA_CONVERSATIONS_API_URL = "http://contract.test";
    process.env.HASNA_CONVERSATIONS_API_KEY = "fx-a";
    const server = makeFakeServer();
    const client = createConversationsClient({ fetch: fakeFetch(server) });

    await client.getHealth();

    expect(server.lastRequestUrl).toContain("http://contract.test");
    expect(server.lastApiKeyHeader).toBe("fx-a");
  });

  it("prefers the app namespace (HASNA_MONITOR_*) over the package contract env", async () => {
    process.env.HASNA_MONITOR_CONVERSATIONS_API_URL = "http://monitor.test";
    process.env.HASNA_MONITOR_CONVERSATIONS_API_KEY = "fx-m";
    process.env.HASNA_CONVERSATIONS_API_URL = "http://contract.test";
    process.env.HASNA_CONVERSATIONS_API_KEY = "fx-a";
    const server = makeFakeServer();
    const client = createConversationsClient({ fetch: fakeFetch(server) });

    await client.getHealth();

    expect(server.lastRequestUrl).toContain("http://monitor.test");
    expect(server.lastApiKeyHeader).toBe("fx-m");
  });

  it("sends the configured API key header when provided and never surfaces its value in the result", async () => {
    const server = makeFakeServer();
    const client = new ConversationsClient({
      baseUrl: "http://monitor.test",
      apiKey: "monitor-test-key-value",
      fetch: fakeFetch(server),
    });

    const result = await sendConversationMessage("msg", { channelId: "ops", client });

    expect(result.status).toBe("delivered");
    expect(server.lastApiKeyHeader).toBe("monitor-test-key-value");
    expect(JSON.stringify(result)).not.toContain("monitor-test-key-value");
  });
});

describe("legacy postMessageToSpace", () => {
  it("delegates to ConversationsClient.sendMessage and resolves on delivery", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "ok", id: 55 };
    const client = makeClient(server);

    await expect(
      postMessageToSpace("legacy message", CONFIG, { client })
    ).resolves.toBeUndefined();
    expect(server.postCount).toBe(1);
    expect(server.postedBodies[0]?.["channel"]).toBe("ops");
    expect(server.postedBodies[0]?.["content"]).toBe("legacy message");
  });

  it("throws on a confirmed failure so existing non-fatal callers keep their catch", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "error", status: 403, error: "forbidden" };
    server.getBehavior = { kind: "not-found" };
    const client = makeClient(server);

    await expect(
      postMessageToSpace("legacy message", CONFIG, { client })
    ).rejects.toThrow(/403/);
    // The confirmed failure is looked up by effect key before throwing, but
    // the row is absent, so the failure stands and nothing is resent.
    expect(server.getCount).toBe(1);
  });

  it("passes the config api_key and from through to the request and never surfaces the key value", async () => {
    const server = makeFakeServer();
    server.postBehavior = { kind: "ok", id: 55 };
    const originalFetch = globalThis.fetch;
    // postMessageToSpace builds its client from config + env, so the fake
    // transport is injected through the global fetch the SDK falls back to.
    globalThis.fetch = fakeFetch(server) as typeof fetch;
    try {
      await postMessageToSpace("legacy message", {
        ...CONFIG,
        api_key: "config-key-value",
        from: "config-sender",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(server.postCount).toBe(1);
    expect(server.lastApiKeyHeader).toBe("config-key-value");
    expect(server.postedBodies[0]?.["from"]).toBe("config-sender");
    expect(JSON.stringify(server.postedBodies)).not.toContain("config-key-value");
  });
});
