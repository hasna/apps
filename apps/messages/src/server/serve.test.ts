/**
 * messages-serve HTTP surface tests — thin handlers over the domain, over a
 * local SQLite store (in-memory). Exercises the wire dialect: register,
 * send, threads, expand, unread, close/reopen, receive (delivery) and
 * delivery status, plus the x-api-key gate.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MessagesService, newThreadId } from "../service";
import { SqliteMessagesStore } from "./sqlite-store";
import { assertSafeBind, buildHandler } from "./serve-entry";

function makeHandler(key?: string) {
  const db = new Database(":memory:");
  const store = new SqliteMessagesStore(db);
  const service = new MessagesService(store);
  const handler = buildHandler({ service, backend: "sqlite" });
  const saved = process.env.HASNA_MESSAGES_API_KEY;
  if (key === undefined) delete process.env.HASNA_MESSAGES_API_KEY;
  else process.env.HASNA_MESSAGES_API_KEY = key;
  const close = () => {
    if (saved === undefined) delete process.env.HASNA_MESSAGES_API_KEY;
    else process.env.HASNA_MESSAGES_API_KEY = saved;
    store.close();
  };
  return { handler, db, close };
}

async function req(handler: (req: Request) => Promise<Response>, method: string, path: string, body?: unknown, key?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

// Typed json helper for the wire tests.
async function j<T = any>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

describe("messages-serve HTTP API", () => {
  afterAll(() => {
    delete process.env.HASNA_MESSAGES_API_KEY;
  });

  test("public contract endpoints answer", async () => {
    const { handler, close } = makeHandler();
    try {
      expect((await req(handler, "GET", "/health")).status).toBe(200);
      expect((await req(handler, "GET", "/ready")).status).toBe(200);
      const version = await j<{ name: string }>(await req(handler, "GET", "/version"));
      expect(version.name).toBe("@hasna/messages");
      expect((await req(handler, "GET", "/v1/openapi.json")).status).toBe(200);
    } finally {
      close();
    }
  });

  test("bind gate: non-loopback without a key is refused; loopback and keyed non-loopback are allowed (REGRESSION: P1 review finding)", () => {
    // Without a key, the server must only ever bind loopback — an absent key
    // disables auth, so a non-loopback bind would expose every /v1/* DM route.
    expect(() => assertSafeBind("0.0.0.0", false)).toThrow(/non-loopback bind/);
    expect(() => assertSafeBind("::", false)).toThrow(/non-loopback bind/);
    // Two-sided control: the gate must not refuse what is safe.
    expect(() => assertSafeBind("127.0.0.1", false)).not.toThrow();
    expect(() => assertSafeBind("localhost", false)).not.toThrow();
    expect(() => assertSafeBind("0.0.0.0", true)).not.toThrow();
  });

  test("x-api-key gate: a configured key is required on /v1/*", async () => {
    const { handler, close } = makeHandler("sekrit");
    try {
      const unauthorized = await req(handler, "GET", "/v1/agents");
      expect(unauthorized.status).toBe(401);
      const authorized = await req(handler, "GET", "/v1/agents", undefined, "sekrit");
      expect(authorized.status).toBe(200);
    } finally {
      close();
    }
  });

  test("full round-trip: register -> send -> receive -> delivery status -> read", async () => {
    const { handler, close } = makeHandler();
    try {
      const reg = await j<{ agent: { name: string } }>(await req(handler, "POST", "/v1/auth/register", { name: "augustus" }));
      expect(reg.agent.name).toBe("augustus");

      const sent = await j<{ message: { id: string; thread_id: string }; deliveries: Array<{ state: string }> }>(
        await req(handler, "POST", "/v1/messages", { from: "augustus", to: "silvanus", content: "ping" }),
      );
      expect(sent.message.thread_id).toBeTruthy();
      expect(sent.deliveries[0].state).toBe("stored");

      // Sender sees 'stored' (the repair): stored-but-undelivered is visible.
      const before = await j<{ deliveries: Array<{ deliveries: Array<{ state: string }> }> }>(
        await req(handler, "GET", `/v1/messages/delivery?thread=${sent.message.thread_id}`),
      );
      expect(before.deliveries[0].deliveries[0].state).toBe("stored");

      // Recipient drains its inbox -> delivered.
      const received = await j<{ messages: Array<{ delivery: { state: string } }> }>(
        await req(handler, "GET", "/v1/messages/receive?agent=silvanus"),
      );
      expect(received.messages).toHaveLength(1);
      expect(received.messages[0].delivery.state).toBe("delivered");

      // Sender now sees 'delivered'.
      const after = await j<{ deliveries: Array<{ deliveries: Array<{ state: string }> }> }>(
        await req(handler, "GET", `/v1/messages/delivery?thread=${sent.message.thread_id}`),
      );
      expect(after.deliveries[0].deliveries[0].state).toBe("delivered");

      // Recipient marks read -> 'read' + unread 0.
      await req(handler, "POST", `/v1/threads/${sent.message.thread_id}/read`, { agent: "silvanus" });
      const unread = await j<{ unread_count: number }>(
        await req(handler, "GET", `/v1/threads/${sent.message.thread_id}/unread?agent=silvanus`),
      );
      expect(unread.unread_count).toBe(0);
    } finally {
      close();
    }
  });

  test("thread close/reopen over HTTP", async () => {
    const { handler, close } = makeHandler();
    try {
      await req(handler, "POST", "/v1/messages", { from: "augustus", to: "silvanus", content: "hi" });
      const tid = newThreadId("augustus", "silvanus");
      await req(handler, "POST", `/v1/threads/${tid}/close`, { agent: "silvanus" });
      const open = await j<{ threads: Array<{ id: string }> }>(await req(handler, "GET", "/v1/threads?agent=silvanus"));
      expect(open.threads.map((t) => t.id)).not.toContain(tid);
      const all = await j<{ threads: Array<{ id: string; closed: boolean }> }>(
        await req(handler, "GET", "/v1/threads?agent=silvanus&open_only=0"),
      );
      expect(all.threads.find((t) => t.id === tid)!.closed).toBe(true);
      await req(handler, "POST", `/v1/threads/${tid}/reopen`, { agent: "silvanus" });
      const reopened = await j<{ threads: Array<{ id: string }> }>(await req(handler, "GET", "/v1/threads?agent=silvanus"));
      expect(reopened.threads.map((t) => t.id)).toContain(tid);
    } finally {
      close();
    }
  });

  test("unread endpoint lists unread threads and a total", async () => {
    const { handler, close } = makeHandler();
    try {
      await req(handler, "POST", "/v1/messages", { from: "augustus", to: "silvanus", content: "one" });
      await req(handler, "POST", "/v1/messages", { from: "augustus", to: "silvanus", content: "two" });
      const unread = await j<{ total: number; threads: unknown[] }>(await req(handler, "GET", "/v1/unread?agent=silvanus"));
      expect(unread.total).toBe(2);
      expect(unread.threads).toHaveLength(1);
    } finally {
      close();
    }
  });

  test("validation errors surface as 400 with an error body", async () => {
    const { handler, close } = makeHandler();
    try {
      const res = await req(handler, "POST", "/v1/messages", { from: "augustus", to: "augustus", content: "hi" });
      expect(res.status).toBe(400);
      expect((await j<{ error: string }>(res)).error).toBeTruthy();
      const missing = await req(handler, "GET", "/v1/threads");
      expect(missing.status).toBe(400);
    } finally {
      close();
    }
  });
});
