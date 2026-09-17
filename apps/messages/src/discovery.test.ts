import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MessagesService, type MessagesStore } from "./service";
import { SqliteMessagesStore } from "./server/sqlite-store";
import { PostgresMessagesStore } from "./server/postgres-store";
import { buildHandler } from "./server/serve-entry";
import { createAuthGate } from "./server/auth";
import { MessagesClient } from "./sdk";
import type { SendResult } from "./types";

const closers: Array<() => unknown> = [];
afterAll(async () => {
  for (const close of closers) await close();
});

function suite(name: string, create: () => Promise<MessagesStore>) {
  describe(`${name}: station discovery and durable runtime inbox`, () => {
    test("station metadata is optional; presence is explicit, and directory pagination is bounded", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      await svc.registerAgent("old-client");
      await svc.heartbeat({ runtime_id: "box", agents: [{ name: "generic" }] });
      await svc.heartbeat({
        runtime_id: "box",
        station: "station02",
        application: "sample-harness",
        agents: [
          { name: "alice", display_name: "Reviewer" },
          { name: "bob", display_name: "Builder" },
          { name: "charlie" },
        ],
      });
      const first = await svc.discoverAgents({
        station: "station02",
        limit: 2,
      });
      expect(first.agents.map((a) => a.name)).toEqual(["alice", "bob"]);
      expect(
        first.agents.every(
          (a) => a.online && a.application === "sample-harness",
        ),
      ).toBe(true);
      const second = await svc.discoverAgents({
        station: "station02",
        limit: 2,
        cursor: first.next_cursor!,
      });
      expect(second.agents.map((a) => a.name)).toEqual(["charlie"]);
      expect(second.next_cursor).toBeNull();
      expect(
        (await svc.discoverAgents({ search: "review" })).agents[0]?.name,
      ).toBe("alice");
      expect((await svc.discoverAgents({ search: "%" })).agents).toEqual([]);
      expect(
        (await svc.discoverAgents({ online: false })).agents.map((a) => a.name),
      ).toEqual(["old-client"]);
      expect(
        (await svc.discoverAgents({ search: "generic" })).agents[0]?.station,
      ).toBeNull();
      expect((await svc.listAgents()).length).toBe(5);
      await expect(svc.discoverAgents({ limit: 501 })).rejects.toThrow("limit");
      await expect(svc.discoverAgents({ cursor: "garbage" })).rejects.toThrow(
        "cursor",
      );
    });

    test("a sender cannot make its offline recipient appear online", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      await svc.send({
        from_agent: "alice",
        to_agent: "offline",
        content: "hello",
      });
      const recipient = (await svc.discoverAgents({ search: "offline" }))
        .agents[0]!;
      expect(recipient.online).toBe(false);
      expect(recipient.last_seen_at).toBeNull();
      const old = "2020-01-01T00:00:00.000Z";
      await store.heartbeat(
        [
          {
            agent: "offline",
            runtime_id: "lost",
            station: "station03",
            application: "anything",
            heartbeat_at: old,
            expires_at: old,
          },
        ],
        new Map(),
      );
      await svc.send({
        from_agent: "alice",
        to_agent: "offline",
        content: "still there?",
      });
      const expired = (await svc.discoverAgents({ station: "station03" }))
        .agents[0]!;
      expect(expired.online).toBe(false);
      expect(expired.station).toBe("station03");
      expect(expired.last_seen_at).toBe(old);
      expect((await svc.runtimeInbox("lost")).messages).toHaveLength(0);
      await svc.heartbeat({
        runtime_id: "reconnected",
        station: "station03",
        agents: [{ name: "offline" }],
      });
      expect((await svc.runtimeInbox("reconnected")).messages).toHaveLength(2);
    });

    test("heartbeat is atomic; an online agent has one owner; retries and expiry work", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      const input = {
        runtime_id: "first",
        station: "station01",
        agents: [{ name: "owner" }],
      };
      await svc.heartbeat(input);
      await svc.heartbeat(input);
      await expect(
        svc.heartbeat({
          runtime_id: "second",
          agents: [{ name: "new-agent" }, { name: "owner" }],
        }),
      ).rejects.toThrow("online receiver");
      expect(await store.findAgentByName("new-agent")).toBeNull();
      expect(
        (await svc.discoverAgents({ search: "owner" })).agents[0]?.runtime_id,
      ).toBe("first");
      await svc.heartbeat({
        ...input,
        agents: [{ name: "owner", display_name: "Renamed agent" }],
      });
      expect(
        (await svc.discoverAgents({ search: "renamed" })).agents[0]
          ?.display_name,
      ).toBe("Renamed agent");
      await expect(
        svc.heartbeat({
          ...input,
          agents: [{ name: "owner" }, { name: "OWNER" }],
        }),
      ).rejects.toThrow("duplicate");
    });

    test("batched reads replay until durable acknowledgement; acknowledgements are owner-bound and preserve read receipts", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      await svc.heartbeat({
        runtime_id: "one",
        station: "station01",
        agents: [{ name: "a" }, { name: "b" }],
      });
      await svc.heartbeat({
        runtime_id: "two",
        station: "station02",
        agents: [{ name: "c" }],
      });
      const ab = await svc.send({
        from_agent: "a",
        to_agent: "b",
        content: "same station",
      });
      const ac = await svc.send({
        from_agent: "a",
        to_agent: "c",
        content: "cross station",
      });
      const first = await svc.runtimeInbox("two");
      expect(first.messages.map((x) => x.message.id)).toEqual([ac.message.id]);
      expect(await svc.runtimeInbox("two")).toEqual(first);
      expect((await svc.acknowledge("one", [ac.message.id])).acknowledged).toBe(
        0,
      );
      expect(
        (await svc.acknowledge("two", [ac.message.id, ab.message.id]))
          .acknowledged,
      ).toBe(1);
      expect((await svc.runtimeInbox("two")).messages).toHaveLength(0);
      expect((await svc.runtimeInbox("one")).messages).toHaveLength(1);
      expect(
        (await svc.deliveryStatus(ac.thread.id))[0]!.deliveries[0]!.state,
      ).toBe("delivered");
      await svc.markMessageRead(ac.message.id, "c");
      expect((await svc.acknowledge("two", [ac.message.id])).acknowledged).toBe(
        0,
      );
      expect(
        (await svc.deliveryStatus(ac.thread.id))[0]!.deliveries[0]!.state,
      ).toBe("read");
    });

    test("concurrent send retries create exactly one durable message and reject changed contents", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      const request = {
        from_agent: "sender",
        to_agent: "receiver",
        content: "once",
        idempotency_key: "retry-1",
      };
      const results = await Promise.all(
        Array.from({ length: 20 }, () => svc.send(request)),
      );
      expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
      expect(await store.countMessages(results[0]!.thread.id)).toBe(1);
      expect(
        (await svc.deliveryStatus(results[0]!.thread.id))[0]?.deliveries,
      ).toHaveLength(1);
      await expect(
        svc.send({ ...request, content: "changed" }),
      ).rejects.toThrow("different request");
      await expect(
        svc.send({ ...request, to_agent: "different-recipient" }),
      ).rejects.toThrow("different request");
      const other = await svc.send({ ...request, from_agent: "other-sender" });
      expect(other.message.id).not.toBe(results[0]!.message.id);
      const distinct = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          svc.send({ ...request, idempotency_key: `fresh-${i}` }),
        ),
      );
      expect(new Set(distinct.map((r) => r.message.seq)).size).toBe(12);
      expect(await store.countMessages(results[0]!.thread.id)).toBe(13);
    });

    test("a failed send transaction leaves neither a message, thread nor a consumed retry key", async () => {
      const store = await create();
      const now = new Date().toISOString();
      const input = {
        thread: {
          id: "rollback",
          agent_a: "a",
          agent_b: "b",
          created_at: now,
          last_message_at: now,
        },
        message: {
          id: "rollback-message",
          thread_id: "rollback",
          from_agent: "a",
          content: null as unknown as string,
          reply_to: null,
          created_at: now,
        },
        delivery: {
          recipient: "b",
          state: "stored" as const,
          stored_at: now,
          delivered_at: null,
          read_at: null,
        },
        requestKey: "rollback-key",
        requestHash: "same-request",
      };
      await expect(store.commitSend(input)).rejects.toThrow();
      expect(await store.findThread("rollback")).toBeNull();
      expect(await store.countMessages("rollback")).toBe(0);
      const result = await store.commitSend({
        ...input,
        message: { ...input.message, content: "valid" },
      });
      expect(result.message.id).toBe("rollback-message");
      expect(result.deliveries).toHaveLength(1);
    });

    test("hundreds of agents share bounded pages without duplicate or missing identities", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      for (let batch = 0; batch < 3; batch++)
        await svc.heartbeat({
          runtime_id: "large",
          agents: Array.from({ length: 400 }, (_, i) => ({
            name: `worker-${String(batch * 400 + i).padStart(4, "0")}`,
          })),
        });
      let cursor: string | undefined;
      const names: string[] = [];
      do {
        const page = await svc.discoverAgents({ limit: 97, cursor });
        names.push(...page.agents.map((a) => a.name));
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      expect(names).toHaveLength(1200);
      expect(new Set(names).size).toBe(1200);
    });

    test("long polling ends on cancellation and an expired receiver cannot acknowledge", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      await svc.heartbeat({
        runtime_id: "gone",
        agents: [{ name: "recipient" }],
      });
      const sent = await svc.send({
        from_agent: "sender",
        to_agent: "recipient",
        content: "pending",
      });
      const old = "2020-01-01T00:00:00.000Z";
      await store.heartbeat(
        [
          {
            agent: "recipient",
            runtime_id: "gone",
            station: null,
            application: null,
            heartbeat_at: old,
            expires_at: old,
          },
        ],
        new Map(),
      );
      expect(
        (await svc.acknowledge("gone", [sent.message.id])).acknowledged,
      ).toBe(0);
      const handler = buildHandler({
        service: svc,
        backend: name === "postgresql" ? "postgresql" : "sqlite",
        auth: createAuthGate({ env: {} }),
      });
      const controller = new AbortController();
      const pending = handler(
        new Request("http://localhost/v1/inbox?runtime_id=gone&wait_ms=15000", {
          signal: controller.signal,
        }),
      );
      setTimeout(() => controller.abort(), 25);
      const before = Date.now();
      const response = await pending;
      expect(Date.now() - before).toBeLessThan(2000);
      expect(response.status).toBe(200);
    });

    test("HTTP and SDK use the same discovery, heartbeat, replay and acknowledgement contract", async () => {
      const store = await create();
      const svc = new MessagesService(store);
      const handler = buildHandler({
        service: svc,
        backend: name === "postgresql" ? "postgresql" : "sqlite",
        auth: createAuthGate({ env: {} }),
      });
      const client = new MessagesClient({
        baseUrl: "http://localhost:1234",
        fetch: ((url: string, options: RequestInit) =>
          handler(new Request(url, options))) as typeof fetch,
      });
      await client.heartbeat({
        runtime_id: "web",
        station: "office",
        agents: [{ name: "web-agent" }],
      });
      expect(
        (await client.discoverAgents({ station: "office", online: true }))
          .agents[0]?.name,
      ).toBe("web-agent");
      const sent = await client.send("sender", "web-agent", "hello");
      expect((await client.runtimeInbox("web")).messages[0]?.message.id).toBe(
        sent.message.id,
      );
      expect(
        (await client.acknowledge("web", [sent.message.id])).acknowledged,
      ).toBe(1);
      expect((await client.runtimeInbox("web")).messages).toEqual([]);
      const invalid = await handler(
        new Request("http://localhost/v1/agents/discover?online=maybe"),
      );
      expect(invalid.status).toBe(400);
      const conflict = await handler(
        new Request("http://localhost/v1/agents/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            runtime_id: "other",
            agents: [{ name: "web-agent" }],
          }),
        }),
      );
      expect(conflict.status).toBe(409);
      const post = (key: string, bodyKey?: string) =>
        handler(
          new Request("http://localhost/v1/messages", {
            method: "POST",
            headers: {
              "Idempotency-Key": key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "sender",
              to: "web-agent",
              content: "header retry",
              idempotency_key: bodyKey,
            }),
          }),
        );
      const first = await post("header-key");
      expect(first.status).toBe(201);
      const firstBody = await first.json() as SendResult;
      const second = await post("header-key", "header-key");
      expect(second.status).toBe(201);
      expect((await second.json() as SendResult).message.id).toBe(firstBody.message.id);
      expect((await post("header-key", "different")).status).toBe(400);
    });
  });
}

suite("sqlite", async () => {
  const store = new SqliteMessagesStore(new Database(":memory:"));
  closers.push(() => store.close());
  return store;
});

// The live gate provides a throwaway PostgreSQL database. Each test gets its
// own schema; no production DSN or shared data can be accidentally cleaned up.
if (process.env.MESSAGES_TEST_DATABASE_URL) {
  const pg = await import("pg");
  suite("postgresql", async () => {
    const url = new URL(process.env.MESSAGES_TEST_DATABASE_URL!);
    const schema = `proof_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new pg.default.Pool({ connectionString: url.toString() });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const store = new PostgresMessagesStore(url.toString());
    await store.init();
    closers.push(async () => {
      await store.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    });
    return store;
  });
}
